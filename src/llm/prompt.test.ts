import { describe, it, expect } from "vitest";
import type { InboxItem } from "../types.js";
import { buildSystemPrompt, computeBatchNow, renderItem } from "./prompt.js";

const mkItem = (id: string, received_at: string, body: string): InboxItem => ({
  id,
  channel: "voicemail_transcript",
  received_at,
  sender: "test sender",
  subject: "test subject",
  body,
  attachments: [],
});

describe("computeBatchNow", () => {
  it("returns the latest received_at for a 2-item fixture", () => {
    const earlier = mkItem("a", "2026-04-27T18:12:00-07:00", "first");
    const later = mkItem("b", "2026-04-28T07:36:00-07:00", "second");
    expect(computeBatchNow([earlier, later])).toBe("2026-04-28T07:36:00-07:00");
    // Order-independent.
    expect(computeBatchNow([later, earlier])).toBe("2026-04-28T07:36:00-07:00");
  });

  it("throws on an empty inbox", () => {
    expect(() => computeBatchNow([])).toThrow();
  });
});

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("contains the required policy substrings", () => {
    expect(prompt).toContain("P0");
    expect(prompt).toContain("submit_triage");
    expect(prompt).toContain("clinical_lead");
    expect(prompt).toContain("never"); // never auto-send / never schedule (case-insensitive presence)
  });

  it("mentions never-send and never-schedule guardrails", () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("auto-send");
    expect(lower).toContain("schedule");
  });
});

describe("renderItem", () => {
  it("includes the item body and the batchNowISO string", () => {
    const item = mkItem("item_x", "2026-04-27T19:43:00-07:00", "hello world body text");
    const batchNow = "2026-04-28T07:36:00-07:00";
    const rendered = renderItem(item, batchNow);
    expect(rendered).toContain("hello world body text");
    expect(rendered).toContain(batchNow);
    expect(rendered).toContain(item.received_at);
  });
});
