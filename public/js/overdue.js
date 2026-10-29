// Überfällige Aufgaben automatisch verlängern
// Nicht abgeschlossene Aufgaben, deren Enddatum heute oder früher liegt, bekommen als neues Ende
// den nächsten Arbeitstag. Das ursprüngliche Ende bleibt in originalEndDate erhalten (für Anzeige
// und Berichte), extendedCount zählt die Verlängerungen. Meilensteine bleiben fest (Termine).
// Läuft beim Laden und bei jedem Tageswechsel, solange das Board offen ist.
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

const AUTO_EXTEND_KEY = 'project_board_auto_extend';
let lastExtendDay = null;

function isAutoExtendEnabled() {
  try { return localStorage.getItem(AUTO_EXTEND_KEY) !== 'false'; } catch (e) { return true; }
}

function setAutoExtendEnabled(on) {
  try { localStorage.setItem(AUTO_EXTEND_KEY, on ? 'true' : 'false'); } catch (e) {}
  syncAutoExtendToggle();
  if (on) extendOverdueTasks();
}

function syncAutoExtendToggle() {
  const cb = document.getElementById('autoExtendToggle');
  if (cb) cb.checked = isAutoExtendEnabled();
}

function localDayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// nächster Arbeitstag nach dem angegebenen Tag (Sa/So werden übersprungen)
function nextWorkdayAfter(key) {
  const d = new Date(`${key}T12:00:00`);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return localDayKey(d);
}

function isExtendable(t) {
  return !isClosed(t) && !t.milestone && !!t.endDate;
}

function extendOverdueTasks() {
  const today = localDayKey();
  lastExtendDay = today;
  if (!isAutoExtendEnabled()) return;

  const overdue = tasks.filter(t => isExtendable(t) && t.endDate <= today);
  if (!overdue.length) return;

  const newEnd = nextWorkdayAfter(today);
  // Stand aller Aufgaben merken: auch verschobene Nachfolger müssen sich rückgängig machen lassen
  const snapshot = tasks.map(t => ({ id: t.id, startDate: t.startDate, endDate: t.endDate, originalEndDate: t.originalEndDate, extendedCount: t.extendedCount }));

  overdue.forEach(t => {
    if (!t.originalEndDate) t.originalEndDate = t.endDate;
    t.extendedCount = (t.extendedCount || 0) + 1;
  });

  // 1) Aufgaben ohne offenen Vorgänger: Ende auf den nächsten Arbeitstag
  const waitsForOpen = t => getPredecessors(t).some(p => !isClosed(p));
  overdue.filter(t => !waitsForOpen(t)).forEach(t => { t.endDate = newEnd; });
  // 2) Nachfolger hinter ihre (verlängerten) Vorgänger schieben – mit ihrer ursprünglichen Dauer
  overdue.forEach(t => cascadeDependentTasks(t.id));
  // 3) was danach immer noch nicht in der Zukunft endet, ebenfalls verlängern
  overdue.forEach(t => {
    if (t.endDate > today) return;
    t.endDate = newEnd;
    cascadeDependentTasks(t.id);
  });

  saveTasks();
  render();

  const moved = snapshot.filter(s => {
    const t = getTask(s.id);
    return t && !overdue.includes(t) && (t.startDate !== s.startDate || t.endDate !== s.endDate);
  }).length;
  showToast(`${overdue.length} überfällige Aufgabe(n) verlängert${moved ? `, ${moved} Nachfolger verschoben` : ''}`, 'success', {
    duration: 9000,
    actionLabel: 'Rückgängig',
    actionIcon: 'undo-2',
    onAction: () => {
      snapshot.forEach(s => {
        const t = getTask(s.id);
        if (!t) return;
        t.startDate = s.startDate;
        t.endDate = s.endDate;
        if (s.originalEndDate) t.originalEndDate = s.originalEndDate; else delete t.originalEndDate;
        if (s.extendedCount) t.extendedCount = s.extendedCount; else delete t.extendedCount;
      });
      saveTasks();
      render();
      showToast('Verlängerung rückgängig gemacht');
    }
  });
}

// Tage, die das ursprüngliche Ende überschritten ist (0 = nicht überfällig)
function getDaysOverOriginal(t, refKey = localDayKey()) {
  const orig = t.originalEndDate || t.endDate;
  if (!orig || isClosed(t) || orig >= refKey) return 0;
  return Math.round((new Date(`${refKey}T12:00:00`) - new Date(`${orig}T12:00:00`)) / 86400000);
}

function getExtendedBadge(t) {
  if (!t.originalEndDate || isClosed(t)) return '';
  const tip = `Automatisch verlängert: ursprünglich Ende ${formatDate(t.originalEndDate)}, ${t.extendedCount || 1}× verlängert`;
  return `<span class="px-1.5 py-px rounded-md text-[10px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30 inline-flex items-center gap-1 flex-shrink-0" title="${escapeHTML(tip)}">${icon('clock-alert', 'text-[9px]')}verlängert</span>`;
}

function initAutoExtend() {
  syncAutoExtendToggle();
  extendOverdueTasks();
  // Tageswechsel bei offenem Board erkennen (z. B. Board läuft über Nacht)
  const check = () => { if (localDayKey() !== lastExtendDay) extendOverdueTasks(); };
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
