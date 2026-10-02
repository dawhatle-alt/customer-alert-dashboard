/**
 * Find Control-M cases (this calendar year, LP 9.0.21 / 9.0.22) where SSL or
 * certificates appear to be an issue, then ask Jev to confirm.
 *
 * Sources: Case Subject, Description, CaseFeed Body, inbound EmailMessage TextBody.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { SalesforceMcp } from "../src/sentiment-watch/salesforce.ts";
import { config, PROJECT_ROOT } from "../src/sentiment-watch/config.ts";

const YEAR_START = "2026-01-01T00:00:00Z";
const KEYWORD_RE =
  /\b(?:ssl|tls|mtls)\b|certificat|keystore|truststore|pkix|pkcs|openssl|self[-\s]?signed|cert\s*path|trust\s*store|client\s*cert|server\s*cert|mutual\s*tls/i;

const SUBJECT_FILTER = `(
  Subject LIKE '%SSL%' OR Subject LIKE '%TLS%' OR Subject LIKE '%certificate%' OR
  Subject LIKE '%Certificate%' OR Subject LIKE '%keystore%' OR Subject LIKE '%truststore%' OR
  Subject LIKE '%OpenSSL%' OR Subject LIKE '%PKCS%' OR Subject LIKE '%PKIX%' OR
  Subject LIKE '%mTLS%' OR Subject LIKE '%mutual TLS%'
)`;

const CASE_SCOPE = `
  sc_Service_Product_Family__c = 'CONTROL-M'
  AND CreatedDate >= ${YEAR_START}
  AND LP_Version__c IN ('9.0.21','9.0.22')
`;

type CaseRow = {
  Id: string;
  CaseNumber: string;
  Subject: string | null;
  Status: string | null;
  Priority: string | null;
  LP_Version__c: string | null;
  CreatedDate: string;
  Description: string | null;
  IsClosed: boolean;
};

type FeedRow = { Id: string; ParentId: string; Body: string | null; CreatedDate: string };
type EmailRow = { Id: string; ParentId: string; Subject: string | null; TextBody: string | null; CreatedDate: string };

type Candidate = {
  id: string;
  caseNumber: string;
  subject: string;
  status: string | null;
  priority: string | null;
  lpVersion: string | null;
  createdDate: string;
  isClosed: boolean;
  matchSources: string[];
  subjectText: string;
  descriptionSnippet: string;
  feedSnippets: string[];
  emailSnippets: string[];
};

type JevJudgment = {
  caseNumber: string;
  isSslCertIssue: number;
  category: string;
  categoryConfidence: number;
};

function snippet(text: string | null | undefined, max = 1200): string {
  if (!text) return "";
  const cleaned = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`;
}

function keywordHits(text: string | null | undefined): boolean {
  return !!text && KEYWORD_RE.test(text);
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function main() {
  const sf = new SalesforceMcp();
  const outDir = path.join(PROJECT_ROOT, "data");
  mkdirSync(outDir, { recursive: true });

  try {
    console.log("1) Subject-keyword cases…");
    const subjectCases = await sf.queryAll<CaseRow>(
      `SELECT Id, CaseNumber, Subject, Status, Priority, LP_Version__c, CreatedDate, Description, IsClosed
       FROM Case WHERE ${CASE_SCOPE} AND ${SUBJECT_FILTER}`,
      200,
    );
    console.log(`   subject matches: ${subjectCases.length}`);

    const byId = new Map<string, Candidate>();
    const ensure = (c: CaseRow, source: string): Candidate => {
      let row = byId.get(c.Id);
      if (!row) {
        row = {
          id: c.Id,
          caseNumber: c.CaseNumber,
          subject: c.Subject ?? "(no subject)",
          status: c.Status,
          priority: c.Priority,
          lpVersion: c.LP_Version__c,
          createdDate: c.CreatedDate,
          isClosed: c.IsClosed,
          matchSources: [],
          subjectText: c.Subject ?? "",
          descriptionSnippet: snippet(c.Description),
          feedSnippets: [],
          emailSnippets: [],
        };
        byId.set(c.Id, row);
      } else if (!row.descriptionSnippet && c.Description) {
        row.descriptionSnippet = snippet(c.Description);
      }
      if (!row.matchSources.includes(source)) row.matchSources.push(source);
      return row;
    };

    for (const c of subjectCases) {
      ensure(c, "subject");
      if (keywordHits(c.Description)) ensure(c, "description");
    }

    // Description is not filterable in SOQL — page all scoped cases and match client-side.
    console.log("2) Scanning Descriptions on all LP 9.0.21/9.0.22 cases this year…");
    const allScoped = await sf.queryAll<CaseRow>(
      `SELECT Id, CaseNumber, Subject, Status, Priority, LP_Version__c, CreatedDate, Description, IsClosed
       FROM Case WHERE ${CASE_SCOPE}`,
      200,
    );
    console.log(`   scoped cases loaded: ${allScoped.length}`);
    let descriptionOnly = 0;
    for (const c of allScoped) {
      if (!keywordHits(c.Description)) continue;
      const already = byId.has(c.Id);
      ensure(c, "description");
      if (!already && !keywordHits(c.Subject)) descriptionOnly++;
    }
    console.log(`   description-only additions: ${descriptionOnly}`);

    // CaseFeed.Body / EmailMessage.TextBody are not SOQL-filterable. Enrich candidates
    // with feed/email snippets (covers "case feed" evidence on keyword cases).
    // Feed-only cases with no subject/description keywords are rare and not fully enumerated.
    console.log("3) Loading CaseFeed + inbound email for keyword candidates…");
    const candidateIds = [...byId.keys()];
    const feedHits: FeedRow[] = [];
    const emailHits: EmailRow[] = [];
    for (let i = 0; i < candidateIds.length; i += 50) {
      const chunk = candidateIds.slice(i, i + 50).map((id) => `'${id}'`).join(",");
      const feeds = await sf.queryAll<FeedRow>(
        `SELECT Id, ParentId, Body, CreatedDate FROM CaseFeed
         WHERE Type IN ('TextPost','ContentPost') AND ParentId IN (${chunk})`,
        200,
      );
      feedHits.push(...feeds.filter((f) => keywordHits(f.Body)));
      const emails = await sf.queryAll<EmailRow>(
        `SELECT Id, ParentId, Subject, TextBody, CreatedDate FROM EmailMessage
         WHERE Incoming = true AND ParentId IN (${chunk})`,
        100,
      );
      emailHits.push(...emails.filter((e) => keywordHits(e.Subject) || keywordHits(e.TextBody)));
      if (i % 250 === 0) {
        process.stdout.write(`   candidate activity ${Math.min(i + 50, candidateIds.length)}/${candidateIds.length}\n`);
      }
    }
    console.log(`   feed keyword rows on candidates: ${feedHits.length}`);
    console.log(`   email keyword rows on candidates: ${emailHits.length}`);

    const feedByParent = new Map<string, FeedRow[]>();
    for (const f of feedHits) {
      const list = feedByParent.get(f.ParentId) ?? [];
      list.push(f);
      feedByParent.set(f.ParentId, list);
    }
    for (const [parentId, posts] of feedByParent) {
      const c = byId.get(parentId);
      if (!c) continue;
      if (!c.matchSources.includes("feed")) c.matchSources.push("feed");
      c.feedSnippets = posts.slice(0, 4).map((p) => snippet(p.Body, 800));
    }

    const emailByParent = new Map<string, EmailRow[]>();
    for (const e of emailHits) {
      const list = emailByParent.get(e.ParentId) ?? [];
      list.push(e);
      emailByParent.set(e.ParentId, list);
    }
    for (const [parentId, msgs] of emailByParent) {
      const c = byId.get(parentId);
      if (!c) continue;
      if (!c.matchSources.includes("email")) c.matchSources.push("email");
      if (!c.matchSources.includes("feed")) c.matchSources.push("feed");
      c.emailSnippets = msgs.slice(0, 4).map((m) => snippet(`${m.Subject ?? ""}\n${m.TextBody ?? ""}`, 800));
    }

    const candidates = [...byId.values()].sort((a, b) => b.createdDate.localeCompare(a.createdDate));
    console.log(`4) Unique keyword candidates: ${candidates.length}`);

    const candidatesPath = path.join(outDir, "ssl-cert-candidates.json");
    writeFileSync(candidatesPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: candidates.length, candidates }, null, 2));
    console.log(`   wrote ${candidatesPath}`);

    if (!process.env.TYPESAFE_API_KEY?.trim()) {
      throw new Error("TYPESAFE_API_KEY is not set");
    }

    const client = new TypeSafeClient({
      defaultModel: config.jevModel,
      timeout: 45_000,
      retry: { maxRetries: 4 },
    });

    console.log(`5) Jev analysis on ${candidates.length} candidates (concurrency ${config.jevConcurrency})…`);
    const judgments = await mapPool(candidates, config.jevConcurrency, async (c) => {
      const state = {
        caseNumber: c.caseNumber,
        subject: c.subjectText,
        description: c.descriptionSnippet,
        feed: c.feedSnippets,
        emails: c.emailSnippets,
        matchSources: c.matchSources,
      };
      const result = await client.systemOne({
        state,
        questions: {
          isSslCertIssue: noul(
            {
              question:
                "Based on `subject`, `description`, `feed`, and `emails`, is SSL, TLS, certificates, keystores, or truststores an actual problem, question, vulnerability, or configuration topic for this Control-M support case?",
              note:
                "Answer yes when the customer is dealing with SSL/TLS setup, certificate trust/errors, keystores, OpenSSL CVEs in Control-M components, HTTPS handshake failures, or certificate renewal. Answer no when the keyword is incidental (e.g. product name containing SSL as in MSSQL only without SSL intent, or 'certificate' meaning something else) or the case is unrelated.",
            },
            {
              true: "SSL/TLS or certificates are a real issue or topic on this case.",
              false: "Keywords are incidental or the case is not about SSL/certificates.",
            },
          ),
          category: noul(
            {
              question:
                "If this case is about SSL/certificates, does it primarily concern a runtime failure or trust error (handshake, PKIX, expired/untrusted cert) rather than a general how-to, security questionnaire, or OpenSSL CVE/version question?",
            },
            {
              true: "Primarily a runtime SSL/TLS or certificate trust/failure issue.",
              false: "Not primarily a runtime failure, or not an SSL/cert case.",
            },
          ),
        },
      });

      const answers = result.answers as Record<string, { type?: string; noul?: number; confidence?: number }>;
      const isSsl = answers.isSslCertIssue?.type === "noul" ? (answers.isSslCertIssue.noul ?? 0) : 0;
      const cat = answers.category?.type === "noul" ? (answers.category.noul ?? 0) : 0;
      process.stdout.write(".");
      return {
        caseNumber: c.caseNumber,
        isSslCertIssue: isSsl,
        category: cat >= 0.5 ? "runtime_failure" : "other_ssl_topic",
        categoryConfidence: cat,
      } satisfies JevJudgment;
    });
    process.stdout.write("\n");

    const byCase = new Map(judgments.map((j) => [j.caseNumber, j]));
    const confirmed = candidates
      .map((c) => {
        const j = byCase.get(c.caseNumber)!;
        return { ...c, jev: j };
      })
      .filter((c) => c.jev.isSslCertIssue >= 0.7)
      .sort((a, b) => b.jev.isSslCertIssue - a.jev.isSslCertIssue || b.createdDate.localeCompare(a.createdDate));

    const uncertain = candidates
      .map((c) => ({ ...c, jev: byCase.get(c.caseNumber)! }))
      .filter((c) => c.jev.isSslCertIssue >= 0.4 && c.jev.isSslCertIssue < 0.7);

    const rejected = candidates
      .map((c) => ({ ...c, jev: byCase.get(c.caseNumber)! }))
      .filter((c) => c.jev.isSslCertIssue < 0.4);

    const report = {
      generatedAt: new Date().toISOString(),
      filters: {
        productFamily: "CONTROL-M",
        createdFrom: YEAR_START,
        lpVersions: ["9.0.21", "9.0.22"],
        keywordSources: [
          "subject (SOQL)",
          "description (full client scan of scoped cases)",
          "case feed + inbound email (enriched on keyword candidates; feed-only discovery not exhaustive because Body/TextBody are not SOQL-filterable)",
        ],
        jevConfirmThreshold: 0.7,
      },
      counts: {
        keywordCandidates: candidates.length,
        jevConfirmed: confirmed.length,
        jevUncertain: uncertain.length,
        jevRejected: rejected.length,
        byLp: {
          "9.0.21": confirmed.filter((c) => c.lpVersion === "9.0.21").length,
          "9.0.22": confirmed.filter((c) => c.lpVersion === "9.0.22").length,
        },
        runtimeFailures: confirmed.filter((c) => c.jev.category === "runtime_failure" && c.jev.categoryConfidence >= 0.6)
          .length,
      },
      confirmed: confirmed.map((c) => ({
        caseNumber: c.caseNumber,
        subject: c.subject,
        status: c.status,
        priority: c.priority,
        lpVersion: c.lpVersion,
        createdDate: c.createdDate,
        isClosed: c.isClosed,
        matchSources: c.matchSources,
        jevSslProbability: Number(c.jev.isSslCertIssue.toFixed(3)),
        jevTopic: c.jev.category,
        jevRuntimeProbability: Number(c.jev.categoryConfidence.toFixed(3)),
        url: `${config.salesforceUrl}/lightning/r/Case/${c.id}/view`,
      })),
      uncertain: uncertain.map((c) => ({
        caseNumber: c.caseNumber,
        subject: c.subject,
        lpVersion: c.lpVersion,
        jevSslProbability: Number(c.jev.isSslCertIssue.toFixed(3)),
        matchSources: c.matchSources,
        url: `${config.salesforceUrl}/lightning/r/Case/${c.id}/view`,
      })),
    };

    const reportPath = path.join(outDir, "ssl-cert-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nConfirmed SSL/cert issues: ${confirmed.length}`);
    console.log(`Uncertain: ${uncertain.length}; Rejected: ${rejected.length}`);
    console.log(`Wrote ${reportPath}`);

    console.log("\nTop confirmed cases:");
    for (const c of confirmed.slice(0, 25)) {
      console.log(
        `  ${c.caseNumber} [${c.lpVersion}] P=${c.jev.isSslCertIssue.toFixed(2)} (${c.matchSources.join("+")}) ${c.subject.slice(0, 90)}`,
      );
    }
  } finally {
    await sf.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
