import type { Assignee, Discipline, PolicyTopic } from "../types.js";
import {
  create_task,
  draft_message,
  escalate,
  find_slots,
  hold_slot,
  lookup_policy,
  search_patient,
  verify_insurance,
} from "../tools.js";

/** Result of executing one real tool: its JSON-stringified rich data plus an
 * optional task id surfaced when the tool was `create_task`. */
export interface ToolExecResult {
  content: string;
  taskId?: string;
}

/**
 * Dispatch a model tool call by name to the matching `src/tools.ts` function.
 * Returns the tool's rich `data` JSON-stringified as `content`; for
 * `create_task` it also surfaces the new `task_id` as `taskId`. Throws on an
 * unknown tool name. Must be called inside the caller's `withItemContext`.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult> {
  switch (name) {
    case "search_patient": {
      const result = await search_patient({
        name: input.name as string | undefined,
        dob: input.dob as string | undefined,
      });
      return { content: JSON.stringify(result.data) };
    }
    case "verify_insurance": {
      const result = await verify_insurance({
        payer: input.payer as string | undefined,
        member_id: input.member_id as string | undefined,
      });
      return { content: JSON.stringify(result.data) };
    }
    case "lookup_policy": {
      const result = await lookup_policy({
        topic: input.topic as PolicyTopic,
      });
      return { content: JSON.stringify(result.data) };
    }
    case "find_slots": {
      const result = await find_slots({
        discipline: input.discipline as Discipline | undefined,
        preferences: input.preferences as string | undefined,
        language: input.language as string | undefined,
      });
      return { content: JSON.stringify(result.data) };
    }
    case "hold_slot": {
      const result = await hold_slot({
        slot_id: input.slot_id as string,
        patient_ref: input.patient_ref as string,
      });
      return { content: JSON.stringify(result.data) };
    }
    case "create_task": {
      const result = await create_task({
        assignee: input.assignee as Assignee,
        title: input.title as string,
        due: input.due as string,
        notes: input.notes as string,
      });
      return { content: JSON.stringify(result.data), taskId: result.data.task_id };
    }
    case "draft_message": {
      const result = await draft_message({
        recipient: input.recipient as string,
        channel: input.channel as "portal" | "email" | "phone",
        body: input.body as string,
        language: input.language as "en" | "es" | undefined,
      });
      return { content: JSON.stringify(result.data) };
    }
    case "escalate": {
      const result = await escalate({
        item_id: input.item_id as string,
        reason: input.reason as string,
        severity: input.severity as "P0" | "P1",
      });
      return { content: JSON.stringify(result.data) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
