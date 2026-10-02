import { config } from "./config.ts";
import { buildRcState, buildRootCauseReport, loadRcStore, runRootCauseCheck } from "./rootcause.ts";
import { askRootCauseJev } from "./rootcauseJev.ts";
import { fetchCaseHistory, SalesforceMcp } from "./salesforce.ts";

/**
 * Usage:
 *   npm run rc-check -- [maxCasesToReview]   review closed cases and print a sample
 *   npm run rc-check -- show 02172301         print Jev's state and answers for one case
 */
const sf = new SalesforceMcp();
try {
  if (process.argv[2] === "show") {
    const store = loadRcStore();
    const c = Object.values(store.cases).find((x) => x.caseNumber === process.argv[3]);
    if (!c) throw new Error(`Case ${process.argv[3]} is not in data/rootcause.json; run a check first.`);
    const [history] = await fetchCaseHistory(sf, [c.id], config.rootCause.emails, config.rootCause.notes);
    const state = buildRcState(c, history!);
    console.log(JSON.stringify(state, null, 2));
    console.log(`\nRecorded: ${c.rc1} > ${c.rc2}   Disposition: ${c.disposition}`);
    console.log(JSON.stringify(await askRootCauseJev(state), null, 2));
  } else {
    const limit = Number.parseInt(process.argv[2] ?? "", 10) || undefined;
    await runRootCauseCheck(sf, console.log, limit);
    const report = buildRootCauseReport(loadRcStore(), false);
    console.log("\nTotals:", JSON.stringify(report.totals));
    const reviewed = report.tsas.flatMap((t) => t.cases.map((c) => ({ ...c, owner: t.owner }))).filter((c) => c.verdict !== "pending");
    for (const c of reviewed.slice(0, 40)) {
      console.log(
        `${c.caseNumber}  ${c.owner.padEnd(22)} ${String(c.score).padStart(3)} ${c.verdict.padEnd(12)} ` +
          `recorded: ${c.recorded.rc1} > ${c.recorded.rc2}  |  Jev: ${c.suggested?.rc1} > ${c.suggested?.rc2}` +
          (c.findings.length ? `\n      ${c.findings.map((f) => f.text).join("; ")}` : ""),
      );
    }
  }
} finally {
  await sf.close();
}
