import { describe, it, expect } from "vitest";
import { PrivacyVault } from "./vault.js";

describe("PrivacyVault", () => {
  it("tokenizes structured identifiers and round-trips them", () => {
    const vault = new PrivacyVault();
    const text =
      "Parent: Daniel Lee, 555-0101, daniel.lee@example.com. DOB: 2018-09-04. Member ID: BCBS-884200.";
    const anon = vault.anonymizeText(text);

    expect(anon).not.toContain("daniel.lee@example.com");
    expect(anon).not.toContain("555-0101");
    expect(anon).not.toContain("2018-09-04");
    expect(anon).not.toContain("BCBS-884200");
    expect(anon).not.toContain("Daniel Lee");
    expect(anon).toContain("[EMAIL_1]");
    expect(anon).toContain("[MEMBER_ID_1]");

    // Reversible: restoring tokens yields the original text exactly.
    expect(vault.deAnonymize(anon)).toBe(text);
  });

  it("gives the same token for a repeated value (idempotent)", () => {
    const vault = new PrivacyVault();
    const a = vault.tokenFor("NAME", "Emma Lee");
    const b = vault.tokenFor("NAME", "Emma Lee");
    expect(a).toBe(b);
  });

  it("deAnonymizes tokens inside a nested object", () => {
    const vault = new PrivacyVault();
    const email = vault.tokenFor("EMAIL", "rachel@example.com");
    const name = vault.tokenFor("NAME", "Rachel Brooks");
    const judgment = {
      extracted_intake: { parent_contact: `${name}, ${email}` },
      draft_reply: `Hi ${name}`,
      missing_info: [] as string[],
    };
    const restored = vault.deAnonymize(judgment);
    expect(restored.draft_reply).toBe("Hi Rachel Brooks");
    expect(restored.extracted_intake.parent_contact).toBe(
      "Rachel Brooks, rachel@example.com",
    );
  });

  it("re-tokenizes known values and patient-record names in tool results", () => {
    const vault = new PrivacyVault();
    vault.tokenFor("NAME", "Mateo Ramirez"); // already seen in the message
    const toolResult = JSON.stringify([
      { name: "Mateo Ramirez", guardian_name: "Sofia Ramirez", dob: "2019-03-15" },
    ]);
    const safe = vault.reAnonymizeText(toolResult);
    expect(safe).not.toContain("Mateo Ramirez");
    expect(safe).not.toContain("Sofia Ramirez");
    expect(safe).not.toContain("2019-03-15");
  });
});
