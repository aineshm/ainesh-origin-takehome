import type { Classification, ExtractedIntake, Urgency } from "../types.js";

/**
 * The structured judgment the model returns via the `submit_triage` tool.
 * This is the model's decision surface only — assembly-layer invariants
 * (requires_human_review, tools_called, task_ids) are added in assemble.ts.
 */
export interface TriageJudgment {
  classification: Classification;
  urgency: Urgency;
  extracted_intake: ExtractedIntake;
  missing_info: string[];
  recommended_next_action: string;
  draft_reply: string | null;
  escalation: { reason: string; severity: "P0" | "P1" } | null;
  decision_rationale: string;
}

/** Result of processing one item through the loop (+ safety net). */
export interface ItemResult {
  judgment: TriageJudgment;
  taskIds: string[];
}
