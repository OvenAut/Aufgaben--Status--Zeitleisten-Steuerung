// Vergleichstest: schickt dem Node-Server (server/server.js) und dem C#-Nachbau (desktop/DevHost)
// dieselben Anfragen und vergleicht Antworten sowie gespeicherte Dateien (Zeitstempel ausgenommen).
// Aufruf: node desktop/tests/parity.mjs <daten-node> <daten-net> [node-url] [net-url]
import fs from 'node:fs';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const norm = v => JSON.parse(JSON.stringify(v, (k, x) => {
  if (typeof x === 'string' && ISO.test(x)) return '<ts>';
  if (k === 'dataDir' || k === 'trash' || k === 'updatedAt' && typeof x === 'string') return '<x>';
  return x;
}));
async function run(base) {
  const out = [];
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    let data; const text = await res.text(); try { data = JSON.parse(text); } catch { data = text; }
    if (data && data.version) data.version = '<v>';
    out.push([method, path, res.status, norm(data)]);
    return data;
  };
  await call('GET', '/api/health');
  await call('GET', '/api/projects/Hauptprojekt/tasks');
  await call('PUT', '/api/projects/Hauptprojekt/tasks', [{ id: 'a', title: 'Klopfer prüfen', status: 'Offen', progress: 0, dependsOn: [] }, { id: 'b', title: 'Blocker', status: 'Blockiert', notes: '' }]);
  await call('PUT', '/api/projects/Hauptprojekt/tasks', [{ id: 'a', title: 'Klopfer prüfen ✓', status: 'Erledigt', progress: 100, dependsOn: ['b'] }, { id: 'b', title: 'Blocker', status: 'Blockiert' }, { id: 'c', title: 'Neu', status: 'Erledigt' }]);
  await call('PUT', '/api/projects/Hauptprojekt/tasks', [{ id: 'a', title: 'Klopfer prüfen ✓', status: 'In Arbeit', progress: 50, dependsOn: ['b'] }, { id: 'c', title: 'Neu', status: 'Erledigt' }]);
  await call('PUT', '/api/projects/Hauptprojekt/tasks?reason=import', [{ id: 'a', title: 'Ganz anders', status: 'Offen' }, { id: 'z', title: 'Import Z', status: 'Erledigt' }, { id: 'c', title: 'Neu', status: 'Abgebrochen' }]);
  await call('PUT', '/api/projects/Hauptprojekt/tasks', [{ id: 'a', title: 'Ganz anders', status: 'Offen' }]);   // ohne Zeitstempel geschickt
  await call('PUT', '/api/projects/Hauptprojekt/tasks', 'kein json');
  await call('PUT', '/api/projects/Hauptprojekt/tasks', [{ title: 'ohne id' }]);
  await call('PUT', '/api/projects/Linie%202/tasks', [{ id: 'l', title: 'Linie', status: 'Offen' }]);
  await call('GET', '/api/projects');
  await call('GET', '/api/projects/Hauptprojekt/history?from=2000-01-01&to=2100-01-01');
  await call('GET', '/api/projects/Hauptprojekt/tasks');
  await call('GET', '/api/projects/_papierkorb/tasks');
  await call('DELETE', '/api/projects/Linie%202');
  await call('DELETE', '/api/projects/gibtsnicht');
  await call('GET', '/api/projects');
  await call('GET', '/api/projects/Neu/tasks');
  await call('GET', '/api/unbekannt');
  return out;
}
const [a, b] = await Promise.all([run(process.argv[4] || 'http://127.0.0.1:3401'), run(process.argv[5] || 'http://127.0.0.1:3402')]);
let diffs = 0;
a.forEach((x, i) => {
  const sa = JSON.stringify(x), sb = JSON.stringify(b[i]);
  if (sa !== sb) { diffs++; console.log('DIFF', x[0], x[1], '\n node:', sa.slice(0, 700), '\n .net:', sb.slice(0, 700)); }
});
console.log(`${a.length} Aufrufe verglichen, ${diffs} Unterschiede`);
let failed = diffs > 0;
// Dateien vergleichen
const file = (root, p) => { try { return fs.readFileSync(`${root}/${p}`, 'utf8'); } catch { return null; } };
for (const p of ['Hauptprojekt/tasks.json', 'Hauptprojekt/history.jsonl']) {
  const fa = file(process.argv[2], p), fb = file(process.argv[3], p);
  const n = t => t && t.split('\n').filter(Boolean).length > 1 && p.endsWith('jsonl') ? t.split('\n').filter(Boolean).map(l => JSON.stringify(norm(JSON.parse(l)))).join('\n') : JSON.stringify(norm(JSON.parse(t)));
  const same = fa.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>') === fb.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>');
  if (!same) failed = true;
  console.log(p, 'identisch (bis auf Zeitstempel):', same);
}
console.log('backups node/net:', fs.readdirSync(`${process.argv[2]}/Hauptprojekt/backups`).join(), '/', fs.readdirSync(`${process.argv[3]}/Hauptprojekt/backups`).join());
console.log('papierkorb node/net:', fs.readdirSync(`${process.argv[2]}/_papierkorb`).map(n => n.replace(/_\d.*/, '')).join(), '/', fs.readdirSync(`${process.argv[3]}/_papierkorb`).map(n => n.replace(/_\d.*/, '')).join());

process.exit(failed ? 1 : 0);
