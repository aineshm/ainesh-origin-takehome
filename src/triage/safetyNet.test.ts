import { describe, it, expect, beforeAll } from "vitest";
import { configureTrace, withItemContext, getToolCallsForItem } from "../tools.js";
import { detectSafeguarding, applySafetyNet } from "./safetyNet.js";
import type { TriageJudgment } from "../agent/judgment.js";
const base: TriageJudgment = { classification:"new_referral", urgency:"P2", extracted_intake:{child_name:null,dob_or_age:null,parent_contact:null,discipline:null,diagnosis_or_concern:null,payer:null,member_id:null}, missing_info:[], recommended_next_action:"x", draft_reply:null, escalation:null, decision_rationale:"x" };
const item = (id:string, body:string) => ({ id, channel:"voicemail_transcript" as const, received_at:"2026-04-27T19:43:00-07:00", sender:"s", subject:"", body, attachments:[] });
beforeAll(() => configureTrace({ path: ".trace/test-safety.jsonl" }));
describe("safety net", () => {
  it("detects safeguarding", () => {
    expect(detectSafeguarding(item("i","his dad started getting rough with him"))).toBe(true);
    expect(detectSafeguarding(item("i","articulation delay, please evaluate"))).toBe(false);
  });
  it("forces P0 + escalate + clinical-lead task", async () => {
    await withItemContext("sg1", async () => {
      const r = await applySafetyNet(item("sg1","getting rough with him"), base);
      expect(r.judgment.urgency).toBe("P0");
      expect(r.judgment.escalation).not.toBeNull();
      const calls = getToolCallsForItem("sg1");
      expect(calls.some(c => c.name === "escalate")).toBe(true);
      expect(calls.some(c => c.name === "create_task")).toBe(true);
    });
  });
});
