// Datumswähler für Start- und Enddatum im Aufgabenformular
// Sichtbar sind Textfelder (taskStartText / taskEndText), die Werte liegen als ISO-Datum in den
// versteckten Feldern taskStartDate / taskEndDate – der übrige Code liest und setzt nur diese.
// Kalender: Montag als Wochenbeginn, Kalenderwochen, Zeitraum hervorgehoben, Schnellwahl, Dauer.
// Eintippen geht auch: 29.10.2026, 29.10.26, 29.10., 2026-10-29, heute, morgen, +3 / -2 (Tage ab heute).
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

const DP_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DP_WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

let dpEl = null;
let dpActive = null;     // 'start' | 'end'
let dpView = null;       // erster Tag des angezeigten Monats (ISO)
let dpHover = null;      // Vorschau beim Wählen des Endes

// -------------------------------------------------------------
// Datumshilfen (ISO JJJJ-MM-TT, lokale Zeit)
// -------------------------------------------------------------
function dpDate(iso) { return new Date(`${iso}T12:00:00`); }
function dpIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function dpAdd(iso, days) { const d = dpDate(iso); d.setDate(d.getDate() + days); return dpIso(d); }
function dpDiff(a, b) { return Math.round((dpDate(b) - dpDate(a)) / 86400000); }
function dpToday() { return dpIso(new Date()); }
function dpIsWeekend(iso) { const day = dpDate(iso).getDay(); return day === 0 || day === 6; }

function dpWorkdays(from, to) {
  let n = 0;
  for (let k = from; k <= to; k = dpAdd(k, 1)) if (!dpIsWeekend(k)) n++;
  return n;
}

function dpFormat(iso) {
  if (!iso) return '';
  return dpDate(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Eingetipptes Datum lesen; null = nicht erkannt
function dpParse(text) {
  const s = String(text || '').trim().toLowerCase().replace(/^[a-zäöü]{2,3}\.?,?\s*(?=\d)/, ''); // "Do., " vor einem Datum ignorieren
  if (!s) return null;
  if (s === 'heute') return dpToday();
  if (s === 'morgen') return dpAdd(dpToday(), 1);
  if (s === 'gestern') return dpAdd(dpToday(), -1);
  let m = s.match(/^([+-])\s*(\d{1,3})$/);
  if (m) return dpAdd(dpToday(), (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return dpValid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/);
  if (m) {
    let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
    if (year < 100) year += 2000;
    return dpValid(year, +m[2], +m[1]);
  }
  return null;
}

function dpValid(y, mo, d) {
  const date = new Date(y, mo - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? dpIso(date) : null;
}

// -------------------------------------------------------------
// Felder lesen / schreiben
// -------------------------------------------------------------
function dpHidden(field) { return document.getElementById(field === 'start' ? 'taskStartDate' : 'taskEndDate'); }
function dpText(field) { return document.getElementById(field === 'start' ? 'taskStartText' : 'taskEndText'); }
function dpGet(field) { return dpHidden(field).value; }

function dpSet(field, iso) {
  dpHidden(field).value = iso;
  dpText(field).value = dpFormat(iso);
}

// nach dem Setzen der versteckten Felder von außen (Formular öffnen) aufrufen
function refreshTaskDateFields() {
  ['start', 'end'].forEach(f => { dpText(f).value = dpFormat(dpGet(f)); dpText(f).classList.remove('ring-2', 'ring-rose-400'); });
  updateTaskDateDuration();
}

function updateTaskDateDuration() {
  const el = document.getElementById('taskDateDuration');
  const start = dpGet('start');
  const end = dpGet('end');
  if (!start || !end || end < start) { el.innerText = ''; return; }
  const days = dpDiff(start, end) + 1;
  const work = dpWorkdays(start, end);
  el.innerText = `Dauer: ${days} Tag${days === 1 ? '' : 'e'} · ${work} Arbeitstag${work === 1 ? '' : 'e'}`;
}

// Start ändern: Dauer bleibt erhalten. Ende ändern: liegt es vor dem Start, wird es zum neuen Start.
function dpApply(field, iso) {
  const start = dpGet('start');
  const end = dpGet('end');
  if (field === 'start') {
    const duration = start && end && end >= start ? dpDiff(start, end) : 0;
    dpSet('start', iso);
    dpSet('end', dpAdd(iso, duration));
  } else if (start && iso < start) {
    dpSet('start', iso);
    if (!end || end < iso) dpSet('end', iso);
  } else {
    dpSet('end', iso);
  }
  updateTaskDateDuration();
}

// -------------------------------------------------------------
// Kalender
// -------------------------------------------------------------
function openDatePicker(field) {
  dpActive = field;
  const base = dpGet(field) || dpGet('start') || dpToday();
  dpView = `${base.slice(0, 8)}01`;
  dpHover = null;
  renderDatePicker();
}

function closeDatePicker() {
  if (dpEl) dpEl.classList.add('hidden');
  dpActive = null;
}

function isDatePickerOpen() {
  return !!dpEl && !dpEl.classList.contains('hidden');
}

function dpChip(label, action) {
  return `<button type="button" data-dp-quick="${action}" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-slate-700 dark:text-slate-200 transition">${label}</button>`;
}

function dpQuickValue(action) {
  const today = dpToday();
  const start = dpGet('start') || today;
  const nextWeekday = (from, weekday) => { let k = dpAdd(from, 1); while (dpDate(k).getDay() !== weekday) k = dpAdd(k, 1); return k; };
  switch (action) {
    case 'today': return today;
    case 'tomorrow': return dpAdd(today, 1);
    case 'nextMonday': return nextWeekday(today, 1);
    case 'plus1': return dpAdd(start, 1);
    case 'plus7': return dpAdd(start, 7);
    case 'plus14': return dpAdd(start, 14);
    case 'friday': return dpDate(start).getDay() === 5 ? start : nextWeekday(start, 5);
    default: return null;
  }
}

function renderDatePicker() {
  if (!dpEl) {
    dpEl = document.createElement('div');
    dpEl.id = 'datePicker';
    dpEl.className = 'hidden fixed z-[65] w-[300px] p-3 space-y-2.5 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs select-none';
    document.body.appendChild(dpEl);
    dpEl.addEventListener('mousedown', e => e.preventDefault()); // Fokus im Textfeld behalten
    dpEl.addEventListener('click', onDatePickerClick);
    dpEl.addEventListener('mouseover', e => {
      const cell = e.target.closest('[data-dp-day]');
      const iso = cell ? cell.dataset.dpDay : null;
      if (dpActive === 'end' && iso !== dpHover) { dpHover = iso; renderDatePicker(); }
    });
  }

  const start = dpGet('start');
  const end = dpGet('end');
  const today = dpToday();
  const rangeEnd = dpActive === 'end' && dpHover && start && dpHover >= start ? dpHover : end;
  const view = dpDate(dpView);

  // Raster: ab dem Montag vor dem Monatsersten, 6 Wochen
  const first = dpDate(dpView);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = dpAdd(dpView, -offset);
  let rows = '';
  for (let w = 0; w < 6; w++) {
    const monday = dpAdd(gridStart, w * 7);
    let cells = `<div class="h-8 flex items-center justify-center text-[10px] text-slate-400 dark:text-slate-500" title="Kalenderwoche">${getWeekNumber(dpDate(monday))}</div>`;
    for (let d = 0; d < 7; d++) {
      const iso = dpAdd(monday, d);
      const inMonth = dpDate(iso).getMonth() === view.getMonth();
      const isStart = iso === start;
      const isEnd = iso === rangeEnd;
      const inRange = start && rangeEnd && iso > start && iso < rangeEnd;
      let cls = 'h-8 rounded-lg flex items-center justify-center cursor-pointer transition ';
      if (isStart || isEnd) cls += 'bg-emerald-600 text-white font-semibold shadow ';
      else if (inRange) cls += 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ';
      else cls += `hover:bg-slate-100 dark:hover:bg-slate-800 ${dpIsWeekend(iso) ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'} `;
      if (!inMonth) cls += 'opacity-40 ';
      if (iso === today && !isStart && !isEnd) cls += 'ring-1 ring-emerald-500 font-semibold ';
      cells += `<div data-dp-day="${iso}" class="${cls}" title="${dpFormat(iso)}">${dpDate(iso).getDate()}</div>`;
    }
    rows += cells;
  }

  const tab = (field, label, iso) => `
    <button type="button" data-dp-tab="${field}" class="flex-1 px-2 py-1.5 rounded-lg text-left transition ${dpActive === field ? 'bg-emerald-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}">
      <div class="text-[10px] uppercase tracking-wider opacity-80">${label}</div>
      <div class="font-semibold">${iso ? dpFormat(iso) : '–'}</div>
    </button>`;

  const quick = dpActive === 'start'
    ? dpChip('Heute', 'today') + dpChip('Morgen', 'tomorrow') + dpChip('Nächster Mo', 'nextMonday')
    : dpChip('+1 Tag', 'plus1') + dpChip('Freitag', 'friday') + dpChip('+1 Woche', 'plus7') + dpChip('+2 Wochen', 'plus14');

  const duration = start && end && end >= start
    ? `${dpDiff(start, end) + 1} Tage · ${dpWorkdays(start, end)} Arbeitstage`
    : '';

  dpEl.innerHTML = `
    <div class="flex gap-1.5">${tab('start', 'Start', start)}${tab('end', 'Ende', end)}</div>
    <div class="flex items-center justify-between">
      <button type="button" data-dp-nav="-1" class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" title="Vormonat">${icon('chevron-left')}</button>
      <div class="font-semibold text-sm text-slate-800 dark:text-slate-100">${DP_MONTHS[view.getMonth()]} ${view.getFullYear()}</div>
      <button type="button" data-dp-nav="1" class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" title="Nächster Monat">${icon('chevron-right')}</button>
    </div>
    <div class="grid grid-cols-8 gap-0.5 text-center">
      <div class="h-6 flex items-center justify-center text-[10px] text-slate-400 dark:text-slate-500">KW</div>
      ${DP_WEEKDAYS.map((d, i) => `<div class="h-6 flex items-center justify-center text-[10px] font-semibold ${i >= 5 ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}">${d}</div>`).join('')}
      ${rows}
    </div>
    <div class="flex flex-wrap gap-1">${quick}</div>
    <div class="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
      <span class="text-[11px] text-slate-500 dark:text-slate-400">${duration}</span>
      <div class="flex gap-1">
        <button type="button" data-dp-nav="today" class="px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-emerald-700 dark:text-emerald-400 font-medium">Heute</button>
        <button type="button" data-dp-close class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium">Fertig</button>
      </div>
    </div>`;

  dpEl.classList.remove('hidden');
  positionDatePicker();
}

function positionDatePicker() {
  if (!isDatePickerOpen() || !dpActive) return;
  const anchor = dpText(dpActive).getBoundingClientRect();
  const rect = dpEl.getBoundingClientRect();
  let top = anchor.bottom + 6;
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, anchor.top - rect.height - 6);
  let left = Math.min(anchor.left, window.innerWidth - rect.width - 8);
  dpEl.style.top = `${top}px`;
  dpEl.style.left = `${Math.max(8, left)}px`;
}

function onDatePickerClick(e) {
  const day = e.target.closest('[data-dp-day]');
  if (day) {
    const field = dpActive;
    dpApply(field, day.dataset.dpDay);
    if (field === 'start') {
      // weiter mit dem Ende
      dpActive = 'end';
      dpText('end').focus();
      renderDatePicker();
    } else {
      closeDatePicker();
    }
    return;
  }
  const tab = e.target.closest('[data-dp-tab]');
  if (tab) {
    dpText(tab.dataset.dpTab).focus();
    openDatePicker(tab.dataset.dpTab);
    return;
  }
  const nav = e.target.closest('[data-dp-nav]');
  if (nav) {
    if (nav.dataset.dpNav === 'today') dpView = `${dpToday().slice(0, 8)}01`;
    else {
      const d = dpDate(dpView);
      d.setMonth(d.getMonth() + parseInt(nav.dataset.dpNav, 10));
      dpView = dpIso(d);
    }
    renderDatePicker();
    return;
  }
  const quick = e.target.closest('[data-dp-quick]');
  if (quick) {
    const iso = dpQuickValue(quick.dataset.dpQuick);
    if (iso) {
      dpApply(dpActive, iso);
      dpView = `${iso.slice(0, 8)}01`;
      if (dpActive === 'start') dpActive = 'end';
      renderDatePicker();
    }
    return;
  }
  if (e.target.closest('[data-dp-close]')) closeDatePicker();
}

// eingetippten Text übernehmen
function commitTypedDate(field) {
  const input = dpText(field);
  const iso = dpParse(input.value);
  if (iso && field === 'end' && dpGet('start') && iso < dpGet('start')) {
    input.classList.add('ring-2', 'ring-rose-400');
    showToast(`Das Ende liegt vor dem Start (${dpFormat(dpGet('start'))})`, 'error');
    return false;
  }
  if (iso) {
    input.classList.remove('ring-2', 'ring-rose-400');
    if (iso !== dpGet(field)) dpApply(field, iso);
    else input.value = dpFormat(iso);
    if (isDatePickerOpen()) { dpView = `${iso.slice(0, 8)}01`; renderDatePicker(); }
    return true;
  }
  input.classList.add('ring-2', 'ring-rose-400');
  showToast('Datum nicht erkannt – z. B. 29.10.2026, 29.10., heute, morgen oder +3', 'error');
  return false;
}

function initDatePicker() {
  ['start', 'end'].forEach(field => {
    const input = dpText(field);
    input.addEventListener('focus', () => openDatePicker(field));
    input.addEventListener('click', () => { if (dpActive !== field || !isDatePickerOpen()) openDatePicker(field); });
    input.addEventListener('change', () => commitTypedDate(field));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault(); // Formular nicht abschicken
        if (commitTypedDate(field)) closeDatePicker();
      } else if (e.key === 'Escape' && isDatePickerOpen()) {
        e.preventDefault();
        e.stopPropagation();
        input.value = dpFormat(dpGet(field));
        closeDatePicker();
      } else if (e.key === 'Tab') {
        closeDatePicker();
      }
    });
  });

  document.addEventListener('mousedown', e => {
    if (isDatePickerOpen() && !e.target.closest('#datePicker') && !e.target.closest('[data-date-field]')) closeDatePicker();
  });
  window.addEventListener('resize', positionDatePicker);
  document.getElementById('taskModal').addEventListener('scroll', positionDatePicker, true);
}

document.addEventListener('DOMContentLoaded', initDatePicker);
