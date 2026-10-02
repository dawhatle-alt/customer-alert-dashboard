import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import type { JevAnswers } from "./jev.ts";

export type CaseRecord = {
  id: string;
  caseNumber: string;
  subject: string;
  status: string;
  priority: string;
  owner: string;
  manager: string;
  account: string;
  tier: string;
  contact: string;
  ownerId: string;
  createdDate: string;
  /** Case field "Case Routed To Eng Y/N?". */
  routedToEng: boolean;
  /** Case field "Case DateTime Last Customer Contact". */
  lastCustomerContact: string | null;
};

export type StoredItem = {
  id: string;
  caseId: string;
  kind: "customer" | "engineer";
  channel: "email" | "support portal" | "case feed";
  author: string;
  createdDate: string;
  text: string;
};

export type Evaluation = {
  activityKey: string;
  questionsVersion: number;
  evaluatedAt: string;
  /** Maps state ids (m1, n1, ...) back to StoredItem ids. */
  stateIds: Record<string, string>;
  answers: JevAnswers;
};

export type RunSummary = {
  startedAt: string;
  finishedAt: string | null;
  openCases: number;
  casesWithActivity: number;
  evaluated: number;
  reused: number;
  failed: number;
  inputTokens: number;
  /** Wall-clock time for the Salesforce sync and for all Jev requests in this run. */
  syncMs: number;
  jevMs: number;
  /** Mean latency of a single Jev request. */
  jevAvgRequestMs: number;
  error: string | null;
};

/** Bump when text cleaning (quote stripping, HTML handling) changes so cached items are re-fetched. */
export const TEXT_VERSION = 2;

export type Store = {
  version: 1;
  textVersion: number;
  /** CreatedDate cutoff for the next incremental Salesforce fetch. */
  watermark: string | null;
  /** When `cases` was last refreshed from Salesforce. */
  casesSyncedAt?: string;
  cases: Record<string, CaseRecord>;
  items: Record<string, StoredItem>;
  userTypes: Record<string, string>;
  evaluations: Record<string, Evaluation>;
  lastRun: RunSummary | null;
};

export function loadStore(): Store {
  const empty: Store = {
    version: 1,
    textVersion: TEXT_VERSION,
    watermark: null,
    cases: {},
    items: {},
    userTypes: {},
    evaluations: {},
    lastRun: null,
  };
  if (!existsSync(config.dataFile)) return empty;
  const store = JSON.parse(readFileSync(config.dataFile, "utf8")) as Store;
  if (store.textVersion !== TEXT_VERSION) {
    return { ...store, textVersion: TEXT_VERSION, watermark: null, items: {} };
  }
  return store;
}

export function saveStore(store: Store): void {
  mkdirSync(path.dirname(config.dataFile), { recursive: true });
  const tmp = `${config.dataFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(store));
  renameSync(tmp, config.dataFile);
}
