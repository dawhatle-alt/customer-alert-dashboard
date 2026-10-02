import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { mapConcurrent, type Logger } from "./pipeline.ts";
import { OTHER_RC_TREE_PRODUCTS, RC1_BY_ID, RC1_CATEGORIES, matchRc1, matchRc2, type Rc1Id } from "./rootcauseGuide.ts";
import { askRootCauseJev, RC_QUESTIONS_VERSION, type RcAnswers, type RootCauseState } from "./rootcauseJev.ts";
import {
  fetchCaseHistory,
  fetchClosedCases,
  fetchUserManagers,
  SalesforceMcp,
  type SfCaseHistory,
  type SfClosedCase,
} from "./salesforce.ts";
import { htmlToText, isAutoReply, normalizeWhitespace, stripEmailBoilerplate, stripQuotedReply, truncate } from "./text.ts";

export type RcCase = {
  id: string;
  caseNumber: string;
  subject: string;
  ownerId: string;
  owner: string;
  account: string;
  product: string;
  disposition: string;
  rc1: string | null;
  rc2: string | null;
  openedDate: string;
  closedDate: string;
  defectAttached: boolean;
  rfeAttached: boolean;
  closedInTriage: boolean;
};

export type RcEvaluation = {
  /** Case content only changes if the case is reopened and closed again. */
  closedDate: string;
  questionsVersion: number;
  evaluatedAt: string;
  answers: RcAnswers;
};

export type RcRun = {
  startedAt: string;
  finishedAt: string | null;
  closedCases: number;
  toReview: number;
  processed: number;
  evaluated: number;
  reused: number;
  failed: number;
  inputTokens: number;
  totalMs: number;
  jevAvgRequestMs: number;
  error: string | null;
};

export type RcStore = {
  version: 1;
  cases: Record<string, RcCase>;
  evaluations: Record<string, RcEvaluation>;
  managers: Record<string, string>;
  syncedAt: string | null;
  lastRun: RcRun | null;
};

export function loadRcStore(): RcStore {
  if (!existsSync(config.rootCause.dataFile)) {
    return { version: 1, cases: {}, evaluations: {}, managers: {}, syncedAt: null, lastRun: null };
  }
  return JSON.parse(readFileSync(config.rootCause.dataFile, "utf8")) as RcStore;
}

function saveRcStore(store: RcStore): void {
  mkdirSync(path.dirname(config.rootCause.dataFile), { recursive: true });
  const tmp = `${config.rootCause.dataFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(store));
  renameSync(tmp, config.rootCause.dataFile);
}

function toRcCase(c: SfClosedCase): RcCase {
  return {
    id: c.Id,
    caseNumber: c.CaseNumber,
    subject: c.Subject ?? "",
    ownerId: c.OwnerId,
    owner: c.Owner?.Name ?? "Unassigned",
    account: c.Account?.Name ?? "—",
    product: c.sc_Root_Cause_1__r?.DR__r?.Name ?? "—",
    disposition: c.sc_Case_Disposition__c ?? "",
    rc1: c.sc_Root_Cause_1__r?.Name ?? null,
    rc2: c.sc_Root_Cause_2__r?.Name ?? null,
    openedDate: c.CreatedDate,
    closedDate: c.ClosedDate,
    defectAttached: c.sc_Case_Defect_Attached_Y_N__c === true,
    rfeAttached: c.sc_Case_RFE_Attached_Y_N__c === true,
    closedInTriage: c.sc_Closed_in_Triage__c === true,
  };
}

const day = (iso: string) => iso.slice(0, 10);

export function buildRcState(c: RcCase, history: SfCaseHistory): RootCauseState {
  const rc = config.rootCause;
  const emails = (history.EmailMessages?.records ?? [])
    .filter((e) => e.TextBody && !isAutoReply(e.Subject))
    .map((e) => ({
      from: e.Incoming ? ("customer" as const) : ("BMC support" as const),
      sent: day(e.CreatedDate),
      text: truncate(normalizeWhitespace(stripEmailBoilerplate(stripQuotedReply(e.TextBody!))), rc.maxEmailChars),
    }))
    .filter((e) => e.text.length >= 25)
    .reverse();
  const notes = (history.Feeds?.records ?? [])
    .map((f) => ({
      author: f.CreatedBy?.Name ?? "Unknown",
      written: day(f.CreatedDate),
      text: truncate(normalizeWhitespace(htmlToText(f.Body ?? "")), rc.maxNoteChars),
    }))
    .filter((n) => n.text)
    .reverse();
  return {
    case: {
      subject: c.subject,
      product: c.product,
      disposition: c.disposition || "—",
      opened: day(c.openedDate),
      closed: day(c.closedDate),
      defect_attached: c.defectAttached,
      rfe_attached: c.rfeAttached,
      closed_in_triage: c.closedInTriage,
    },
    problem_description: truncate(normalizeWhitespace(history.Description ?? ""), rc.maxDescriptionChars),
    emails,
    case_notes: notes,
  };
}

export async function runRootCauseCheck(sf: SalesforceMcp, log: Logger = console.log, limit?: number): Promise<RcRun> {
  const store = loadRcStore();
  const started = performance.now();
  const run: RcRun = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    closedCases: 0,
    toReview: 0,
    processed: 0,
    evaluated: 0,
    reused: 0,
    failed: 0,
    inputTokens: 0,
    totalMs: 0,
    jevAvgRequestMs: 0,
    error: null,
  };
  store.lastRun = run;

  try {
    const rc = config.rootCause;
    log(`Root cause: fetching ${config.productFamily} cases closed in the last ${rc.windowDays} days…`);
    const closed = await fetchClosedCases(sf, rc.windowDays);
    store.cases = Object.fromEntries(closed.map((c) => [c.Id, toRcCase(c)]));
    run.closedCases = closed.length;

    const ownerIds = [...new Set(closed.map((c) => c.OwnerId))].filter((id) => id.startsWith("005"));
    for (const u of await fetchUserManagers(sf, ownerIds)) store.managers[u.Id] = u.Manager?.Name ?? "—";
    store.syncedAt = new Date().toISOString();

    for (const id of Object.keys(store.evaluations)) if (!store.cases[id]) delete store.evaluations[id];

    let pending = Object.values(store.cases).filter((c) => {
      if (OTHER_RC_TREE_PRODUCTS.test(c.product)) return false;
      const prev = store.evaluations[c.id];
      const fresh = prev?.closedDate === c.closedDate && prev.questionsVersion === RC_QUESTIONS_VERSION;
      if (fresh) run.reused++;
      return !fresh;
    });
    if (limit) pending = pending.slice(0, limit);
    run.toReview = pending.length;
    log(`Root cause: ${run.closedCases} closed cases; reviewing ${pending.length} with Jev (${run.reused} unchanged).`);
    saveRcStore(store);

    const batches: RcCase[][] = [];
    for (let i = 0; i < pending.length; i += rc.batchSize) batches.push(pending.slice(i, i + rc.batchSize));

    const errors: string[] = [];
    let requestMsTotal = 0;
    let batchesDone = 0;
    await mapConcurrent(batches, rc.fetchConcurrency, async (batch) => {
      let histories: SfCaseHistory[];
      try {
        histories = await fetchCaseHistory(sf, batch.map((c) => c.id), rc.emails, rc.notes);
      } catch (error) {
        run.failed += batch.length;
        run.processed += batch.length;
        errors.push(`Salesforce history for ${batch[0]!.caseNumber}…: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const returned = new Set(histories.map((h) => h.Id));
      for (const c of batch) {
        if (returned.has(c.id)) continue;
        run.failed++;
        errors.push(`${c.caseNumber}: not returned by Salesforce`);
      }
      await mapConcurrent(histories, Math.ceil(config.jevConcurrency / rc.fetchConcurrency) + 1, async (history) => {
        const c = store.cases[history.Id]!;
        const requestStart = performance.now();
        try {
          const answers = await askRootCauseJev(buildRcState(c, history));
          requestMsTotal += performance.now() - requestStart;
          store.evaluations[c.id] = {
            closedDate: c.closedDate,
            questionsVersion: RC_QUESTIONS_VERSION,
            evaluatedAt: new Date().toISOString(),
            answers,
          };
          run.evaluated++;
          run.inputTokens += answers.inputTokens;
        } catch (error) {
          run.failed++;
          errors.push(`${c.caseNumber}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      run.processed += batch.length;
      if (++batchesDone % 5 === 0) {
        log(`Root cause: ${run.processed}/${run.toReview} reviewed…`);
        saveRcStore(store);
      }
    });
    run.jevAvgRequestMs = run.evaluated ? Math.round(requestMsTotal / run.evaluated) : 0;
    if (errors.length) {
      run.error = `${errors.length} failure(s). First: ${errors[0]}`;
      log(`Root cause: ${run.error}`);
    }
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
    log(`Root cause check failed: ${run.error}`);
  }

  run.totalMs = Math.round(performance.now() - started);
  run.finishedAt = new Date().toISOString();
  saveRcStore(store);
  log(
    `Root cause finished: ${run.evaluated} reviewed, ${run.reused} reused, ${run.failed} failed, ` +
      `${run.inputTokens.toLocaleString()} Jev input tokens in ${(run.totalMs / 1000).toFixed(1)}s.`,
  );
  return run;
}

// ---- Scoring ------------------------------------------------------------------------------

/** Recorded category counts as a match when Jev rates it at least this close to its own top pick. */
const MATCH_RATIO = 0.6;
/** Below this, Jev judges the case record too thin to assess, so it is left out of accuracy. */
const MIN_CAUSE_EXPLAINED = 0.3;
const VERDICT = { accurate: 75, questionable: 45 } as const;
const VOID_DISPOSITION_PENALTY = 25;

type Finding = { kind: "rule" | "guide" | "info"; text: string };
type Verdict = "accurate" | "questionable" | "wrong" | "insufficient" | "outOfScope" | "pending";
const NOT_JUDGED: Verdict[] = ["pending", "insufficient", "outOfScope"];

/** zUnsure means "no category fits", so it is never treated as Jev's pick. */
function top(probs: Record<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const [id, p] of Object.entries(probs)) if (id !== "unsure" && (!best || p > best[1])) best = [id, p];
  return best;
}

/** How close the recorded category is to Jev's favourite: 1 when it is Jev's top pick. */
function agreement(probs: Record<string, number>, id: string): number {
  const best = top(probs);
  if (!best || best[1] <= 0) return 0;
  return Math.min(1, (probs[id] ?? 0) / best[1]);
}

export function reviewCase(c: RcCase, e: RcEvaluation | undefined) {
  const findings: Finding[] = [];
  const base = {
    caseId: c.id,
    caseNumber: c.caseNumber,
    caseUrl: `${config.salesforceUrl}/lightning/r/Case/${c.id}/view`,
    subject: c.subject,
    account: c.account,
    product: c.product,
    disposition: c.disposition,
    closedDate: c.closedDate,
    recorded: { rc1: c.rc1, rc2: c.rc2 },
  };
  const outOfScope = OTHER_RC_TREE_PRODUCTS.test(c.product);
  if (outOfScope) findings.push({ kind: "info", text: `${c.product} uses the mainframe RC tree, which the guide does not cover` });
  if (!e || outOfScope) {
    return {
      ...base,
      verdict: (outOfScope ? "outOfScope" : "pending") as Verdict,
      suggested: null,
      rc1Score: null,
      rc2Score: null,
      score: null,
      rc1Match: null,
      rc2Match: null,
      causeExplained: null,
      recentInstall: null,
      findings,
    };
  }

  const a = e.answers;
  const rc1Cat = matchRc1(c.rc1);
  const topRc1 = top(a.rc1);
  const suggestedRc1 = topRc1 ? RC1_BY_ID[topRc1[0] as Rc1Id] : undefined;
  const topRc2 = suggestedRc1?.rc2.length ? top(a.rc2[suggestedRc1.id] ?? {}) : null;
  const suggested = suggestedRc1
    ? {
        rc1: suggestedRc1.label,
        rc1Probability: topRc1![1],
        rc2: topRc2 ? (suggestedRc1.rc2.find((r) => r.id === topRc2[0])?.label ?? null) : null,
      }
    : null;

  let rc1Score: number;
  if (!c.rc1) {
    rc1Score = 0;
    findings.push({ kind: "rule", text: "Root Cause 1 is blank" });
  } else if (!rc1Cat) {
    rc1Score = 0;
    findings.push({ kind: "rule", text: `RC1 "${c.rc1}" is not one of the five guide categories` });
  } else {
    rc1Score = agreement(a.rc1, rc1Cat.id);
  }
  if (rc1Cat && rc1Cat.id !== "install" && rc1Score < MATCH_RATIO && suggestedRc1?.id === "install" && a.recentInstall >= 0.7) {
    findings.push({ kind: "guide", text: "Problem followed a recent install/upgrade/rehost/migration; the guide puts Install/Upgrade/Rehost/Migration first" });
  }

  let rc2Score: number | null = null;
  let penalty = 0;
  if (rc1Cat?.id === "void") {
    rc2Score = c.rc2 ? 0 : 1;
    if (c.rc2) findings.push({ kind: "rule", text: "Void has no Root Cause 2, but one is set" });
    if (c.disposition !== "Void") {
      penalty = VOID_DISPOSITION_PENALTY;
      findings.push({ kind: "rule", text: `RC1 Void requires Disposition Void (is "${c.disposition || "blank"}")` });
    }
  } else if (!c.rc2) {
    if (c.rc1) {
      rc2Score = 0;
      findings.push({ kind: "rule", text: "Root Cause 2 is blank" });
    }
  } else if (rc1Cat) {
    const rc2Cat = matchRc2(rc1Cat, c.rc2);
    if (!rc2Cat) {
      findings.push({ kind: "info", text: `RC2 "${c.rc2}" is not in the guide's ${rc1Cat.label} list, so RC2 was not scored` });
    } else {
      rc2Score = agreement(a.rc2[rc1Cat.id] ?? {}, rc2Cat.id);
      if (rc2Cat.id === "unsure") findings.push({ kind: "guide", text: "zUnsure-Follow Up Needed: flagged for management follow-up" });
    }
  }

  const blended = rc2Score === null ? rc1Score : 0.6 * rc1Score + 0.4 * rc2Score;
  const score = Math.max(0, Math.round(blended * 100) - penalty);
  const verdict: Verdict =
    a.causeExplained < MIN_CAUSE_EXPLAINED
      ? "insufficient"
      : score >= VERDICT.accurate
        ? "accurate"
        : score >= VERDICT.questionable
          ? "questionable"
          : "wrong";
  return {
    ...base,
    verdict,
    suggested,
    rc1Score,
    rc2Score,
    score,
    rc1Match: rc1Score >= MATCH_RATIO,
    rc2Match: rc2Score === null ? null : rc2Score >= MATCH_RATIO,
    causeExplained: a.causeExplained,
    recentInstall: a.recentInstall,
    findings,
  };
}

export type CaseReview = ReturnType<typeof reviewCase>;

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

export function buildRootCauseReport(store: RcStore, running: boolean) {
  const byOwner = new Map<string, { owner: string; ownerId: string; manager: string; cases: CaseReview[] }>();
  const all: CaseReview[] = [];
  for (const c of Object.values(store.cases)) {
    const review = reviewCase(c, store.evaluations[c.id]);
    all.push(review);
    const manager = store.managers[c.ownerId] ?? (c.ownerId.startsWith("00G") ? "Queue (no manager)" : "—");
    const row = byOwner.get(c.ownerId) ?? { owner: c.owner, ownerId: c.ownerId, manager, cases: [] };
    row.cases.push(review);
    byOwner.set(c.ownerId, row);
  }

  const summarize = (cases: CaseReview[]) => {
    const judged = cases.filter((r) => !NOT_JUDGED.includes(r.verdict));
    const rc2Judged = judged.filter((r) => r.rc2Match !== null);
    const count = (v: Verdict) => cases.filter((r) => r.verdict === v).length;
    return {
      closed: cases.length,
      reviewed: judged.length,
      pending: count("pending"),
      insufficient: count("insufficient"),
      outOfScope: count("outOfScope"),
      accurate: count("accurate"),
      questionable: count("questionable"),
      wrong: count("wrong"),
      rc1Accuracy: pct(judged.filter((r) => r.rc1Match).length, judged.length),
      rc2Accuracy: pct(rc2Judged.filter((r) => r.rc2Match).length, rc2Judged.length),
      avgScore: judged.length ? Math.round((judged.reduce((s, r) => s + (r.score ?? 0), 0) / judged.length) * 10) / 10 : null,
      ruleIssues: cases.filter((r) => r.findings.some((f) => f.kind === "rule")).length,
    };
  };

  const tsas = [...byOwner.values()].map((row) => ({
    owner: row.owner,
    ownerId: row.ownerId,
    manager: row.manager,
    ...summarize(row.cases),
    cases: row.cases.sort((x, y) => (x.score ?? 101) - (y.score ?? 101) || y.closedDate.localeCompare(x.closedDate)),
  }));

  const byRc1 = RC1_CATEGORIES.map((cat) => {
    const judged = all.filter((r) => !NOT_JUDGED.includes(r.verdict) && matchRc1(r.recorded.rc1)?.id === cat.id);
    return { label: cat.label, total: judged.length, matched: judged.filter((r) => r.rc1Match).length };
  });

  const changes = new Map<string, number>();
  for (const r of all) {
    if (NOT_JUDGED.includes(r.verdict) || r.rc1Match || !r.suggested) continue;
    const key = `${matchRc1(r.recorded.rc1)?.label ?? r.recorded.rc1 ?? "Blank"} → ${r.suggested.rc1}`;
    changes.set(key, (changes.get(key) ?? 0) + 1);
  }

  return {
    updatedAt: store.lastRun?.finishedAt ?? store.syncedAt,
    running,
    lastRun: store.lastRun,
    windowDays: config.rootCause.windowDays,
    thresholds: { matchRatio: MATCH_RATIO, ...VERDICT, minCauseExplained: MIN_CAUSE_EXPLAINED },
    totals: summarize(all),
    byRc1,
    topChanges: [...changes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, n]) => ({ label, n })),
    tsas,
  };
}
