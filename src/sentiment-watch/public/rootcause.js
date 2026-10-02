// Root cause accuracy tab. Uses $, esc, when, natural and avatar from app.js.
(() => {
  let rc = null;
  const expanded = new Set();
  const verdictFilter = {};
  let sort = JSON.parse(localStorage.getItem("rcSort") || '{"key":"rank","dir":1}');

  const VERDICTS = {
    wrong: "Likely miscoded",
    questionable: "Review",
    accurate: "Matches guide",
    insufficient: "Too little info",
    outOfScope: "Not covered by guide",
    pending: "Not reviewed yet",
  };
  const COLUMNS = [
    { key: "rank", label: "Rank" },
    { key: "owner", label: "TSA", left: true },
    { key: "manager", label: "Manager", left: true },
    { key: "closed", label: "Closed" },
    { key: "reviewed", label: "Reviewed" },
    { key: "rc1Accuracy", label: "RC1 match" },
    { key: "rc2Accuracy", label: "RC2 match" },
    { key: "avgScore", label: "Avg score" },
    { key: "accurate", label: "Matches guide" },
    { key: "questionable", label: "Review" },
    { key: "wrong", label: "Likely miscoded" },
    { key: "ruleIssues", label: "Rule issues" },
    { key: "notAssessed", label: "Not assessed" },
  ];

  const tone = (v) => (v == null ? "" : v >= 80 ? "good" : v >= 60 ? "warn" : "bad");
  const pill = (v, suffix = "") => (v == null ? '<span class="meta">—</span>' : `<span class="pct ${tone(v)}">${Math.round(v)}${suffix}</span>`);
  const num = (v) => (v ? v.toLocaleString() : '<span class="meta">0</span>');
  const date = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  const secs = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

  async function load() {
    try {
      const res = await fetch("/api/rootcause");
      if (!res.ok) throw new Error(res.statusText);
      rc = await res.json();
    } catch {
      $("rc-table").innerHTML = '<div class="empty">Cannot reach the dashboard server. Start it with <b>npm start</b>, then reload.</div>';
      return;
    }
    const select = $("rc-manager");
    const current = select.value || localStorage.getItem("rcManager") || "";
    const managers = [...new Set(rc.tsas.map((t) => t.manager))].sort(natural);
    select.innerHTML = '<option value="">All managers</option>' + managers.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    select.value = managers.includes(current) ? current : "";
    $("rc-min").value = localStorage.getItem("rcMin") || "5";
    render();
  }

  function renderStatus() {
    const run = rc.lastRun;
    if (rc.running && run) {
      const done = run.processed ?? 0;
      const total = run.toReview || 0;
      const width = total ? Math.round((done / total) * 100) : 0;
      $("rc-updated").innerHTML = total
        ? `Jev is reviewing closed cases… ${done.toLocaleString()} of ${total.toLocaleString()}<div class="progress"><span style="width:${width}%"></span></div>`
        : "Fetching closed cases from Salesforce…";
      return;
    }
    if (!run) {
      $("rc-updated").textContent = "Waiting for the first root cause check";
      return;
    }
    const parts = [`Updated ${when(run.finishedAt || run.startedAt)}`];
    if (run.evaluated) parts.push(`${run.evaluated.toLocaleString()} reviewed by Jev (avg ${secs(run.jevAvgRequestMs)} each)`);
    if (run.reused) parts.push(`${run.reused.toLocaleString()} unchanged`);
    if (run.failed) parts.push(`<span style="color:var(--high)">${run.failed} failed</span>`);
    $("rc-updated").innerHTML = parts.join(" · ");
    $("rc-updated").title = run.error ?? "";
  }

  function renderKpis() {
    const t = rc.totals;
    $("rc-k-closed").textContent = t.closed.toLocaleString();
    $("rc-k-closed-sub").textContent =
      `${t.reviewed.toLocaleString()} assessed · ${t.outOfScope.toLocaleString()} mainframe · last ${rc.windowDays} days` +
      (t.pending ? ` · ${t.pending.toLocaleString()} pending` : "");
    $("rc-k-rc1").textContent = t.rc1Accuracy == null ? "—" : `${t.rc1Accuracy}%`;
    $("rc-k-rc2").textContent = t.rc2Accuracy == null ? "—" : `${t.rc2Accuracy}%`;
    $("rc-k-score").textContent = t.avgScore ?? "—";
    $("rc-k-wrong").textContent = t.wrong.toLocaleString();
    $("rc-k-wrong-sub").textContent = `${t.questionable.toLocaleString()} to review · ${t.ruleIssues.toLocaleString()} rule issues`;
  }

  function renderCharts() {
    const max = Math.max(1, ...rc.byRc1.map((r) => r.total));
    $("rc-cat").innerHTML = rc.byRc1.map((r) => {
      const share = r.total ? Math.round((r.matched / r.total) * 100) : null;
      return `<div class="hbar rc-change${r.total ? "" : " zero"}" title="${esc(r.label)}: ${r.matched} of ${r.total} match the guide">
        <div class="name">${esc(r.label)}</div>
        <div class="track"><div class="seg-ok" style="width:${(r.matched / max) * 100}%"></div><div class="seg-hi" style="width:${((r.total - r.matched) / max) * 100}%"></div></div>
        <div class="n">${share == null ? "—" : `${share}%`} <span class="meta">of ${r.total}</span></div>
      </div>`;
    }).join("");

    const cmax = Math.max(1, ...rc.topChanges.map((c) => c.n));
    $("rc-changes").innerHTML = rc.topChanges.length
      ? rc.topChanges.map((c) => `<div class="hbar rc-change" title="${esc(c.label)}: ${c.n} cases">
          <div class="name">${esc(c.label)}</div>
          <div class="track"><div class="seg-md" style="width:${(c.n / cmax) * 100}%"></div></div>
          <div class="n">${c.n}</div></div>`).join("")
      : '<div class="meta" style="padding:12px 4px">No disagreements yet</div>';
  }

  function ranked(rows) {
    const min = Number($("rc-min").value) || 1;
    const eligible = rows
      .filter((r) => r.reviewed >= min && r.avgScore != null)
      .sort((a, b) => b.avgScore - a.avgScore || (b.rc1Accuracy ?? 0) - (a.rc1Accuracy ?? 0) || b.reviewed - a.reviewed);
    const rank = new Map(eligible.map((r, i) => [r.ownerId, i + 1]));
    return rows.map((r) => ({ ...r, rank: rank.get(r.ownerId) ?? null, notAssessed: r.insufficient + r.outOfScope }));
  }

  function sortRows(rows) {
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x == null && y == null) return natural(a.owner, b.owner);
      if (x == null) return 1;
      if (y == null) return -1;
      const cmp = typeof x === "string" ? natural(x, y) : x - y;
      return cmp * dir || natural(a.owner, b.owner);
    });
  }

  function recordedCell(c) {
    return `<div class="rc-path"><b>${esc(c.recorded.rc1 ?? "Blank")}</b><span class="rc2">${esc(c.recorded.rc2 ?? "—")}</span></div>`;
  }

  function suggestedCell(c) {
    if (!c.suggested) return '<span class="meta">—</span>';
    const differs = c.rc1Match === false;
    return `<div class="rc-path${differs ? " diff" : ""}" title="Jev's RC1 probability ${Math.round(c.suggested.rc1Probability * 100)}%">
      <b>${esc(c.suggested.rc1)}</b><span class="rc2">${esc(c.suggested.rc2 ?? "—")}</span></div>`;
  }

  function caseTable(row) {
    const active = verdictFilter[row.ownerId] ?? "";
    const counts = {};
    for (const c of row.cases) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
    const buttons = [["", `All ${row.cases.length}`], ...Object.entries(VERDICTS).filter(([v]) => counts[v]).map(([v, label]) => [v, `${label} ${counts[v]}`])];
    const cases = active ? row.cases.filter((c) => c.verdict === active) : row.cases;
    return `<div class="rc-filter">${buttons.map(([v, label]) => `<button data-rcverdict="${v}" data-rcowner="${esc(row.ownerId)}" class="${active === v ? "on" : ""}">${esc(label)}</button>`).join("")}</div>
      <table class="rc-cases">
      <thead><tr><th>Case</th><th>Closed</th><th>Subject</th><th>Disposition</th><th>Recorded RC1 › RC2</th><th>Jev's pick from the guide</th><th class="num">Score</th><th>Verdict</th></tr></thead>
      <tbody>${cases.map((c) => `<tr>
        <td><a href="${esc(c.caseUrl)}" target="_blank" rel="noopener">${esc(c.caseNumber)}</a><div class="meta">${esc(c.product)}</div></td>
        <td>${date(c.closedDate)}</td>
        <td>${esc(c.subject)}<div class="meta">${esc(c.account)}</div></td>
        <td>${esc(c.disposition || "—")}</td>
        <td>${recordedCell(c)}</td>
        <td>${suggestedCell(c)}</td>
        <td class="num">${pill(c.score)}</td>
        <td><span class="verdict ${c.verdict}">${VERDICTS[c.verdict]}</span>
          ${c.findings.map((f) => `<span class="finding ${f.kind}">${esc(f.text)}</span>`).join("")}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function render() {
    if (!rc) return;
    renderStatus();
    renderKpis();
    renderCharts();

    const mgr = $("rc-manager").value;
    const q = $("rc-search").value.trim().toLowerCase();
    const team = ranked(rc.tsas.filter((t) => !mgr || t.manager === mgr));
    const rows = sortRows(team.filter((t) => !q || t.owner.toLowerCase().includes(q)));
    $("rc-count").textContent = `${rows.length} of ${rc.tsas.length} TSAs`;

    const head = COLUMNS.map((c) => {
      const on = sort.key === c.key;
      return `<th data-rcsort="${c.key}" class="${c.left ? "left" : ""}${on ? " sorted" : ""}">${esc(c.label)}${on ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>`;
    }).join("");
    const body = rows.map((t) => {
      const isOpen = expanded.has(t.ownerId);
      const line = `<tr class="tsa${isOpen ? " open" : ""}" data-rcowner="${esc(t.ownerId)}" title="Click to show ${esc(t.owner)}'s cases">
        <td>${t.rank ? `<span class="rank${t.rank <= 3 ? " top" : ""}">${t.rank}</span>` : '<span class="meta" title="Too few reviewed cases to rank">—</span>'}</td>
        <td class="left"><div class="person"><span class="chev">›</span>${avatar(t.owner)}${esc(t.owner)}</div></td>
        <td class="left">${esc(t.manager)}</td>
        <td>${num(t.closed)}</td>
        <td>${num(t.reviewed)}${t.pending ? `<div class="meta">${t.pending} pending</div>` : ""}</td>
        <td>${pill(t.rc1Accuracy, "%")}</td>
        <td>${pill(t.rc2Accuracy, "%")}</td>
        <td>${pill(t.avgScore)}</td>
        <td>${num(t.accurate)}</td>
        <td>${num(t.questionable)}</td>
        <td>${t.wrong ? `<b style="color:var(--high)">${t.wrong}</b>` : num(0)}</td>
        <td>${t.ruleIssues ? `<b style="color:var(--high)">${t.ruleIssues}</b>` : num(0)}</td>
        <td title="${t.outOfScope} mainframe (not covered by the guide) · ${t.insufficient} too little info">${num(t.notAssessed)}</td>
      </tr>`;
      return isOpen ? `${line}<tr class="detail"><td colspan="${COLUMNS.length}">${caseTable(t)}</td></tr>` : line;
    }).join("");

    $("rc-table").innerHTML = rows.length
      ? `<table class="rc"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
      : `<div class="empty">${rc.tsas.length ? "No TSAs match the filter." : "Waiting for the first root cause check to finish…"}</div>`;
  }

  $("rc-manager").addEventListener("change", (e) => {
    localStorage.setItem("rcManager", e.target.value);
    render();
  });
  $("rc-min").addEventListener("change", (e) => {
    localStorage.setItem("rcMin", e.target.value);
    render();
  });
  $("rc-search").addEventListener("input", render);
  $("rc-table").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const th = e.target.closest("th[data-rcsort]");
    if (th) {
      const key = th.dataset.rcsort;
      const textual = key === "owner" || key === "manager" || key === "rank";
      sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: textual ? 1 : -1 };
      localStorage.setItem("rcSort", JSON.stringify(sort));
      return render();
    }
    const filter = e.target.closest("button[data-rcverdict]");
    if (filter) {
      verdictFilter[filter.dataset.rcowner] = filter.dataset.rcverdict;
      return render();
    }
    const row = e.target.closest("tr.tsa[data-rcowner]");
    if (!row) return;
    const id = row.dataset.rcowner;
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
  });

  document.addEventListener("tabchange", (e) => {
    if (e.detail === "rootcause") load();
  });
  if (!$("tab-rootcause").hidden) load();
  setInterval(() => {
    if (!$("tab-rootcause").hidden) load();
  }, 60_000);
})();
