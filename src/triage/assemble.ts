import type { InboxItem, ItemOutput, ToolCall } from "../types.js";
import type { TriageJudgment } from "../agent/judgment.js";

const VALID_DISCIPLINES: ReadonlyArray<"SLP" | "OT" | "PT"> = [
  "SLP",
  "OT",
  "PT",
];

/**
 * Pure normalizer for the discipline field. Non-array input yields null.
 * Filters to the valid discipline set, dedupes, and returns null when empty.
 */
export function normalizeDiscipline(
  raw: unknown,
): ("SLP" | "OT" | "PT")[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const filtered = raw.filter((value): value is "SLP" | "OT" | "PT" =>
    VALID_DISCIPLINES.includes(value as "SLP" | "OT" | "PT"),
  );
  const deduped = Array.from(new Set(filtered));

  return deduped.length === 0 ? null : deduped;
}

/**
 * Assembles the final ItemOutput from the judgment, the verbatim trace tool
 * calls, and the collected task ids. requires_human_review is always true.
 */
export function assembleItemOutput(
  item: InboxItem,
  judgment: TriageJudgment,
  toolsCalled: ToolCall[],
  taskIds: string[],
): ItemOutput {
  return {
    item_id: item.id,
    classification: judgment.classification,
    urgency: judgment.urgency,
    requires_human_review: true,
    extracted_intake: {
      ...judgment.extracted_intake,
      discipline: normalizeDiscipline(judgment.extracted_intake.discipline),
    },
    missing_info: judgment.missing_info,
    tools_called: toolsCalled,
    recommended_next_action: judgment.recommended_next_action,
    draft_reply: judgment.draft_reply,
    task_ids: taskIds,
    escalation: judgment.escalation,
    decision_rationale: judgment.decision_rationale,
  };
}

/**
 * Conservative fallback output emitted when automated triage fails for an item.
 * Preserves whatever tool calls were recorded before the failure.
 */
export function minimalSafeOutput(
  item: InboxItem,
  toolsCalled: ToolCall[],
): ItemOutput {
  return {
    item_id: item.id,
    classification: "other",
    urgency: "P2",
    requires_human_review: true,
    extracted_intake: {
      child_name: null,
      dob_or_age: null,
      parent_contact: null,
      discipline: null,
      diagnosis_or_concern: null,
      payer: null,
      member_id: null,
    },
    missing_info: [
      "Automated triage failed for this item; manual review required.",
    ],
    tools_called: toolsCalled,
    recommended_next_action: "Manual review — automated triage error.",
    draft_reply: null,
    task_ids: [],
    escalation: null,
    decision_rationale: "Processing error; emitted minimal safe output.",
  };
}
