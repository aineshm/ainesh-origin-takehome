import { describe, it, expect, beforeAll } from "vitest";
import { configureTrace, withItemContext } from "../tools.js";
import { executeTool } from "./executor.js";
import { PrivacyVault } from "../privacy/vault.js";

beforeAll(() => configureTrace({ path: ".trace/test-exec.jsonl" }));

describe("executeTool", () => {
  it("returns rich data as content", async () => {
    await withItemContext("t1", async () => {
      const r = await executeTool(
        "verify_insurance",
        { payer: "Aetna PPO" },
        new PrivacyVault(),
      );
      expect(JSON.parse(r.content).status).toBe("in_network");
    });
  });
  it("captures task_id for create_task", async () => {
    await withItemContext("t2", async () => {
      const r = await executeTool(
        "create_task",
        { assignee: "billing", title: "x", due: "2026-04-29", notes: "n" },
        new PrivacyVault(),
      );
      expect(r.taskId).toMatch(/^task_/);
    });
  });
  it("de-anonymizes token args before calling the tool", async () => {
    await withItemContext("t4", async () => {
      const vault = new PrivacyVault();
      const token = vault.tokenFor("MEMBER_ID", "AET-9910");
      const r = await executeTool(
        "verify_insurance",
        { payer: "Aetna PPO", member_id: token },
        vault,
      );
      // verify_insurance recognizes Aetna as in-network regardless, but the call
      // must have received the real member id (round-trips through the vault).
      expect(vault.deAnonymize(token)).toBe("AET-9910");
      expect(JSON.parse(r.content).status).toBe("in_network");
    });
  });
  it("throws on unknown tool", async () => {
    await withItemContext("t3", async () => {
      await expect(executeTool("nope", {}, new PrivacyVault())).rejects.toThrow();
    });
  });
});
