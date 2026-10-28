// Baut js/icons.js aus allen SVGs in assets/icons/lucide/.
// Die Icons landen als <symbol id="i-NAME"> in einem unsichtbaren Sprite und werden mit
//   <svg class="icon"><use href="#i-NAME"></use></svg>   bzw. icon('NAME') in JS
// verwendet. So funktioniert alles ohne CDN und auch beim Öffnen per file://.
//
// Aufruf: node tools/build-icons.mjs

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = join(root, 'assets/icons/lucide');
const outFile = join(root, 'js/icons.js');

const files = readdirSync(iconDir).filter(f => f.endsWith('.svg')).sort();
const symbols = files.map(file => {
  const name = file.slice(0, -4);
  const svg = readFileSync(join(iconDir, file), 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').match(/<svg[^>]*>([\s\S]*?)<\/svg>/)[1];
  const body = inner.split('\n').map(l => l.trim()).filter(Boolean).join('');
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`;
});

const out = `// AUTOMATISCH ERZEUGT von tools/build-icons.mjs – nicht von Hand bearbeiten.
// Quelle: Lucide Icons (https://lucide.dev, ISC-Lizenz, siehe assets/icons/lucide/LICENSE)
// ${files.length} Icons aus assets/icons/lucide/

(function () {
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">' +
${symbols.map(s => `    '${s}' +`).join('\n')}
    '</svg>';
  const inject = () => document.body.insertAdjacentHTML('afterbegin', sprite);
  if (document.body) inject(); else document.addEventListener('DOMContentLoaded', inject);
})();

// Liefert das Markup für ein Icon, z. B. icon('plus', 'text-xs text-emerald-500')
function icon(name, cls = '') {
  return \`<svg class="icon \${cls}" aria-hidden="true"><use href="#i-\${name}"></use></svg>\`;
}

// Tauscht Icon und Klassen eines vorhandenen <svg class="icon"> aus
function setIcon(el, name, cls = '') {
  if (!el) return;
  el.setAttribute('class', \`icon \${cls}\`);
  el.innerHTML = \`<use href="#i-\${name}"></use>\`;
}
`;
writeFileSync(outFile, out);
console.log(`js/icons.js geschrieben (${files.length} Icons)`);
