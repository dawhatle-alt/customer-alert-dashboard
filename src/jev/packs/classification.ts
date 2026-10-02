import { DR_BY_LP, LP_CRITERIA } from "../catalog/products";
import type { DispatchCaseState } from "../types";

/**
 * Pass 1 — FR-2 classification + routing signal booleans.
 * All questions share the same case state and evaluate independently.
 */
export function buildClassificationQuestions() {
  return {
    proposedLp: {
      type: "choice" as const,
      instructions:
        "Based on `subject` and `description`, which Control-M Licensed Product (LP) should this case use? Prefer the product the customer is actually having trouble with, not the product they may have selected incorrectly. Use `uncertain` when evidence is insufficient.",
      criteria: LP_CRITERIA,
    },

    isIntegrationFactory: {
      type: "boolean" as const,
      instructions:
        "Does the customer identify a published Integration Factory package (Integration Name + Integration Version), or ask about running jobs / integrating with a third-party application in a way that points to Integration Factory rather than authoring in Application Integrator?",
      criteria: {
        true: "Mentions a named integration + version, or a third-party application integration that maps to published Integration Factory packages.",
        false: "Generic Application Integrator authoring, unrelated Control-M issue, or no third-party integration package indicated.",
      },
    },

    openedAsAiButLikelyIf: {
      type: "boolean" as const,
      instructions:
        "The case may currently be opened as Control-M Application Integrator. Ignoring the current LP field, does the Subject/Description indicate Integration Factory (published package) instead of AI authoring?",
      criteria: {
        true: "Content describes a published/named integration package or third-party connector, not building a custom AI job type.",
        false: "Content is about Application Integrator design/runtime, or is unrelated.",
      },
    },

    mentionsThirdPartyIntegration: {
      type: "boolean" as const,
      instructions:
        "Is the customer asking about running jobs with or integrating a third-party application (so dispatch should check the Integration Factory Master Version List)?",
      criteria: {
        true: "Explicit third-party product/app integration or job-type for an external system.",
        false: "No third-party integration ask.",
      },
    },

    isHelixMigrationCase: {
      type: "boolean" as const,
      instructions:
        "Is this an OnPrem-to-Helix Control-M SaaS migration case (e.g. migrateToHelix.sh / migrateToHelix.bat or equivalent migration tooling)?",
      criteria: {
        true: "Customer is migrating OnPrem Control-M to Helix using migration scripts/tools.",
        false: "Ordinary Helix or OnPrem support issue, not migration execution.",
      },
    },

    needsJobDefinitionXml: {
      type: "boolean" as const,
      instructions:
        "Would a Job Definition export to XML materially help diagnose this issue?",
      criteria: {
        true: "Issue centers on job definition, scheduling properties, or job-type configuration where XML export is standard evidence.",
        false: "XML job export is not clearly useful yet (e.g. install-only, EM login, agent connectivity without a specific job).",
      },
    },

    needsScreenshotOrVideo: {
      type: "boolean" as const,
      instructions:
        "Would a screenshot or short video of the issue materially help?",
      criteria: {
        true: "UI/error dialog/visual workflow issue where a capture is the best next evidence.",
        false: "Logs/config alone are sufficient, or capture would not help.",
      },
    },

    subjectHasCorrectableTypos: {
      type: "boolean" as const,
      instructions:
        "Does the case subject contain obvious typos or misspellings that a dispatcher should correct — excluding any text that is part of an error message, return code, or log fragment?",
      criteria: {
        true: "Clear human typos in narrative subject text; no error-message tokens would be altered.",
        false: "Subject is fine, or the only odd tokens look like errors/codes/paths that must not be changed.",
      },
    },
  };
}

/**
 * Pass 2 — FR-2.1 DR proposal scoped to the LP chosen in pass 1.
 * Call only when proposedLp is auto-applicable (confidence + probability gates).
 */
export function buildDrQuestions(proposedLpKey: string) {
  const criteria =
    DR_BY_LP[proposedLpKey] ??
    ({
      uncertain:
        "No DR catalog entry for this LP key — dispatcher must set DR manually.",
    } satisfies Record<string, string>);

  return {
    proposedDr: {
      type: "choice" as const,
      instructions: `Given LP \`${proposedLpKey}\` and the case \`subject\` / \`description\`, which Detail Record (DR) / component should be set? Use \`uncertain\` when unclear.`,
      criteria,
    },
  };
}

export function classificationState(caseState: DispatchCaseState) {
  return {
    caseNumber: caseState.caseNumber,
    subject: caseState.subject,
    description: caseState.description,
    currentLp: caseState.currentLp,
    currentDr: caseState.currentDr,
    fixPack: caseState.fixPack,
    severity: caseState.severity,
    productFamily: caseState.productFamily,
  };
}
