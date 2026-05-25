import { describe, it, expect, beforeAll } from "vitest";
import { configureTrace, withItemContext } from "../tools.js";
import { executeTool } from "./executor.js";
beforeAll(() => configureTrace({ path: ".trace/test-exec.jsonl" }));
describe("executeTool", () => {
  it("returns rich data as content", async () => {
    await withItemContext("t1", async () => {
      const r = await executeTool("verify_insurance", { payer: "Aetna PPO" });
      expect(JSON.parse(r.content).status).toBe("in_network");
    });
  });
  it("captures task_id for create_task", async () => {
    await withItemContext("t2", async () => {
      const r = await executeTool("create_task", { assignee: "billing", title: "x", due: "2026-04-29", notes: "n" });
      expect(r.taskId).toMatch(/^task_/);
    });
  });
  it("throws on unknown tool", async () => {
    await withItemContext("t3", async () => {
      await expect(executeTool("nope", {})).rejects.toThrow();
    });
  });
});
