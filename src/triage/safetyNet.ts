import type { InboxItem } from "../types.js";
import type { TriageJudgment } from "../agent/judgment.js";
import { getToolCallsForItem, escalate, create_task } from "../tools.js";

/**
 * Focused phrase list for clear harm/abuse/neglect/unsafe-caregiving signals.
 * Kept conservative to avoid false positives.
 */
const SAFEGUARDING_PHRASES: readonly string[] = [
  "getting rough",
  "rough with him",
  "rough with her",
  "hit ",
  "hits ",
  "abuse",
  "neglect",
  "unsafe",
  "hurt",
  "afraid of",
  "scared of",
];

const DEFAULT_SAFEGUARDING_REASON =
  "Safeguarding signal detected in message; routed to clinical lead for same-hour review.";

/**
 * Pure detector: returns true on clear safeguarding signals in the
 * lowercased subject + body. Conservative phrase matching.
 */
export function detectSafeguarding(item: InboxItem): boolean {
  const haystack = `${item.subject} ${item.body}`.toLowerCase();
  return SAFEGUARDING_PHRASES.some((phrase) => haystack.includes(phrase));
}

/**
 * Deterministic safety net. If no safeguarding signal, returns the judgment
 * unchanged. Otherwise forces P0 + escalation (immutably), and ensures an
 * `escalate` call and a `clinical_lead` `create_task` exist in the trace,
 * creating any that are missing. MUST be called inside withItemContext.
 */
export async function applySafetyNet(
  item: InboxItem,
  judgment: TriageJudgment,
): Promise<{ judgment: TriageJudgment; taskIds: string[] }> {
  if (!detectSafeguarding(item)) {
    return { judgment, taskIds: [] };
  }

  const escalation =
    judgment.escalation ?? {
      reason: DEFAULT_SAFEGUARDING_REASON,
      severity: "P0" as const,
    };

  const updatedJudgment: TriageJudgment = {
    ...judgment,
    urgency: "P0",
    escalation,
  };

  const priorCalls = getToolCallsForItem(item.id);

  const hasEscalate = priorCalls.some((call) => call.name === "escalate");
  if (!hasEscalate) {
    await escalate({
      item_id: item.id,
      reason: escalation.reason,
      severity: "P0",
    });
  }

  const hasClinicalLeadTask = priorCalls.some(
    (call) =>
      call.name === "create_task" && call.args.assignee === "clinical_lead",
  );

  const taskIds: string[] = [];
  if (!hasClinicalLeadTask) {
    const result = await create_task({
      assignee: "clinical_lead",
      title: `Same-hour safeguarding review: ${item.id}`,
      due: item.received_at.slice(0, 10),
      notes:
        "Auto-flagged safeguarding signal; clinical lead to review within the hour.",
    });
    taskIds.push(result.data.task_id);
  }

  return { judgment: updatedJudgment, taskIds };
}
