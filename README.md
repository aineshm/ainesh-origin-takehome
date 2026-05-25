# Cedar Kids Therapy — Referral Inbox Triage Agent

An AI agent that triages a pediatric therapy practice's weekend inbox (fax referrals, voicemails, portal messages, emails) into a sorted, human-reviewable action plan. One structured, audited `ItemOutput` per inbox item.

## 1. How to run

```bash
npm install
cp .env.example .env        # then paste your key into .env: ANTHROPIC_API_KEY=...
npm run triage   -- --input data/inbox.json --output output.json --trace .trace/tool-calls.jsonl
npm run validate -- --input data/inbox.json --output output.json --trace .trace/tool-calls.jsonl
```

All flags are optional and default to the paths above. Additional scripts:

```bash
npm test          # deterministic unit suite (vitest) — no API key needed
npm run eval      # opt-in: runs the real LLM, asserts high-confidence triage outcomes
npm run typecheck # tsc --noEmit
```

The agent reads `ANTHROPIC_API_KEY` from `.env` or the environment. End-to-end runtime is a couple of minutes (8 items, processed sequentially).

## 2. Stack and runtime

- **Language/runtime:** TypeScript on Node LTS, run with `tsx`, npm scripts.
- **LLM:** Anthropic Messages API tool-use loop via `@anthropic-ai/sdk`, model `claude-sonnet-4-6`. We drive the loop directly rather than using a heavier agent framework — the task is a bounded, single-cycle, strongly-audited batch, so owning the loop gives guaranteed trace correctness and direct control over guardrails.
- **Testing:** `vitest` for the deterministic core; a separate opt-in real-LLM eval.
- **Other deps:** `dotenv` (key loading), plus the provided `ajv`/`ulid`.

## 3. Architecture

Per item, inside `withItemContext(item.id, …)` so every tool call is attributed in the audit trace:

```
item → PHI de-id → tool-use loop (model) → safety net → assemble → ItemOutput
```

- **PHI de-identification gateway** (`src/privacy/`): a per-item `PrivacyVault` pseudonymizes the message (emails, phones, DOBs, member IDs, labeled names → `[NAME_1]`…) before it reaches the model. Real values are restored inside the executor before the real tools run (so the trace and output stay accurate) and on the final judgment. The external LLM never sees raw identifiers.
- **Tool-use loop** (`src/llm/loop.ts`): the model orchestrates the 8 provided tools and finishes by calling a `submit_triage` tool that returns its structured judgment. Real tool calls are executed (via `executor.ts` → the real `src/tools.ts`) and their rich results fed back; a `submit_triage` block ends the loop. Sibling real-tool calls in the same turn run before termination, so a parallel call is never dropped. A turn cap forces a final `submit_triage`.
- **Policy & safety:** safety-critical rules (urgency calibration, safeguarding, no-clinical-advice, draft-only, never-schedule, out-of-network handling, date anchoring, language access) are embedded in the system prompt; `lookup_policy` is used where an operational policy materially drives the decision.
- **Deterministic safety net** (`src/triage/safetyNet.ts`): after the model returns, a conservative check scans for clear safeguarding signals. If present, it forces P0 + escalation and ensures an `escalate` call and a same-hour clinical-lead task exist in the trace (idempotent — it won't double-fire). It only escalates upward, so it can't cause over-escalation.
- **Assembly** (`src/triage/assemble.ts`): builds the `ItemOutput`, hard-sets `requires_human_review: true`, normalizes `discipline`, and passes `tools_called` through verbatim from `getToolCallsForItem`. Summary counts come only from the provided `buildBatchOutput`.
- **Error isolation:** a per-item failure yields a minimal safe output (still surfacing any recorded tool calls), so one bad item never sinks the batch or breaks validation.

**On the sample inbox** the agent escalates the safeguarding voicemail to P0 (with a clinical-lead review task), holds the "URGENT" same-day reschedule at P1 rather than over-escalating, withholds clinical advice on the R-sounds question, drafts in Spanish for the Spanish-speaking Medicaid family (matched to a Spanish-speaking SLP), and blocks scheduling for the out-of-network Kaiser referral in favor of a billing conversation — and passes `npm run validate`.

The provided files (`tools.ts`, `index.ts`, `validate.ts`, `types.ts`, schema) are unmodified; all logic lives in new modules plus the implemented `src/agent.ts`.

## 4. Failure modes and production eval

**Known limitations of this prototype**
- **De-id name coverage is an MVP.** Structured identifiers (email/phone/DOB/member-ID) are detected robustly and reversibly; names rely on labeled/contextual patterns, so an unlabeled free-text first name (e.g. "my son Leo") can still reach the model. Production needs clinical NER (e.g. Microsoft Presidio) behind the same `PrivacyVault` interface.
- **The local audit trace and `output.json` contain real (synthetic) PHI** by design — that's the system of record. With real PHI this requires encryption at rest, access controls, and retention limits.
- **Third-party LLM:** sending any real PHI to Anthropic requires a BAA + zero-retention configuration. The de-id gateway reduces but does not by itself satisfy this.
- **Nondeterminism:** borderline P2/P3 calls can vary run to run.
- **No retry/backoff:** a transient API error degrades that one item to a safe fallback rather than retrying.
- **De-id depends on token preservation:** if the model alters a token, that field won't re-hydrate; mitigated by an explicit prompt instruction.

**How I'd evaluate in production**
- A labeled regression set far larger than 8 items, scored on: safeguarding recall (missing a P0 is the worst failure), over-escalation rate (P0/P1 precision), classification accuracy, and policy-adherence checks (never schedules, never auto-sends, OON never held).
- Automated red-team prompts for safeguarding phrasings and jailbreak attempts to bypass the no-clinical-advice rule.
- A PHI-leak test asserting the model payload contains no raw identifiers.
- Human-in-the-loop review metrics (since every item is `requires_human_review`): accept/edit/reject rates on drafts and recommended actions.

## 5. What I chose not to build, and why

- **A rule-based fallback engine.** It's an LLM agent; the key is part of its runtime. A parallel deterministic triage engine would be significant code competing with the time budget and isn't the point.
- **Retry/backoff and request parallelism.** Sequential processing meets the "few minutes" target for 8 items and is safer against a rate-limited key; parallelism is a trivial later swap. Named here rather than built.
- **Full NER-based de-identification.** The MVP covers the high-confidence identifiers; robust name redaction is a documented upgrade path, not a 2-hour task.
- **Attachment/PDF parsing.** Referral content is inline in the item body; the attachments are filenames only.
- **Broad eval coverage.** The eval asserts only high-confidence, high-stakes cases to stay fast and non-flaky; borderline urgency calls are left to manual review.

## 6. What I would do with another 4 hours

- Swap the regex name detector for Presidio (or a clinical NER) behind the existing `PrivacyVault`, and add a PHI-leak assertion to the test suite.
- Parallelize item processing with a small concurrency cap.
- Add retry/backoff with jitter on transient API errors.
- Grow the eval set and add over-escalation/precision metrics + a small red-team suite.
- Surface a confidence signal per item to help reviewers prioritize, and richer `missing_info` for incomplete referrals.
- Tighten the safety net (e.g. force escalation severity to match forced P0).
- Run it as an always-on service that triages items as they arrive (continuous operation instead of a one-shot batch) — keeping the same human-in-the-loop gates: still drafts-not-sends, still every item flagged for review. The goal is to clear the queue continuously, never to act unattended.
</content>
