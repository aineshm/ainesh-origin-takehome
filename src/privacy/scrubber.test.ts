import { describe, it, expect } from "vitest";
import { PrivacyVault } from "./vault.js";
import { scrubInboxItem } from "./scrubber.js";
import type { InboxItem } from "../types.js";

const item: InboxItem = {
  id: "item_1",
  channel: "fax_referral",
  received_at: "2026-04-27T18:12:00-07:00",
  sender: "Northside Pediatrics fax",
  subject: "Referral: Emma Lee - speech articulation evaluation",
  body: "Child: Emma Lee. DOB: 2018-09-04. Parent: Daniel Lee, 555-0101, daniel.lee@example.com. Insurance: Blue Cross Blue Shield PPO. Member ID: BCBS-884200.",
  attachments: ["referral_item_1.pdf"],
};

describe("scrubInboxItem", () => {
  it("removes PHI from free-text fields and preserves structural fields", () => {
    const vault = new PrivacyVault();
    const scrubbed = scrubInboxItem(item, vault);

    // Structural fields untouched.
    expect(scrubbed.id).toBe("item_1");
    expect(scrubbed.channel).toBe("fax_referral");
    expect(scrubbed.received_at).toBe(item.received_at);
    expect(scrubbed.attachments).toEqual(item.attachments);

    // PHI scrubbed from body.
    expect(scrubbed.body).not.toContain("daniel.lee@example.com");
    expect(scrubbed.body).not.toContain("555-0101");
    expect(scrubbed.body).not.toContain("2018-09-04");
    expect(scrubbed.body).not.toContain("BCBS-884200");
    expect(scrubbed.body).not.toContain("Emma Lee");

    // Non-PHI context preserved (payer + concern aid triage).
    expect(scrubbed.body).toContain("Blue Cross Blue Shield PPO");

    // Original is not mutated.
    expect(item.body).toContain("Emma Lee");
  });

  it("round-trips: deAnonymizing the scrubbed body restores the original", () => {
    const vault = new PrivacyVault();
    const scrubbed = scrubInboxItem(item, vault);
    expect(vault.deAnonymize(scrubbed.body)).toBe(item.body);
  });
});
