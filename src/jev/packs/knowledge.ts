import type { DispatchCaseState, KnowledgeCandidate } from "../types";

/**
 * FR-3 — score each Coveo/Data Cloud candidate after retrieval.
 * One Score question per candidate (or batch candidates into state and ask
 * separate question ids). Prefer per-candidate questions for clear thresholds.
 */
export function buildKaRelevanceQuestions(
  candidates: KnowledgeCandidate[],
): Record<
  string,
  {
    type: "score";
    instructions: string;
    criteria: string[];
  }
> {
  const questions: Record<
    string,
    {
      type: "score";
      instructions: string;
      criteria: string[];
    }
  > = {};

  for (const c of candidates.slice(0, 8)) {
    // Cap fan-out; tune with latency/cost. Ids must be stable for code mapping.
    const qid = `kaRelevance_${c.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    questions[qid] = {
      type: "score",
      instructions: `How relevant is knowledge article candidate \`${c.id}\` (\`${c.title}\`) to resolving this case, given \`subject\` and \`description\`? Treat generic error matches cautiously — the stated error is often not the ultimate issue.`,
      criteria: [
        "Irrelevant or misleading for this case",
        "Tangentially related; unsafe to suggest as resolution",
        "Plausible workaround or partial match worth suggesting with caveats",
        "Strong match — appropriate to draft a KA-based customer response",
      ],
    };
  }

  return questions;
}

export function knowledgeState(
  caseState: DispatchCaseState,
  candidates: KnowledgeCandidate[],
) {
  return {
    subject: caseState.subject,
    description: caseState.description,
    productFamily: caseState.productFamily,
    currentLp: caseState.currentLp,
    candidates: candidates.map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
    })),
  };
}
