import type { DispatchCaseState } from "../types";

/**
 * FR-4 / FR-5 disposition judgments — void, duplicate, Data Collector gates.
 * Run in parallel with classification or immediately after on the same state.
 */
export function buildDispositionQuestions() {
  return {
    voidCandidate: {
      type: "boolean" as const,
      instructions:
        "Should this case be flagged as a void candidate because the customer resolved the issue without Support assistance (e.g. asked to close before Support suggested a solution)?",
      criteria: {
        true: "Customer states they fixed it themselves / please close / no longer need help, prior to Support providing a solution.",
        false: "Customer still needs help, or Support already engaged with a proposed solution.",
      },
    },

    duplicateCandidate: {
      type: "boolean" as const,
      instructions:
        "Does the Subject/Description (and recent messages if present) indicate this case is a duplicate of another existing case?",
      criteria: {
        true: "Customer references another case number, or clearly restates an identical open issue as a duplicate filing.",
        false: "Appears to be a distinct issue, or insufficient evidence of duplication.",
      },
    },

    isInstalledVersionsOnly: {
      type: "boolean" as const,
      instructions:
        "Is the customer only asking about installed versions / version information such that a Data Collector is NOT required?",
      criteria: {
        true: "Question is limited to what versions are installed or supported; no troubleshooting dump needed.",
        false: "Broader troubleshooting; Data Collector may still be relevant later.",
      },
    },

    dataCollectorIsSoleNextStep: {
      type: "boolean" as const,
      instructions:
        "Is requesting the Control-M Data Collector clearly the only next thing needed from the customer right now (so triage may draft a DC request), rather than leaving diagnostics to the assigned TSA with troubleshooting questions?",
      criteria: {
        true: "Problem is understood enough that logs/DC are the sole blocker; no meaningful clarifying product questions remain.",
        false: "Clarifying questions are still needed, or TSA should combine DC with troubleshooting, or DC is premature.",
      },
    },

    problemUnderstoodEnoughToSearchKb: {
      type: "boolean" as const,
      instructions:
        "Is the problem understood well enough to search the knowledge base effectively (specific product symptom/error), versus needing clarifying questions first?",
      criteria: {
        true: "There is a concrete symptom, error, or reproducible behavior suitable for KB search.",
        false: "Too vague; clarifying questions should come before (or with) KB search.",
      },
    },
  };
}

/**
 * FR-7.3 — out-of-GEO Severity 2 path selection (only when code detects out-of-GEO Sev-2).
 */
export function buildOutOfGeoQuestions() {
  return {
    outOfGeoNextAction: {
      type: "choice" as const,
      instructions:
        "This is a new Severity 2 case from a customer outside the active GEO. What should triage do next?",
      criteria: {
        draft_potential_solution:
          "A likely solution or workaround can be drafted now from the case content / known patterns.",
        draft_clarifying_questions:
          "Need clarifying information from the customer before a solution or assignment path is clear.",
        request_log_data:
          "Need log/Data Collector (or similar) data before progressing.",
        ask_active_geo_preference:
          "Primary next step is to ask whether the customer wants the case worked by the currently active GEO (email or phone).",
      },
    },
  };
}

/**
 * Optional FR-8 assist — only when age/KA counters are inconclusive.
 * Prefer pure code for: age > 3 days, kaSuggestionEmailCount >= 2.
 */
export function buildRedispatchProgressQuestion() {
  return {
    caseNotProgressing: {
      type: "boolean" as const,
      instructions:
        "Given the case subject, description, and recent customer messages, does the case appear stalled / not progressing in a way that warrants re-dispatch back to the dispatch queue?",
      criteria: {
        true: "No meaningful forward motion; customer waiting; repeated unanswered asks; or loop without new diagnostic progress.",
        false: "Active troubleshooting thread or recent substantive progress.",
      },
    },
  };
}

export function dispositionState(caseState: DispatchCaseState) {
  return {
    caseNumber: caseState.caseNumber,
    subject: caseState.subject,
    description: caseState.description,
    severity: caseState.severity,
    recentCustomerMessages: caseState.recentCustomerMessages ?? [],
    kaSuggestionEmailCount: caseState.kaSuggestionEmailCount ?? 0,
    customerGeo: caseState.customerGeo,
    activeGeo: caseState.activeGeo,
  };
}
