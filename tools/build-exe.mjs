// Baut das Board als eigenständige Programmdatei (Node "Single Executable Application").
// Die Web-App (public/) wird in die Datei eingebettet; Daten landen beim Start im Ordner "daten" daneben.
//
//   node tools/build-exe.mjs --target win-x64     -> dist/Projekt-Status-Board.exe
//   node tools/build-exe.mjs --target linux-x64   -> dist/projekt-status-board
//
// Für ein fremdes Zielsystem wird die passende Node-Laufzeit (gleiche Version wie das bauende Node)
// von nodejs.org geladen, per SHA-256 geprüft und unter build/ zwischengespeichert.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { inject } from 'postject';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const distDir = join(root, 'dist');
const args = process.argv.slice(2);
const target = args[args.indexOf('--target') + 1] || `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const version = process.version; // z. B. v22.22.0
const [platform] = target.split('-');
const isWindows = platform === 'win';
const outName = isWindows ? 'Projekt-Status-Board.exe' : 'projekt-status-board';
const current = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;

mkdirSync(buildDir, { recursive: true });
mkdirSync(distDir, { recursive: true });

// 1) alle Dateien der Web-App als Assets einbetten
function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const assets = {};
walk(join(root, 'public')).forEach(file => {
  assets[relative(root, file).split(sep).join('/')] = file;
});
console.log(`• ${Object.keys(assets).length} Dateien der Web-App werden eingebettet`);

// 2) SEA-Blob erzeugen
const blob = join(buildDir, 'sea-prep.blob');
const seaConfig = join(buildDir, 'sea-config.json');
writeFileSync(seaConfig, JSON.stringify({
  main: join(root, 'server/server.js'),
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false, // Pflicht, wenn für ein anderes Betriebssystem gebaut wird
  assets
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 3) Node-Laufzeit für das Ziel besorgen
async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function readTarEntry(buf, wanted) {
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const str = (s, l) => header.subarray(s, s + l).toString('utf8').replace(/\0.*$/s, '');
    const name = (str(345, 155) ? str(345, 155) + '/' : '') + str(0, 100);
    const size = parseInt(str(124, 12).trim() || '0', 8);
    offset += 512;
    if (name === wanted) return buf.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} nicht im Archiv gefunden`);
}

async function getNodeBinary() {
  if (target === current) return process.execPath;
  const cached = join(buildDir, `node-${version}-${target}${isWindows ? '.exe' : ''}`);
  if (existsSync(cached)) return cached;

  const base = `https://nodejs.org/dist/${version}`;
  const file = isWindows ? `win-${target.split('-')[1]}/node.exe` : `node-${version}-${target}.tar.gz`;
  console.log(`• lade Node ${version} für ${target} …`);
  const [data, shasums] = await Promise.all([download(`${base}/${file}`), download(`${base}/SHASUMS256.txt`)]);
  const expected = shasums.toString().split('\n').find(l => l.trim().endsWith(`  ${file}`))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(data).digest('hex');
  if (!expected || expected !== actual) throw new Error(`Prüfsumme stimmt nicht für ${file}`);
  console.log('• Prüfsumme (SHA-256) ok');

  const binary = isWindows ? data : readTarEntry(gunzipSync(data), `node-${version}-${target}/bin/node`);
  writeFileSync(cached, binary);
  return cached;
}

// Die offizielle node.exe ist signiert; durch das Einbetten würde die Signatur ungültig.
// Eine kaputte Signatur ist schlechter als keine (Virenscanner), daher wird sie vorher entfernt.
function stripAuthenticode(buf) {
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') throw new Error('Keine gültige PE-Datei');
  const optional = peOffset + 24;
  const magic = buf.readUInt16LE(optional);
  const dataDirs = optional + (magic === 0x20b ? 112 : 96);
  const certEntry = dataDirs + 4 * 8; // Eintrag 4 = Certificate Table
  const certOffset = buf.readUInt32LE(certEntry);
  const certSize = buf.readUInt32LE(certEntry + 4);
  if (!certOffset || !certSize) return buf;
  buf.writeUInt32LE(0, certEntry);
  buf.writeUInt32LE(0, certEntry + 4);
  buf.writeUInt32LE(0, optional + 64); // Prüfsumme des Headers
  return certOffset + certSize === buf.length ? buf.subarray(0, certOffset) : buf;
}

const nodeBinary = await getNodeBinary();
const out = join(distDir, outName);
if (isWindows) {
  writeFileSync(out, stripAuthenticode(readFileSync(nodeBinary)));
  console.log('• Signatur der Node-Laufzeit entfernt (wird durch das Einbetten ungültig)');
} else {
  copyFileSync(nodeBinary, out);
  chmodSync(out, 0o755);
}

// 4) Blob in die Laufzeit injizieren
await inject(out, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  machoSegmentName: platform === 'darwin' ? 'NODE_SEA' : undefined
});

const sizeMb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ ${relative(root, out)} (${sizeMb} MB) – Node ${version}, Ziel ${target}`);
if (isWindows) console.log('  Hinweis: Die EXE ist nicht signiert – Windows SmartScreen fragt beim ersten Start nach („Weitere Informationen“ → „Trotzdem ausführen“).');
