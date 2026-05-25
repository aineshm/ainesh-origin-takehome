import { describe, it, expect } from "vitest";
import type { TriageJudgment } from "./judgment.js";

describe("smoke", () => {
  it("resolves .js imports under NodeNext", () => {
    const urgency: TriageJudgment["urgency"] = "P2";
    expect(urgency).toBe("P2");
  });
});
