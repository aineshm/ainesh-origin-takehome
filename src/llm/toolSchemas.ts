import type Anthropic from "@anthropic-ai/sdk";

/** Name of the terminal tool the model calls to submit its structured judgment. */
export const SUBMIT_TRIAGE = "submit_triage";

/** The 8 real tool names backed by functions in `src/tools.ts`. */
export const REAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "search_patient",
  "verify_insurance",
  "lookup_policy",
  "find_slots",
  "hold_slot",
  "create_task",
  "draft_message",
  "escalate",
]);

const POLICY_TOPICS = [
  "service_lines",
  "insurance",
  "safeguarding",
  "clinical_advice",
  "scheduling",
  "cancellation",
  "language_access",
] as const;

const ASSIGNEES = ["front_desk", "intake", "billing", "clinical_lead"] as const;
const CHANNELS = ["portal", "email", "phone"] as const;
const LANGUAGES = ["en", "es"] as const;
const DISCIPLINES = ["SLP", "OT", "PT"] as const;
const CLASSIFICATIONS = [
  "new_referral",
  "existing_patient_request",
  "scheduling",
  "clinical_question",
  "billing_question",
  "missing_paperwork",
  "provider_followup",
  "complaint",
  "safeguarding",
  "spam",
  "other",
] as const;
const URGENCIES = ["P0", "P1", "P2", "P3"] as const;

// Nullable fields use JSON-Schema union form (`type: ["string", "null"]`), which
// the Anthropic tool API accepts. Mirrors the output schema's nullable intake
// fields so the model can return null for anything not present in the message.
const extractedIntakeSchema = {
  type: "object",
  description:
    "Structured intake fields extracted from the message. Use null for any field not present or not inferable.",
  properties: {
    child_name: { type: ["string", "null"], description: "Child's full name, or null." },
    dob_or_age: {
      type: ["string", "null"],
      description: "Child's date of birth or age, or null.",
    },
    parent_contact: {
      type: ["string", "null"],
      description: "Parent/guardian contact (name, phone, or email), or null.",
    },
    discipline: {
      type: ["array", "null"],
      description:
        "Requested therapy disciplines, or null if unknown. Subset of SLP/OT/PT.",
      items: { type: "string", enum: DISCIPLINES },
    },
    diagnosis_or_concern: {
      type: ["string", "null"],
      description: "Stated diagnosis or presenting concern, or null.",
    },
    payer: { type: ["string", "null"], description: "Insurance payer/plan name, or null." },
    member_id: { type: ["string", "null"], description: "Insurance member ID, or null." },
  },
  required: [
    "child_name",
    "dob_or_age",
    "parent_contact",
    "discipline",
    "diagnosis_or_concern",
    "payer",
    "member_id",
  ],
} as const;

/**
 * Tool definitions exposed to the model: the 8 real tools (mirroring the arg
 * shapes in `src/tools.ts`) plus the terminal `submit_triage` tool that
 * captures the full `TriageJudgment`.
 */
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "search_patient",
    description:
      "Look up an existing patient record by name and/or date of birth to confirm whether the family is new or established.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Patient (child) full name." },
        dob: { type: "string", description: "Patient date of birth, ISO YYYY-MM-DD." },
      },
    },
  },
  {
    name: "verify_insurance",
    description:
      "Verify insurance coverage status (in_network / out_of_network / expired / unknown) against the billing system of record. The verified status supersedes anything on a referral document.",
    input_schema: {
      type: "object",
      properties: {
        payer: { type: "string", description: "Insurance payer/plan name." },
        member_id: { type: "string", description: "Insurance member ID." },
      },
    },
  },
  {
    name: "lookup_policy",
    description:
      "Retrieve Cedar Kids policy snippets for a topic. Use when insurance, language access, scheduling, safeguarding, or clinical-advice rules materially drive the decision.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: [...POLICY_TOPICS],
          description: "Policy topic to look up.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "find_slots",
    description:
      "Find candidate appointment slots for human review. This NEVER books an appointment; results are reviewable suggestions only.",
    input_schema: {
      type: "object",
      properties: {
        discipline: {
          type: "string",
          enum: [...DISCIPLINES],
          description: "Therapy discipline to filter slots by.",
        },
        preferences: {
          type: "string",
          description: "Free-text scheduling preferences (e.g. afternoons).",
        },
        language: {
          type: "string",
          description: "Preferred provider language (e.g. en, es, English, Spanish).",
        },
      },
    },
  },
  {
    name: "hold_slot",
    description:
      "Place a pending_review hold on a slot for staff to confirm. Never call this for out-of-network or expired insurance; route those to a billing benefits conversation instead.",
    input_schema: {
      type: "object",
      properties: {
        slot_id: { type: "string", description: "Slot identifier to hold." },
        patient_ref: {
          type: "string",
          description: "Patient or family reference for the hold.",
        },
      },
      required: ["slot_id", "patient_ref"],
    },
  },
  {
    name: "create_task",
    description:
      "Create a follow-up task for a staff queue. Use for billing benefits conversations, missing paperwork, clinical-lead review, and other human work items.",
    input_schema: {
      type: "object",
      properties: {
        assignee: {
          type: "string",
          enum: [...ASSIGNEES],
          description: "Staff queue the task is routed to.",
        },
        title: { type: "string", description: "Short task title." },
        due: { type: "string", description: "Due date, ISO YYYY-MM-DD." },
        notes: { type: "string", description: "Task details/context for the assignee." },
      },
      required: ["assignee", "title", "due", "notes"],
    },
  },
  {
    name: "draft_message",
    description:
      "Draft an outbound message for staff review. This NEVER auto-sends. Draft in the family's language (Spanish if the inbound item is in Spanish).",
    input_schema: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "Message recipient (family/guardian)." },
        channel: {
          type: "string",
          enum: [...CHANNELS],
          description:
            "Delivery channel. Map portal_message->portal, voicemail_transcript->phone, fax_referral/email->email.",
        },
        body: { type: "string", description: "Message body text." },
        language: {
          type: "string",
          enum: [...LANGUAGES],
          description: "Message language: en or es.",
        },
      },
      required: ["recipient", "channel", "body"],
    },
  },
  {
    name: "escalate",
    description:
      "Escalate an item to the clinical lead / on-call staff. Reserve P0 for safeguarding or imminent harm; P1 for same-day operational urgency.",
    input_schema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "ID of the inbox item being escalated." },
        reason: { type: "string", description: "Why this item is being escalated." },
        severity: {
          type: "string",
          enum: ["P0", "P1"],
          description: "Escalation severity.",
        },
      },
      required: ["item_id", "reason", "severity"],
    },
  },
  {
    name: SUBMIT_TRIAGE,
    description:
      "Submit the final structured triage judgment for this item. Call this exactly once, last, after any other tools.",
    input_schema: {
      type: "object",
      properties: {
        classification: {
          type: "string",
          enum: [...CLASSIFICATIONS],
          description: "Primary classification of the item.",
        },
        urgency: {
          type: "string",
          enum: [...URGENCIES],
          description:
            "Urgency: P0 safeguarding/imminent harm, P1 same-day operational, P2 default, P3 low/FYI/spam. Default P2; over-escalation is a failure.",
        },
        extracted_intake: extractedIntakeSchema,
        missing_info: {
          type: "array",
          items: { type: "string" },
          description: "List of material missing fields/details needed before next steps.",
        },
        recommended_next_action: {
          type: "string",
          description: "The single recommended next action for staff.",
        },
        draft_reply: {
          type: ["string", "null"],
          description: "Drafted reply text in the family's language, or null if none.",
        },
        escalation: {
          type: ["object", "null"],
          description: "Escalation details if escalated, otherwise null.",
          properties: {
            reason: { type: "string", description: "Reason for escalation." },
            severity: {
              type: "string",
              enum: ["P0", "P1"],
              description: "Escalation severity.",
            },
          },
          required: ["reason", "severity"],
        },
        decision_rationale: {
          type: "string",
          description: "Concise rationale for the classification, urgency, and actions.",
        },
      },
      required: [
        "classification",
        "urgency",
        "extracted_intake",
        "missing_info",
        "recommended_next_action",
        "draft_reply",
        "escalation",
        "decision_rationale",
      ],
    },
  },
];
