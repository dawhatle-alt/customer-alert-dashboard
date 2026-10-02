import { existsSync } from "node:fs";
import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");

const envFile = path.join(PROJECT_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export const config = {
  orgAlias: process.env.SF_ORG_ALIAS?.trim() || "bmc",
  salesforceUrl: "https://bmcapps.lightning.force.com",
  /** Same server definition as the salesforce-bmc entry in ~/.cursor/mcp.json. */
  mcpServer: {
    command: "npx",
    args: [
      "-y",
      "@salesforce/mcp@latest",
      "--orgs",
      process.env.SF_ORG_ALIAS?.trim() || "bmc",
      "--toolsets",
      "data",
      "--tools",
      "run_soql_query",
    ],
  },
  productFamily: "CONTROL-M",
  intervalMinutes: intEnv("CHECK_INTERVAL_MINUTES", 30),
  lookbackDays: intEnv("LOOKBACK_DAYS", 14),
  port: intEnv("PORT", 3000),
  dataFile: path.join(PROJECT_ROOT, "data", "store.json"),
  publicDir: path.join(PROJECT_ROOT, "src", "sentiment-watch", "public"),

  /** Most recent items per case sent to Jev; keeps state focused (see Jev jaggedness: large state). */
  maxCustomerMessages: 6,
  maxEngineerNotes: 4,
  maxCharsPerItem: 1500,

  jevModel: "jev-latest",
  jevConcurrency: 8,

  rootCause: {
    dataFile: path.join(PROJECT_ROOT, "data", "rootcause.json"),
    windowDays: intEnv("RC_WINDOW_DAYS", 30),
    /** Cases per history query; each returns up to `emails` + `notes` bodies per case. */
    batchSize: 15,
    fetchConcurrency: 3,
    emails: 8,
    notes: 6,
    maxDescriptionChars: 2500,
    maxEmailChars: 1500,
    maxNoteChars: 800,
  },
};
