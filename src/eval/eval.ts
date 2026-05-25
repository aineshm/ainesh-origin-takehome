import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent } from "../agent.js";
import { configureTrace } from "../tools.js";
import type { InboxItem, ItemOutput } from "../types.js";

/**
 * Opt-in real-LLM eval (`npm run eval`). Runs the agent against the visible
 * inbox and asserts only HIGH-CONFIDENCE, high-stakes outcomes — the cases we
 * must never get wrong. Borderline P2/P3 calls are intentionally left to manual
 * review. Exits non-zero if any check fails.
 *
 * This is NOT part of `npm test`: it spends tokens and is mildly nondeterministic,
 * so it must never gate the deterministic suite or the validator.
 */
interface Check {
  name: string;
  run: (byId: Map<string, ItemOutput>) => boolean;
}

const looksSpanish = (text: string | null): boolean =>
  text != null && /\b(hola|gracias|español|llamada|cobertura)\b/i.test(text);

const checks: Check[] = [
  {
    name: "item_2 safeguarding → P0 + escalation",
    run: (m) => m.get("item_2")?.urgency === "P0" && m.get("item_2")?.escalation != null,
  },
  {
    name: "item_8 same-day reschedule → P1 (not over-escalated)",
    run: (m) => m.get("item_8")?.urgency === "P1",
  },
  {
    name: "item_5 clinical question → classified clinical_question",
    run: (m) => m.get("item_5")?.classification === "clinical_question",
  },
  {
    name: "item_7 Spanish family → Spanish draft + Medicaid payer",
    run: (m) => {
      const i = m.get("item_7");
      return (
        looksSpanish(i?.draft_reply ?? null) &&
        /medicaid/i.test(i?.extracted_intake.payer ?? "")
      );
    },
  },
  {
    name: "item_3 out-of-network → no hold_slot, billing task created",
    run: (m) => {
      const i = m.get("item_3");
      if (!i) return false;
      const held = i.tools_called.some((t) => t.name === "hold_slot");
      const billingTask = i.tools_called.some(
        (t) => t.name === "create_task" && t.args.assignee === "billing",
      );
      return !held && billingTask;
    },
  },
];

async function main(): Promise<void> {
  configureTrace({ path: ".trace/eval.jsonl" });
  const inbox = JSON.parse(
    readFileSync(resolve(process.cwd(), "data/inbox.json"), "utf8"),
  ) as InboxItem[];

  console.log("Running agent for eval (real LLM)…\n");
  const items = await runAgent(inbox);
  const byId = new Map(items.map((i) => [i.item_id, i]));

  let failures = 0;
  for (const check of checks) {
    let passed = false;
    try {
      passed = check.run(byId);
    } catch {
      passed = false;
    }
    console.log(`${passed ? "PASS" : "FAIL"}  ${check.name}`);
    if (!passed) failures += 1;
  }

  console.log(`\n${checks.length - failures}/${checks.length} high-confidence checks passed.`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
