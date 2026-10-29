// Oberfläche: einklappbare Kennzahlen & Filter, Schnellerfassungs-Popover in der Kopfzeile
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

const OVERVIEW_COLLAPSED_KEY = 'project_board_overview_collapsed';

// -------------------------------------------------------------
// Kennzahlen & Filter einklappen
// -------------------------------------------------------------
function isOverviewCollapsed() {
  try { return localStorage.getItem(OVERVIEW_COLLAPSED_KEY) === 'true'; } catch (e) { return false; }
}

function setOverviewCollapsed(collapsed) {
  try { localStorage.setItem(OVERVIEW_COLLAPSED_KEY, collapsed ? 'true' : 'false'); } catch (e) {}
  applyOverviewCollapsed();
}

function applyOverviewCollapsed() {
  const collapsed = isOverviewCollapsed();
  document.getElementById('statsSection').classList.toggle('hidden', collapsed);
  document.getElementById('filterSection').classList.toggle('hidden', collapsed);
  document.getElementById('overviewCollapsedBar').classList.toggle('hidden', !collapsed);
  updateOverviewSummary();
}

function getActiveFilterCount() {
  let n = document.getElementById('filterSearch').value.trim() ? 1 : 0;
  ['filterGroup', 'filterPhase', 'filterPriority', 'filterStatus'].forEach(id => {
    if (document.getElementById(id).value !== 'ALL') n++;
  });
  if (inboxOnly) n++;
  return n;
}

// Kurzfassung für die eingeklappte Zeile
function updateOverviewSummary() {
  const summary = document.getElementById('overviewSummary');
  if (!summary || !isOverviewCollapsed()) return;
  const total = tasks.length;
  const active = tasks.filter(t => t.status === 'In Arbeit' || t.status === 'Im Testen').length;
  const blocked = tasks.filter(t => t.status === 'Blockiert').length;
  const done = tasks.filter(t => t.status === 'Erledigt').length;
  const avg = total ? Math.round(tasks.reduce((s, t) => s + (t.progress || 0), 0) / total) : 0;
  const item = (label, value, cls = '') => `<span>${label} <b class="${cls || 'text-slate-800 dark:text-slate-200'}">${value}</b></span>`;
  summary.innerHTML = [
    item('Aufgaben', total),
    item('In Arbeit/Test', active, 'text-blue-600 dark:text-blue-400'),
    item('Blockiert', blocked, blocked ? 'text-rose-600 dark:text-rose-400' : ''),
    item('Erledigt', done, 'text-emerald-600 dark:text-emerald-400'),
    item('Ø', `${avg} %`, 'text-emerald-600 dark:text-emerald-400')
  ].join('<span class="text-slate-300 dark:text-slate-700">·</span>');

  const filters = getActiveFilterCount();
  document.getElementById('overviewActiveFilters').classList.toggle('hidden', filters === 0);
  document.getElementById('overviewFilterCount').innerText = `${filters} Filter aktiv – ${getFilteredTasks().length} von ${total} sichtbar`;
}

// -------------------------------------------------------------
// Schnellerfassung (Popover in der Kopfzeile)
// -------------------------------------------------------------
function isQuickAddOpen() {
  return !document.getElementById('quickAddForm').classList.contains('hidden');
}

function toggleQuickAdd(open = !isQuickAddOpen()) {
  const form = document.getElementById('quickAddForm');
  form.classList.toggle('hidden', !open);
  if (open) {
    const menu = document.getElementById('dropdownMenu');
    if (menu) menu.classList.add('hidden');
    setTimeout(() => document.getElementById('quickTitle').focus(), 0);
  }
}

function isTypingTarget(el) {
  return el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function initLayout() {
  applyOverviewCollapsed();

  // Klick außerhalb schließt das Popover
  document.addEventListener('mousedown', e => {
    if (isQuickAddOpen() && !e.target.closest('#quickAddWrap')) toggleQuickAdd(false);
  });

  // Enter in der Beschreibung speichert, Umschalt+Enter macht eine neue Zeile
  document.getElementById('quickNotes').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('quickAddForm').requestSubmit();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isQuickAddOpen()) {
      toggleQuickAdd(false);
      return;
    }
    // Taste N öffnet die Schnellerfassung (nicht beim Tippen, nicht bei offenem Dialog)
    if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target) &&
        !document.querySelector('#taskModal:not(.hidden), #reportModal:not(.hidden), #aiImportModal:not(.hidden), #proofreadPasteModal:not(.hidden)')) {
      e.preventDefault();
      toggleQuickAdd(true);
    }
  });
}
