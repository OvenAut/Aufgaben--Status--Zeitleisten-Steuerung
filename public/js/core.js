// Kern: Theme, Workspace, Zustand, Laden/Speichern, Gruppierung, Filter, Badges
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

// Theme Management (Light / Dark)
const THEME_STORAGE_KEY = 'project_board_theme';

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const isDark = savedTheme !== null ? savedTheme === 'dark' : false;
  applyTheme(isDark);
}

function applyTheme(isDark) {
  const html = document.documentElement;
  const themeIcon = document.getElementById('themeToggleIcon');
  const themeLabel = document.getElementById('themeToggleLabel');

  if (isDark) {
    html.classList.add('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    setIcon(themeIcon, 'sun', 'text-amber-400 text-sm');
    if (themeLabel) themeLabel.innerText = 'Hell';
  } else {
    html.classList.remove('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    setIcon(themeIcon, 'moon', 'text-indigo-500 text-sm');
    if (themeLabel) themeLabel.innerText = 'Dunkel';
  }

  if (tasks && tasks.length > 0) {
    render();
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(!isDark);
  showToast(!isDark ? 'Dunkelmodus aktiviert' : 'Hellmodus aktiviert');
}

// Dynamic project workspace & storage key resolution based on pathname
// Server-Modus: Die App läuft über den lokalen Node-Server (EXE bzw. npm start), Daten liegen in ./daten.
// Beim Öffnen der HTML-Datei per Doppelklick (file://) wird weiterhin im Browser gespeichert.
const SERVER_MODE = location.protocol === 'http:' || location.protocol === 'https:';
const DEFAULT_SERVER_PROJECT = 'Hauptprojekt';

function detectProjectWorkspace() {
  if (SERVER_MODE) {
    const projectName = (new URLSearchParams(location.search).get('projekt') || DEFAULT_SERVER_PROJECT).trim() || DEFAULT_SERVER_PROJECT;
    return { projectName, filename: 'Server', storageKey: `project_board_server_${projectName}` };
  }
  let rawPath = window.location.pathname || '';
  rawPath = rawPath.replace(/\\/g, '/');
  const segments = rawPath.split('/').filter(Boolean);
  let filename = segments.length > 0 ? segments[segments.length - 1] : '';

  filename = filename.split('?')[0].split('#')[0];

  let projectName = 'Projekt';
  if (filename && filename.toLowerCase().endsWith('.html')) {
    projectName = filename.substring(0, filename.length - 5);
  } else if (filename) {
    projectName = filename;
  }

  projectName = decodeURIComponent(projectName).trim();
  if (!projectName || projectName.toLowerCase() === 'index') {
    projectName = 'Hauptprojekt';
  }

  const storageKey = `project_board_data_${projectName}`;
  return { projectName, filename: filename || 'lokale Datei', storageKey };
}

const currentWorkspace = detectProjectWorkspace();
const STORAGE_KEY = currentWorkspace.storageKey;

// Helper dates relative to today
const now = new Date();
const toISO = (d) => d.toISOString().split('T')[0];
const addDays = (days) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return toISO(d);
};

// Automation & Engineering Tasks
const DEFAULT_TASKS = [
  {
    id: 't-1',
    title: 'Werkstückstatus aus HMI an PLC übertragen',
    group: 'HMI ↔ PLC Kommunikation',
    phase: 'Schnittstellen',
    priority: 'Hoch',
    status: 'Offen',
    progress: 0,
    startDate: addDays(0),
    endDate: addDays(5),
    dependsOn: [],
    nextAction: 'DB-Struktur in TIA Portal anlegen',
    notes: 'Handshake-Bits für Werkstückfreigabe definieren.'
  },
  {
    id: 't-2',
    title: 'Kontrollbild nach Türschließung im Relais',
    group: 'Maschinentests',
    phase: 'Inbetriebnahme',
    priority: 'Mittel',
    status: 'Offen',
    progress: 0,
    startDate: addDays(0),
    endDate: addDays(4),
    dependsOn: [],
    nextAction: 'Sicherheitskreis-Verriegelung prüfen',
    notes: 'Visuelle Rückmeldung am HMI-Panel verifizieren.'
  },
  {
    id: 't-3',
    title: 'FG14 Schublade Klopfer programmieren',
    group: 'FG14 Klopfer',
    phase: 'Umsetzung',
    priority: 'Hoch',
    status: 'In Arbeit',
    progress: 40,
    startDate: addDays(0),
    endDate: addDays(4),
    dependsOn: [],
    nextAction: 'Zylinder-Ansteuerung und Taktsignale einprogrammieren',
    notes: 'Voraussetzung für den anschließenden Klopfer-Zyklustest.'
  },
  {
    id: 't-4',
    title: 'Klopfer-Zyklus testen',
    group: 'FG14 Klopfer',
    phase: 'Inbetriebnahme',
    priority: 'Hoch',
    status: 'Offen',
    progress: 0,
    startDate: addDays(5),
    endDate: addDays(9),
    dependsOn: ['t-3'],
    nextAction: 'Sensorabfragen und Zylinderhub im Tippbetrieb prüfen',
    notes: 'Darf erst starten, wenn die Klopfer-Programmierung abgeschlossen ist.'
  },
  {
    id: 't-5',
    title: 'Umrüstprozess fertig programmieren',
    group: 'Umrüstung',
    phase: 'Umsetzung',
    priority: 'Mittel',
    status: 'In Arbeit',
    progress: 70,
    startDate: addDays(-2),
    endDate: addDays(3),
    dependsOn: [],
    nextAction: 'Rezepturverwaltung für Werkzeugwechsel abschließen',
    notes: 'Bereits zu 70% parametriert.'
  },
  {
    id: 't-6',
    title: 'Umrüstprozess testen',
    group: 'Umrüstung',
    phase: 'Inbetriebnahme',
    priority: 'Mittel',
    status: 'Offen',
    progress: 0,
    startDate: addDays(4),
    endDate: addDays(7),
    dependsOn: ['t-5'],
    nextAction: 'Werkzeugwechsel mit Musterteilen durchspielen',
    notes: 'Hängt direkt an der Umrüstprogrammierung.'
  },
  {
    id: 't-7',
    title: 'Leerfahrt der Maschine testen',
    group: 'Maschinentests',
    phase: 'Inbetriebnahme',
    priority: 'Niedrig',
    status: 'Offen',
    progress: 0,
    startDate: addDays(0),
    endDate: addDays(3),
    dependsOn: [],
    nextAction: 'Not-Aus Kreise und Achsendschalter abfahren',
    notes: 'Grundlegende Maschinenbewegung sicherstellen.'
  },
  {
    id: 't-8',
    title: 'Reset-Funktion testen',
    group: 'Maschinentests',
    phase: 'Inbetriebnahme',
    priority: 'Mittel',
    status: 'Offen',
    progress: 0,
    startDate: addDays(10),
    endDate: addDays(13),
    dependsOn: ['t-7', 't-4'],
    nextAction: 'Schrittketten-Reset bei laufendem Zyklus simulieren',
    notes: 'Erst nach Leerfahrt und Klopfer-Zyklustest. Sicherstellen, dass keine Zylinder in Zwischenstellung verharren.'
  }
];

let tasks = [];
let currentView = 'gantt'; // Starts directly in Gantt 2D view
let sortColumn = null;
let sortAsc = true;
let draggedTaskId = null;
let draggedLeftTaskId = null;
// Zoom = Pixel pro Tag (stufenlos). Klein = mehr Zeitraum sichtbar, groß = mehr Details.
const ZOOM_PRESETS = { day: 64, week: 42, month: 20, quarter: 9, year: 3 };
const ZOOM_MIN = 2;
const ZOOM_MAX = 140;
const ZOOM_KEY = `${STORAGE_KEY}_zoom`;
let ganttDayWidth = ZOOM_PRESETS.week;
let ganttMinDate = null;

// Grouping State
const NO_GROUP = 'Ohne Gruppe';
const NO_PHASE = 'Ohne Phase';
const PHASE_ORDER = ['Konzept', 'Vorbereitung', 'Umsetzung', 'Schnittstellen', 'Inbetriebnahme', 'Doku'];
const STATUS_ORDER = ['Offen', 'In Arbeit', 'Im Testen', 'Blockiert', 'Erledigt', 'Abgebrochen'];
const STATUS_COLORS = { 'Offen': '#64748b', 'In Arbeit': '#3b82f6', 'Im Testen': '#8b5cf6', 'Blockiert': '#f43f5e', 'Erledigt': '#10b981', 'Abgebrochen': '#94a3b8' };

// Abgeschlossen = blockiert keine Nachfolger mehr
function isClosed(t) {
  return t.status === 'Erledigt' || t.status === 'Abgebrochen';
}

// Status setzen und Verlauf mitschreiben (Grundlage für Tages- und Wochenbericht)
function setTaskStatus(task, newStatus) {
  if (!task || task.status === newStatus) return;
  const now = new Date().toISOString();
  task.prevStatus = task.status || '';
  task.status = newStatus;
  task.statusChangedAt = now;
  task.updatedAt = now;
  task.doneAt = newStatus === 'Erledigt' ? now : '';
  task.blockedSince = newStatus === 'Blockiert' ? now : '';
  if (newStatus === 'Erledigt') task.progress = 100;
  if (newStatus === 'Offen' && task.progress === 100) task.progress = 0;
}

function getStatusOptions(selected) {
  return STATUS_ORDER.map(st => `<option value="${st}" ${st === selected ? 'selected' : ''}>${st}</option>`).join('');
}
const GROUP_COLORS = ['#6366f1', '#f59e0b', '#06b6d4', '#d946ef', '#84cc16', '#f97316', '#0ea5e9', '#8b5cf6', '#14b8a6', '#ec4899'];
const GROUPBY_KEY = `${STORAGE_KEY}_groupby`;
const COLLAPSED_KEY = `${STORAGE_KEY}_collapsed`;
let groupBy = 'group';
let collapsedGroups = new Set();

// Gantt Layout
const ROW_H = 56;
const GROUP_H = 40;

// Interactive Dependency Linking State (2D)
let linkingPredecessorId = null;
let linkingStartCoords = null;
let cachedBarPositions = {};
let cachedGroupPositions = {};

// -------------------------------------------------------------
// GENERAL APP & TASK LOGIC
// -------------------------------------------------------------
function initWorkspaceUI() {
  const headerTitle = document.getElementById('projectHeaderTitle');
  const badgeName = document.getElementById('workspaceBadgeName');
  const storageHint = document.getElementById('storageKeyHint');
  const dropdownTitle = document.getElementById('dropdownWorkspaceTitle');

  if (headerTitle) headerTitle.innerText = `Projekt: ${currentWorkspace.projectName}`;
  if (badgeName) badgeName.innerText = currentWorkspace.filename;
  if (storageHint) {
    storageHint.innerText = SERVER_MODE
      ? `Speicher: daten/${currentWorkspace.projectName}/tasks.json · Änderungsprotokoll aktiv`
      : `Key: ${currentWorkspace.storageKey} (nur in diesem Browser)`;
  }
  if (dropdownTitle) dropdownTitle.innerText = `Workspace: ${currentWorkspace.projectName}`;
  document.title = `${currentWorkspace.projectName} - Board & Gantt (2D & 3D)`;
}

// Abhängigkeiten werden als Array von Vorgänger-IDs gespeichert.
// Ältere Daten (ein einzelner String) werden beim Laden konvertiert.
function normalizeDeps(val) {
  if (Array.isArray(val)) return [...new Set(val.map(v => String(v).trim()).filter(Boolean))];
  if (!val) return [];
  return [...new Set(String(val).split(',').map(v => v.trim()).filter(Boolean))];
}

function normalizeTask(t) {
  return {
    ...t,
    group: (t.group || t.gruppe || '').trim(),
    startDate: t.startDate || t.deadline || toISO(new Date()),
    endDate: t.endDate || t.deadline || addDays(5),
    dependsOn: normalizeDeps(t.dependsOn || t.depends_on),
    progress: typeof t.progress === 'number' ? t.progress : (t.status === 'Erledigt' ? 100 : 0)
  };
}

function dropDanglingDeps() {
  const ids = new Set(tasks.map(t => t.id));
  tasks.forEach(t => { t.dependsOn = t.dependsOn.filter(id => ids.has(id) && id !== t.id); });
}

async function loadTasks() {
  initTheme();
  initWorkspaceUI();
  try {
    if (SERVER_MODE) {
      await loadTasksFromServer();
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        tasks = JSON.parse(stored).map(normalizeTask);
        dropDanglingDeps();
      } else {
        tasks = DEFAULT_TASKS.map(normalizeTask);
        saveTasks();
      }
    }
  } catch (e) {
    console.error('Fehler beim Laden:', e);
    tasks = DEFAULT_TASKS.map(normalizeTask);
  }
  if (SERVER_MODE) loadProjectMenu();

  try {
    groupBy = localStorage.getItem(GROUPBY_KEY) || 'group';
    collapsedGroups = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'));
  } catch (e) {
    groupBy = 'group';
    collapsedGroups = new Set();
  }
  document.getElementById('groupBySelect').value = groupBy;

  initGanttScrollSync();
  initGanttZoom();
  switchView('gantt');
  initAutoExtend();
  initHoverCard();
}

function saveViewState() {
  try {
    localStorage.setItem(GROUPBY_KEY, groupBy);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedGroups]));
  } catch (e) {}
}

// Linke Aufgabenliste und Timeline vertikal synchron scrollen
function initGanttScrollSync() {
  const left = document.getElementById('ganttLabelScroll');
  const right = document.getElementById('ganttTimelineWrapper');
  let lock = null;
  const sync = (src, dst) => () => {
    if (lock && lock !== src) return;
    lock = src;
    dst.scrollTop = src.scrollTop;
    requestAnimationFrame(() => { lock = null; });
  };
  left.addEventListener('scroll', sync(left, right));
  right.addEventListener('scroll', sync(right, left));
}

// -------------------------------------------------------------
// GROUPING
// -------------------------------------------------------------
function getGroupKey(t, mode = groupBy) {
  if (mode === 'phase') return t.phase || NO_PHASE;
  if (mode === 'status') return t.status || 'Offen';
  if (mode === 'group') return t.group || NO_GROUP;
  return null;
}

function getAllGroupNames() {
  const names = [];
  tasks.forEach(t => { if (t.group && !names.includes(t.group)) names.push(t.group); });
  return names;
}

// Liefert [{ key, tasks }] in stabiler Reihenfolge
function buildGroups(list, mode = groupBy) {
  if (mode === 'none') return [{ key: null, tasks: list }];
  const map = new Map();
  let order;
  if (mode === 'phase') order = PHASE_ORDER;
  else if (mode === 'status') order = STATUS_ORDER;
  else order = [...getAllGroupNames(), NO_GROUP];
  order.forEach(k => map.set(k, []));
  list.forEach(t => {
    const k = getGroupKey(t, mode);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  });
  return [...map.entries()].filter(([, ts]) => ts.length > 0).map(([key, ts]) => ({ key, tasks: ts }));
}

function getGroupColor(key) {
  if (groupBy === 'status') {
    return STATUS_COLORS[key] || '#64748b';
  }
  if (!key || key === NO_GROUP) return '#94a3b8';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

function collapseId(key) {
  return `${groupBy}:${key}`;
}

function isGroupCollapsed(key) {
  return key !== null && collapsedGroups.has(collapseId(key));
}

function toggleGroup(key, e) {
  if (e) e.stopPropagation();
  const id = collapseId(key);
  if (collapsedGroups.has(id)) collapsedGroups.delete(id); else collapsedGroups.add(id);
  saveViewState();
  render();
}

function toggleAllGroups() {
  const keys = buildGroups(getFilteredTasks()).map(g => g.key).filter(k => k !== null);
  const allCollapsed = keys.length > 0 && keys.every(k => isGroupCollapsed(k));
  keys.forEach(k => {
    if (allCollapsed) collapsedGroups.delete(collapseId(k)); else collapsedGroups.add(collapseId(k));
  });
  saveViewState();
  render();
}

function setGroupBy(mode) {
  groupBy = mode;
  saveViewState();
  render();
}

function renameGroup(oldName, e) {
  if (e) e.stopPropagation();
  if (oldName === NO_GROUP) return;
  const newName = (prompt(`Gruppe "${oldName}" umbenennen:`, oldName) || '').trim();
  if (!newName || newName === oldName) return;
  tasks.forEach(t => { if (t.group === oldName) t.group = newName; });
  if (collapsedGroups.delete(`group:${oldName}`)) collapsedGroups.add(`group:${newName}`);
  saveTasks();
  saveViewState();
  render();
  showToast(`Gruppe umbenannt: "${oldName}" ➔ "${newName}"`);
}

function addTaskToGroup(key, e) {
  if (e) e.stopPropagation();
  openTaskModal(false);
  if (groupBy === 'group') document.getElementById('taskGroup').value = key === NO_GROUP ? '' : key;
  if (groupBy === 'phase') document.getElementById('taskPhase').value = key === NO_PHASE ? '' : key;
  if (groupBy === 'status') {
    document.getElementById('taskStatus').value = key;
    syncStatusProgress();
  }
}

// Setzt das Feld, nach dem gerade gruppiert wird (Gruppe / Phase / Status)
function assignTaskToGroup(task, key) {
  if (groupBy === 'group' || groupBy === 'phase') task.quick = false;
  if (groupBy === 'group') task.group = key === NO_GROUP ? '' : key;
  else if (groupBy === 'phase') task.phase = key === NO_PHASE ? '' : key;
  else if (groupBy === 'status') setTaskStatus(task, key);
}

function populateGroupControls() {
  const names = getAllGroupNames();
  const datalist = document.getElementById('groupOptions');
  datalist.innerHTML = names.map(n => `<option value="${escapeHTML(n)}"></option>`).join('');
  const owners = [...new Set(tasks.map(t => t.owner).filter(Boolean))];
  document.getElementById('ownerOptions').innerHTML = owners.map(n => `<option value="${escapeHTML(n)}"></option>`).join('');

  const filter = document.getElementById('filterGroup');
  const current = filter.value;
  filter.innerHTML = '<option value="ALL">Alle Gruppen</option>' +
    names.map(n => `<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join('') +
    (tasks.some(t => !t.group) ? `<option value="${NO_GROUP}">${NO_GROUP}</option>` : '');
  filter.value = [...filter.options].some(o => o.value === current) ? current : 'ALL';

  // Phasen aus importierten Daten (z. B. "Fertigstellen") in Filter und Formular ergänzen
  const extraPhases = [...new Set(tasks.map(t => t.phase).filter(ph => ph && !PHASE_ORDER.includes(ph)))];
  const phaseFilter = document.getElementById('filterPhase');
  const phaseSelect = document.getElementById('taskPhase');
  const currentPhase = phaseFilter.value;
  phaseFilter.querySelectorAll('[data-dynamic]').forEach(o => o.remove());
  phaseSelect.querySelectorAll('[data-dynamic]').forEach(o => o.remove());
  [...extraPhases, ...(tasks.some(t => !t.phase) ? [NO_PHASE] : [])].forEach(ph => {
    phaseFilter.insertAdjacentHTML('beforeend', `<option data-dynamic value="${escapeHTML(ph)}">${escapeHTML(ph)}</option>`);
  });
  extraPhases.forEach(ph => {
    phaseSelect.insertAdjacentHTML('beforeend', `<option data-dynamic value="${escapeHTML(ph)}">${escapeHTML(ph)}</option>`);
  });
  phaseFilter.value = [...phaseFilter.options].some(o => o.value === currentPhase) ? currentPhase : 'ALL';
}

// reason: 'import' / 'reset' – der Server protokolliert dann "importiert" statt einzelner Feldänderungen
function saveTasks(reason) {
  try {
    // im Server-Modus nur Zwischenspeicher für den Fall, dass der Server nicht erreichbar ist
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    if (!SERVER_MODE) showToast('Speicherfehler im Browser', 'error');
  }
  if (SERVER_MODE) pushTasksToServer(reason);
}

// -------------------------------------------------------------
// SERVER (lokale Node-App)
// -------------------------------------------------------------
const SERVER_STAMP_FIELDS = ['createdAt', 'updatedAt', 'statusChangedAt', 'doneAt', 'blockedSince', 'prevStatus'];
let serverSaveInFlight = false;
let serverSavePending = false;
let serverPendingReason = '';
let serverOnline = null;

function apiUrl(resource, params) {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return `/api/projects/${encodeURIComponent(currentWorkspace.projectName)}/${resource}${query}`;
}

async function loadTasksFromServer() {
  try {
    const res = await fetch(apiUrl('tasks'), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setServerStatus(true);
    if (data.exists) {
      tasks = data.tasks.map(normalizeTask);
      dropDanglingDeps();
    } else {
      // neues Projekt: das Hauptprojekt startet mit Demodaten, weitere Projekte leer
      tasks = currentWorkspace.projectName === DEFAULT_SERVER_PROJECT ? DEFAULT_TASKS.map(normalizeTask) : [];
      saveTasks();
    }
  } catch (e) {
    setServerStatus(false);
    const cached = localStorage.getItem(STORAGE_KEY);
    tasks = cached ? JSON.parse(cached).map(normalizeTask) : [];
    showToast('Server nicht erreichbar – zuletzt bekannter Stand aus dem Browser geladen', 'error', { duration: 6000 });
  }
}

// Speichert den kompletten Stand; der Server protokolliert die Unterschiede mit Zeitstempel
async function pushTasksToServer(reason = '') {
  if (serverSaveInFlight) {
    serverSavePending = true;
    serverPendingReason = reason || serverPendingReason;
    return;
  }
  serverSaveInFlight = true;
  try {
    const body = JSON.stringify(tasks);
    const res = await fetch(apiUrl('tasks', reason ? { reason } : undefined), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60000
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // vom Server gesetzte Zeitstempel übernehmen
    const byId = new Map(data.tasks.map(t => [t.id, t]));
    tasks.forEach(t => {
      const s = byId.get(t.id);
      if (s) SERVER_STAMP_FIELDS.forEach(f => { if (s[f] !== undefined) t[f] = s[f]; });
    });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch (e) {}
    setServerStatus(true);
  } catch (e) {
    if (serverOnline !== false) showToast('Server nicht erreichbar – Änderung nur im Browser zwischengespeichert', 'error', { duration: 6000 });
    setServerStatus(false);
  } finally {
    serverSaveInFlight = false;
    if (serverSavePending) {
      const pendingReason = serverPendingReason;
      serverSavePending = false;
      serverPendingReason = '';
      pushTasksToServer(pendingReason);
    }
  }
}

function setServerStatus(online) {
  serverOnline = online;
  const badge = document.getElementById('workspaceBadge');
  const name = document.getElementById('workspaceBadgeName');
  if (!badge || !name) return;
  name.innerText = online ? `Server · ${currentWorkspace.projectName}` : 'Server offline';
  badge.title = online ? 'Gespeichert auf dem lokalen Server (mit Änderungsprotokoll)' : 'Lokaler Server nicht erreichbar – App (EXE) gestartet?';
  badge.classList.toggle('text-rose-600', !online);
  badge.classList.toggle('dark:text-rose-400', !online);
  badge.classList.toggle('bg-rose-500/10', !online);
  badge.classList.toggle('border-rose-500/30', !online);
}

async function loadProjectMenu() {
  const container = document.getElementById('projectMenu');
  if (!container) return;
  container.classList.remove('hidden');
  let projects = [];
  try {
    projects = await (await fetch('/api/projects', { cache: 'no-store' })).json();
  } catch (e) {}
  if (!projects.some(p => p.name === currentWorkspace.projectName)) projects.unshift({ name: currentWorkspace.projectName, tasks: tasks.length });
  document.getElementById('projectMenuList').innerHTML = projects.map(p => `
    <a href="?projekt=${encodeURIComponent(p.name)}" class="w-full text-left px-3.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 ${p.name === currentWorkspace.projectName ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''}">
      ${icon(p.name === currentWorkspace.projectName ? 'circle-check' : 'folder-open', 'w-4')}
      <span class="truncate flex-1">${escapeHTML(p.name)}</span>
      <span class="text-[10px] text-slate-400">${p.tasks}</span>
    </a>`).join('');
}

function createProject() {
  const name = (prompt('Name des neuen Projekts:') || '').trim();
  if (!name) return;
  location.href = `?projekt=${encodeURIComponent(name)}`;
}

// options: { duration, actionLabel, actionIcon, onAction } – z. B. für "Rückgängig"
let toastTimer = null;
function showToast(msg, type = 'success', options = {}) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMessage');
  const toastIcon = document.getElementById('toastIcon');
  const toastAction = document.getElementById('toastAction');

  toastMsg.innerText = msg;
  if (type === 'error') {
    setIcon(toastIcon, 'circle-alert', 'text-rose-400');
  } else if (type === 'info') {
    setIcon(toastIcon, 'clipboard-copy', 'text-indigo-300');
  } else {
    setIcon(toastIcon, 'circle-check', 'text-emerald-400');
  }

  const hide = () => toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
  if (options.onAction) {
    toastAction.innerHTML = `${options.actionIcon ? icon(options.actionIcon) : ''}${escapeHTML(options.actionLabel || 'OK')}`;
    toastAction.onclick = () => { hide(); options.onAction(); };
    toastAction.classList.remove('hidden');
  } else {
    toastAction.classList.add('hidden');
    toastAction.onclick = null;
  }

  toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, options.duration || (options.onAction ? 8000 : 2600));
}

function getFilteredTasks() {
  const query = document.getElementById('filterSearch').value.toLowerCase().trim();
  const phase = document.getElementById('filterPhase').value;
  const priority = document.getElementById('filterPriority').value;
  const status = document.getElementById('filterStatus').value;
  const group = document.getElementById('filterGroup').value;

  return tasks.filter(t => {
    const matchesQuery = !query ||
      t.title.toLowerCase().includes(query) ||
      (t.group && t.group.toLowerCase().includes(query)) ||
      (t.owner && t.owner.toLowerCase().includes(query)) ||
      (t.notes && t.notes.toLowerCase().includes(query)) ||
      (t.nextAction && t.nextAction.toLowerCase().includes(query));
    const matchesPhase = phase === 'ALL' || (t.phase || NO_PHASE) === phase;
    const matchesPriority = priority === 'ALL' || t.priority === priority;
    const matchesStatus = status === 'ALL' || t.status === status;
    const matchesGroup = group === 'ALL' || (t.group || NO_GROUP) === group;

    const matchesInbox = !inboxOnly || isInboxTask(t);

    return matchesQuery && matchesPhase && matchesPriority && matchesStatus && matchesGroup && matchesInbox;
  });
}

function applyFilters() {
  render();
}

function resetFilters() {
  document.getElementById('filterSearch').value = '';
  document.getElementById('filterPhase').value = 'ALL';
  document.getElementById('filterPriority').value = 'ALL';
  document.getElementById('filterStatus').value = 'ALL';
  document.getElementById('filterGroup').value = 'ALL';
  render();
}

function updateMetrics() {
  const total = tasks.length;
  const inProgress = tasks.filter(t => t.status === 'In Arbeit').length;
  const blocked = tasks.filter(t => t.status === 'Blockiert').length;
  const done = tasks.filter(t => t.status === 'Erledigt').length;
  const highOpen = tasks.filter(t => t.priority === 'Hoch' && !isClosed(t)).length;

  const avgProgress = total === 0 ? 0 : Math.round(tasks.reduce((acc, t) => acc + (t.progress || 0), 0) / total);

  document.getElementById('statTotal').innerText = total;
  document.getElementById('statInProgress').innerText = inProgress;
  document.getElementById('statBlocked').innerText = blocked;
  document.getElementById('statDone').innerText = done;

  document.getElementById('statPercentText').innerText = `${avgProgress}%`;
  document.getElementById('statProgressBar').style.width = `${avgProgress}%`;
  document.getElementById('statProgressRatio').innerText = `${done} von ${total} fertig`;
  document.getElementById('statHighPriorityOpen').innerText = `${highOpen} Prio-Hoch offen`;
}

function getPriorityBadge(prio) {
  if (prio === 'Hoch') {
    return `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 flex items-center gap-1 w-max"><svg class="icon text-[10px]" aria-hidden="true"><use href="#i-chevrons-up"></use></svg> Hoch</span>`;
  } else if (prio === 'Mittel') {
    return `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1 w-max"><svg class="icon text-[10px]" aria-hidden="true"><use href="#i-chevron-up"></use></svg> Mittel</span>`;
  }
  return `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 dark:bg-slate-700/40 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600/40 flex items-center gap-1 w-max"><svg class="icon text-[10px]" aria-hidden="true"><use href="#i-minus"></use></svg> Niedrig</span>`;
}

function getGroupBadge(group) {
  const color = getGroupColor(group);
  return `<span class="px-2 py-0.5 rounded-lg text-[10px] font-semibold border flex items-center gap-1 w-max" style="color:${color}; border-color:${color}66; background:${color}14;"><svg class="icon text-[9px]" aria-hidden="true"><use href="#i-group"></use></svg>${escapeHTML(group)}</span>`;
}

// Vorgänger-Chip mit Zustand der Abhängigkeit (freigegeben / wartet / Konflikt)
function getDependencyChip(pred, task, removable = false) {
  const state = getDependencyState(pred, task);
  const cls = {
    done: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
    wait: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border-indigo-500/25',
    conflict: 'text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/30'
  }[state];
  const iconName = { done: 'circle-check', wait: 'hourglass', conflict: 'triangle-alert' }[state];
  const prefix = { done: 'Freigegeben nach', wait: 'Wartet auf', conflict: 'Konflikt mit' }[state];
  return `
    <div class="text-[10px] ${cls} border px-2 py-0.5 rounded-md flex items-center gap-1.5 max-w-full" title="${prefix}: ${escapeHTML(pred.title)} (Ende ${formatDate(pred.endDate)})">
      ${icon(iconName, 'text-[9px] flex-shrink-0')}
      <span class="truncate">${prefix}: ${escapeHTML(pred.title)}</span>
      ${removable ? `<button onclick="removeDependency('${task.id}', '${pred.id}', event)" class="ml-auto hover:text-rose-500 p-0.5 opacity-60 hover:opacity-100" title="Verknüpfung aufheben"><svg class="icon text-[9px]" aria-hidden="true"><use href="#i-x"></use></svg></button>` : ''}
    </div>`;
}

function getPhaseBadge(phase) {
  if (!phase) return '';
  return `<span class="px-2 py-0.5 rounded-lg text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/80">${escapeHTML(phase || 'Konzept')}</span>`;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  if (!dateStr) return '<span class="text-slate-400 dark:text-slate-600">-</span>';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
  } catch (e) {}
  return dateStr;
}
