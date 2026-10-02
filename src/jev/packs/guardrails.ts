import type { DraftGuardrailState } from "../types";

/**
 * Optional post-LLM checks (FR-2.2, FR-4, FR-7.4 expectation rules).
 * Run after Agentforce/LLM drafts; block or flag before dispatcher send.
 */
export function buildDraftGuardrailQuestions() {
  return {
    commitsSpecificMeetingTime: {
      type: "boolean" as const,
      instructions:
        "Does `draftText` commit to a specific date/time for a call, WebEx, or meeting?",
      criteria: {
        true: "Names a concrete calendar date and/or clock time for a live session.",
        false: "No specific meeting commitment.",
      },
    },

    altersErrorMessageText: {
      type: "boolean" as const,
      instructions:
        "Does `draftText` rewrite, normalize, or alter text that appears to be an error message, return code, or log fragment from the case (versus quoting it unchanged)?",
      criteria: {
        true: "Error/log tokens from the case are changed or paraphrased in a way that could break KB matching.",
        false: "Errors are quoted faithfully or not present.",
      },
    },

    claimsKaResolvesWithoutEvidence: {
      type: "boolean" as const,
      instructions:
        "Does `draftText` assert that a knowledge article will resolve the issue as a certainty without appropriate caveats?",
      criteria: {
        true: "Presents KA as definitive fix without hedging or asking the customer to confirm.",
        false: "Suggests KA as possible help, asks for confirmation, or does not claim resolution.",
      },
    },

    requestsDataCollectorUnjustified: {
      type: "boolean" as const,
      instructions:
        "If this is a Data Collector request draft, does it fail to justify why the Data Collector is needed?",
      criteria: {
        true: "Asks for DC without a clear justification tied to the symptom.",
        false: "Not a DC request, or justification is present.",
      },
    },

    safeToSendPendingHumanEdit: {
      type: "boolean" as const,
      instructions:
        "Ignoring that MVP always requires human review: is this draft free of the policy violations above and generally appropriate for the draft kind?",
      criteria: {
        true: "No meeting-time commitments, no altered error text, no overclaimed KA resolution, DC justified if applicable.",
        false: "One or more policy issues present.",
      },
    },
  };
}

export function guardrailState(state: DraftGuardrailState) {
  return {
    subject: state.case.subject,
    description: state.case.description,
    draftKind: state.draftKind,
    draftText: state.draftText,
  };
}
