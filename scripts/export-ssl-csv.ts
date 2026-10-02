import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/sentiment-watch/config.ts";

type Confirmed = {
  caseNumber: string;
  subject: string;
  status: string | null;
  priority: string | null;
  lpVersion: string | null;
  createdDate: string;
  isClosed: boolean;
  matchSources: string[];
  jevSslProbability: number;
  jevTopic: string;
  jevRuntimeProbability: number;
  url: string;
};

const report = JSON.parse(
  readFileSync(path.join(PROJECT_ROOT, "data", "ssl-cert-report.json"), "utf8"),
) as { confirmed: Confirmed[] };

const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const header = [
  "CaseNumber",
  "Subject",
  "Status",
  "Priority",
  "LP_Version",
  "CreatedDate",
  "IsClosed",
  "MatchSources",
  "JevSslProbability",
  "JevTopic",
  "JevRuntimeProbability",
  "Url",
];
const lines = [header.join(",")];
for (const c of report.confirmed) {
  lines.push(
    [
      c.caseNumber,
      esc(c.subject),
      esc(c.status),
      esc(c.priority),
      c.lpVersion,
      c.createdDate,
      c.isClosed,
      c.matchSources.join("|"),
      c.jevSslProbability,
      c.jevTopic,
      c.jevRuntimeProbability,
      c.url,
    ].join(","),
  );
}
const out = path.join(PROJECT_ROOT, "data", "ssl-cert-confirmed.csv");
writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${report.confirmed.length} rows to ${out}`);
