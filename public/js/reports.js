// Tages- und Wochenbericht aus den Aufgabendaten, als Vorschau, Markdown und KI-Prompt
// ("verbessern" = professionell ausformulieren, "auswerten" = Risiken / Empfehlungen).
// Grundlage sind die Zeitstempel createdAt, statusChangedAt, doneAt, blockedSince (siehe setTaskStatus).
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

let reportType = 'daily';
let lastReport = null;
let reportRenderSeq = 0;

// Feldnamen für das Änderungsprotokoll (vom Server in daten/<Projekt>/history.jsonl geschrieben)
const HISTORY_FIELD_LABELS = {
  title: 'Titel', status: 'Status', progress: 'Fortschritt', startDate: 'Start', endDate: 'Ende',
  group: 'Gruppe', phase: 'Phase', priority: 'Priorität', owner: 'Verantwortlich', dependsOn: 'Vorgänger',
  nextAction: 'Nächster Schritt', notes: 'Notizen', blockReason: 'Blockiergrund', waitingFor: 'Wartet auf',
  milestone: 'Meilenstein', quick: 'Eingang'
};

const AUDIENCES = {
  team: 'das interne Projektteam (Technik, direkt und kompakt)',
  pl: 'die Projektleitung (Stand, Termine, Risiken, Entscheidungsbedarf)',
  kunde: 'den Kunden (verständlich, neutral, ohne interne Notizen, Kürzel und Schuldzuweisungen)'
};

// -------------------------------------------------------------
// DATUMSHILFEN (lokale Zeit)
// -------------------------------------------------------------
function dayKey(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(key, days) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

function nextWorkday(key) {
  let k = shiftDay(key, 1);
  while ([0, 6].includes(new Date(`${k}T12:00:00`).getDay())) k = shiftDay(k, 1);
  return k;
}

function weekStart(key) {
  const day = new Date(`${key}T12:00:00`).getDay() || 7;
  return shiftDay(key, 1 - day);
}

function inRange(value, from, to) {
  const k = dayKey(value);
  return !!k && k >= from && k <= to;
}

function weekdayLabel(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// -------------------------------------------------------------
// BERICHT AUFBAUEN (gemeinsame Struktur für Vorschau und Markdown)
// -------------------------------------------------------------
function reportLine(t, extra = []) {
  const late = t.status === 'Erledigt' && t.originalEndDate && t.doneAt ? dayKey(t.doneAt) > t.originalEndDate : false;
  if (late) extra = [...extra, `verspätet (geplant ${formatDate(t.originalEndDate)})`];
  const meta = [
    t.group || '',
    t.status,
    t.status !== 'Erledigt' && t.progress ? `${t.progress} %` : '',
    t.endDate ? `Ende ${formatDate(t.endDate)}` : '',
    t.owner ? `👤 ${t.owner}` : '',
    ...extra
  ].filter(Boolean);
  const notes = [];
  if (t.nextAction && !isClosed(t)) notes.push(`Nächster Schritt: ${t.nextAction}`);
  return { title: t.title, meta, notes };
}

function blockedLine(t, today) {
  const since = t.blockedSince ? dayKey(t.blockedSince) : '';
  const days = since ? Math.round((new Date(`${today}T12:00:00`) - new Date(`${since}T12:00:00`)) / 86400000) : null;
  const line = reportLine(t, since ? [`blockiert seit ${formatDate(since)}${days > 0 ? ` (${days} Tage)` : ''}`] : []);
  if (t.blockReason) line.notes.unshift(`Grund: ${t.blockReason}`);
  if (t.waitingFor) line.notes.unshift(`Wartet auf: ${t.waitingFor}`);
  return line;
}

// überfällig: Tage über dem ursprünglichen Termin, ggf. mit automatischer Verlängerung
function overdueLine(t, refKey) {
  const extra = [`${getDaysOverOriginal(t, refKey)} Tage über Termin`];
  if (t.originalEndDate) extra.push(`ursprünglich Ende ${formatDate(t.originalEndDate)}, ${t.extendedCount || 1}× verlängert`);
  return reportLine(t, extra);
}

function openDependencyLines(list) {
  const lines = [];
  list.forEach(t => getPredecessors(t).forEach(p => {
    const state = getDependencyState(p, t);
    if (state === 'done') return;
    lines.push({
      title: `${p.title}  →  ${t.title}`,
      meta: [state === 'conflict' ? '⚠ Konflikt: Nachfolger beginnt vor Ende des Vorgängers' : 'wartet', `Vorgänger ${p.status}, Ende ${formatDate(p.endDate)}`, `Nachfolger Start ${formatDate(t.startDate)}`],
      notes: []
    });
  }));
  return lines;
}

function describeHistoryChange(c) {
  const label = HISTORY_FIELD_LABELS[c.field] || c.field;
  const fmt = v => {
    if (v === null || v === undefined || v === '') return '–';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
    return String(v);
  };
  if (c.field === 'progress') return `${label} ${fmt(c.from)} → ${fmt(c.to)} %`;
  if (['status', 'startDate', 'endDate', 'group', 'phase', 'priority', 'owner'].includes(c.field)) return `${label}: ${fmt(c.from)} → ${fmt(c.to)}`;
  if (c.field === 'dependsOn') return `${label} geändert`;
  if (c.field === 'quick') return c.to ? 'in den Eingang' : 'zugeordnet';
  if (c.field === 'milestone') return c.to ? 'als Meilenstein markiert' : 'kein Meilenstein mehr';
  if (HISTORY_FIELD_LABELS[c.field]) return `${label} überarbeitet`;
  return null; // unbekannte Felder (z. B. Importfelder) nicht aufführen
}

// Änderungen je Aufgabe zusammenfassen: Uhrzeit(en) + was sich geändert hat
function historySection(entries, type) {
  const byTask = new Map();
  entries.forEach(e => {
    if (!byTask.has(e.taskId)) byTask.set(e.taskId, { title: e.title, entries: [] });
    const item = byTask.get(e.taskId);
    item.title = e.title || item.title;
    item.entries.push(e);
  });
  const items = [...byTask.values()].map(({ title, entries: list }) => {
    const times = list.map(e => new Date(e.ts));
    const when = type === 'daily'
      ? times.map(d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })).filter((v, i, a) => a.indexOf(v) === i).join(', ')
      : [...new Set(times.map(d => d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })))].join(', ');
    const actions = [];
    list.forEach(e => {
      if (e.action === 'erstellt') actions.push('angelegt');
      else if (e.action === 'importiert') actions.push('importiert');
      else if (e.action === 'gelöscht') actions.push('gelöscht');
      else e.changes.forEach(c => { const d = describeHistoryChange(c); if (d) actions.push(d); });
    });
    // gleiche Felder mehrfach geändert -> nur erste/letzte Fassung nennen
    const unique = [...new Set(actions)];
    return { title, meta: [when, `${list.length} Speicherung${list.length === 1 ? '' : 'en'}`], notes: unique.length ? [unique.join(' · ')] : [] };
  });
  return { title: 'Änderungsprotokoll', icon: 'clock', tone: 'slate', items };
}

function byGroupThenEnd(a, b) {
  return (a.group || '~').localeCompare(b.group || '~') || (a.endDate || '').localeCompare(b.endDate || '');
}

function buildReport(type, refKey, list, history) {
  const open = list.filter(t => !isClosed(t)).sort(byGroupThenEnd);
  const sections = [];
  let from;
  let to;
  let title;
  let range;

  if (type === 'daily') {
    from = to = refKey;
    const nextKey = nextWorkday(refKey);
    title = 'Tagesbericht';
    range = weekdayLabel(refKey);

    const done = list.filter(t => t.status === 'Erledigt' && inRange(t.doneAt, from, to));
    const changed = list.filter(t => inRange(t.statusChangedAt, from, to) && !done.includes(t) && t.prevStatus);
    const created = list.filter(t => inRange(t.createdAt, from, to));
    const active = open.filter(t => ['In Arbeit', 'Im Testen'].includes(t.status));
    const blocked = open.filter(t => t.status === 'Blockiert');
    const overdue = open.filter(t => getDaysOverOriginal(t, refKey) > 0 && t.status !== 'Blockiert');
    const dueSoon = open.filter(t => t.endDate && t.endDate >= refKey && t.endDate <= nextKey);

    sections.push(
      { title: 'Heute erledigt', icon: 'circle-check', tone: 'emerald', items: done.map(t => reportLine(t)) },
      { title: 'Statusänderungen', icon: 'arrow-right', tone: 'indigo', items: changed.map(t => reportLine(t, [`${t.prevStatus} → ${t.status}`])) },
      { title: 'Neu erfasst', icon: 'plus', tone: 'slate', items: created.map(t => reportLine(t, isInboxTask(t) ? ['Eingang, noch nicht zugeordnet'] : [])) },
      { title: 'In Arbeit / im Test', icon: 'loader-circle', tone: 'blue', items: active.map(t => reportLine(t)) },
      { title: 'Blockiert', icon: 'ban', tone: 'rose', items: blocked.map(t => blockedLine(t, refKey)) },
      { title: 'Überfällig / verlängert', icon: 'triangle-alert', tone: 'rose', items: overdue.map(t => overdueLine(t, refKey)) },
      { title: `Fällig bis ${formatDate(nextKey)}`, icon: 'clock', tone: 'amber', items: dueSoon.map(t => reportLine(t)) },
      { title: 'Offene Abhängigkeiten', icon: 'link', tone: 'violet', items: openDependencyLines(open) }
    );
    if (history) sections.splice(2, 0, historySection(history, 'daily'));

    return {
      type, title, range, from, to,
      kpis: [
        { label: 'Erledigt', value: done.length },
        { label: 'Neu', value: created.length },
        { label: 'In Arbeit / Test', value: active.length },
        { label: 'Blockiert', value: blocked.length },
        { label: 'Überfällig', value: overdue.length }
      ],
      sections
    };
  }

  // Wochenbericht (Montag bis Sonntag)
  from = weekStart(refKey);
  to = shiftDay(from, 6);
  const nextFrom = shiftDay(from, 7);
  const nextTo = shiftDay(from, 13);
  title = 'Wochenbericht';
  range = `KW ${getWeekNumber(new Date(`${from}T12:00:00`))} · ${formatDate(from)} – ${formatDate(to)}`;

  const done = list.filter(t => t.status === 'Erledigt' && inRange(t.doneAt, from, to));
  const created = list.filter(t => inRange(t.createdAt, from, to));
  const active = open.filter(t => ['In Arbeit', 'Im Testen'].includes(t.status));
  const blocked = open.filter(t => t.status === 'Blockiert');
  const overdueCut = to < dayKey(new Date()) ? to : dayKey(new Date()); // Stichtag: Wochenende oder heute
  const overdue = open.filter(t => getDaysOverOriginal(t, overdueCut) > 0 && t.status !== 'Blockiert');
  const milestones = list.filter(t => t.milestone && t.endDate >= from && t.endDate <= nextTo).sort((a, b) => a.endDate.localeCompare(b.endDate));
  const outlook = open.filter(t => (t.startDate >= nextFrom && t.startDate <= nextTo) || (t.endDate >= nextFrom && t.endDate <= nextTo));
  const inbox = list.filter(isInboxTask);
  const conflicts = list.reduce((n, t) => n + getPredecessors(t).filter(p => getDependencyState(p, t) === 'conflict').length, 0);

  const relevant = list.filter(t => t.status !== 'Abgebrochen');
  const avg = relevant.length ? Math.round(relevant.reduce((s, t) => s + (t.progress || 0), 0) / relevant.length) : 0;

  const groupLines = buildGroups(list, 'group').map(g => {
    const gDone = g.tasks.filter(t => t.status === 'Erledigt').length;
    const gWeek = g.tasks.filter(t => done.includes(t)).length;
    const gOpen = g.tasks.filter(t => !isClosed(t)).length;
    const gRel = g.tasks.filter(t => t.status !== 'Abgebrochen');
    const pct = gRel.length ? Math.round(gRel.reduce((s, t) => s + (t.progress || 0), 0) / gRel.length) : 0;
    return { title: g.key, meta: [`${pct} % Fortschritt`, `${gDone}/${g.tasks.length} erledigt`, gWeek ? `${gWeek} diese Woche` : '', gOpen ? `${gOpen} offen` : ''].filter(Boolean), notes: [] };
  });

  sections.push(
    { title: 'Stand je Gruppe', icon: 'layers', tone: 'slate', items: groupLines },
    { title: 'Diese Woche erledigt', icon: 'circle-check', tone: 'emerald', items: done.sort(byGroupThenEnd).map(t => reportLine(t, [`erledigt ${formatDate(dayKey(t.doneAt))}`])) },
    { title: 'In Arbeit / im Test', icon: 'loader-circle', tone: 'blue', items: active.map(t => reportLine(t)) },
    { title: 'Blockiert', icon: 'ban', tone: 'rose', items: blocked.map(t => blockedLine(t, to)) },
    { title: 'Überfällig / verlängert', icon: 'triangle-alert', tone: 'rose', items: overdue.map(t => overdueLine(t, overdueCut)) },
    { title: 'Meilensteine (diese + nächste Woche)', icon: 'chevrons-up', tone: 'amber', items: milestones.map(t => reportLine(t)) },
    { title: `Ausblick KW ${getWeekNumber(new Date(`${nextFrom}T12:00:00`))}`, icon: 'calendar-range', tone: 'indigo', items: outlook.sort(byGroupThenEnd).map(t => reportLine(t, [t.startDate >= nextFrom ? `Start ${formatDate(t.startDate)}` : ''])) },
    { title: 'Offene Abhängigkeiten', icon: 'link', tone: 'violet', items: openDependencyLines(open) },
    { title: 'Eingang (noch nicht zugeordnet)', icon: 'inbox', tone: 'amber', items: inbox.map(t => reportLine(t)) }
  );
  if (history) sections.push(historySection(history, 'weekly'));

  return {
    type, title, range, from, to,
    kpis: [
      { label: 'Erledigt (Woche)', value: done.length },
      { label: 'Neu (Woche)', value: created.length },
      { label: 'Offen gesamt', value: open.length },
      { label: 'Blockiert', value: blocked.length },
      { label: 'Ø Fortschritt', value: `${avg} %` },
      { label: 'Konflikte', value: conflicts }
    ],
    sections
  };
}

// -------------------------------------------------------------
// AUSGABE: Markdown
// -------------------------------------------------------------
function reportToMarkdown(r) {
  const out = [];
  out.push(`# ${r.title} – ${currentWorkspace.projectName}`);
  out.push(`**${r.range}** · erstellt ${new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`);
  out.push('');
  out.push(r.kpis.map(k => `${k.label}: **${k.value}**`).join(' · '));
  r.sections.forEach(sec => {
    out.push('');
    out.push(`## ${sec.title}${sec.items.length ? ` (${sec.items.length})` : ''}`);
    if (!sec.items.length) {
      out.push('- keine');
      return;
    }
    sec.items.forEach(it => {
      out.push(`- **${it.title}**${it.meta.length ? ` – ${it.meta.join(', ')}` : ''}`);
      it.notes.forEach(n => out.push(`  - ${n}`));
    });
  });
  return out.join('\n');
}

// -------------------------------------------------------------
// AUSGABE: Vorschau
// -------------------------------------------------------------
const REPORT_TONES = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  blue: 'text-blue-600 dark:text-blue-400',
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  violet: 'text-violet-600 dark:text-violet-400',
  slate: 'text-slate-500 dark:text-slate-400'
};

function reportToHTML(r) {
  const kpis = `
    <div class="grid grid-cols-2 sm:grid-cols-3 ${r.kpis.length > 5 ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-2">
      ${r.kpis.map(k => `
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">${escapeHTML(k.label)}</div>
          <div class="text-lg font-bold text-slate-900 dark:text-slate-100">${escapeHTML(String(k.value))}</div>
        </div>`).join('')}
    </div>`;
  const sections = r.sections.map(sec => `
    <section class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <h4 class="px-3.5 py-2 text-xs font-semibold uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 ${REPORT_TONES[sec.tone]}">
        ${icon(sec.icon)} ${escapeHTML(sec.title)}
        <span class="ml-auto text-[10px] px-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">${sec.items.length}</span>
      </h4>
      ${sec.items.length ? `<ul class="divide-y divide-slate-100 dark:divide-slate-800/70">${sec.items.map(it => `
        <li class="px-3.5 py-2">
          <div class="font-medium text-slate-900 dark:text-slate-100">${escapeHTML(it.title)}</div>
          ${it.meta.length ? `<div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">${it.meta.map(escapeHTML).join(' · ')}</div>` : ''}
          ${it.notes.map(n => `<div class="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 flex gap-1.5">${icon('move-right', 'mt-0.5 text-slate-400')}<span>${escapeHTML(n)}</span></div>`).join('')}
        </li>`).join('')}</ul>` : '<div class="px-3.5 py-2 text-[11px] text-slate-400 dark:text-slate-500">keine</div>'}
    </section>`).join('');
  return kpis + sections;
}

// -------------------------------------------------------------
// KI-PROMPTS
// -------------------------------------------------------------
function buildReportPrompt(mode, r, markdown) {
  const kind = r.type === 'daily' ? 'Tagesbericht' : 'Wochenbericht';
  const audience = AUDIENCES[document.getElementById('reportAudience').value] || AUDIENCES.team;
  const context = `Du bist erfahrener Projektleiter in der industriellen Automatisierungstechnik (Sondermaschinenbau, Anlagenbau,
SPS-Programmierung z. B. Siemens TIA Portal, HMI / WinCC Unified, Robotik, Bildverarbeitung, Inbetriebnahme).
Unten steht ein automatisch aus dem Aufgaben-Board erzeugter ${kind} des Automatisierungsprojekts "${currentWorkspace.projectName}"
(${r.range}). Status-Werte: Offen, In Arbeit, Im Testen, Blockiert, Erledigt, Abgebrochen. Abhängigkeiten sind Ende → Anfang.`;

  const rules = `REGELN
- Nur Fakten aus dem Bericht verwenden, nichts erfinden. Annahmen ausdrücklich als Annahme kennzeichnen.
- Fachbegriffe, Anlagen-/Stationsbezeichnungen (z. B. FG14, Roboter 2), Signal- und Bausteinnamen, Namen, Daten und Zahlen unverändert übernehmen.
- Korrekte deutsche Rechtschreibung und Grammatik, sachlicher Stil der Automatisierungstechnik.
- Ausgabe als Markdown.`;

  if (mode === 'evaluate') {
    return `${context}

AUFGABE
Werte den ${kind} kritisch aus und liefere:
1. Gesamtbewertung als Ampel (Grün / Gelb / Rot) mit kurzer Begründung.
2. Kritische Punkte: Blocker, Überfälliges, Abhängigkeitskonflikte und der daraus folgende kritische Pfad${r.type === 'weekly' ? ' bis zu den Meilensteinen' : ''}.
3. Engpässe: Verteilung der offenen und blockierten Aufgaben je Verantwortlichem und je Gruppe.
4. Terminrisiken für ${r.type === 'daily' ? 'die nächsten Arbeitstage' : 'die nächste Woche'}.
5. Konkrete, priorisierte Empfehlungen (was, wer, bis wann – nur aus den vorhandenen Informationen abgeleitet).
6. Offene Fragen bzw. Entscheidungsbedarf an Kunde, Lieferanten oder Team.
Zielgruppe der Auswertung: ${audience}.

${rules}

BERICHT
${markdown}`;
  }

  return `${context}

AUFGABE
Formuliere daraus einen gut lesbaren, professionellen ${kind} für ${audience}.
Gliederung:
1. Kurzfazit (2–3 Sätze) mit Ampel (Grün / Gelb / Rot) und Begründung
2. Erledigt${r.type === 'daily' ? ' (heute)' : ' (diese Woche)'}
3. In Arbeit / im Test
4. Blocker und Risiken (inkl. Abhängigkeitskonflikte und Überfälliges)
5. Nächste Schritte${r.type === 'weekly' ? '\n6. Meilensteine und Ausblick auf die nächste Woche' : ''}
Leere Abschnitte weglassen. Stichpunkte kurz halten, ähnliche Punkte je Gruppe zusammenfassen.

${rules}

BERICHT
${markdown}`;
}

// -------------------------------------------------------------
// DIALOG
// -------------------------------------------------------------
function openReportModal() {
  if (!document.getElementById('reportDate').value) document.getElementById('reportDate').value = dayKey(new Date());
  setReportType(reportType);
  document.getElementById('reportModal').classList.remove('hidden');
}

function closeReportModal() {
  document.getElementById('reportModal').classList.add('hidden');
}

function setReportType(type) {
  reportType = type;
  const active = 'px-3 py-1 rounded flex items-center gap-1.5 transition bg-emerald-600 text-white font-medium shadow';
  const inactive = 'px-3 py-1 rounded flex items-center gap-1.5 transition text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white';
  document.getElementById('reportTabDaily').className = type === 'daily' ? active : inactive;
  document.getElementById('reportTabWeekly').className = type === 'weekly' ? active : inactive;
  renderReport();
}

function shiftReportDate(direction) {
  const input = document.getElementById('reportDate');
  const key = input.value || dayKey(new Date());
  input.value = reportType === 'weekly' ? shiftDay(key, 7 * direction) : (direction > 0 ? nextWorkday(key) : previousWorkday(key));
  renderReport();
}

function previousWorkday(key) {
  let k = shiftDay(key, -1);
  while ([0, 6].includes(new Date(`${k}T12:00:00`).getDay())) k = shiftDay(k, -1);
  return k;
}

function setReportDateToday() {
  document.getElementById('reportDate').value = dayKey(new Date());
  renderReport();
}

async function renderReport() {
  const seq = ++reportRenderSeq;
  const key = document.getElementById('reportDate').value || dayKey(new Date());
  const list = document.getElementById('reportUseFilter').checked ? getFilteredTasks() : tasks;

  // Änderungsprotokoll gibt es nur mit dem lokalen Server (EXE / npm start)
  let history = null;
  if (SERVER_MODE) {
    const from = reportType === 'weekly' ? weekStart(key) : key;
    const to = reportType === 'weekly' ? shiftDay(from, 6) : key;
    try {
      const res = await fetch(apiUrl('history', { from, to }), { cache: 'no-store' });
      if (res.ok) {
        const ids = new Set(list.map(t => t.id));
        const all = await res.json();
        history = document.getElementById('reportUseFilter').checked ? all.filter(e => ids.has(e.taskId)) : all;
      }
    } catch (e) {}
    if (seq !== reportRenderSeq) return; // inzwischen anderer Bericht gewählt
  }

  lastReport = buildReport(reportType, key, list, history);
  document.getElementById('reportRangeLabel').innerText = lastReport.range;
  document.getElementById('reportPreview').innerHTML = reportToHTML(lastReport) + (SERVER_MODE ? '' : `
    <p class="text-[11px] text-slate-400 dark:text-slate-500">Hinweis: Das Änderungsprotokoll mit Uhrzeiten steht zur Verfügung, wenn das Board über die App (EXE bzw. <code>npm start</code>) läuft.</p>`);
}

async function copyReportMarkdown() {
  if (!lastReport) await renderReport();
  const ok = await copyToClipboard(reportToMarkdown(lastReport));
  showToast(ok ? `${lastReport.title} als Markdown kopiert` : 'Kopieren nicht möglich', ok ? 'success' : 'error');
}

async function copyReportPrompt(mode) {
  if (!lastReport) await renderReport();
  const prompt = buildReportPrompt(mode, lastReport, reportToMarkdown(lastReport));
  const ok = await copyToClipboard(prompt);
  showToast(ok ? `KI-Prompt „${mode === 'evaluate' ? 'Auswerten' : 'Bericht verbessern'}“ kopiert – in ChatGPT / Claude / Gemini einfügen` : 'Kopieren nicht möglich', ok ? 'info' : 'error', { duration: 5000 });
}

async function downloadReport() {
  if (!lastReport) await renderReport();
  const blob = new Blob([reportToMarkdown(lastReport)], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  const suffix = lastReport.type === 'daily' ? lastReport.from : `KW${getWeekNumber(new Date(`${lastReport.from}T12:00:00`))}_${lastReport.from.slice(0, 4)}`;
  a.href = URL.createObjectURL(blob);
  a.download = `${currentWorkspace.projectName}_${lastReport.type === 'daily' ? 'Tagesbericht' : 'Wochenbericht'}_${suffix}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast('Bericht gespeichert');
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('reportModal').classList.contains('hidden')) closeReportModal();
});
