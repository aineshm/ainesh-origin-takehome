import type { InboxItem } from "../types.js";
import type { PrivacyVault } from "./vault.js";

/**
 * Return a copy of the inbox item with PHI in its free-text fields replaced by
 * vault tokens. The structural fields (id, channel, received_at, attachments)
 * are preserved as-is — they carry no patient identifiers and the agent needs
 * `received_at` and `channel` for date anchoring and channel mapping.
 */
export function scrubInboxItem(item: InboxItem, vault: PrivacyVault): InboxItem {
  return {
    ...item,
    sender: vault.anonymizeText(item.sender),
    subject: vault.anonymizeText(item.subject),
    body: vault.anonymizeText(item.body),
  };
}
