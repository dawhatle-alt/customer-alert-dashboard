import { createHash } from "node:crypto";
import { config } from "./config.ts";
import { askJev, QUESTIONS_VERSION, type SentimentState } from "./jev.ts";
import {
  fetchFeedPosts,
  fetchInboundEmails,
  fetchOpenCases,
  fetchOwnerManagers,
  fetchUserTypes,
  SalesforceMcp,
  type SfEmail,
  type SfFeedPost,
} from "./salesforce.ts";
import { loadStore, saveStore, type RunSummary, type Store, type StoredItem } from "./store.ts";
import { htmlToText, isAutoReply, normalizeWhitespace, stripQuotedReply } from "./text.ts";

/** Re-fetch a little before the watermark so records committed late are not missed. */
const WATERMARK_OVERLAP_MS = 15 * 60_000;

function emailToItem(email: SfEmail): StoredItem | null {
  if (isAutoReply(email.Subject) || !email.TextBody) return null;
  const text = normalizeWhitespace(stripQuotedReply(email.TextBody));
  if (!text) return null;
  return {
    id: email.Id,
    caseId: email.ParentId,
    kind: "customer",
    channel: "email",
    author: email.FromName || email.FromAddress || "Customer",
    createdDate: email.CreatedDate,
    text,
  };
}

function postToItem(post: SfFeedPost, userType: string | undefined): StoredItem | null {
  if (!post.Body) return null;
  const text = normalizeWhitespace(htmlToText(post.Body));
  if (!text) return null;
  const isCustomer = userType !== undefined && userType !== "Standard";
  return {
    id: post.Id,
    caseId: post.ParentId,
    kind: isCustomer ? "customer" : "engineer",
    channel: isCustomer ? "support portal" : "case feed",
    author: post.CreatedBy?.Name ?? "Unknown",
    createdDate: post.CreatedDate,
    text,
  };
}

async function syncFromSalesforce(sf: SalesforceMcp, store: Store, runStart: Date): Promise<void> {
  const lookbackStart = new Date(runStart.getTime() - config.lookbackDays * 86_400_000);
  const since = store.watermark
    ? new Date(Math.max(new Date(store.watermark).getTime() - WATERMARK_OVERLAP_MS, lookbackStart.getTime()))
    : lookbackStart;

  const cases = await fetchOpenCases(sf);
  const managerByOwner = new Map((await fetchOwnerManagers(sf)).map((u) => [u.Id, u.Manager?.Name]));
  store.cases = Object.fromEntries(
    cases.map((c) => [
      c.Id,
      {
        id: c.Id,
        caseNumber: c.CaseNumber,
        subject: c.Subject ?? "",
        status: c.Status ?? "",
        priority: c.Priority ?? "",
        owner: c.Owner?.Name ?? "Unassigned",
        manager: managerByOwner.get(c.OwnerId) ?? (c.OwnerId.startsWith("00G") ? "Queue (no manager)" : "—"),
        account: c.Account?.Name ?? "—",
        tier: c.Account?.Operational_Segmentation__c ?? "No tier",
        contact: c.Contact?.Name ?? "—",
        ownerId: c.OwnerId,
        createdDate: c.CreatedDate,
        routedToEng: c.sc_Case_Routed_To_Eng_Y_N__c === true,
        lastCustomerContact: c.sc_Case_DateTime_Last_Customer_Contact__c,
      },
    ]),
  );
  store.casesSyncedAt = new Date().toISOString();

  const [emails, posts] = [await fetchInboundEmails(sf, since), await fetchFeedPosts(sf, since)];

  const unknownUsers = [...new Set(posts.map((p) => p.CreatedById))].filter((id) => !store.userTypes[id]);
  for (const user of await fetchUserTypes(sf, unknownUsers)) store.userTypes[user.Id] = user.UserType;

  for (const email of emails) {
    const item = emailToItem(email);
    if (item) store.items[item.id] = item;
  }
  for (const post of posts) {
    const item = postToItem(post, store.userTypes[post.CreatedById]);
    if (item) store.items[item.id] = item;
  }

  const cutoff = lookbackStart.toISOString();
  for (const [id, item] of Object.entries(store.items)) {
    if (!store.cases[item.caseId] || new Date(item.createdDate).toISOString() < cutoff) delete store.items[id];
  }
  for (const caseId of Object.keys(store.evaluations)) {
    if (!store.cases[caseId]) delete store.evaluations[caseId];
  }
  store.watermark = runStart.toISOString();
}

function buildState(
  caseId: string,
  store: Store,
  items: StoredItem[],
): { state: SentimentState; stateIds: Record<string, string>; activityKey: string } {
  const byDate = [...items].sort((a, b) => a.createdDate.localeCompare(b.createdDate));
  const customer = byDate.filter((i) => i.kind === "customer").slice(-config.maxCustomerMessages);
  const engineer = byDate.filter((i) => i.kind === "engineer").slice(-config.maxEngineerNotes);
  const clip = (t: string) => (t.length > config.maxCharsPerItem ? `${t.slice(0, config.maxCharsPerItem)} …` : t);
  const day = (iso: string) => iso.slice(0, 10);

  const stateIds: Record<string, string> = {};
  const record = store.cases[caseId]!;
  const state: SentimentState = {
    case: { subject: record.subject, status: record.status },
    customer_messages: customer.map((item, i) => {
      stateIds[`m${i + 1}`] = item.id;
      return { id: `m${i + 1}`, channel: item.channel as "email" | "support portal", from: item.author, sent: day(item.createdDate), text: clip(item.text) };
    }),
    bmc_engineer_notes: engineer.map((item, i) => {
      stateIds[`n${i + 1}`] = item.id;
      return { id: `n${i + 1}`, author: item.author, written: day(item.createdDate), text: clip(item.text) };
    }),
  };
  const activityKey = createHash("sha1").update(JSON.stringify(state)).digest("hex");
  return { state, stateIds, activityKey };
}

export async function mapConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

export type Logger = (message: string) => void;

export async function runCheck(sf: SalesforceMcp, log: Logger = console.log): Promise<RunSummary> {
  const store = loadStore();
  const runStart = new Date();
  const summary: RunSummary = {
    startedAt: runStart.toISOString(),
    finishedAt: null,
    openCases: 0,
    casesWithActivity: 0,
    evaluated: 0,
    reused: 0,
    failed: 0,
    inputTokens: 0,
    syncMs: 0,
    jevMs: 0,
    jevAvgRequestMs: 0,
    error: null,
  };

  try {
    log(`Syncing open ${config.productFamily} cases and case feed from Salesforce…`);
    const syncStart = performance.now();
    await syncFromSalesforce(sf, store, runStart);
    summary.syncMs = Math.round(performance.now() - syncStart);
    summary.openCases = Object.keys(store.cases).length;

    const itemsByCase: Record<string, StoredItem[]> = {};
    for (const item of Object.values(store.items)) (itemsByCase[item.caseId] ??= []).push(item);
    summary.casesWithActivity = Object.keys(itemsByCase).length;

    for (const caseId of Object.keys(store.evaluations)) {
      if (!itemsByCase[caseId]) delete store.evaluations[caseId];
    }

    const toEvaluate = Object.entries(itemsByCase)
      .map(([caseId, items]) => ({ caseId, ...buildState(caseId, store, items) }))
      .filter(({ caseId, activityKey }) => {
        const prev = store.evaluations[caseId];
        const fresh = prev?.activityKey === activityKey && prev.questionsVersion === QUESTIONS_VERSION;
        if (fresh) summary.reused++;
        return !fresh;
      });

    log(
      `${summary.openCases} open cases, ${summary.casesWithActivity} with recent activity; ` +
        `evaluating ${toEvaluate.length} with Jev (${summary.reused} unchanged).`,
    );

    const errors: string[] = [];
    let requestMsTotal = 0;
    const jevStart = performance.now();
    await mapConcurrent(toEvaluate, config.jevConcurrency, async ({ caseId, state, stateIds, activityKey }) => {
      const requestStart = performance.now();
      try {
        const answers = await askJev(state);
        requestMsTotal += performance.now() - requestStart;
        store.evaluations[caseId] = {
          activityKey,
          questionsVersion: QUESTIONS_VERSION,
          evaluatedAt: new Date().toISOString(),
          stateIds,
          answers,
        };
        summary.evaluated++;
        summary.inputTokens += answers.inputTokens;
      } catch (error) {
        summary.failed++;
        errors.push(`${store.cases[caseId]?.caseNumber}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    summary.jevMs = Math.round(performance.now() - jevStart);
    summary.jevAvgRequestMs = summary.evaluated ? Math.round(requestMsTotal / summary.evaluated) : 0;
    if (errors.length) {
      summary.error = `Jev failed for ${errors.length} case(s). First error: ${errors[0]}`;
      log(summary.error);
    }
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error);
    log(`Check failed: ${summary.error}`);
  }

  summary.finishedAt = new Date().toISOString();
  store.lastRun = summary;
  saveStore(store);
  log(
    `Check finished: ${summary.evaluated} evaluated, ${summary.reused} reused, ${summary.failed} failed, ` +
      `${summary.inputTokens.toLocaleString()} Jev input tokens. ` +
      `Salesforce ${(summary.syncMs / 1000).toFixed(1)}s, Jev ${(summary.jevMs / 1000).toFixed(1)}s.`,
  );
  return summary;
}
