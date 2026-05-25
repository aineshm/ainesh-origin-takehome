import type { InboxItem, ItemOutput } from "./types.js";
import { getToolCallsForItem, withItemContext } from "./tools.js";
import { computeBatchNow } from "./llm/prompt.js";
import { runItemLoop } from "./llm/loop.js";
import { applySafetyNet } from "./triage/safetyNet.js";
import { assembleItemOutput, minimalSafeOutput } from "./triage/assemble.js";

/**
 * Triage the inbox: one ItemOutput per item, processed sequentially. Each item
 * runs inside withItemContext so tool calls are attributed to it in the audit
 * trace. The model loop produces a judgment; the deterministic safety net may
 * escalate upward; output is assembled from the verbatim trace. A per-item
 * failure yields a minimal safe output (still surfacing any recorded tool calls)
 * so one bad item never sinks the batch.
 */
export async function runAgent(inbox: InboxItem[]): Promise<ItemOutput[]> {
  const batchNow = computeBatchNow(inbox);
  const outputs: ItemOutput[] = [];

  for (const item of inbox) {
    const output = await withItemContext(
      item.id,
      async (): Promise<ItemOutput> => {
        try {
          const { judgment, taskIds } = await runItemLoop(item, batchNow);
          const net = await applySafetyNet(item, judgment);
          const toolsCalled = getToolCallsForItem(item.id);
          return assembleItemOutput(item, net.judgment, toolsCalled, [
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
