/**
 * Per-item reversible pseudonymization vault.
 *
 * The external LLM only ever sees placeholder tokens (e.g. `[NAME_1]`,
 * `[MEMBER_ID_1]`); real values are restored locally before the real tools run
 * and before the final output is assembled. This keeps PHI out of the
 * third-party model payload while leaving the audit trace and output intact.
 *
 * Scope (MVP): structured identifiers — email, phone, DOB, insurance member ID —
 * are detected with high-confidence regexes and are fully reversible. Person
 * names are caught via labeled/contextual patterns; robust free-text name
 * coverage requires NER (e.g. Microsoft Presidio) and is a documented upgrade.
 */
export type PhiType = "NAME" | "DOB" | "PHONE" | "EMAIL" | "MEMBER_ID";

const TOKEN_RE = /\[[A-Z_]+_\d+\]/g;

interface Detector {
  type: PhiType;
  regex: RegExp;
}

/** High-confidence, fully-reversible structured identifiers. Order matters:
 * member IDs (letters + digits) and ISO DOBs are matched before bare phones. */
const STRUCTURED: Detector[] = [
  { type: "EMAIL", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: "MEMBER_ID", regex: /\b[A-Z]{2,5}-\d{3,8}\b/g },
  { type: "DOB", regex: /\b\d{4}-\d{2}-\d{2}\b/g },
  { type: "PHONE", regex: /\b\d{3}[-.\s]\d{4}\b/g },
];

/** Person-name patterns; capture group 1 is the name to tokenize. Covers the
 * common referral/voicemail phrasings (EN + a little ES). Unlabeled names may
 * still slip through — that gap is what NER would close. */
const NAME_PATTERNS: RegExp[] = [
  /\b(?:Child|Patient|Parent\/guardian|Parent|Guardian)\s*:\s*([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){0,2})/gu,
  /\bDr\.?\s+([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){0,2})/gu,
  /\b(?:referral for|this is|my son|my daughter|for my son|for my daughter|about my son|about my daughter)\s+([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){0,2})/gu,
  /\b(?:soy|mi hija|mi hijo|por mi hija|por mi hijo)\s+([A-ZÁÉÍÓÚÑ][\p{L}'.-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'.-]+){0,2})/gu,
];

/** Names inside structured tool-result JSON (patient / guardian records). */
const JSON_NAME_RE = /"(?:name|guardian_name|patient_name)"\s*:\s*"([^"]+)"/g;

export class PrivacyVault {
  private readonly valueToToken = new Map<string, string>();
  private readonly tokenToValue = new Map<string, string>();
  private readonly counters = new Map<PhiType, number>();

  /** Register a raw value and return its stable token (idempotent per value). */
  tokenFor(type: PhiType, value: string): string {
    const trimmed = value.trim();
    const existing = this.valueToToken.get(trimmed);
    if (existing) {
      return existing;
    }
    const next = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, next);
    const token = `[${type}_${next}]`;
    this.valueToToken.set(trimmed, token);
    this.tokenToValue.set(token, trimmed);
    return token;
  }

  /** Replace detected PHI in inbound free text with tokens. */
  anonymizeText(text: string): string {
    let out = text;
    for (const { type, regex } of STRUCTURED) {
      out = out.replace(regex, (match) => this.tokenFor(type, match));
    }
    for (const pattern of NAME_PATTERNS) {
      out = out.replace(pattern, (full: string, name: string) =>
        full.replace(name, this.tokenFor("NAME", name)),
      );
    }
    return out;
  }

  /** Tokenize tool-result text before the model sees it: re-tokenize values we
   * already know, detect new structured identifiers, and tokenize names in
   * patient/guardian record fields. */
  reAnonymizeText(text: string): string {
    let out = text;
    for (const [value, token] of this.valueToToken) {
      if (value.length > 0) {
        out = out.split(value).join(token);
      }
    }
    for (const { type, regex } of STRUCTURED) {
      out = out.replace(regex, (match) => this.tokenFor(type, match));
    }
    out = out.replace(JSON_NAME_RE, (full: string, name: string) =>
      full.replace(`"${name}"`, `"${this.tokenFor("NAME", name)}"`),
    );
    return out;
  }

  /** Restore real values: replaces tokens in a string or any JSON-serializable
   * value (objects/arrays are round-tripped through JSON). Unknown tokens are
   * left untouched. */
  deAnonymize<T>(input: T): T {
    if (typeof input === "string") {
      return this.replaceTokens(input) as unknown as T;
    }
    return JSON.parse(this.replaceTokens(JSON.stringify(input))) as T;
  }

  private replaceTokens(text: string): string {
    return text.replace(
      TOKEN_RE,
      (token) => this.tokenToValue.get(token) ?? token,
    );
  }
}
