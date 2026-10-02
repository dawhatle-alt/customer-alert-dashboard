import type { JevThresholds } from "./types";
import { DEFAULT_JEV_THRESHOLDS } from "./types";

type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
};

type BooleanAnswer = {
  type: "boolean";
  probability: number;
};

type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities?: Record<string, number>;
};

export type EvaluateLikeResult = {
  answers: Record<string, ChoiceAnswer | BooleanAnswer | ScoreAnswer>;
  providerMetadata?: {
    typesafe?: {
      confidence?: Record<string, number>;
    };
  };
};

export type ChoiceDecision =
  | { action: "apply"; value: string; confidence: number; probability: number }
  | {
      action: "human_review";
      value: string | null;
      reason: string;
      confidence: number;
      probability: number;
    };

export type BooleanDecision =
  | { action: "yes" | "no"; probability: number }
  | { action: "human_review"; probability: number; reason: string };

export function decideChoice(
  result: EvaluateLikeResult,
  questionId: string,
  thresholds: JevThresholds = DEFAULT_JEV_THRESHOLDS,
  opts?: { rejectValues?: string[] },
): ChoiceDecision {
  const answer = result.answers[questionId];
  if (!answer || answer.type !== "choice") {
    return {
      action: "human_review",
      value: null,
      reason: `missing_or_invalid_answer:${questionId}`,
      confidence: 0,
      probability: 0,
    };
  }

  const confidence =
    result.providerMetadata?.typesafe?.confidence?.[questionId] ?? 0;
  const probability = answer.probabilities?.[answer.choice] ?? 0;
  const reject = opts?.rejectValues?.includes(answer.choice) ?? false;

  if (
    reject ||
    answer.choice === "uncertain" ||
    confidence < thresholds.choiceMinConfidence ||
    probability < thresholds.choiceMinProbability
  ) {
    return {
      action: "human_review",
      value: answer.choice,
      reason: reject
        ? "rejected_option"
        : answer.choice === "uncertain"
          ? "uncertain_option"
          : "below_threshold",
      confidence,
      probability,
    };
  }

  return {
    action: "apply",
    value: answer.choice,
    confidence,
    probability,
  };
}

export function decideBoolean(
  result: EvaluateLikeResult,
  questionId: string,
  thresholds: JevThresholds = DEFAULT_JEV_THRESHOLDS,
): BooleanDecision {
  const answer = result.answers[questionId];
  if (!answer || answer.type !== "boolean") {
    return {
      action: "human_review",
      probability: 0.5,
      reason: `missing_or_invalid_answer:${questionId}`,
    };
  }

  if (answer.probability >= thresholds.booleanYesMin) {
    return { action: "yes", probability: answer.probability };
  }
  if (answer.probability <= thresholds.booleanNoMax) {
    return { action: "no", probability: answer.probability };
  }
  return {
    action: "human_review",
    probability: answer.probability,
    reason: "mid_band",
  };
}

export function decideScorePass(
  result: EvaluateLikeResult,
  questionId: string,
  minScore: number,
): { pass: boolean; score: number } {
  const answer = result.answers[questionId];
  if (!answer || answer.type !== "score") {
    return { pass: false, score: 0 };
  }
  return { pass: answer.score >= minScore, score: answer.score };
}
