import { config } from "./config.ts";
import { CONTEXT_LABELS, MOOD_LABELS, SIGNALS, type SignalId } from "./jev.ts";
import type { CaseRecord, Evaluation, Store, StoredItem } from "./store.ts";
import { truncate } from "./text.ts";

/**
 * Starting thresholds — tune against cases your team agrees were (or were not) upset customers.
 * Signal values are Jev Noul probabilities (0–1); mood is the Score expectation on the 0–4 rubric.
 */
export const THRESHOLDS = {
  signalHigh: 0.8,
  signalMedium: 0.6,
  moodHigh: 3.0,
  moodMedium: 2.3,
  /** When the latest tone is satisfied, a high flag is shown as medium. */
  positiveMoodCap: 0.8,
  /** Evidence quotes below this probability are shown as "possible" evidence. */
  evidenceMinProbability: 0.4,
};

/**
 * Signals that are listed as reasons but cannot raise a flag on their own. A failed fix is
 * routine in troubleshooting and fired on about a third of all active cases in the first run.
 */
const SUPPORTING_ONLY: ReadonlySet<SignalId> = new Set(["unresolved"]);

export type FlagLevel = "high" | "medium";

export type FlaggedCase = {
  caseId: string;
  caseUrl: string;
  caseNumber: string;
  subject: string;
  status: string;
  priority: string;
  owner: string;
  manager: string;
  account: string;
  tier: string;
  contact: string;
  level: FlagLevel;
  riskScore: number;
  reasons: { id: string; label: string; detail: string }[];
  /** Concern category ids (see CATEGORIES) present on this case, for filtering and charts. */
  categories: string[];
  mood: { label: string; score: number } | null;
  businessImpact: boolean;
  evidence: {
    author: string;
    channel: string;
    date: string;
    text: string;
    probability: number;
    strong: boolean;
  } | null;
  /** When the most recent message showing the concern was written; drives the "today" filter. */
  latestConcernAt: string | null;
  evaluatedAt: string;
  lastActivityAt: string;
};

/** Salesforce returns "+0000" offsets; normalize so every browser parses them. */
function toIso(sfDate: string): string {
  return sfDate ? new Date(sfDate).toISOString() : "";
}

function levelFor(evaluation: Evaluation): { level: FlagLevel | null; riskScore: number } {
  const { signals, mood } = evaluation.answers;
  const maxSignal = Math.max(
    0,
    ...(Object.entries(signals) as [SignalId, number][])
      .filter(([id]) => !SUPPORTING_ONLY.has(id))
      .map(([, p]) => p),
  );
  const moodScore = mood?.score ?? 0;

  let level: FlagLevel | null = null;
  if (maxSignal >= THRESHOLDS.signalHigh || moodScore >= THRESHOLDS.moodHigh) level = "high";
  else if (maxSignal >= THRESHOLDS.signalMedium || moodScore >= THRESHOLDS.moodMedium) level = "medium";

  if (level === "high" && mood && mood.score < THRESHOLDS.positiveMoodCap) level = "medium";
  return { level, riskScore: Math.max(maxSignal, moodScore / 4) };
}

export function flagFor(
  record: CaseRecord,
  evaluation: Evaluation,
  itemsById: Record<string, StoredItem>,
  caseItems: StoredItem[],
): FlaggedCase | null {
  const { level, riskScore } = levelFor(evaluation);
  if (!level) return null;
  const { answers } = evaluation;

  const reasons: FlaggedCase["reasons"] = (Object.entries(answers.signals) as [SignalId, number][])
    .filter(([, p]) => p >= THRESHOLDS.signalMedium)
    .sort((a, b) => b[1] - a[1])
    .map(([id, p]) => ({ id, label: SIGNALS[id].label, detail: `${Math.round(p * 100)}%` }));
  if (answers.mood && answers.mood.score >= THRESHOLDS.moodMedium) {
    reasons.push({
      id: "tone",
      label: `Overall tone: ${MOOD_LABELS[Math.round(answers.mood.score)]}`,
      detail: `${answers.mood.score.toFixed(1)} / 4`,
    });
  }

  const businessImpact = answers.businessImpact >= THRESHOLDS.signalMedium;
  const categories = reasons.map((r) => r.id);
  if (businessImpact) categories.push("businessImpact");

  const latestConcern = Object.entries(answers.itemConcern ?? {})
    .filter(([, p]) => p >= THRESHOLDS.signalMedium)
    .map(([stateId, probability]) => ({ item: itemsById[evaluation.stateIds[stateId] ?? ""], probability }))
    .filter((c): c is { item: StoredItem; probability: number } => c.item !== undefined)
    .sort((a, b) => b.item.createdDate.localeCompare(a.item.createdDate))[0];
  const chosenItem = answers.evidence ? itemsById[evaluation.stateIds[answers.evidence.id] ?? ""] : undefined;
  const shown =
    latestConcern ??
    (chosenItem && answers.evidence ? { item: chosenItem, probability: answers.evidence.probability } : null);

  return {
    caseId: record.id,
    caseUrl: `${config.salesforceUrl}/lightning/r/Case/${record.id}/view`,
    caseNumber: record.caseNumber,
    subject: record.subject,
    status: record.status,
    priority: record.priority,
    owner: record.owner,
    manager: record.manager ?? "—",
    account: record.account,
    tier: record.tier ?? "No tier",
    contact: record.contact,
    level,
    riskScore,
    reasons,
    categories,
    mood: answers.mood
      ? { label: MOOD_LABELS[Math.round(answers.mood.score)] ?? "Unknown", score: answers.mood.score }
      : null,
    businessImpact,
    evidence: shown
      ? {
          author: shown.item.author,
          channel: shown.item.kind === "engineer" ? "Engineer note" : shown.item.channel,
          date: toIso(shown.item.createdDate),
          text: truncate(shown.item.text, 500),
          probability: shown.probability,
          strong: shown.probability >= THRESHOLDS.evidenceMinProbability,
        }
      : null,
    latestConcernAt: shown ? toIso(shown.item.createdDate) : null,
    evaluatedAt: evaluation.evaluatedAt,
    lastActivityAt: toIso(caseItems.reduce((latest, i) => (i.createdDate > latest ? i.createdDate : latest), "")),
  };
}

export function buildDashboard(store: Store) {
  const itemsByCase: Record<string, StoredItem[]> = {};
  for (const item of Object.values(store.items)) (itemsByCase[item.caseId] ??= []).push(item);

  const flags: FlaggedCase[] = [];
  for (const [caseId, evaluation] of Object.entries(store.evaluations)) {
    const record = store.cases[caseId];
    if (!record) continue;
    const flag = flagFor(record, evaluation, store.items, itemsByCase[caseId] ?? []);
    if (flag) flags.push(flag);
  }
  flags.sort((a, b) => (a.level === b.level ? b.riskScore - a.riskScore : a.level === "high" ? -1 : 1));

  return {
    lastRun: store.lastRun,
    openCases: Object.keys(store.cases).length,
    evaluatedCases: Object.keys(store.evaluations).length,
    lookbackDays: config.lookbackDays,
    thresholds: THRESHOLDS,
    contextLabels: CONTEXT_LABELS,
    categories: CATEGORIES,
    flags,
  };
}

export const CATEGORIES: { id: string; label: string }[] = [
  ...(Object.entries(SIGNALS) as [SignalId, (typeof SIGNALS)[SignalId]][]).map(([id, s]) => ({ id, label: s.label })),
  { id: "tone", label: "Negative overall tone" },
  { id: "businessImpact", label: CONTEXT_LABELS.businessImpact },
];
