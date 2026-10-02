// Export of the Customer alert table, grouped by manager.
// Uses data, filters, applyFilters, sortRows, isToday, categoryLabel, esc, when and natural from app.js.
(() => {
  const APP_NAME = "Customer Alert Dashboard";
  const fileDate = () => new Date().toLocaleDateString("en-CA");
  const longDate = () => new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const csvDate = (iso) => (iso ? new Date(iso).toLocaleString("sv-SE").slice(0, 16) : "");
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, "-");
  const reasonText = (r) => (r.detail ? `${r.label} (${r.detail})` : r.label);

  function exportRows() {
    const rows = sortRows(applyFilters(data.flags));
    const groups = new Map();
    for (const f of rows) groups.set(f.manager, [...(groups.get(f.manager) ?? []), f]);
    return { rows, groups: [...groups.entries()].sort((a, b) => natural(a[0], b[0])) };
  }

  /** The active filters other than manager, which the export groups by instead. */
  function filterSummary() {
    const parts = [];
    if (filters.today) parts.push("Concerns raised today");
    if (filters.level) parts.push(filters.level === "high" ? "High only" : "Medium only");
    if (filters.concern) parts.push(`Concern: ${categoryLabel(filters.concern)}`);
    if (filters.tier) parts.push(`Tier Global: ${filters.tier}`);
    if (filters.q) parts.push(`Search: "${filters.q}"`);
    return parts.length ? parts.join(" · ") : "All flagged cases";
  }

  const scopeTitle = () => (filters.manager ? filters.manager : "All managers");

  // ---- Email-safe HTML (inline styles only, since Outlook ignores stylesheets) ----

  const S = {
    th: "padding:8px 10px;background:#f2f3f8;border-bottom:1px solid #d9dce8;text-align:left;font-size:12px;color:#5b6180;font-weight:600;",
    td: "padding:9px 10px;border-bottom:1px solid #e6e8f0;vertical-align:top;font-size:13px;color:#1f2540;",
    muted: "color:#6b7190;font-size:12px;",
    quote: "margin:6px 0 0;padding:6px 10px;border-left:3px solid #e5484d;background:#fbf6f7;color:#3b4263;font-size:12px;",
  };

  function levelPill(level) {
    const [bg, fg, label] = level === "high" ? ["#ffd6de", "#b42340", "High"] : ["#ffe9c4", "#8a5a00", "Medium"];
    return `<span style="background:${bg};color:${fg};padding:2px 10px;border-radius:10px;font-weight:600;font-size:12px;white-space:nowrap">${label}</span>`;
  }

  function flagRow(f) {
    const quote = f.evidence
      ? `<div style="${S.quote}">${esc(f.evidence.text.length > 400 ? `${f.evidence.text.slice(0, 400)}…` : f.evidence.text)}
           <div style="${S.muted};margin-top:4px">${f.evidence.strong ? "" : "Possible evidence · "}${esc(f.evidence.channel)} from ${esc(f.evidence.author)}, ${esc(when(f.evidence.date))}</div></div>`
      : "";
    const impact = f.businessImpact ? `<div style="${S.muted}">${esc(data.contextLabels.businessImpact)}</div>` : "";
    return `<tr>
      <td style="${S.td}">${levelPill(f.level)}</td>
      <td style="${S.td}"><a href="${esc(f.caseUrl)}" style="color:#3a56d4;font-weight:600;text-decoration:none">${esc(f.caseNumber)}</a>
        <div style="${S.muted}">${esc(f.subject)}</div><div style="${S.muted}">${esc(f.status)} · ${esc(f.priority)}</div></td>
      <td style="${S.td}">${esc(f.owner)}</td>
      <td style="${S.td}">${esc(f.account)}<div style="${S.muted}">${esc(f.tier)}</div></td>
      <td style="${S.td}"><b>${esc(f.reasons.map(reasonText).join(" · "))}</b>${impact}${quote}</td>
      <td style="${S.td};white-space:nowrap">${esc(when(f.latestConcernAt))}<div style="${S.muted}">Tone: ${esc(f.mood?.label ?? "—")}</div></td>
    </tr>`;
  }

  function reportBody(groups) {
    const sections = groups.map(([manager, flags]) => {
      const high = flags.filter((f) => f.level === "high").length;
      const raisedToday = flags.filter(isToday).length;
      return `<h2 style="font-size:16px;margin:26px 0 2px;color:#1f2540">${esc(manager)}</h2>
        <p style="margin:0 0 10px;${S.muted}">${flags.length} flagged case${flags.length === 1 ? "" : "s"}: ${high} High, ${flags.length - high} Medium · ${raisedToday} raised today</p>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid #e6e8f0">
          <tr><th style="${S.th}">Flag</th><th style="${S.th}">Case</th><th style="${S.th}">Owner</th><th style="${S.th}">Account</th>
              <th style="${S.th}">What caused the flag</th><th style="${S.th}">Concern raised</th></tr>
          ${flags.map(flagRow).join("")}
        </table>`;
    });
    const total = groups.reduce((n, [, flags]) => n + flags.length, 0);
    return `<div style="font-family:'Segoe UI',Arial,sans-serif;color:#1f2540;max-width:1100px">
      <div style="font-size:20px;font-weight:700;margin:0">${APP_NAME}: ${esc(scopeTitle())}</div>
      <div style="${S.muted};font-size:13px;margin-top:2px">${esc(longDate())} · ${esc(filterSummary())} · ${total} flagged case${total === 1 ? "" : "s"}</div>
      ${sections.join("")}
      <p style="margin:22px 0 0;${S.muted}">Data as of ${esc(when(data.lastRun?.finishedAt))}. Flags are AI-assisted (TypeSafe Jev) from open Control-M case emails and notes; open the case before acting.</p>
    </div>`;
  }

  function reportText(groups) {
    const lines = [`${APP_NAME}: ${scopeTitle()}`, `${longDate()} · ${filterSummary()}`, ""];
    for (const [manager, flags] of groups) {
      lines.push(`${manager} (${flags.length})`);
      for (const f of flags) {
        lines.push(`  ${f.level === "high" ? "HIGH  " : "MEDIUM"} ${f.caseNumber}  ${f.owner}  ${f.account}  ${f.reasons.map((r) => r.label).join(", ")}`);
        lines.push(`         ${f.caseUrl}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  // ---- CSV ----

  const CSV_COLUMNS = [
    ["Manager", (f) => f.manager],
    ["Flag", (f) => (f.level === "high" ? "High" : "Medium")],
    ["Case number", (f) => f.caseNumber],
    ["Case link", (f) => f.caseUrl],
    ["Subject", (f) => f.subject],
    ["Status", (f) => f.status],
    ["Priority", (f) => f.priority],
    ["Owner", (f) => f.owner],
    ["Account", (f) => f.account],
    ["Contact", (f) => f.contact],
    ["Tier Global", (f) => f.tier],
    ["What caused the flag", (f) => f.reasons.map(reasonText).join("; ")],
    ["Business impact", (f) => (f.businessImpact ? "Yes" : "")],
    ["Latest tone", (f) => (f.mood ? `${f.mood.label} (${f.mood.score.toFixed(1)}/4)` : "")],
    ["Concern raised", (f) => csvDate(f.latestConcernAt)],
    ["Last activity", (f) => csvDate(f.lastActivityAt)],
    ["Evidence from", (f) => (f.evidence ? `${f.evidence.channel} from ${f.evidence.author}, ${csvDate(f.evidence.date)}` : "")],
    ["Evidence", (f) => f.evidence?.text ?? ""],
  ];

  function csvCell(value) {
    let s = String(value ?? "");
    // Stop Excel from treating customer text as a formula.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function reportCsv(rows) {
    const sorted = [...rows].sort((a, b) => natural(a.manager, b.manager));
    const lines = [CSV_COLUMNS.map(([h]) => h), ...sorted.map((f) => CSV_COLUMNS.map(([, get]) => get(f)))];
    return "\uFEFF" + lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n");
  }

  // ---- Actions ----

  function toast(message) {
    const el = Object.assign(document.createElement("div"), { className: "toast", textContent: message });
    document.body.append(el);
    setTimeout(() => el.remove(), 3000);
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyRich(html, text) {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
      ]);
      return;
    }
    const holder = Object.assign(document.createElement("div"), { innerHTML: html, contentEditable: "true" });
    holder.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.execCommand("copy");
    getSelection().removeAllRanges();
    holder.remove();
  }

  async function runExport(kind) {
    const { rows, groups } = exportRows();
    if (!rows.length) return toast("No flagged cases match the current filters.");
    const base = `Customer alerts - ${safeName(scopeTitle())} - ${fileDate()}`;
    if (kind === "csv") {
      download(`${base}.csv`, reportCsv(rows), "text/csv;charset=utf-8");
    } else if (kind === "html") {
      const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(base)}</title></head><body style="margin:24px">${reportBody(groups)}</body></html>`;
      download(`${base}.html`, doc, "text/html;charset=utf-8");
    } else {
      try {
        await copyRich(reportBody(groups), reportText(groups));
        toast(`Copied ${rows.length} case${rows.length === 1 ? "" : "s"}. Paste into an Outlook message.`);
      } catch {
        toast("Could not copy to the clipboard. Use Download report instead.");
      }
    }
  }

  const menu = $("export-menu");
  $("export").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!data) return;
    if (menu.hidden) {
      const { rows, groups } = exportRows();
      $("export-scope").textContent =
        `${scopeTitle()} · ${rows.length} case${rows.length === 1 ? "" : "s"}` +
        (filters.manager ? "" : ` across ${groups.length} manager${groups.length === 1 ? "" : "s"}`) +
        ` · ${filterSummary()}`;
    }
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-export]");
    if (!btn) return;
    menu.hidden = true;
    runExport(btn.dataset.export);
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !e.target.closest(".export")) menu.hidden = true;
  });
})();
