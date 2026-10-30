# Projekt Status & Aufgaben Board

Aufgaben-, Status- und Zeitleisten-Steuerung für Automatisierungsprojekte – Gantt-Chart, Kanban und Tabelle.
Läuft als **Windows-Programm** (lokaler Server + Browser) und protokolliert jede Änderung mit Zeitstempel.

## Benutzung (Windows)

1. `Projekt-Status-Board.exe` in einen eigenen Ordner legen, z. B. `Dokumente\Projekt-Board\`
   (nicht nach `C:\Programme`, dort darf nicht geschrieben werden).
2. Doppelklick – ein Konsolenfenster öffnet sich und das Board erscheint im Standardbrowser
   unter `http://127.0.0.1:3210/`.
3. Das Konsolenfenster offen lassen; schließen beendet das Programm.

Beim ersten Start fragt Windows SmartScreen nach, weil die EXE nicht signiert ist:
„Weitere Informationen“ → „Trotzdem ausführen“.

Die Daten liegen im Ordner **`daten`** neben der EXE:

```
daten/
  Hauptprojekt/
    tasks.json            aktueller Stand
    history.jsonl         Änderungsprotokoll (jede Änderung mit Uhrzeit)
    backups/tasks_JJJJ-MM-TT.json   Stand vom Tagesbeginn
  Linie 2/ …              weitere Projekte (Menü ⋮ → „Neues Projekt …“)
  _papierkorb/            gelöschte Projekte (Menü ⋮ → Papierkorb-Symbol bzw. „Dieses Projekt löschen …“)
```

Projekte lassen sich nach Rückfrage löschen, auch das Hauptprojekt. Der Ordner wird dabei nach
`daten/_papierkorb/<Projekt>_<Zeitpunkt>` verschoben; zum Wiederherstellen den Ordner zurück nach
`daten/` kopieren und auf den Projektnamen umbenennen. Demodaten gibt es nur beim allerersten Start.

Ist der Ordner neben der EXE nicht beschreibbar, wird `%APPDATA%\Projekt-Status-Board\daten` verwendet
(der tatsächliche Pfad steht im Konsolenfenster).

**Umzug von der HTML-Version:** In der alten Version Menü ⋮ → „Export als JSON“, in der App
Menü ⋮ → „Backup importieren“. Der Import wird im Protokoll als „importiert“ vermerkt.

Startoptionen: `Projekt-Status-Board.exe --port 3300 --no-browser --data D:\Projektdaten`

## Funktionen

- **Gantt-Chart** mit stufenlosem Zoom (Lupen-Knöpfe oder Strg/⌘ + Mausrad, Tage … Jahr)
- **Gruppen** (Gruppe / Phase / Status) mit einklappbaren Sammelbalken, Drag & Drop zwischen Gruppen
- **Abhängigkeiten** Ende → Anfang, mehrere Vorgänger, farbige Verbindungen (freigegeben / wartet / Konflikt)
- **Datumswähler** im Aufgabenformular: Kalender mit KW und Zeitraum, Schnellwahl, Dauer in Arbeitstagen; Eintippen wie `29.10.`, `heute`, `+3`
- **Schnellerfassung** oben: nur Titel + Beschreibung, Zuordnung später („Eingang“)
- **KI-Rechtschreibprüfung**: Prompt + JSON in die Zwischenablage, Antwort der KI per „KI-Korrektur“ zurück
- **Tages- und Wochenbericht** mit Änderungsprotokoll, KI-Prompts „Bericht verbessern“ und „Auswerten“
- Kanban, Tabelle, Filter, Meilensteine, Verantwortliche, Import/Export (JSON, CSV), KI-Schnellimport

## Ohne Installation

`public/projekt_status_aufgaben_board.html` lässt sich auch direkt per Doppelklick öffnen.
Dann wird nur im Browser (`localStorage`) gespeichert – ohne Änderungsprotokoll und ohne Projekte-Ordner.

## Entwicklung

Voraussetzung: Node.js 22+

```bash
npm install
```

```bash
npm start
```

| Befehl | Zweck |
| --- | --- |
| `npm start` | Server starten und Browser öffnen (`npm run dev` ohne Browser) |
| `npm run build:css` | Tailwind-CSS nach `public/css/tailwind.css` bauen (nach neuen Klassen nötig) |
| `npm run watch:css` | Tailwind beim Bearbeiten automatisch neu bauen |
| `npm run build:exe` | `dist/Projekt-Status-Board.exe` bauen (geht auch unter Linux/macOS) |
| `npm run build:exe:linux` | Linux-Programmdatei `dist/projekt-status-board` bauen |
| `node tools/fetch-icons.mjs NAME …` | Lucide-Icons nachladen, z. B. `calendar flag` |

`build:exe` nutzt die in Node eingebaute „Single Executable Application“: Die Web-App aus `public/`
wird in eine Kopie der Node-Laufzeit eingebettet. Für ein fremdes Zielsystem wird die passende
Node-Version von nodejs.org geladen und per SHA-256 geprüft. Der GitHub-Workflow
`.github/workflows/build-exe.yml` baut und testet die EXE auf Windows und stellt sie als Download bereit.

### Aufbau

```
server/server.js          lokaler Server (nur Node-Bordmittel): Web-App, API, Speicherung, Protokoll
public/                   Web-App
  projekt_status_aufgaben_board.html
  css/ tailwind.css (gebaut) · fonts.css · board.css
  js/  core · dependencies · gantt · views · dialogs · ai-proofread · quick-add · reports · main
       icons.js (gebaut aus assets/icons/lucide)
  assets/icons/lucide/    Lucide-SVGs (ISC)
  assets/fonts/           Inter, JetBrains Mono (SIL OFL 1.1)
tools/                    Build-Skripte (EXE, Icons)
```

Die Scripts im Browser sind klassische `<script>`-Dateien (keine ES-Module), damit die HTML-Datei
auch per Doppelklick funktioniert. Sie teilen sich den globalen Scope; die Reihenfolge der
`<script>`-Tags ist wichtig.

### API des lokalen Servers

| Methode | Pfad | |
| --- | --- | --- |
| GET | `/api/health` | Version, Datenordner |
| GET | `/api/projects` | Projekte mit Anzahl Aufgaben |
| GET | `/api/projects/<Projekt>/tasks` | Aufgaben |
| PUT | `/api/projects/<Projekt>/tasks` | kompletten Stand speichern; Unterschiede werden protokolliert (`?reason=import` fasst zusammen) |
| DELETE | `/api/projects/<Projekt>` | Projekt in den Papierkorb (`daten/_papierkorb`) verschieben |
| GET | `/api/projects/<Projekt>/history?from=JJJJ-MM-TT&to=JJJJ-MM-TT` | Änderungsprotokoll |

Der Server lauscht nur auf `127.0.0.1` – andere Rechner im Netz haben keinen Zugriff.

### Icons (Lucide)

Icons von [lucide.dev](https://lucide.dev/icons/) liegen als SVG im Repository, `public/js/icons.js` bündelt sie als Sprite:

```html
<svg class="icon text-emerald-500"><use href="#i-plus"></use></svg>
```

```js
icon('plus', 'text-xs text-emerald-500')      // Markup als String
setIcon(element, 'check', 'text-emerald-300') // vorhandenes Icon austauschen
```

Neue Icons: `node tools/fetch-icons.mjs calendar flag` (lädt aus dem npm-Paket `lucide-static` und baut den Sprite neu).
Von Hand heruntergeladene SVGs in `public/assets/icons/lucide/` legen und `npm run build:icons` ausführen.
