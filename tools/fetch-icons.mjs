// Lädt Lucide-Icons als SVG nach assets/icons/lucide/ (nur zur Entwicklungszeit –
// die App selbst lädt keine Icons aus dem Netz) und baut danach js/icons.js neu.
// Quelle ist das versionierte Paket "lucide-static" aus der npm-Registry; es wird
// ohne Zusatzpakete (nur Node-Bordmittel) entpackt.
// Icon-Namen siehe https://lucide.dev/icons/
//
// Aufruf: node tools/fetch-icons.mjs calendar flag rocket

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const LUCIDE_VERSION = '1.63.0';
const TARBALL = `https://registry.npmjs.org/lucide-static/-/lucide-static-${LUCIDE_VERSION}.tgz`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const names = process.argv.slice(2);
if (!names.length) {
  console.error('Bitte Icon-Namen angeben, z. B.: node tools/fetch-icons.mjs calendar flag');
  process.exit(1);
}

// Minimaler tar-Leser: 512-Byte-Header, Name in Byte 0–99, Präfix 345–499, Größe oktal in 124–135
function readTar(buf) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const str = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const name = (str(345, 155) ? str(345, 155) + '/' : '') + str(0, 100);
    const size = parseInt(str(124, 12).trim() || '0', 8);
    offset += 512;
    files.set(name, buf.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

let res;
try {
  res = await fetch(TARBALL);
} catch (e) {
  console.error(`Netzwerkfehler beim Laden von ${TARBALL}: ${e.message}`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`Download fehlgeschlagen (${res.status}) – ${TARBALL}`);
  process.exit(1);
}
const files = readTar(gunzipSync(Buffer.from(await res.arrayBuffer())));

let failed = 0;
for (const name of names) {
  const svg = files.get(`package/icons/${name}.svg`);
  if (!svg) {
    console.error(`✗ ${name} – gibt es in Lucide ${LUCIDE_VERSION} nicht (Name auf lucide.dev prüfen)`);
    failed++;
    continue;
  }
  writeFileSync(join(root, 'public/assets/icons/lucide', `${name}.svg`), svg);
  console.log(`✓ ${name}`);
}
writeFileSync(join(root, 'public/assets/icons/lucide/LICENSE'), files.get('package/LICENSE'));

execFileSync(process.execPath, [join(root, 'tools/build-icons.mjs')], { stdio: 'inherit' });
process.exit(failed ? 1 : 0);
