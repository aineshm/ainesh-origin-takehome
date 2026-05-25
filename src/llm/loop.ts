import type Anthropic from "@anthropic-ai/sdk";
import type { InboxItem } from "../types.js";
import type { ItemResult, TriageJudgment } from "../agent/judgment.js";
import { getClient, MAX_TURNS, MODEL } from "./client.js";
import { executeTool } from "./executor.js";
import { REAL_TOOL_NAMES, SUBMIT_TRIAGE, toolDefinitions } from "./toolSchemas.js";
import { buildSystemPrompt, renderItem } from "./prompt.js";
import type { PrivacyVault } from "../privacy/vault.js";

// Generous cap so a full submit_triage payload (draft reply + rationale) is never
// truncated mid-tool-use, which would corrupt the JSON we parse from it.
const MAX_TOKENS = 4096;

function toolUseBlocks(content: Anthropic.ContentBlock[]): Anthropic.ToolUseBlock[] {
  return content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
}

/**
 * Run the per-item tool-use loop. The model orchestrates the real tools
 * (executed via the executor inside the caller's `withItemContext`, which records
 * the audit trace) and finishes by calling `submit_triage`. Real tool blocks in a
 * turn are always executed before a sibling `submit_triage` terminates the loop, so
 * a parallel tool call is never dropped.
 *
 * MUST be called inside `withItemContext(item.id, ...)`.
 */
export async function runItemLoop(
  item: InboxItem,
  batchNowISO: string,
  vault: PrivacyVault,
): Promise<ItemResult> {
  const client = getClient();
  const system = buildSystemPrompt();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: renderItem(item, batchNowISO) },
  ];
  const taskIds: string[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: toolDefinitions,
      messages,
    });

    const blocks = toolUseBlocks(res.content);
    const submitBlock = blocks.find((block) => block.name === SUBMIT_TRIAGE);
    const realBlocks = blocks.filter((block) => REAL_TOOL_NAMES.has(block.name));

    // Execute every real tool call first (records the trace), gathering results.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of realBlocks) {
      const exec = await executeTool(
        block.name,
        block.input as Record<string, unknown>,
        vault,
      );
      if (exec.taskId) {
        taskIds.push(exec.taskId);
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: exec.content,
      });
    }

    // A submit_triage block in this turn is terminal (after siblings ran). We end
    // here without sending tool_results back — the conversation is over, so the
    // API never needs them.
    if (submitBlock) {
      return { judgment: submitBlock.input as TriageJudgment, taskIds };
    }

    // Real tools but no submit yet: feed results back and continue.
    if (realBlocks.length > 0) {
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // No tools at all (model ended its turn with text): force a submission.
    messages.push({ role: "assistant", content: res.content });
    return { judgment: await forceSubmit(client, system, messages), taskIds };
  }

  // Turn cap reached without a submission: force a final one.
  return { judgment: await forceSubmit(client, system, messages), taskIds };
}

/**
 * Force the model to emit its structured judgment via `submit_triage`. Adds a
 * nudge only when the last message is the assistant's (avoids two consecutive
 * user turns when pending tool results already prompt a response).
 */
async function forceSubmit(
  client: Anthropic,
  system: string,
  messages: Anthropic.MessageParam[],
): Promise<TriageJudgment> {
  if (messages[messages.length - 1]?.role === "assistant") {
    messages.push({
      role: "user",
      content: "Submit your final triage judgment now by calling submit_triage.",
    });
  }

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    tools: toolDefinitions,
    messages,
    tool_choice: { type: "tool", name: SUBMIT_TRIAGE },
  });

  const submit = toolUseBlocks(res.content).find(
    (block) => block.name === SUBMIT_TRIAGE,
  );
  if (!submit) {
    throw new Error("Model did not return a submit_triage judgment when forced.");
  }
  return submit.input as TriageJudgment;
}
