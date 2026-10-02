/**
 * Product-improvement insights for Jev-confirmed SSL/certificate cases
 * (output of scripts/ssl-cert-cases.ts).
 *
 * Salesforce supplies facts (component, support root cause, R&D routing, close time).
 * Jev supplies judgments (issue area, preventing product lever, friction signals).
 * Code aggregates everything into data/ssl-cert-insights.json for the dashboard.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { choice, noul, TypeSafeClient, type ChoiceResponse, type NoulResponse } from "@typesafe-ai/sdk";
import { SalesforceMcp } from "../src/sentiment-watch/salesforce.ts";
import { config, PROJECT_ROOT } from "../src/sentiment-watch/config.ts";

const QUESTIONS_VERSION = 1;
const DATA = path.join(PROJECT_ROOT, "data");
const ENRICHED_FILE = path.join(DATA, "ssl-cert-enriched.json");
const JEV_FILE = path.join(DATA, "ssl-cert-jev.json");
const OUT_FILE = path.join(DATA, "ssl-cert-insights.json");

/** Control-M cases on each LP this year (denominator for per-LP rates). */
const SCOPED_BY_LP: Record<string, number> = { "9.0.21": 13841, "9.0.22": 7527 };

export const ISSUE_AREAS = {
  initial_enablement:
    "Turning on SSL/TLS for Control-M's own component communication for the first time (Agent to Server, Server to EM, EM to clients, SSL zone 1/2/3 setup, z/OS gateway), including which steps and files are needed.",
  renewal_rotation:
    "Renewing, replacing, or rotating certificates that are expiring or have expired, including redeploying new certificates to agents or components.",
  trust_chain_ca:
    "Trusting a CA or certificate chain: importing root or intermediate CA certificates into Control-M keystores or truststores, internal or corporate CAs, PKIX 'unable to find valid certification path' errors.",
  cert_creation_formats:
    "Creating keys, CSRs, or self-signed certificates, or converting and handling certificate formats, keystore files, and keystore passwords (PEM, PKCS#12, JKS, kdb).",
  outbound_integration_tls:
    "Control-M jobs, plug-ins, or integrations (Application Integrator, Managed File Transfer, cloud or ERP plug-ins, Automation API clients, Jenkins, databases used by jobs) connecting to external HTTPS/TLS endpoints.",
  web_api_https:
    "The HTTPS certificate of Control-M Web, the Control-M/EM web server, or the Automation API endpoint.",
  ldap_db_tls:
    "Encrypting Control-M's own LDAP/Active Directory authentication (LDAPS) or its own Control-M/Server or EM database connection (MSSQL, Oracle, PostgreSQL SSL).",
  hardening_protocols:
    "TLS protocol versions, cipher suites, weak signature or hash algorithms, HSTS, or other TLS configuration hardening, often raised by a security scan.",
  vulnerable_libraries:
    "Vulnerabilities (CVEs) in OpenSSL, Java, or other crypto libraries bundled with Control-M, and which fix pack or version resolves them.",
  other_ssl: "Related to SSL or certificates, but none of the other areas fit.",
} as const;

export const LEVERS = {
  better_documentation:
    "Clearer, more complete, or easier-to-find documentation or knowledge articles (step-by-step procedures, examples, prerequisites).",
  clearer_errors_diagnostics:
    "Clearer error messages, logs, or status, or a built-in diagnostic or validation check that pinpoints the certificate or TLS cause.",
  guided_config_tooling:
    "A simpler guided tool, wizard, or single command to generate, import, and apply certificates and enable SSL correctly.",
  centralized_cert_lifecycle:
    "Centralized certificate lifecycle management: expiry monitoring and alerts, automated renewal, and pushing certificates to many agents from one place.",
  updated_bundled_libraries: "Shipping updated OpenSSL, Java, or crypto libraries, or faster security fix packs.",
  fix_product_defect: "Fixing a bug in Control-M's SSL or certificate handling.",
  new_capability_integration:
    "Supporting a capability not available today, such as a certificate format, an external CA or secrets-manager integration (CyberArk, Venafi), a TLS option, or configurable hostname verification.",
  none_customer_environment:
    "No product change would help: the cause was the customer's own environment, network, proxy, CA, or a third-party system.",
  unclear: "There is not enough information to tell.",
} as const;

type IssueArea = keyof typeof ISSUE_AREAS;
type Lever = keyof typeof LEVERS;

const SIGNALS = {
  docGap: {
    question:
      "Did the customer lack or misunderstand the SSL/certificate procedure? For example, they asked how to do it, followed documentation that was incomplete or unclear, or support's answer was mainly to point to or explain documented steps.",
    yes: "The customer did not know or misunderstood the procedure, or the documentation was missing, incomplete, or unclear.",
    no: "The customer knew the procedure; the problem was something else.",
  },
  manualToil: {
    question:
      "Does the case involve manual, repetitive, multi-step certificate work (running keytool or openssl commands, copying files to each agent or host, editing config files, restarting components, repeating per host) that built-in automation in Control-M could remove?",
    yes: "The case involves manual, repetitive, or multi-step certificate work that product automation could remove.",
    no: "No significant manual certificate work is involved.",
  },
  unclearError: {
    question:
      "Did Control-M show an error message, log entry, or status that was unclear or misleading about the SSL/certificate cause (for example a generic communication error or 'Unavailable' agent instead of a certificate error), so the cause had to be diagnosed by support?",
    yes: "Control-M's errors, logs, or status were unclear or misleading about the certificate or TLS cause.",
    no: "Errors were clear, or there was no error because this was a question.",
  },
  productDefect: {
    question:
      "Is there evidence of a bug in Control-M's SSL/certificate handling? For example, a defect, hotfix, or fix pack was referenced as the fix, or Control-M failed even though the configuration was correct.",
    yes: "There is evidence of a Control-M defect in SSL or certificate handling.",
    no: "No evidence of a Control-M defect.",
  },
  businessImpact: {
    question:
      "Did the SSL/certificate problem cause production impact, such as jobs failing, agents or components disconnected or unavailable, or a blocked upgrade, go-live, or audit deadline?",
    yes: "There was production impact or a blocked upgrade, go-live, or deadline.",
    no: "No production impact; this was a question, a planned change, or a non-production issue.",
  },
  upgradeTriggered: {
    question: "Was the SSL/certificate problem triggered by a Control-M upgrade, fix pack installation, or migration?",
    yes: "An upgrade, fix pack, or migration triggered the problem.",
    no: "Not triggered by an upgrade, fix pack, or migration.",
  },
  expiryTriggered: {
    question: "Was the case triggered by a certificate expiring, about to expire, or being renewed or replaced?",
    yes: "Certificate expiry, renewal, or replacement triggered the case.",
    no: "Not triggered by certificate expiry or renewal.",
  },
  securityCompliance: {
    question:
      "Was the case driven by a security scan, audit, or compliance requirement rather than by a functional failure?",
    yes: "A security scan, audit, or compliance requirement drove the case.",
    no: "The case was driven by a functional need or failure.",
  },
  featureRequest: {
    question:
      "Does the customer ask for an SSL/certificate capability that Control-M does not currently have (for example a certificate format, an external CA or secrets-manager integration, automatic renewal, a TLS option, or configurable hostname verification)?",
    yes: "The customer asks for a capability Control-M does not have.",
    no: "No request for a missing capability.",
  },
} as const;

type SignalId = keyof typeof SIGNALS;
const SIGNAL_IDS = Object.keys(SIGNALS) as SignalId[];

type Confirmed = {
  caseNumber: string;
  subject: string;
  status: string | null;
  lpVersion: string | null;
  createdDate: string;
  isClosed: boolean;
  jevSslProbability: number;
  url: string;
};

type Candidate = {
  id: string;
  caseNumber: string;
  descriptionSnippet: string;
  feedSnippets: string[];
  emailSnippets: string[];
};

type SfFacts = {
  Id: string;
  CaseNumber: string;
  ClosedDate: string | null;
  AccountId: string | null;
  sc_DR_Name__c: string | null;
  sc_Root_Cause_1__r: { Name: string } | null;
  sc_Case_Routed_To_Eng_Y_N__c: boolean | null;
  sc_Case_Defect_Attached_Y_N__c: boolean | null;
};

type Enriched = {
  id: string;
  caseNumber: string;
  subject: string;
  status: string | null;
  lpVersion: string | null;
  createdDate: string;
  closedDate: string | null;
  isClosed: boolean;
  url: string;
  accountId: string | null;
  component: string;
  supportRootCause: string | null;
  routedToEng: boolean;
  defectAttached: boolean;
  emailCount: number;
  description: string;
  customerAndFeed: string[];
  supportReplies: string[];
};

type JevResult = {
  version: number;
  issueArea: IssueArea;
  issueAreaConfidence: number;
  lever: Lever;
  leverConfidence: number;
  signals: Record<SignalId, number>;
};

function clean(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const withoutQuote = text.split(
    /\n\s*(?:From:|De\s*:|Von:|-----\s*Original Message|On .{0,120}wrote:|_{10,})/i,
  )[0]!;
  const flat = withoutQuote.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function idList(ids: string[]): string {
  return ids.map((id) => `'${id}'`).join(",");
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function enrich(confirmed: Confirmed[], candidates: Map<string, Candidate>): Promise<Enriched[]> {
  if (existsSync(ENRICHED_FILE)) {
    const cached = JSON.parse(readFileSync(ENRICHED_FILE, "utf8")) as Enriched[];
    if (cached.length === confirmed.length) {
      console.log(`Using cached Salesforce enrichment (${cached.length} cases)`);
      return cached;
    }
  }

  const sf = new SalesforceMcp();
  try {
    const ids = confirmed.map((c) => candidates.get(c.caseNumber)!.id);

    console.log("Loading case facts…");
    const facts = new Map<string, SfFacts>();
    for (let i = 0; i < ids.length; i += 200) {
      const page = await sf.query<SfFacts>(
        `SELECT Id, CaseNumber, ClosedDate, AccountId, sc_DR_Name__c, sc_Root_Cause_1__r.Name, ` +
          `sc_Case_Routed_To_Eng_Y_N__c, sc_Case_Defect_Attached_Y_N__c FROM Case WHERE Id IN (${idList(ids.slice(i, i + 200))})`,
      );
      for (const r of page.records) facts.set(r.Id, r);
    }

    console.log("Loading email counts and BMC support replies…");
    const emailCounts = new Map<string, number>();
    const replies = new Map<string, { at: string; text: string }[]>();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = idList(ids.slice(i, i + 50));
      const counts = await sf.query<{ ParentId: string; n: number }>(
        `SELECT ParentId, COUNT(Id) n FROM EmailMessage WHERE ParentId IN (${chunk}) GROUP BY ParentId`,
      );
      for (const r of counts.records) emailCounts.set(r.ParentId, r.n);

      const outbound = await sf.queryAll<{ Id: string; ParentId: string; CreatedDate: string; TextBody: string | null }>(
        `SELECT Id, ParentId, CreatedDate, TextBody FROM EmailMessage WHERE Incoming = false AND ParentId IN (${chunk})`,
        50,
      );
      for (const e of outbound) {
        const text = clean(e.TextBody, 1200);
        if (!text) continue;
        const list = replies.get(e.ParentId) ?? [];
        list.push({ at: e.CreatedDate, text });
        replies.set(e.ParentId, list);
      }
      if (i % 250 === 0) console.log(`  ${Math.min(i + 50, ids.length)}/${ids.length}`);
    }

    const enriched = confirmed.map((c): Enriched => {
      const cand = candidates.get(c.caseNumber)!;
      const f = facts.get(cand.id);
      const lastReplies = (replies.get(cand.id) ?? [])
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-2)
        .map((r) => r.text);
      return {
        id: cand.id,
        caseNumber: c.caseNumber,
        subject: c.subject,
        status: c.status,
        lpVersion: c.lpVersion,
        createdDate: c.createdDate,
        closedDate: f?.ClosedDate ?? null,
        isClosed: c.isClosed,
        url: c.url,
        accountId: f?.AccountId ?? null,
        component: f?.sc_DR_Name__c?.trim() || "Unspecified",
        supportRootCause: f?.sc_Root_Cause_1__r?.Name ?? null,
        routedToEng: f?.sc_Case_Routed_To_Eng_Y_N__c === true,
        defectAttached: f?.sc_Case_Defect_Attached_Y_N__c === true,
        emailCount: emailCounts.get(cand.id) ?? 0,
        description: cand.descriptionSnippet,
        customerAndFeed: [...cand.emailSnippets, ...cand.feedSnippets].slice(0, 5),
        supportReplies: lastReplies,
      };
    });
    writeFileSync(ENRICHED_FILE, JSON.stringify(enriched, null, 2));
    return enriched;
  } finally {
    await sf.close();
  }
}

function buildQuestions() {
  const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {
    issueArea: choice(
      "Based on `case`, `customer_and_case_feed`, and `bmc_support_replies`, which area of SSL/TLS or certificate management is the main subject of this Control-M support case?",
      ISSUE_AREAS,
    ),
    lever: choice(
      "Based on `case`, `customer_and_case_feed`, and `bmc_support_replies`, which single product improvement by BMC would most likely have prevented this Control-M support case, or let the customer resolve it without contacting support?",
      LEVERS,
    ),
  };
  for (const id of SIGNAL_IDS) {
    const s = SIGNALS[id];
    questions[id] = noul(
      `Based on \`case\`, \`customer_and_case_feed\`, and \`bmc_support_replies\`: ${s.question}`,
      { true: s.yes, false: s.no },
    );
  }
  return questions;
}

async function analyze(cases: Enriched[]): Promise<Map<string, JevResult>> {
  const cache: Record<string, JevResult> = existsSync(JEV_FILE)
    ? (JSON.parse(readFileSync(JEV_FILE, "utf8")) as Record<string, JevResult>)
    : {};
  const todo = cases.filter((c) => cache[c.caseNumber]?.version !== QUESTIONS_VERSION);
  console.log(`Jev: ${cases.length - todo.length} cached, ${todo.length} to evaluate`);

  if (todo.length > 0) {
    if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error("TYPESAFE_API_KEY is not set");
    const client = new TypeSafeClient({ defaultModel: config.jevModel, timeout: 45_000, retry: { maxRetries: 4 } });
    const questions = buildQuestions();
    let done = 0;
    await mapPool(todo, config.jevConcurrency, async (c) => {
      const state = {
        case: {
          subject: c.subject,
          description: c.description,
          control_m_component: c.component,
          control_m_version: c.lpVersion,
        },
        customer_and_case_feed: c.customerAndFeed,
        bmc_support_replies: c.supportReplies,
      };
      try {
        const result = await client.systemOne({ state, questions });
        const answers = result.answers as Record<string, NoulResponse | ChoiceResponse>;
        const area = answers.issueArea as ChoiceResponse;
        const lever = answers.lever as ChoiceResponse;
        cache[c.caseNumber] = {
          version: QUESTIONS_VERSION,
          issueArea: area.choice as IssueArea,
          issueAreaConfidence: area.confidence,
          lever: lever.choice as Lever,
          leverConfidence: lever.confidence,
          signals: Object.fromEntries(
            SIGNAL_IDS.map((id) => [id, (answers[id] as NoulResponse).noul]),
          ) as Record<SignalId, number>,
        };
      } catch (err) {
        console.warn(`\n  Jev failed for ${c.caseNumber}: ${(err as Error).message}`);
      }
      done++;
      if (done % 50 === 0) {
        writeFileSync(JEV_FILE, JSON.stringify(cache));
        console.log(`  ${done}/${todo.length}`);
      }
    });
    writeFileSync(JEV_FILE, JSON.stringify(cache));
  }
  return new Map(Object.entries(cache));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round = (n: number, d = 3) => Number(n.toFixed(d));

type Row = Enriched & { jev: JevResult; daysToClose: number | null };

function summarize(rows: Row[], total: number) {
  const closedDays = rows.flatMap((r) => (r.daysToClose == null ? [] : [r.daysToClose]));
  const mean = (id: SignalId) => (rows.length ? rows.reduce((s, r) => s + r.jev.signals[id], 0) / rows.length : 0);
  return {
    count: rows.length,
    share: round(rows.length / total),
    open: rows.filter((r) => !r.isClosed).length,
    accounts: new Set(rows.map((r) => r.accountId).filter(Boolean)).size,
    lp: {
      "9.0.21": rows.filter((r) => r.lpVersion === "9.0.21").length,
      "9.0.22": rows.filter((r) => r.lpVersion === "9.0.22").length,
    },
    medianDaysToClose: closedDays.length ? round(median(closedDays)!, 1) : null,
    medianEmails: median(rows.map((r) => r.emailCount)),
    routedToEngRate: round(rows.filter((r) => r.routedToEng).length / Math.max(rows.length, 1)),
    defectAttachedRate: round(rows.filter((r) => r.defectAttached).length / Math.max(rows.length, 1)),
    signals: Object.fromEntries(SIGNAL_IDS.map((id) => [id, round(mean(id))])) as Record<SignalId, number>,
  };
}

function countBy<T>(items: T[], key: (t: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

function examples(rows: Row[], n: number, rank: (r: Row) => number) {
  return [...rows]
    .sort((a, b) => rank(b) - rank(a) || b.createdDate.localeCompare(a.createdDate))
    .slice(0, n)
    .map((r) => ({
      caseNumber: r.caseNumber,
      subject: r.subject.length > 110 ? `${r.subject.slice(0, 110)}…` : r.subject,
      lp: r.lpVersion,
      component: r.component,
      url: r.url,
    }));
}

async function main() {
  const report = JSON.parse(readFileSync(path.join(DATA, "ssl-cert-report.json"), "utf8")) as { confirmed: Confirmed[] };
  const candFile = JSON.parse(readFileSync(path.join(DATA, "ssl-cert-candidates.json"), "utf8")) as {
    candidates: Candidate[];
  };
  const candidates = new Map(candFile.candidates.map((c) => [c.caseNumber, c]));

  const enriched = await enrich(report.confirmed, candidates);
  const jev = await analyze(enriched);

  const rows: Row[] = enriched.flatMap((c) => {
    const j = jev.get(c.caseNumber);
    if (!j || j.version !== QUESTIONS_VERSION) return [];
    const daysToClose =
      c.isClosed && c.closedDate
        ? (Date.parse(c.closedDate) - Date.parse(c.createdDate)) / 86_400_000
        : null;
    return [{ ...c, jev: j, daysToClose }];
  });
  const total = rows.length;
  console.log(`Aggregating ${total} analyzed cases`);

  const months = [...new Set(rows.map((r) => r.createdDate.slice(0, 7)))].sort();
  const topComponents = countBy(rows, (r) => r.component).slice(0, 8).map((c) => c.key);

  const issueAreas = (Object.keys(ISSUE_AREAS) as IssueArea[])
    .map((area) => {
      const sub = rows.filter((r) => r.jev.issueArea === area);
      return {
        area,
        description: ISSUE_AREAS[area],
        ...summarize(sub, total),
        lowConfidenceShare: round(sub.filter((r) => r.jev.issueAreaConfidence < 0.6).length / Math.max(sub.length, 1)),
        monthly: months.map((m) => sub.filter((r) => r.createdDate.startsWith(m)).length),
        topComponents: countBy(sub, (r) => r.component).slice(0, 3),
        levers: countBy(sub, (r) => r.jev.lever),
        examples: examples(sub, 5, (r) => r.jev.issueAreaConfidence + r.jev.signals.businessImpact),
      };
    })
    .filter((a) => a.count > 0)
    .sort((a, b) => b.count - a.count);

  const levers = (Object.keys(LEVERS) as Lever[])
    .map((lever) => {
      const sub = rows.filter((r) => r.jev.lever === lever);
      return {
        lever,
        description: LEVERS[lever],
        ...summarize(sub, total),
        areas: countBy(sub, (r) => r.jev.issueArea),
        examples: examples(sub, 5, (r) => r.jev.leverConfidence),
      };
    })
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count);

  const components = countBy(rows, (r) => r.component).map(({ key, count }) => {
    const sub = rows.filter((r) => r.component === key);
    return { component: key, ...summarize(sub, total), areas: countBy(sub, (r) => r.jev.issueArea).slice(0, 3) };
  });

  const heatmap = {
    components: topComponents,
    areas: issueAreas.map((a) => a.area),
    counts: topComponents.map((comp) =>
      issueAreas.map((a) => rows.filter((r) => r.component === comp && r.jev.issueArea === a.area).length),
    ),
  };

  const supportRootCause = countBy(rows, (r) => r.supportRootCause ?? "Not set").map(({ key, count }) => ({
    rootCause: key,
    count,
    levers: countBy(
      rows.filter((r) => (r.supportRootCause ?? "Not set") === key),
      (r) => r.jev.lever,
    ),
  }));

  const insights = {
    generatedAt: new Date().toISOString(),
    scope: {
      productFamily: "CONTROL-M",
      createdFrom: "2026-01-01",
      lpVersions: ["9.0.21", "9.0.22"],
      scopedCasesByLp: SCOPED_BY_LP,
      jevModel: config.jevModel,
      questionsVersion: QUESTIONS_VERSION,
    },
    overall: summarize(rows, total),
    months,
    issueAreas,
    levers,
    components,
    heatmap,
    supportRootCause,
  };
  writeFileSync(OUT_FILE, JSON.stringify(insights, null, 2));
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
