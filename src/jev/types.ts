/**
 * Shared state and threshold types for Control-M Dispatch Agent Jev packs.
 * Maps to PRD FR-2, FR-3, FR-4, FR-5, FR-6.5, FR-7.3.
 */

export type CaseSeverity = 2 | 3 | 4;

export type DispatchCaseState = {
  caseNumber: string;
  subject: string;
  description: string;
  /** Current Service Cloud LP value (may be wrong — Jev proposes correction). */
  currentLp: string | null;
  currentDr: string | null;
  fixPack: string | null;
  severity: CaseSeverity;
  productFamily: "OP" | "SaaS" | "unknown";
  customerCountry: string | null;
  customerGeo: string | null;
  activeGeo: string;
  language: string | null;
  englishCommunication: "Yes" | "No" | "Written" | "blank" | null;
  /** Recent feed/email snippets used for void/dup and progress signals. */
  recentCustomerMessages?: string[];
  /** Prior KA suggestion count on this case (re-dispatch / FR-3.6). */
  kaSuggestionEmailCount?: number;
};

/** Candidate KA returned from Coveo / Data Cloud before Jev rerank. */
export type KnowledgeCandidate = {
  id: string;
  title: string;
  summary: string;
  url?: string;
};

export type DraftGuardrailState = {
  case: Pick<DispatchCaseState, "subject" | "description">;
  draftText: string;
  draftKind:
    | "clarifying_questions"
    | "data_collector_request"
    | "ka_suggestion"
    | "geo_handoff_summary"
    | "helix_migration_note"
    | "other";
};

/**
 * Starting floors — tune against labeled MVP feedback (FR-9.2).
 * Choice: require both confidence and selected-option probability.
 * Boolean: act on P(true) above/below floors; mid-band → HITL.
 */
export type JevThresholds = {
  choiceMinConfidence: number;
  choiceMinProbability: number;
  booleanYesMin: number;
  booleanNoMax: number;
  kaRelevanceMinScore: number;
};

export const DEFAULT_JEV_THRESHOLDS: JevThresholds = {
  choiceMinConfidence: 0.6,
  choiceMinProbability: 0.7,
  booleanYesMin: 0.8,
  booleanNoMax: 0.2,
  /** Score rubric is 0–3; treat ≥2.0 as "likely useful KA". */
  kaRelevanceMinScore: 2.0,
};
