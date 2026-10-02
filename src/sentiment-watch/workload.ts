import { config } from "./config.ts";
import type { CaseRecord, Store } from "./store.ts";

const DAY_MS = 86_400_000;

/** Report columns, in display order. */
export const WORKLOAD_METRICS = [
  { id: "caseCount", label: "Case Count" },
  { id: "pendingTsa", label: "# Cases Pending TSA" },
  { id: "totalDaysOpen", label: "Total Days Open" },
  { id: "open10NotRouted", label: "Case Open >=10 Days Not Routed to Engineering" },
  { id: "open30", label: "# Cases Open >30 Days" },
  { id: "noContact3", label: "# Cases Last Customer Contact >3 Days" },
  { id: "routedToEng", label: "# Cases Routed to Engineering" },
] as const;

export type MetricId = (typeof WORKLOAD_METRICS)[number]["id"];
type Metrics = Record<MetricId, number>;

export type WorkloadCase = {
  caseId: string;
  caseUrl: string;
  caseNumber: string;
  subject: string;
  status: string;
  priority: string;
  account: string;
  daysOpen: number;
  daysSinceContact: number | null;
  routedToEng: boolean;
  /** Metric ids this case counts toward, so the dashboard can filter the drill-down. */
  counts: MetricId[];
};

export type OwnerRow = { owner: string; metrics: Metrics; aboveAverage: MetricId[]; cases: WorkloadCase[] };
export type TeamGroup = { manager: string; owners: OwnerRow[]; average: Metrics; total: Metrics };

const emptyMetrics = (): Metrics => ({
  caseCount: 0,
  pendingTsa: 0,
  totalDaysOpen: 0,
  open10NotRouted: 0,
  open30: 0,
  noContact3: 0,
  routedToEng: 0,
});

/** "Marcelo Souza" → "Souza, Marcelo", matching the existing report. */
function lastFirst(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || name.startsWith("Queue") || name === "—" || name === "Unassigned") return name;
  const last = parts.pop()!;
  return `${last}, ${parts.join(" ")}`;
}

function toWorkloadCase(c: CaseRecord, now: number): WorkloadCase {
  const daysOpen = Math.floor((now - new Date(c.createdDate).getTime()) / DAY_MS);
  const daysSinceContact = c.lastCustomerContact
    ? Math.floor((now - new Date(c.lastCustomerContact).getTime()) / DAY_MS)
    : null;
  const counts: MetricId[] = ["caseCount", "totalDaysOpen"];
  if (c.status === "Work In Progress-TSA") counts.push("pendingTsa");
  if (daysOpen >= 10 && !c.routedToEng) counts.push("open10NotRouted");
  if (daysOpen > 30) counts.push("open30");
  if ((daysSinceContact ?? daysOpen) > 3) counts.push("noContact3");
  if (c.routedToEng) counts.push("routedToEng");
  return {
    caseId: c.id,
    caseUrl: `${config.salesforceUrl}/lightning/r/Case/${c.id}/view`,
    caseNumber: c.caseNumber,
    subject: c.subject,
    status: c.status,
    priority: c.priority,
    account: c.account,
    daysOpen,
    daysSinceContact,
    routedToEng: c.routedToEng,
    counts,
  };
}

function metricsFor(cases: WorkloadCase[]): Metrics {
  const m = emptyMetrics();
  for (const c of cases) {
    for (const id of c.counts) m[id] += id === "totalDaysOpen" ? c.daysOpen : 1;
  }
  return m;
}

export function buildWorkload(store: Store, now = Date.now()) {
  const byManager = new Map<string, Map<string, WorkloadCase[]>>();
  for (const record of Object.values(store.cases)) {
    if (!record.createdDate) continue;
    const manager = lastFirst(record.manager ?? "—");
    const owner = lastFirst(record.owner);
    const owners = byManager.get(manager) ?? new Map<string, WorkloadCase[]>();
    byManager.set(manager, owners);
    const list = owners.get(owner) ?? [];
    list.push(toWorkloadCase(record, now));
    owners.set(owner, list);
  }

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const teams: TeamGroup[] = [...byManager.entries()]
    .map(([manager, owners]) => {
      const rows = [...owners.entries()]
        .map(([owner, cases]) => ({
          owner,
          metrics: metricsFor(cases),
          aboveAverage: [] as MetricId[],
          cases: cases.sort((a, b) => b.daysOpen - a.daysOpen),
        }))
        .sort((a, b) => collator.compare(a.owner, b.owner));

      const total = emptyMetrics();
      for (const row of rows) for (const { id } of WORKLOAD_METRICS) total[id] += row.metrics[id];
      const average = emptyMetrics();
      for (const { id } of WORKLOAD_METRICS) average[id] = total[id] / rows.length;
      for (const row of rows) {
        row.aboveAverage = WORKLOAD_METRICS.map((m) => m.id).filter(
          (id) => rows.length > 1 && row.metrics[id] > average[id],
        );
      }
      return { manager, owners: rows, average, total };
    })
    .sort((a, b) => {
      const special = (m: string) => (m.startsWith("Queue") || m === "—" ? 1 : 0);
      return special(a.manager) - special(b.manager) || collator.compare(a.manager, b.manager);
    });

  const grandTotal = emptyMetrics();
  for (const team of teams) for (const { id } of WORKLOAD_METRICS) grandTotal[id] += team.total[id];

  return {
    updatedAt: store.casesSyncedAt ?? store.lastRun?.finishedAt ?? null,
    metrics: WORKLOAD_METRICS,
    teams,
    grandTotal,
    ownerCount: teams.reduce((n, t) => n + t.owners.length, 0),
  };
}
