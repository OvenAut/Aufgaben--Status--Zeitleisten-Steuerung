// KI-Rechtschreibprüfung über die Zwischenablage
// Hinweg: Prompt + JSON der Aufgabentexte kopieren -> in ChatGPT / Claude / Gemini einfügen.
// Rückweg: Antwort der KI kopieren -> "KI-Korrektur" übernimmt die Texte (Zuordnung über die Aufgaben-ID).
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

const AI_AUTOCOPY_KEY = 'project_board_ai_autocopy';

// Aufgabenfeld <-> JSON-Schlüssel für die KI (deutsch, damit die KI den Inhalt versteht)
const PROOFREAD_FIELDS = [
  { field: 'title', key: 'titel', input: 'taskTitle' },
  { field: 'nextAction', key: 'naechsterSchritt', input: 'taskNextAction' },
  { field: 'notes', key: 'notizen', input: 'taskNotes' },
  { field: 'blockReason', key: 'blockiergrund', input: null }
];

let proofreadPasteTarget = null; // 'form' | 'tasks' – Ziel des Einfüge-Dialogs

function isAiAutoCopy() {
  try { return localStorage.getItem(AI_AUTOCOPY_KEY) !== 'false'; } catch (e) { return true; }
}

function setAiAutoCopy(on) {
  try { localStorage.setItem(AI_AUTOCOPY_KEY, on ? 'true' : 'false'); } catch (e) {}
}

// -------------------------------------------------------------
// PROMPT
// -------------------------------------------------------------
function buildProofreadPrompt(items) {
  const payload = { typ: 'rechtschreibpruefung', aufgaben: items };
  return `Du bist Fachlektor für technische Projektdokumentation in der industriellen Automatisierungstechnik
(Sondermaschinenbau, Anlagenbau, SPS-Programmierung z. B. Siemens TIA Portal, HMI / WinCC Unified, Robotik,
Bildverarbeitung, Sensorik / Aktorik, Inbetriebnahme). Die folgenden Texte stammen aus den Aufgaben eines
Automatisierungsprojekts ("${currentWorkspace.projectName}").

AUFGABE
Prüfe alle Textfelder auf Rechtschreibung, Grammatik und Zeichensetzung (deutsche Rechtschreibung) und korrigiere sie.

REGELN
- Inhalt und Bedeutung nicht verändern, nichts hinzufügen und nichts weglassen.
- Fachbegriffe und Anglizismen der Automatisierungstechnik (z. B. Handshake, Teachen, Override, Faceplate, Feeder) beibehalten.
- Anlagen-, Stations- und Funktionsgruppenbezeichnungen (z. B. FG14, Roboter 2), Variablen-, Signal- und Bausteinnamen
  (z. B. xReqDeletePresent, DB, FB, OB), Hersteller-, Produkt- und Personennamen sowie Zahlen und Einheiten exakt beibehalten.
- Sachlichen, knappen Technikstil beibehalten. Titel kurz halten, keine ganzen Sätze erzwingen.
- Offensichtliche Tippfehler korrigieren (z. B. fehlende Buchstaben), fehlende Satzzeichen ergänzen.
- Die Felder "id" und "kontext" niemals ändern ("kontext" dient nur zur Information). Leere Felder leer lassen.

ANTWORTFORMAT
Antworte ausschließlich mit gültigem JSON in exakt derselben Struktur wie unten (gleiche Schlüssel), ohne
Markdown-Codeblock und ohne Erklärtext. Ergänze in jedem Objekt der Liste "aufgaben" das Feld "aenderungen":
eine Liste kurzer Stichpunkte, was korrigiert wurde (leere Liste, wenn nichts zu ändern war).

${JSON.stringify(payload, null, 2)}`;
}

function taskToProofreadItem(t) {
  const item = { id: t.id };
  const ctx = [t.group && `Gruppe: ${t.group}`, t.phase && `Phase: ${t.phase}`, t.status && `Status: ${t.status}`].filter(Boolean).join(' · ');
  if (ctx) item.kontext = ctx;
  PROOFREAD_FIELDS.forEach(({ field, key }) => {
    if (field === 'blockReason' && !t.blockReason) return;
    item[key] = t[field] || '';
  });
  return item;
}

// -------------------------------------------------------------
// ZWISCHENABLAGE
// -------------------------------------------------------------
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Fallback für Browser ohne Clipboard-API-Freigabe
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) {}
    ta.remove();
    return ok;
  }
}

async function readClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText();
  } catch (e) {}
  return null;
}

async function copyProofreadPrompt(items, label) {
  const ok = await copyToClipboard(buildProofreadPrompt(items));
  if (ok) {
    showToast(`${label} – Prüf-Prompt kopiert. In die KI einfügen, Antwort kopieren und „KI-Korrektur“ klicken.`, 'info', { duration: 6000 });
  } else {
    showToast('Kopieren in die Zwischenablage nicht möglich', 'error');
  }
}

// -------------------------------------------------------------
// HINWEG: kopieren
// -------------------------------------------------------------
function copyProofreadForForm() {
  const id = document.getElementById('taskId').value;
  const existing = id ? getTask(id) : null;
  const item = { id: id || 'neu' };
  PROOFREAD_FIELDS.forEach(({ field, key, input }) => {
    if (input) item[key] = document.getElementById(input).value;
    else if (existing && existing[field]) item[key] = existing[field];
  });
  if (!item.titel.trim()) {
    showToast('Bitte zuerst einen Titel eingeben', 'error');
    return;
  }
  copyProofreadPrompt([item], 'Formular');
}

function copyProofreadForTask(task) {
  copyProofreadPrompt([taskToProofreadItem(task)], `"${task.title}"`);
}

function copyProofreadForFilteredTasks() {
  toggleMenu();
  const list = getFilteredTasks();
  if (!list.length) {
    showToast('Keine Aufgaben im aktuellen Filter', 'error');
    return;
  }
  copyProofreadPrompt(list.map(taskToProofreadItem), `${list.length} Aufgabe(n)`);
}

// -------------------------------------------------------------
// RÜCKWEG: KI-Antwort einlesen
// -------------------------------------------------------------
// Akzeptiert { aufgaben: [...] }, ein Array oder ein einzelnes Objekt – auch mit ```json-Umrandung oder Begleittext
function parseProofreadResponse(text) {
  if (!text) return null;
  let raw = text.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = raw.search(/[\[{]/);
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.aufgaben) ? parsed.aufgaben : [parsed]);
    const valid = items.filter(it => it && typeof it === 'object' && PROOFREAD_FIELDS.some(({ key }) => typeof it[key] === 'string'));
    return valid.length ? valid : null;
  } catch (e) {
    return null;
  }
}

async function getProofreadItems(target) {
  const items = parseProofreadResponse(await readClipboard());
  if (items) return items;
  // Zwischenablage nicht lesbar oder kein passendes JSON -> Einfügen von Hand
  proofreadPasteTarget = target;
  document.getElementById('proofreadPasteInput').value = '';
  document.getElementById('proofreadPasteModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('proofreadPasteInput').focus(), 50);
  return null;
}

function closeProofreadPasteModal() {
  document.getElementById('proofreadPasteModal').classList.add('hidden');
  proofreadPasteTarget = null;
}

function confirmProofreadPaste() {
  const items = parseProofreadResponse(document.getElementById('proofreadPasteInput').value);
  if (!items) {
    showToast('Kein gültiges JSON der KI gefunden', 'error');
    return;
  }
  const target = proofreadPasteTarget;
  closeProofreadPasteModal();
  if (target === 'form') fillFormFromProofread(items);
  else applyProofreadToTasks(items);
}

// Kopfzeile / Menü: ist das Formular offen, dorthin – sonst direkt in die Aufgaben
async function applyProofreadFromClipboard() {
  const menu = document.getElementById('dropdownMenu');
  if (menu && !menu.classList.contains('hidden')) menu.classList.add('hidden');
  if (!document.getElementById('taskModal').classList.contains('hidden')) {
    applyProofreadToForm();
    return;
  }
  const items = await getProofreadItems('tasks');
  if (items) applyProofreadToTasks(items);
}

async function applyProofreadToForm() {
  const items = await getProofreadItems('form');
  if (items) fillFormFromProofread(items);
}

function fillFormFromProofread(items) {
  const id = document.getElementById('taskId').value || 'neu';
  const item = items.find(it => it.id === id) || items[0];
  let changed = 0;
  PROOFREAD_FIELDS.forEach(({ key, input }) => {
    if (!input || typeof item[key] !== 'string') return;
    const el = document.getElementById(input);
    if (el.value === item[key]) return;
    el.value = item[key];
    changed++;
    // geänderte Felder kurz hervorheben
    el.classList.add('ring-2', 'ring-indigo-400');
    setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-400'), 2500);
  });
  showToast(changed ? `${changed} Feld(er) korrigiert${describeChanges(item)} – zum Übernehmen speichern` : 'Keine Änderungen – Texte waren bereits korrekt');
}

function applyProofreadToTasks(items) {
  const undo = [];
  let changedFields = 0;
  let unknown = 0;
  items.forEach(item => {
    const task = getTask(item.id);
    if (!task) {
      unknown++;
      return;
    }
    const before = {};
    PROOFREAD_FIELDS.forEach(({ field, key }) => {
      if (typeof item[key] !== 'string' || (task[field] || '') === item[key]) return;
      if (field === 'title' && !item[key].trim()) return;
      before[field] = task[field];
      task[field] = item[key];
      changedFields++;
    });
    if (Object.keys(before).length) undo.push({ id: task.id, before });
  });

  if (!undo.length) {
    showToast(unknown ? `Keine passende Aufgabe gefunden (${unknown} unbekannte ID)` : 'Keine Änderungen – Texte waren bereits korrekt', unknown ? 'error' : 'success');
    return;
  }
  saveTasks();
  render();
  const single = items.length === 1 ? describeChanges(items[0]) : '';
  showToast(`${changedFields} Feld(er) in ${undo.length} Aufgabe(n) korrigiert${single}${unknown ? ` · ${unknown} unbekannt` : ''}`, 'success', {
    actionLabel: 'Rückgängig',
    actionIcon: 'undo-2',
    onAction: () => {
      undo.forEach(({ id, before }) => Object.assign(getTask(id) || {}, before));
      saveTasks();
      render();
      showToast('KI-Korrektur rückgängig gemacht');
    }
  });
}

function describeChanges(item) {
  const list = Array.isArray(item.aenderungen) ? item.aenderungen.filter(Boolean) : [];
  if (!list.length) return '';
  const shown = list.slice(0, 3).join('; ');
  return `: ${shown}${list.length > 3 ? ' …' : ''}`;
}
