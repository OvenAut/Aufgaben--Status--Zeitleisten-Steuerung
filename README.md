# Projekt Status & Aufgaben Board

Aufgaben-, Status- und Zeitleisten-Steuerung mit Gantt-Chart, Kanban und Tabelle.
Läuft komplett im Browser – einfach `projekt_status_aufgaben_board.html` öffnen (Doppelklick genügt, kein Server nötig).

## Funktionen

- **Gantt-Chart** mit stufenlosem Zoom (Lupen-Knöpfe oder Strg/⌘ + Mausrad, Voreinstellungen Tage … Jahr)
- **Gruppen** (Gruppe / Phase / Status) mit einklappbaren Sammelbalken, Drag & Drop zwischen Gruppen
- **Abhängigkeiten** Ende → Anfang, mehrere Vorgänger je Aufgabe, farbige Verbindungen
  (freigegeben / wartet / Konflikt), Konflikte automatisch auflösbar
- **Kanban** und **Tabelle**, Filter, Suche, Meilensteine, Verantwortliche
- Export/Import als JSON, CSV-Export, KI-Schnellimport per Prompt-Vorlage

Die Daten liegen im `localStorage` des Browsers. Der Speicherschlüssel wird aus dem
Dateinamen der HTML-Datei abgeleitet – eine Kopie mit anderem Namen ist ein eigenes Projekt.

## Aufbau

```
projekt_status_aufgaben_board.html   Markup
css/board.css                        eigene Styles (inkl. .icon)
js/tailwind.config.js                Tailwind-Konfiguration
js/icons.js                          Lucide-Icon-Sprite (automatisch erzeugt)
js/core.js                           Zustand, Laden/Speichern, Gruppierung, Filter, Badges
js/dependencies.js                   Abhängigkeiten, Verknüpfen, Hervorhebung, Zeilen-Drag & Drop
js/gantt.js                          Gantt-Zeichnung, Verbindungspfeile, Zoom
js/views.js                          Ansichtswechsel, Kanban, Tabelle
js/dialogs.js                        Aufgaben-Formular, Menü, Import/Export, KI-Import
js/main.js                           Start
assets/icons/lucide/                 heruntergeladene Lucide-SVGs + Lizenz
tools/                               Hilfsskripte für die Icons
```

Die Scripts sind bewusst klassische `<script>`-Dateien (keine ES-Module), weil Browser
ES-Module beim Öffnen per `file://` blockieren. Sie teilen sich den globalen Scope;
die Reihenfolge der `<script>`-Tags in der HTML-Datei ist daher wichtig.

## Icons (Lucide)

Die Icons stammen von [lucide.dev](https://lucide.dev/icons/) (ISC-Lizenz) und liegen als SVG
im Repository – zur Laufzeit wird nichts aus einem CDN geladen. `js/icons.js` bündelt sie als
SVG-Sprite; verwendet werden sie so:

```html
<svg class="icon text-emerald-500"><use href="#i-plus"></use></svg>
```

```js
icon('plus', 'text-xs text-emerald-500')   // liefert das Markup als String
setIcon(element, 'check', 'text-emerald-300') // tauscht ein vorhandenes Icon aus
```

Größe und Farbe richten sich wie bei Schrift nach `font-size` und `color` (`text-xs`, `text-rose-500` …).

Neues Icon hinzufügen (Name von lucide.dev, benötigt Node 18+):

```bash
node tools/fetch-icons.mjs calendar flag
```

Das Skript lädt die SVGs aus dem versionierten npm-Paket `lucide-static` nach
`assets/icons/lucide/` und erzeugt `js/icons.js` neu. Wer SVGs von Hand von lucide.dev
herunterlädt und in den Ordner legt, baut den Sprite anschließend mit:

```bash
node tools/build-icons.mjs
```

## Noch extern geladen

- Tailwind CSS (Play-CDN `cdn.tailwindcss.com`)
- Schriftarten Inter / JetBrains Mono (Google Fonts)

Ohne Internet funktioniert die Logik weiterhin, das Layout aber nicht.
