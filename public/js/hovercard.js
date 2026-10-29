// Infokarte beim Überfahren einer Aufgabe (Gantt, Kanban, Tabelle) bzw. einer Gruppenzeile im Gantt.
// Erkennt Elemente mit data-task-id bzw. data-group-tasks per Event-Delegation – die Ansichten müssen
// nur dieses Attribut setzen. Nicht auf Touch-Geräten, beim Ziehen, im Verknüpfungsmodus oder bei offenem Dialog.
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

const HOVER_DELAY_MS = 350;
const HOVER_OFFSET = 16;

let hoverCardEl = null;
let hoverTarget = null;
let hoverTimer = null;
let hoverMouse = { x: 0, y: 0 };
let hoverFrame = null;

const STATUS_DOT = {
  'Offen': 'bg-slate-400', 'In Arbeit': 'bg-blue-500', 'Im Testen': 'bg-violet-500',
  'Blockiert': 'bg-rose-500', 'Erledigt': 'bg-emerald-500', 'Abgebrochen': 'bg-slate-300 dark:bg-slate-600'
};

function hoverDayDiff(fromKey, toKey) {
  return Math.round((new Date(`${toKey}T12:00:00`) - new Date(`${fromKey}T12:00:00`)) / 86400000);
}

function hoverDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function hoverRow(label, value) {
  if (!value) return '';
  return `<div class="flex gap-2"><span class="w-24 flex-shrink-0 text-slate-400 dark:text-slate-500">${label}</span><span class="flex-1 min-w-0 text-slate-700 dark:text-slate-200">${value}</span></div>`;
}

function hoverTaskList(list, task, asPredecessor) {
  if (!list.length) return '';
  const max = 4;
  const items = list.slice(0, max).map(other => {
    const state = asPredecessor ? getDependencyState(other, task) : getDependencyState(task, other);
    const iconName = { done: 'circle-check', wait: 'hourglass', conflict: 'triangle-alert' }[state];
    const tone = { done: 'text-emerald-500', wait: 'text-indigo-500', conflict: 'text-rose-500' }[state];
    return `<div class="flex items-center gap-1.5 min-w-0">${icon(iconName, `text-[10px] ${tone}`)}<span class="truncate">${escapeHTML(other.title)}</span><span class="text-slate-400 dark:text-slate-500 flex-shrink-0">${escapeHTML(other.status)}</span></div>`;
  }).join('');
  return items + (list.length > max ? `<div class="text-slate-400">+ ${list.length - max} weitere</div>` : '');
}

function buildTaskHoverCard(t) {
  const today = dayKey(new Date());
  const preds = getPredecessors(t);
  const succs = getSuccessors(t.id);
  const closed = isClosed(t);
  const duration = t.startDate && t.endDate ? hoverDayDiff(t.startDate, t.endDate) + 1 : null;

  // Termin-Lage
  let timing = '';
  if (t.status === 'Erledigt' && t.doneAt) {
    const late = t.originalEndDate && dayKey(t.doneAt) > t.originalEndDate;
    timing = `<span class="${late ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} font-medium">erledigt am ${formatDate(dayKey(t.doneAt))}${late ? ' (verspätet)' : ''}</span>`;
  } else if (!closed && t.endDate) {
    const left = hoverDayDiff(today, t.endDate);
    const over = getDaysOverOriginal(t, today);
    if (over > 0) timing = `<span class="text-rose-600 dark:text-rose-400 font-medium">${over} Tag${over === 1 ? '' : 'e'} über dem ursprünglichen Termin</span>`;
    else if (left > 0) timing = `noch ${left} Tag${left === 1 ? '' : 'e'}`;
    else if (left === 0) timing = '<span class="text-amber-600 dark:text-amber-400 font-medium">heute fällig</span>';
  }

  const badges = [
    t.group ? getGroupBadge(t.group) : '',
    getPhaseBadge(t.phase),
    getPriorityBadge(t.priority),
    t.owner ? `<span class="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1">${icon('user', 'text-[9px]')}${escapeHTML(t.owner)}</span>` : '',
    isInboxTask(t) ? getInboxBadge() : '',
    getExtendedBadge(t)
  ].filter(Boolean).join('');

  const blocked = t.status === 'Blockiert' && (t.blockReason || t.waitingFor || t.blockedSince) ? `
    <div class="rounded-lg bg-rose-500/10 border border-rose-500/25 px-2.5 py-1.5 space-y-0.5 text-rose-700 dark:text-rose-300">
      ${t.blockedSince ? `<div class="flex gap-1.5">${icon('ban', 'text-[10px] mt-0.5')}<span>blockiert seit ${hoverDateTime(t.blockedSince)}</span></div>` : ''}
      ${t.blockReason ? `<div class="pl-4">${escapeHTML(t.blockReason)}</div>` : ''}
      ${t.waitingFor ? `<div class="flex gap-1.5">${icon('clock-alert', 'text-[10px] mt-0.5')}<span>wartet auf ${escapeHTML(t.waitingFor)}</span></div>` : ''}
    </div>` : '';

  const notes = t.notes ? `
    <div>
      <div class="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Notizen</div>
      <div class="text-slate-700 dark:text-slate-300 whitespace-pre-line line-clamp-5">${escapeHTML(t.notes)}</div>
    </div>` : '';

  const footer = [
    t.createdAt ? `erstellt ${hoverDateTime(t.createdAt)}` : '',
    t.updatedAt ? `geändert ${hoverDateTime(t.updatedAt)}` : ''
  ].filter(Boolean).join(' · ');

  return `
    <div class="flex items-start gap-2">
      ${t.milestone
        ? '<span class="mt-1 w-2.5 h-2.5 rotate-45 bg-amber-500 flex-shrink-0" title="Meilenstein"></span>'
        : `<span class="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_DOT[t.status] || 'bg-slate-400'}"></span>`}
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-sm leading-snug text-slate-900 dark:text-white ${t.status === 'Abgebrochen' ? 'line-through opacity-70' : ''}">${escapeHTML(t.title)}</div>
        <div class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHTML(t.status)}${t.milestone ? ' · Meilenstein' : ''}${t.statusChangedAt ? ` seit ${hoverDateTime(t.statusChangedAt)}` : ''}${t.prevStatus ? ` (vorher ${escapeHTML(t.prevStatus)})` : ''}</div>
      </div>
      <span class="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400 flex-shrink-0">${t.progress || 0}%</span>
    </div>

    <div class="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
      <div class="h-full rounded-full ${t.status === 'Erledigt' ? 'bg-emerald-500' : t.status === 'Blockiert' ? 'bg-rose-500' : 'bg-blue-500'}" style="width:${t.progress || 0}%"></div>
    </div>

    ${badges ? `<div class="flex flex-wrap gap-1">${badges}</div>` : ''}

    <div class="space-y-1">
      ${hoverRow('Zeitraum', t.startDate ? `${formatDate(t.startDate)} – ${formatDate(t.endDate)}${duration ? ` <span class="text-slate-400">(${duration} Tag${duration === 1 ? '' : 'e'})</span>` : ''}` : '')}
      ${hoverRow('Termin', timing)}
      ${t.originalEndDate && !closed ? hoverRow('Ursprünglich', `Ende ${formatDate(t.originalEndDate)}, ${t.extendedCount || 1}× automatisch verlängert`) : ''}
      ${hoverRow('Vorgänger', hoverTaskList(preds, t, true))}
      ${hoverRow('Nachfolger', hoverTaskList(succs, t, false))}
    </div>

    ${blocked}

    ${t.nextAction && !closed ? `
      <div class="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 flex gap-1.5 text-slate-700 dark:text-slate-200">
        ${icon('move-right', 'text-emerald-500 mt-0.5')}
        <div><div class="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Nächster Schritt</div>${escapeHTML(t.nextAction)}</div>
      </div>` : ''}

    ${notes}

    ${footer ? `<div class="pt-1.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500">${footer}</div>` : ''}
  `;
}

function buildGroupHoverCard(ids) {
  const list = ids.map(getTask).filter(Boolean);
  if (!list.length) return '';
  const name = getGroupKey(list[0]) || 'Gruppe';
  const relevant = list.filter(t => t.status !== 'Abgebrochen');
  const pct = relevant.length ? Math.round(relevant.reduce((s, t) => s + (t.progress || 0), 0) / relevant.length) : 0;
  const counts = STATUS_ORDER.map(st => [st, list.filter(t => t.status === st).length]).filter(([, n]) => n);
  const starts = list.map(t => t.startDate).filter(Boolean).sort();
  const ends = list.map(t => t.endDate).filter(Boolean).sort();
  const owners = [...new Set(list.map(t => t.owner).filter(Boolean))];
  const today = dayKey(new Date());
  const overdue = list.filter(t => getDaysOverOriginal(t, today) > 0).length;
  const conflicts = list.reduce((n, t) => n + getPredecessors(t).filter(p => getDependencyState(p, t) === 'conflict').length, 0);
  const nextDue = list.filter(t => !isClosed(t) && t.endDate >= today).sort((a, b) => a.endDate.localeCompare(b.endDate))[0];

  return `
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="font-semibold text-sm text-slate-900 dark:text-white">${escapeHTML(name)}</div>
        <div class="text-[11px] text-slate-500 dark:text-slate-400">${list.length} Aufgabe${list.length === 1 ? '' : 'n'}</div>
      </div>
      <span class="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">${pct}%</span>
    </div>
    <div class="flex h-2 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
      ${counts.map(([st, n]) => `<div class="${STATUS_DOT[st]}" style="width:${(n / list.length) * 100}%" title="${st}: ${n}"></div>`).join('')}
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
      ${counts.map(([st, n]) => `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full ${STATUS_DOT[st]}"></span>${st} ${n}</span>`).join('')}
    </div>
    <div class="space-y-1">
      ${hoverRow('Zeitraum', starts.length ? `${formatDate(starts[0])} – ${formatDate(ends[ends.length - 1])}` : '')}
      ${hoverRow('Nächste Frist', nextDue ? `${formatDate(nextDue.endDate)} · ${escapeHTML(nextDue.title)}` : '')}
      ${hoverRow('Verantwortlich', owners.map(escapeHTML).join(', '))}
      ${overdue ? hoverRow('Überfällig', `<span class="text-rose-600 dark:text-rose-400 font-medium">${overdue} Aufgabe${overdue === 1 ? '' : 'n'}</span>`) : ''}
      ${conflicts ? hoverRow('Konflikte', `<span class="text-rose-600 dark:text-rose-400 font-medium">${conflicts} Abhängigkeitskonflikt${conflicts === 1 ? '' : 'e'}</span>`) : ''}
    </div>
  `;
}

// -------------------------------------------------------------
// Anzeige
// -------------------------------------------------------------
function hoverBlocked() {
  return !!(linkingPredecessorId || draggedTaskId || draggedLeftTaskId ||
    document.querySelector('#taskModal:not(.hidden), #reportModal:not(.hidden), #aiImportModal:not(.hidden), #proofreadPasteModal:not(.hidden)'));
}

function positionHoverCard() {
  hoverFrame = null;
  if (!hoverCardEl || hoverCardEl.classList.contains('hidden')) return;
  const rect = hoverCardEl.getBoundingClientRect();
  let x = hoverMouse.x + HOVER_OFFSET;
  let y = hoverMouse.y + HOVER_OFFSET;
  if (x + rect.width > window.innerWidth - 8) x = hoverMouse.x - rect.width - HOVER_OFFSET;
  if (y + rect.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - rect.height - 8);
  hoverCardEl.style.left = `${Math.max(8, x)}px`;
  hoverCardEl.style.top = `${y}px`;
}

function showHoverCard(target) {
  const html = target.dataset.taskId
    ? (getTask(target.dataset.taskId) ? buildTaskHoverCard(getTask(target.dataset.taskId)) : '')
    : buildGroupHoverCard(target.dataset.groupTasks.split(','));
  if (!html) return;
  hoverCardEl.innerHTML = html;
  hoverCardEl.classList.remove('hidden');
  positionHoverCard();
}

function hideHoverCard() {
  clearTimeout(hoverTimer);
  hoverTarget = null;
  if (hoverCardEl) hoverCardEl.classList.add('hidden');
}

function initHoverCard() {
  if (!window.matchMedia('(hover: hover)').matches) return; // Touch-Geräte: keine Hover-Karte

  hoverCardEl = document.createElement('div');
  hoverCardEl.id = 'hoverCard';
  hoverCardEl.className = 'hidden fixed z-[70] w-80 max-w-[calc(100vw-16px)] p-3 space-y-2.5 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur text-xs pointer-events-none';
  document.body.appendChild(hoverCardEl);

  document.addEventListener('mouseover', e => {
    const target = e.target.closest('[data-task-id], [data-group-tasks]');
    if (target === hoverTarget) return;
    clearTimeout(hoverTimer);
    hoverTarget = target;
    if (!target || hoverBlocked()) {
      hoverCardEl.classList.add('hidden');
      return;
    }
    // Ist schon eine Karte sichtbar, sofort wechseln – sonst kurz warten
    const visible = !hoverCardEl.classList.contains('hidden');
    hoverTimer = setTimeout(() => {
      if (hoverTarget === target && !hoverBlocked()) showHoverCard(target);
    }, visible ? 0 : HOVER_DELAY_MS);
  });

  document.addEventListener('mousemove', e => {
    hoverMouse = { x: e.clientX, y: e.clientY };
    if (!hoverFrame && !hoverCardEl.classList.contains('hidden')) hoverFrame = requestAnimationFrame(positionHoverCard);
  });

  ['mousedown', 'wheel', 'dragstart', 'keydown'].forEach(type => document.addEventListener(type, hideHoverCard, { passive: true }));
  document.addEventListener('mouseleave', hideHoverCard);
  window.addEventListener('blur', hideHoverCard);
}
