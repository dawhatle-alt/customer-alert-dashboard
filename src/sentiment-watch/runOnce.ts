import { buildDashboard } from "./flags.ts";
import { runCheck } from "./pipeline.ts";
import { SalesforceMcp } from "./salesforce.ts";
import { loadStore } from "./store.ts";

const sf = new SalesforceMcp();
try {
  const summary = await runCheck(sf);
  const { flags } = buildDashboard(loadStore());
  console.log(`\n${flags.length} flagged case(s):`);
  for (const f of flags) {
    console.log(
      `  [${f.level.toUpperCase()}] ${f.caseNumber} | ${f.owner} | ${f.account} | ` +
        f.reasons.map((r) => `${r.label} (${r.detail})`).join("; "),
    );
  }
  process.exitCode = summary.error ? 1 : 0;
} finally {
  await sf.close();
}
