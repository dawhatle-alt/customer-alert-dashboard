/**
 * Example wiring for AI SDK + AI Gateway + Jev.
 * Requires: ai@^7 (experimental_evaluate), Vercel OIDC or AI_GATEWAY_API_KEY.
 *
 * This file is a reference implementation — install deps before importing.
 */
import { experimental_evaluate as evaluate } from "ai";
import {
  buildClassificationQuestions,
  buildDrQuestions,
  classificationState,
} from "./packs/classification";
import {
  buildDispositionQuestions,
  dispositionState,
} from "./packs/disposition";
import { decideBoolean, decideChoice } from "./decide";
import type { DispatchCaseState } from "./types";
import { INTEGRATION_FACTORY_SF_VALUES } from "./catalog/products";

const MODEL = "typesafe-ai/jev" as const;

export async function classifyDispatchCase(caseState: DispatchCaseState) {
  const state = {
    ...classificationState(caseState),
    ...dispositionState(caseState),
  };

  const pass1 = await evaluate({
    model: MODEL,
    state,
    questions: {
      ...buildClassificationQuestions(),
      ...buildDispositionQuestions(),
    },
    providerOptions: {
      gateway: {
        zeroDataRetention: true,
        tags: ["feature:dispatch-classify", "product:control-m"],
        user: caseState.caseNumber,
      },
    },
  });

  const lp = decideChoice(pass1, "proposedLp");
  const voidFlag = decideBoolean(pass1, "voidCandidate");
  const dupFlag = decideBoolean(pass1, "duplicateCandidate");
  const ifFlag = decideBoolean(pass1, "isIntegrationFactory");
  const helixFlag = decideBoolean(pass1, "isHelixMigrationCase");
  const installedVersionsOnly = decideBoolean(pass1, "isInstalledVersionsOnly");
  const dcSole = decideBoolean(pass1, "dataCollectorIsSoleNextStep");

  let dr: ReturnType<typeof decideChoice> | null = null;
  if (lp.action === "apply") {
    const pass2 = await evaluate({
      model: MODEL,
      state,
      questions: buildDrQuestions(lp.value),
      providerOptions: {
        gateway: {
          zeroDataRetention: true,
          tags: ["feature:dispatch-classify-dr", "product:control-m"],
          user: caseState.caseNumber,
        },
      },
    });
    dr = decideChoice(pass2, "proposedDr");
  }

  const proposedLpSf =
    ifFlag.action === "yes"
      ? INTEGRATION_FACTORY_SF_VALUES.lpApiName
      : lp.action === "apply"
        ? lp.value
        : null;

  const proposedDrSf =
    ifFlag.action === "yes"
      ? INTEGRATION_FACTORY_SF_VALUES.drApiName
      : dr?.action === "apply"
        ? dr.value
        : null;

  return {
    rawPass1: pass1.answers,
    recommendations: {
      lp,
      dr,
      proposedLpSf,
      proposedDrSf,
      voidFlag,
      dupFlag,
      ifFlag,
      helixFlag,
      installedVersionsOnly,
      dcSole,
      /** Helix migration → do not troubleshoot; route TSA→R&D (FR-6.5). */
      forceHelixMigrationPath: helixFlag.action === "yes",
      /** Skip Data Collector drafting when installed-versions only (FR-4.4). */
      allowDataCollectorDraft:
        installedVersionsOnly.action !== "yes" && dcSole.action === "yes",
    },
  };
}
