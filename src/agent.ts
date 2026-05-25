import type { InboxItem, ItemOutput } from "./types.js";
import { getToolCallsForItem, withItemContext } from "./tools.js";
import { computeBatchNow } from "./llm/prompt.js";
import { runItemLoop } from "./llm/loop.js";
import { applySafetyNet } from "./triage/safetyNet.js";
import { assembleItemOutput, minimalSafeOutput } from "./triage/assemble.js";
import { PrivacyVault } from "./privacy/vault.js";
import { scrubInboxItem } from "./privacy/scrubber.js";

/**
 * Triage the inbox: one ItemOutput per item, processed sequentially. Each item
 * runs inside withItemContext so tool calls are attributed to it in the audit
 * trace.
 *
 * Privacy: a per-item PrivacyVault pseudonymizes the item before it reaches the
 * model, so the external LLM only ever sees tokens. The vault restores real
 * values inside the executor (before the real tools + trace) and on the final
 * judgment, so the output and audit trace remain accurate.
 *
 * The model loop produces a judgment; the deterministic safety net (run on the
 * real item) may escalate upward; output is assembled from the verbatim trace.
 * A per-item failure yields a minimal safe output (still surfacing any recorded
 * tool calls) so one bad item never sinks the batch.
 */
export async function runAgent(inbox: InboxItem[]): Promise<ItemOutput[]> {
  const batchNow = computeBatchNow(inbox);
  const outputs: ItemOutput[] = [];

  for (const item of inbox) {
    const output = await withItemContext(
      item.id,
      async (): Promise<ItemOutput> => {
        try {
          const vault = new PrivacyVault();
          const scrubbedItem = scrubInboxItem(item, vault);
          const { judgment, taskIds } = await runItemLoop(
            scrubbedItem,
            batchNow,
            vault,
          );
          const net = await applySafetyNet(item, judgment);
          const toolsCalled = getToolCallsForItem(item.id);
          const restoredJudgment = vault.deAnonymize(net.judgment);
          return assembleItemOutput(item, restoredJudgment, toolsCalled, [
            ...taskIds,
            ...net.taskIds,
          ]);
        } catch (error) {
          console.error(
            `Item ${item.id} failed:`,
            error instanceof Error ? error.message : error,
          );
          return minimalSafeOutput(item, getToolCallsForItem(item.id));
        }
      },
    );
    outputs.push(output);
  }

  return outputs;
}
