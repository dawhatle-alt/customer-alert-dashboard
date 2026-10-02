import { choice, noul, type ChoiceResponse, type NoulResponse, type Questions } from "@typesafe-ai/sdk";
import { getClient } from "./jev.ts";
import { ORIGINAL_PROBLEM_NOTE, RC1_CATEGORIES, RC1_ORDER_NOTE } from "./rootcauseGuide.ts";

/** Bump when questions or state shape change so cached reviews are recomputed. */
export const RC_QUESTIONS_VERSION = 2;

/** Deliberately excludes the recorded RC1/RC2 so Jev's pick is not anchored on the engineer's choice. */
export type RootCauseState = {
  case: {
    subject: string;
    product: string;
    disposition: string;
    opened: string;
    closed: string;
    defect_attached: boolean;
    rfe_attached: boolean;
    closed_in_triage: boolean;
  };
  problem_description: string;
  emails: { from: "customer" | "BMC support"; sent: string; text: string }[];
  case_notes: { author: string; written: string; text: string }[];
};

const EVIDENCE_NOTE =
  `${ORIGINAL_PROBLEM_NOTE} Use \`case\`, \`problem_description\`, \`emails\`, and \`case_notes\`. Error messages and logs describe the symptom; ` +
  "look for what BMC support concluded caused it and what was done to resolve it.";

const RC2_NOTE =
  "Prefer the most specific category. Use Customer Abandoned only when the customer stopped responding before the cause was understood, " +
  "Problem Self-Resolved only when it went away without intervention, and zUnsure only when no other category fits. ";

const QUESTIONS: Questions = (() => {
  const questions: Questions = {
    rc1: choice(
      {
        question: "Following the BMC root cause guideline, which Root Cause 1 category best describes the underlying cause of this case?",
        note: `${RC1_ORDER_NOTE} ${EVIDENCE_NOTE}`,
      },
      Object.fromEntries(RC1_CATEGORIES.map((c) => [c.id, `${c.label}: ${c.description}`])),
    ),
    recentInstall: noul(
      {
        question:
          "Did the originally reported problem arise from an install, upgrade, rehost, or migration that the customer performed shortly before it started (up to about two weeks earlier), or is the case an AMIGO activity?",
        note: `An upgrade, patch, or fix pack recommended or applied as the solution does not count. ${EVIDENCE_NOTE}`,
      },
      {
        true: "The problem started soon after, and because of, an install, upgrade, fix pack, rehost, or migration the customer performed, or it is an AMIGO review/starter case.",
        false: "The problem did not arise from a recent install, upgrade, rehost, or migration, even if one was later suggested as the fix.",
      },
    ),
    causeExplained: noul(
      {
        question: "Does the case record show enough about what happened to choose a root cause category?",
        note: "Also answer yes when the record clearly shows a duplicate, a non-technical request, a How-To question, or that the customer stopped responding.",
      },
      {
        true: "The description, emails, or notes explain the cause, or clearly show why the case was closed.",
        false: "The record is too thin to tell what caused the problem or why the case was closed.",
      },
    ),
  };
  for (const rc1 of RC1_CATEGORIES) {
    if (!rc1.rc2.length) continue;
    questions[`rc2_${rc1.id}`] = choice(
      {
        question: `If Root Cause 1 for this case is "${rc1.label}", which Root Cause 2 category best describes the underlying cause?`,
        note: RC2_NOTE + EVIDENCE_NOTE,
      },
      Object.fromEntries(rc1.rc2.map((c) => [c.id, `${c.label}: ${c.description}`])),
    );
  }
  return questions;
})();

export type RcAnswers = {
  model: string;
  inputTokens: number;
  /** Probability per RC1 id. */
  rc1: Record<string, number>;
  /** Probability per RC2 id, keyed by the RC1 id it belongs to. */
  rc2: Record<string, Record<string, number>>;
  recentInstall: number;
  causeExplained: number;
};

export async function askRootCauseJev(state: RootCauseState): Promise<RcAnswers> {
  const result = await getClient().systemOne({ state, questions: QUESTIONS });
  const answers = result.answers as Record<string, ChoiceResponse | NoulResponse | undefined>;
  const probs = (id: string) => {
    const a = answers[id];
    return a?.type === "choice" ? { ...(a.probabilities as Record<string, number>) } : {};
  };
  const noulOf = (id: string) => {
    const a = answers[id];
    return a?.type === "noul" ? a.noul : 0;
  };
  return {
    model: result.model,
    inputTokens: result.usage.input_tokens,
    rc1: probs("rc1"),
    rc2: Object.fromEntries(RC1_CATEGORIES.filter((c) => c.rc2.length).map((c) => [c.id, probs(`rc2_${c.id}`)])),
    recentInstall: noulOf("recentInstall"),
    causeExplained: noulOf("causeExplained"),
  };
}
