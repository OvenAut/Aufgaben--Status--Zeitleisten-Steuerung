'use strict';
// Projekt-Status-Board – lokaler Server
//
// - liefert die Web-App aus (von der Festplatte oder, in der EXE, aus den eingebetteten Dateien)
// - speichert die Aufgaben je Projekt als JSON in ./daten/<Projekt>/tasks.json (neben der EXE)
// - vergleicht bei jedem Speichern alt gegen neu und schreibt jede Änderung mit Zeitstempel
//   in ./daten/<Projekt>/history.jsonl – Grundlage für Tages- und Wochenbericht
// - legt pro Tag eine Sicherung ./daten/<Projekt>/backups/tasks_JJJJ-MM-TT.json an
//
// Nur Node-Bordmittel, keine Abhängigkeiten. Aufruf: node server/server.js [--port 3210] [--no-browser] [--data <ordner>]

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const APP_NAME = 'Projekt-Status-Board';
const APP_VERSION = '1.0.0';
const DEFAULT_PROJECT = 'Hauptprojekt';
const START_PAGE = 'projekt_status_aufgaben_board.html';
const MAX_BODY = 20 * 1024 * 1024;

// Felder, die nur Zeitstempel/Verwaltung sind und nicht als inhaltliche Änderung protokolliert werden
const UNTRACKED_FIELDS = new Set(['updatedAt', 'createdAt', 'statusChangedAt', 'doneAt', 'blockedSince', 'prevStatus']);

// -------------------------------------------------------------
// Aufrufparameter
// -------------------------------------------------------------
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};
const OPEN_BROWSER = !args.includes('--no-browser');
const PREFERRED_PORT = parseInt(argValue('--port') || process.env.PORT || '3210', 10);

// -------------------------------------------------------------
// Laufzeitumgebung: Single Executable (EXE) oder normales Node
// -------------------------------------------------------------
let sea = null;
try {
  sea = require('node:sea');
  if (!sea.isSea()) sea = null;
} catch (e) {
  sea = null;
}

const BASE_DIR = sea ? path.dirname(process.execPath) : path.join(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = resolveDataDir();

// Standard: Ordner "daten" neben der EXE. Ist der nicht beschreibbar (z. B. C:\Programme),
// wird auf %APPDATA%\Projekt-Status-Board\daten bzw. ~/.projekt-status-board/daten ausgewichen.
function resolveDataDir() {
  const explicit = argValue('--data') || process.env.BOARD_DATA_DIR;
  if (explicit) return path.resolve(explicit);
  const preferred = path.join(BASE_DIR, 'daten');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch (e) {
    const fallback = process.platform === 'win32'
      ? path.join(process.env.APPDATA || os.homedir(), 'Projekt-Status-Board', 'daten')
      : path.join(os.homedir(), '.projekt-status-board', 'daten');
    return fallback;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '': 'text/plain; charset=utf-8'
};

// Liest eine Datei der Web-App (relativ zu public/)
function readPublicFile(rel) {
  if (sea) {
    try {
      return Buffer.from(sea.getAsset(`public/${rel}`));
    } catch (e) {
      return null;
    }
  }
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return null;
  try {
    return fs.readFileSync(full);
  } catch (e) {
    return null;
  }
}

// -------------------------------------------------------------
// Datenablage
// -------------------------------------------------------------
function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Projektnamen auf einen sicheren Ordnernamen abbilden
function projectDir(name) {
  const safe = String(name || DEFAULT_PROJECT).trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').slice(0, 120) || DEFAULT_PROJECT;
  return path.join(DATA_DIR, safe);
}

function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function readTasks(project) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(projectDir(project), 'tasks.json'), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return null;
  }
}

function listProjects() {
  try {
    return fs.readdirSync(DATA_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(DATA_DIR, d.name, 'tasks.json')))
      .map(d => {
        const tasks = readTasks(d.name) || [];
        const stat = fs.statSync(path.join(DATA_DIR, d.name, 'tasks.json'));
        return { name: d.name, tasks: tasks.length, updatedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  } catch (e) {
    return [];
  }
}

function sameValue(a, b) {
  return JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
}

// Vergleicht alten und neuen Stand, setzt Zeitstempel (Serverzeit) und liefert die Protokolleinträge
function diffAndStamp(oldTasks, newTasks, nowIso, reason) {
  const bulk = reason === 'import' || reason === 'reset';
  const oldById = new Map(oldTasks.map(t => [t.id, t]));
  const newIds = new Set();
  const entries = [];

  newTasks.forEach(t => {
    newIds.add(t.id);
    const before = oldById.get(t.id);
    if (!before || (bulk && before.title !== t.title)) {
      // neu – oder beim Import eine andere Aufgabe mit zufällig gleicher ID.
      // Importierte Aufgaben behalten ihre eigenen Zeitstempel; fehlende werden nicht mit "jetzt"
      // erfunden, sonst erschienen alte Aufgaben im Tagesbericht als heute angelegt / erledigt.
      if (!bulk) {
        t.createdAt = t.createdAt || nowIso;
        if (!t.statusChangedAt) t.statusChangedAt = nowIso;
        if (t.status === 'Erledigt' && !t.doneAt) t.doneAt = nowIso;
        if (t.status === 'Blockiert' && !t.blockedSince) t.blockedSince = nowIso;
      }
      t.updatedAt = nowIso;
      entries.push({ ts: nowIso, taskId: t.id, title: t.title, action: bulk ? 'importiert' : 'erstellt', changes: [{ field: 'status', from: null, to: t.status }] });
      return;
    }

    // vom Server vergebene Zeitstempel bleiben erhalten, auch wenn der Client sie nicht mitschickt
    UNTRACKED_FIELDS.forEach(field => {
      if (t[field] === undefined && before[field] !== undefined) t[field] = before[field];
    });

    const changes = [];
    new Set([...Object.keys(before), ...Object.keys(t)]).forEach(field => {
      if (UNTRACKED_FIELDS.has(field)) return;
      if (!sameValue(before[field], t[field])) changes.push({ field, from: before[field] ?? null, to: t[field] ?? null });
    });
    if (!changes.length) return;
    if (bulk) {
      entries.push({ ts: nowIso, taskId: t.id, title: t.title, action: 'importiert', changes: [] });
      return;
    }

    t.updatedAt = nowIso;
    if (changes.some(c => c.field === 'status')) {
      // Statuswechsel immer mit Serverzeit festhalten
      t.prevStatus = before.status || '';
      t.statusChangedAt = nowIso;
      t.doneAt = t.status === 'Erledigt' ? (before.status === 'Erledigt' ? before.doneAt : nowIso) : '';
      t.blockedSince = t.status === 'Blockiert' ? (before.status === 'Blockiert' ? before.blockedSince : nowIso) : '';
    }
    entries.push({ ts: nowIso, taskId: t.id, title: t.title, action: 'geändert', changes });
  });

  oldTasks.forEach(t => {
    if (!newIds.has(t.id)) entries.push({ ts: nowIso, taskId: t.id, title: t.title, action: 'gelöscht', changes: [] });
  });
  return entries;
}

function saveTasks(project, newTasks, reason) {
  const dir = projectDir(project);
  const file = path.join(dir, 'tasks.json');
  const oldTasks = readTasks(project) || [];
  const nowIso = new Date().toISOString();
  const entries = diffAndStamp(oldTasks, newTasks, nowIso, reason);

  // Tagessicherung: der erste Stand des Tages bleibt erhalten
  const backup = path.join(dir, 'backups', `tasks_${localDay()}.json`);
  if (oldTasks.length && !fs.existsSync(backup)) writeFileAtomic(backup, JSON.stringify(oldTasks, null, 2));

  writeFileAtomic(file, JSON.stringify(newTasks, null, 2));
  if (entries.length) {
    fs.appendFileSync(path.join(dir, 'history.jsonl'), entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  }
  return { tasks: newTasks, logged: entries.length };
}

function readHistory(project, from, to) {
  let lines;
  try {
    lines = fs.readFileSync(path.join(projectDir(project), 'history.jsonl'), 'utf8').split('\n');
  } catch (e) {
    return [];
  }
  const out = [];
  lines.forEach(line => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line);
      const day = localDay(new Date(e.ts));
      if ((!from || day >= from) && (!to || day <= to)) out.push(e);
    } catch (err) { /* defekte Zeile überspringen */ }
  });
  return out;
}

// -------------------------------------------------------------
// HTTP
// -------------------------------------------------------------
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Anfrage zu groß'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]

  if (parts[1] === 'health') {
    return sendJson(res, 200, { ok: true, app: APP_NAME, version: APP_VERSION, dataDir: DATA_DIR });
  }
  if (parts[1] === 'projects' && parts.length === 2 && req.method === 'GET') {
    return sendJson(res, 200, listProjects());
  }
  if (parts[1] === 'projects' && parts.length === 4) {
    const project = parts[2];
    if (parts[3] === 'tasks' && req.method === 'GET') {
      const tasks = readTasks(project);
      return sendJson(res, 200, { project, exists: tasks !== null, tasks: tasks || [] });
    }
    if (parts[3] === 'tasks' && req.method === 'PUT') {
      let tasks;
      try {
        tasks = JSON.parse(await readBody(req));
      } catch (e) {
        return sendJson(res, 400, { error: 'Ungültiges JSON' });
      }
      if (!Array.isArray(tasks) || tasks.some(t => !t || typeof t !== 'object' || !t.id)) {
        return sendJson(res, 400, { error: 'Erwartet wird eine Liste von Aufgaben mit "id"' });
      }
      return sendJson(res, 200, saveTasks(project, tasks, url.searchParams.get('reason')));
    }
    if (parts[3] === 'history' && req.method === 'GET') {
      return sendJson(res, 200, readHistory(project, url.searchParams.get('from'), url.searchParams.get('to')));
    }
  }
  return sendJson(res, 404, { error: 'Unbekannte API-Adresse' });
}

function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!rel) rel = START_PAGE;
  if (rel.split('/').includes('..')) {
    res.writeHead(400);
    return res.end();
  }
  const content = readPublicFile(rel);
  if (!content) {
    res.writeHead(404, { 'Content-Type': MIME[''] });
    return res.end('Nicht gefunden');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else handleStatic(req, res, url);
  } catch (e) {
    console.error('Fehler:', e);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
  }
});

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
function openBrowser(url) {
  if (!OPEN_BROWSER) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) { /* Browser von Hand öffnen */ }
}

// Läuft auf dem Port schon ein Board? Dann nur den Browser öffnen.
function probeExisting(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 800 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).app === APP_NAME); } catch (e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function listen(port, attempts = 10) {
  server.once('error', async err => {
    if (err.code === 'EADDRINUSE' && attempts > 0) {
      if (await probeExisting(port)) {
        const url = `http://127.0.0.1:${port}/`;
        console.log(`${APP_NAME} läuft bereits: ${url}`);
        openBrowser(url);
        setTimeout(() => process.exit(0), 500);
        return;
      }
      listen(port + 1, attempts - 1);
      return;
    }
    console.error('Server konnte nicht gestartet werden:', err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('');
    console.log(`  ${APP_NAME} ${APP_VERSION}`);
    console.log(`  Board:  ${url}`);
    console.log(`  Daten:  ${DATA_DIR}`);
    console.log('');
    console.log('  Dieses Fenster offen lassen. Zum Beenden schließen oder Strg+C drücken.');
    openBrowser(url);
  });
}

listen(PREFERRED_PORT);
