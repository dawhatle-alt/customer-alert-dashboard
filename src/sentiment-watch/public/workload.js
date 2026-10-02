// Case workload tab. Uses $, esc and when from app.js.
(() => {
  let wl = null;
  const expanded = new Set();
  const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));

  function showTab(tab) {
    if (!$(`tab-${tab}`)) tab = "sentiment";
    for (const b of document.querySelectorAll("#tabs .tab")) b.classList.toggle("on", b.dataset.tab === tab);
    for (const page of document.querySelectorAll(".tab-page")) page.hidden = page.id !== `tab-${tab}`;
    document.querySelector(".search").style.visibility = tab === "sentiment" ? "visible" : "hidden";
    localStorage.setItem("tab", tab);
    if (tab === "workload") loadWorkload();
    document.dispatchEvent(new CustomEvent("tabchange", { detail: tab }));
  }

  async function loadWorkload() {
    try {
      const res = await fetch("/api/workload");
      if (!res.ok) throw new Error(res.statusText);
      wl = await res.json();
    } catch {
      $("wl-table").innerHTML = '<div class="empty">Cannot reach the dashboard server. Start it with <b>npm start</b>, then reload.</div>';
      return;
    }
    const select = $("wl-manager");
    const current = select.value || localStorage.getItem("wlManager") || "";
    const managers = wl.teams.map((t) => t.manager);
    select.innerHTML = '<option value="">All managers</option>' + managers.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    select.value = managers.includes(current) ? current : "";
    render();
  }

  function caseTable(owner) {
    return `<table class="wl-cases">
      <thead><tr><th>Case</th><th>Subject</th><th>Status</th><th>Account</th>
        <th class="num">Days open</th><th class="num">Days since customer contact</th><th>Routed to Eng</th></tr></thead>
      <tbody>${owner.cases.map((c) => `<tr>
        <td><a href="${esc(c.caseUrl)}" target="_blank" rel="noopener">${esc(c.caseNumber)}</a></td>
        <td>${esc(c.subject)}</td>
        <td>${esc(c.status)}</td>
        <td>${esc(c.account)}</td>
        <td class="num">${c.daysOpen}</td>
        <td class="num">${c.daysSinceContact ?? "—"}</td>
        <td>${c.routedToEng ? '<span class="yes">Yes</span>' : "No"}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function render() {
    if (!wl) return;
    const mgr = $("wl-manager").value;
    const q = $("wl-search").value.trim().toLowerCase();
    const highlight = $("wl-highlight").checked;
    const ids = wl.metrics.map((m) => m.id);
    const colCount = ids.length + 2;

    $("wl-updated").textContent = wl.updatedAt ? `Updated ${when(wl.updatedAt)}` : "Waiting for the first check";

    let shownOwners = 0;
    const body = [];
    for (const team of wl.teams) {
      if (mgr && team.manager !== mgr) continue;
      const owners = team.owners.filter((o) => !q || o.owner.toLowerCase().includes(q));
      if (!owners.length) continue;
      shownOwners += owners.length;

      owners.forEach((o, i) => {
        const key = `${team.manager}|${o.owner}`;
        const isOpen = expanded.has(key);
        body.push(`<tr class="owner${isOpen ? " open" : ""}" data-owner="${esc(key)}" title="Click to show ${esc(o.owner)}'s cases">
          <td class="mgr">${i === 0 ? esc(team.manager) : ""}</td>
          <td class="left"><span class="chev">›</span>${esc(o.owner)}</td>
          ${ids.map((id) => `<td class="${highlight && o.aboveAverage.includes(id) ? "hot" : ""}">${o.metrics[id] ? fmt(o.metrics[id]) : ""}</td>`).join("")}
        </tr>`);
        if (isOpen) body.push(`<tr class="detail"><td class="mgr"></td><td colspan="${colCount - 1}">${caseTable(o)}</td></tr>`);
      });
      if (team.owners.length > 1 && !q) {
        body.push(`<tr class="avg team-end"><td class="mgr"></td><td class="left">Team average</td>
          ${ids.map((id) => `<td>${fmt(Math.round(team.average[id] * 10) / 10)}</td>`).join("")}</tr>`);
      }
    }

    if (!mgr && !q && wl.teams.length) {
      body.push(`<tr class="grand"><td class="mgr">All teams</td><td class="left">${wl.ownerCount} owners</td>
        ${ids.map((id) => `<td>${fmt(wl.grandTotal[id])}</td>`).join("")}</tr>`);
    }

    $("wl-count").textContent = `${shownOwners} of ${wl.ownerCount} owners`;
    $("wl-table").innerHTML = body.length
      ? `<table class="wl"><thead><tr><th class="left">Manager</th><th class="left">Case Owner</th>
          ${wl.metrics.map((m) => `<th>${esc(m.label)}</th>`).join("")}</tr></thead><tbody>${body.join("")}</tbody></table>`
      : `<div class="empty">${wl.teams.length ? "No owners match the filter." : "Waiting for the first check to finish…"}</div>`;
  }

  $("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab[data-tab]");
    if (btn) showTab(btn.dataset.tab);
  });
  $("wl-manager").addEventListener("change", (e) => {
    localStorage.setItem("wlManager", e.target.value);
    render();
  });
  $("wl-search").addEventListener("input", render);
  $("wl-highlight").addEventListener("change", render);
  $("wl-table").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const row = e.target.closest("tr.owner[data-owner]");
    if (!row) return;
    const key = row.dataset.owner;
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    render();
  });

  setInterval(() => {
    if (!$("tab-workload").hidden) loadWorkload();
  }, 60_000);

  showTab(localStorage.getItem("tab") || "sentiment");
})();
