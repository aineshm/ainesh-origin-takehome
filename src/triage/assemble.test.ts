import { describe, it, expect } from "vitest";
import {
  normalizeDiscipline,
  assembleItemOutput,
  minimalSafeOutput,
} from "./assemble.js";
import type { TriageJudgment } from "../agent/judgment.js";
import type { InboxItem, ToolCall } from "../types.js";

const item: InboxItem = {
  id: "item_1",
  channel: "email",
  received_at: "2026-04-27T19:43:00-07:00",
  sender: "s",
  subject: "subj",
  body: "body",
  attachments: [],
};

const toolsCalled: ToolCall[] = [
  {
    call_id: "c1",
    name: "verify_insurance",
    args: { payer: "Aetna PPO" },
    result_summary: "insurance status: in_network",
  },
];

describe("normalizeDiscipline", () => {
  it("filters invalid + dedupes", () => {
    expect(normalizeDiscipline(["OT", "OT", "ZZ"])).toEqual(["OT"]);
  });
  it("empty array -> null", () => {
    expect(normalizeDiscipline([])).toBeNull();
  });
  it("null -> null", () => {
    expect(normalizeDiscipline(null)).toBeNull();
  });
});

describe("assembleItemOutput", () => {
  it("hardcodes requires_human_review, passes tools through, normalizes discipline", () => {
    const judgment: TriageJudgment = {
      classification: "new_referral",
      urgency: "P2",
      extracted_intake: {
        child_name: null,
        dob_or_age: null,
        parent_contact: null,
        discipline: ["OT", "OT", "ZZ"] as unknown as ("SLP" | "OT" | "PT")[],
        diagnosis_or_concern: null,
        payer: null,
        member_id: null,
      },
      missing_info: [],
      recommended_next_action: "x",
      draft_reply: null,
      escalation: null,
      decision_rationale: "x",
    };

    const out = assembleItemOutput(item, judgment, toolsCalled, ["task_1"]);
    expect(out.requires_human_review).toBe(true);
    expect(out.tools_called).toBe(toolsCalled);
    expect(out.extracted_intake.discipline).toEqual(["OT"]);
    expect(out.task_ids).toEqual(["task_1"]);
    expect(out.item_id).toBe("item_1");
  });
});

describe("minimalSafeOutput", () => {
  it("is a conservative P2 output that preserves the trace", () => {
    const out = minimalSafeOutput(item, toolsCalled);
    expect(out.urgency).toBe("P2");
    expect(out.requires_human_review).toBe(true);
    expect(out.tools_called).toBe(toolsCalled);
    expect(out.classification).toBe("other");
  });
});
