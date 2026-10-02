const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString([], { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit" });
};
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
const PASTELS = ["#b8c4ff", "#c9b8f5", "#8fa6ff", "#a9e4d6", "#ffc4ad", "#f5b8d0", "#b8e0f5", "#d6c8ff", "#c4ecc0", "#ffe0a3"];
const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const hue = (name) => [...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const avatar = (name) => {
  const h = hue(name) % 360;
  return `<span class="avatar" style="background:linear-gradient(135deg,hsl(${h} 70% 72%),hsl(${(h + 40) % 360} 65% 60%))">${esc(initials(name))}</span>`;
};

const THEME_ORDER = ["system", "light", "dark"];
const THEME_ICONS = {
  system: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  light: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
let themePref = localStorage.getItem("theme") || "system";

function applyTheme() {
  const dark = themePref === "dark" || (themePref === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const label = themePref === "system" ? `System (${dark ? "dark" : "light"})` : themePref === "dark" ? "Dark" : "Light";
  $("theme").innerHTML = `${THEME_ICONS[themePref]}<span>${label}</span>`;
  $("theme").title = "Switch between system, light and dark mode";
}

$("theme").addEventListener("click", () => {
  themePref = THEME_ORDER[(THEME_ORDER.indexOf(themePref) + 1) % THEME_ORDER.length];
  localStorage.setItem("theme", themePref);
  applyTheme();
});
darkQuery.addEventListener("change", () => themePref === "system" && applyTheme());
applyTheme();

let data = null;
const filters = {
  level: "",
  concern: localStorage.getItem("concern") || "",
  tier: localStorage.getItem("tier") || "",
  manager: localStorage.getItem("manager") || "",
  today: localStorage.getItem("todayOnly") !== "false",
  q: "",
};

const isToday = (f) => f.latestConcernAt && new Date(f.latestConcernAt).toDateString() === new Date().toDateString();
const categoryLabel = (id) => data?.categories.find((c) => c.id === id)?.label ?? id;

/** Applies every active filter except `skip`, so each chart shows what clicking it would select. */
function applyFilters(flags, skip) {
  const q = filters.q.toLowerCase();
  return flags.filter((f) =>
    (skip === "level" || !filters.level || f.level === filters.level) &&
    (skip === "concern" || !filters.concern || f.categories.includes(filters.concern)) &&
    (skip === "tier" || !filters.tier || f.tier === filters.tier) &&
    (skip === "manager" || !filters.manager || f.manager === filters.manager) &&
    (skip === "today" || !filters.today || isToday(f)) &&
    (!q || [f.caseNumber, f.owner, f.manager, f.account, f.tier, f.contact].some((v) => String(v).toLowerCase().includes(q))));
}

function setFilter(key, value) {
  filters[key] = value;
  if (key === "today") localStorage.setItem("todayOnly", String(value));
  else if (key !== "q" && key !== "level") localStorage.setItem(key, value);
  render();
}
const toggleFilter = (key, value) => setFilter(key, filters[key] === value ? "" : value);

const byFlag = (a, b) => (a.level === b.level ? b.riskScore - a.riskScore : a.level === "high" ? -1 : 1);
const byText = (field) => (a, b) => natural(a[field], b[field]);
const COLUMNS = [
  { key: "flag", label: "Flag", compare: byFlag },
  { key: "case", label: "Case", compare: byText("caseNumber") },
  { key: "owner", label: "Owner", compare: byText("owner") },
  { key: "manager", label: "Manager", compare: byText("manager") },
  { key: "account", label: "Account", compare: byText("account") },
  { key: "tier", label: "Tier Global", compare: byText("tier") },
  { key: "cause", label: "What caused the flag" },
  { key: "tone", label: "Latest tone", compare: (a, b) => (b.mood?.score ?? -1) - (a.mood?.score ?? -1) },
  { key: "raised", label: "Concern raised", compare: (a, b) => String(b.latestConcernAt ?? "").localeCompare(String(a.latestConcernAt ?? "")) },
];
let sort = JSON.parse(localStorage.getItem("sort") || '{"key":"flag","dir":1}');

function sortRows(rows) {
  const col = COLUMNS.find((c) => c.key === sort.key && c.compare) ?? COLUMNS[0];
  return [...rows].sort((a, b) => sort.dir * col.compare(a, b) || byFlag(a, b));
}

function setSort(key) {
  sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: 1 };
  localStorage.setItem("sort", JSON.stringify(sort));
  render();
}

function fillSelect(id, allLabel, options, key) {
  const select = $(id);
  if (filters[key] && !options.some((o) => o.value === filters[key])) filters[key] = "";
  select.innerHTML = `<option value="">${esc(allLabel)}</option>` +
    options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
  select.value = filters[key];
}

function fillSelects() {
  const uniq = (field) => [...new Set(data.flags.map((f) => f[field]))].sort(natural).map((v) => ({ value: v, label: v }));
  fillSelect("concern", "All concerns", data.categories.map((c) => ({ value: c.id, label: c.label })), "concern");
  fillSelect("tier", "All tiers", uniq("tier"), "tier");
  fillSelect("manager", "All managers", uniq("manager"), "manager");
}

function showUnreachable() {
  $("banner").innerHTML = '<div class="glass banner">Cannot reach the dashboard server. Start it with <b>npm start</b> in the project folder, then reload this page.</div>';
  $("run").disabled = true;
}

async function load() {
  try {
    const res = await fetch("/api/dashboard");
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
  } catch {
    showUnreachable();
    return;
  }
  fillSelects();
  render();
}

function renderKpis() {
  const run = data.lastRun;
  const high = data.flags.filter((f) => f.level === "high").length;
  $("k-flagged").textContent = data.flags.length;
  $("k-flagged-sub").innerHTML = `<b class="hi">${high} High</b> · <b class="md">${data.flags.length - high} Medium</b>`;
  $("k-today").textContent = data.flags.filter(isToday).length;
  $("k-open").textContent = data.openCases;
  $("k-open-sub").textContent = `${data.evaluatedCases} active in last ${data.lookbackDays} days`;
  $("k-last").textContent = run ? clock(run.finishedAt || run.startedAt) : "never";
  $("k-next").textContent = data.running ? "Running now…" : `Next check ${clock(data.nextRunAt)}`;
}

const secs = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

function renderTiming() {
  const run = data.lastRun;
  const el = $("timing");
  el.classList.toggle("running", data.running);
  if (data.running) {
    el.innerHTML = '<span class="icon">⚡</span><div><div class="t-main">Checking…</div><div class="t-sub">Salesforce sync, then Jev</div></div>';
    el.title = "";
    return;
  }
  if (!run || run.jevMs === undefined) {
    el.innerHTML = '<span class="icon">⚡</span><div><div class="t-main">Jev time —</div><div class="t-sub">Shown after the next check</div></div>';
    el.title = "";
    return;
  }
  const cases = run.evaluated + run.failed;
  el.innerHTML = `<span class="icon">⚡</span><div>
      <div class="t-main">Jev ${secs(run.jevMs)}</div>
      <div class="t-sub">${cases.toLocaleString()} case${cases === 1 ? "" : "s"}${run.evaluated ? ` · avg ${secs(run.jevAvgRequestMs)} each` : ""}</div>
    </div>`;
  el.title = [
    `Jev processing: ${secs(run.jevMs)} for ${run.evaluated} case(s)` + (run.failed ? `, ${run.failed} failed` : ""),
    `Average per Jev request: ${secs(run.jevAvgRequestMs)}`,
    `Unchanged cases reused: ${run.reused}`,
    `Jev input tokens: ${run.inputTokens.toLocaleString()}`,
    `Salesforce sync: ${secs(run.syncMs)}`,
    `Finished: ${when(run.finishedAt)}`,
  ].join("\n");
}

function renderColumnBars(elId, key, entries, shortName) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  $(elId).innerHTML = entries.length
    ? entries.map(([name, n], i) => `<div class="bar${filters[key] === name ? " on" : ""}" data-key="${key}" data-value="${esc(name)}" title="${esc(name)}: ${n} flagged">
        <div class="col" style="height:${Math.max(10, Math.round((n / max) * 110))}px;background:linear-gradient(180deg,${PASTELS[i % PASTELS.length]},${PASTELS[i % PASTELS.length]}99)"><span>${n}</span></div>
        <div class="name">${esc(shortName(name))}</div></div>`).join("")
    : '<div class="meta" style="align-self:center">No flags for the current filters</div>';
}

function countBy(flags, field) {
  const counts = {};
  for (const f of flags) counts[f[field]] = (counts[f[field]] || 0) + 1;
  return counts;
}

function renderCharts() {
  const managers = Object.entries(countBy(applyFilters(data.flags, "manager"), "manager")).sort((a, b) => b[1] - a[1]).slice(0, 8);
  renderColumnBars("bars", "manager", managers, (n) => n.split(" ")[0]);

  const tiers = Object.entries(countBy(applyFilters(data.flags, "tier"), "tier")).sort((a, b) => natural(a[0], b[0]));
  renderColumnBars("tierBars", "tier", tiers, (n) => n.replace(/^Tier\s+/i, "T"));

  const pool = applyFilters(data.flags, "concern");
  const rows = data.categories.map((c) => {
    const hits = pool.filter((f) => f.categories.includes(c.id));
    return { ...c, total: hits.length, high: hits.filter((f) => f.level === "high").length };
  }).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...rows.map((r) => r.total));
  $("catBars").innerHTML = rows.map((r) => `<div class="hbar${filters.concern === r.id ? " on" : ""}${r.total ? "" : " zero"}" data-key="concern" data-value="${esc(r.id)}"
      title="${esc(r.label)}: ${r.total} flagged (${r.high} High, ${r.total - r.high} Medium)">
      <div class="name">${esc(r.label)}</div>
      <div class="track"><div class="seg-hi" style="width:${(r.high / max) * 100}%"></div><div class="seg-md" style="width:${((r.total - r.high) / max) * 100}%"></div></div>
      <div class="n">${r.total}${r.high ? ` · <span style="color:var(--high)">${r.high}</span>` : ""}</div>
    </div>`).join("");
}

function renderActive() {
  const tags = [];
  if (filters.level) tags.push(["level", filters.level === "high" ? "High only" : "Medium only"]);
  if (filters.concern) tags.push(["concern", `Concern: ${categoryLabel(filters.concern)}`]);
  if (filters.tier) tags.push(["tier", `Tier Global: ${filters.tier}`]);
  if (filters.manager) tags.push(["manager", `Manager: ${filters.manager}`]);
  if (filters.today) tags.push(["today", "Raised today"]);
  if (filters.q) tags.push(["q", `Search: “${filters.q}”`]);
  $("active").innerHTML = tags.length
    ? tags.map(([k, label]) => `<span class="tag">${esc(label)}<button data-clear="${k}" title="Remove filter">×</button></span>`).join("") +
      (tags.length > 1 ? '<button class="link-btn" data-clear="all">Clear all</button>' : "")
    : "";
}

function syncControls() {
  $("concern").value = filters.concern;
  $("tier").value = filters.tier;
  $("manager").value = filters.manager;
  $("today").checked = filters.today;
  $("search").value = filters.q;
  for (const b of document.querySelectorAll("#level button")) b.classList.toggle("on", b.dataset.level === filters.level);
}

function render() {
  const run = data.lastRun;
  $("run").disabled = data.running;
  $("banner").innerHTML = run?.error ? `<div class="glass banner">${esc(run.error)}</div>` : "";
  syncControls();
  renderTiming();
  renderKpis();
  renderCharts();
  renderActive();

  const rows = sortRows(applyFilters(data.flags));
  $("count").textContent = `${rows.length} of ${data.flags.length} flagged`;
  if (!rows.length) {
    const onlyToday = filters.today && !filters.level && !filters.concern && !filters.tier && !filters.manager && !filters.q;
    const msg = !run ? "Waiting for the first check to finish…"
      : !data.flags.length ? "No cases are currently flagged."
      : onlyToday ? "No new concerns raised today."
      : "No flags match the filters.";
    $("table").innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }

  $("table").innerHTML = `<table>
    <thead><tr>${COLUMNS.map((c) => c.compare
      ? `<th class="sortable col-${c.key}${sort.key === c.key ? " sorted" : ""}" data-sort="${c.key}">${esc(c.label)}${sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>`
      : `<th class="col-${c.key}">${esc(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((f) => `<tr>
      <td><span class="level ${f.level}">${f.level === "high" ? "High" : "Medium"}</span></td>
      <td><a href="${esc(f.caseUrl)}" target="_blank" rel="noopener">${esc(f.caseNumber)}</a>
          <div class="subject">${esc(f.subject)}</div>
          <div class="meta">${esc(f.status)} · ${esc(f.priority)}</div></td>
      <td><div class="person">${avatar(f.owner)}${esc(f.owner)}</div></td>
      <td><div class="person">${avatar(f.manager)}${esc(f.manager)}</div></td>
      <td>${esc(f.account)}<div class="meta">${esc(f.contact)}</div></td>
      <td><span class="tier" data-key="tier" data-value="${esc(f.tier)}" title="Filter to ${esc(f.tier)}">${esc(f.tier)}</span></td>
      <td class="col-cause">
        <div class="chips">${f.reasons.map((r) => `<span class="chip${filters.concern === r.id ? " on" : ""}" data-cat="${esc(r.id)}" title="Show only this concern">${esc(r.label)} <i>${esc(r.detail)}</i></span>`).join("")}
          ${f.businessImpact ? `<span class="chip ctx${filters.concern === "businessImpact" ? " on" : ""}" data-cat="businessImpact">${esc(data.contextLabels.businessImpact)}</span>` : ""}</div>
        ${f.evidence ? `<div class="meta">${f.evidence.strong ? "" : "Possible evidence · "}${esc(f.evidence.channel)} from ${esc(f.evidence.author)}, ${when(f.evidence.date)}</div>
          <blockquote>${esc(f.evidence.text)}</blockquote>` : ""}
      </td>
      <td>${f.mood ? `${esc(f.mood.label)} <div class="meta">${f.mood.score.toFixed(1)} / 4</div>` : '<span class="meta">No customer messages</span>'}</td>
      <td class="col-raised">${when(f.latestConcernAt)}<div class="meta">Last activity ${when(f.lastActivityAt)}</div><div class="meta">Checked ${when(f.evaluatedAt)}</div></td>
    </tr>`).join("")}</tbody></table>`;
}

$("search").addEventListener("input", (e) => data && setFilter("q", e.target.value.trim()));
$("level").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-level]");
  if (btn && data) setFilter("level", btn.dataset.level);
});
for (const key of ["concern", "tier", "manager"]) $(key).addEventListener("change", (e) => data && setFilter(key, e.target.value));
$("today").addEventListener("change", (e) => data && setFilter("today", e.target.checked));

document.addEventListener("click", (e) => {
  if (!data) return;
  const target = e.target.closest("[data-key][data-value]");
  if (target) return toggleFilter(target.dataset.key, target.dataset.value);
  const chip = e.target.closest(".chip[data-cat]");
  if (chip) return toggleFilter("concern", chip.dataset.cat);
  const th = e.target.closest("th[data-sort]");
  if (th) return setSort(th.dataset.sort);
  const clear = e.target.closest("[data-clear]");
  if (clear) {
    const keys = clear.dataset.clear === "all" ? ["level", "concern", "tier", "manager", "today", "q"] : [clear.dataset.clear];
    for (const k of keys) setFilter(k, k === "today" ? false : "");
  }
});

$("run").addEventListener("click", async () => {
  $("run").disabled = true;
  try {
    await fetch("/api/run", { method: "POST" });
  } catch {
    showUnreachable();
    return;
  }
  load();
});

load();
setInterval(load, 30_000);
