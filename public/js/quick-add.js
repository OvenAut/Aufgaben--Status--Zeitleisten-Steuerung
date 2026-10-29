// Schnellerfassung: nur Titel + Beschreibung; Gruppe, Phase, Termine usw. werden später zugeordnet.
// Schnell erfasste Aufgaben tragen quick: true und erscheinen im "Eingang", bis sie einmal
// im Formular gespeichert oder per Drag & Drop einer Gruppe/Phase zugeordnet wurden.
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

let inboxOnly = false;

function handleQuickAdd(e) {
  e.preventDefault();
  const titleInput = document.getElementById('quickTitle');
  const notesInput = document.getElementById('quickNotes');
  const title = titleInput.value.trim();
  if (!title) return;

  const task = normalizeTask({
    id: 't-' + Date.now(),
    title,
    notes: notesInput.value.trim(),
    group: '',
    phase: '',
    priority: 'Mittel',
    status: 'Offen',
    progress: 0,
    startDate: toISO(new Date()),
    endDate: toISO(new Date()),
    dependsOn: [],
    nextAction: '',
    quick: true,
    createdAt: new Date().toISOString()
  });
  tasks.push(task);
  saveTasks();
  render();

  titleInput.value = '';
  notesInput.value = '';
  titleInput.focus();

  if (isAiAutoCopy()) copyProofreadForTask(task);
  else showToast(`"${title}" im Eingang erfasst – Zuordnung später über Bearbeiten`);
}

function isInboxTask(t) {
  return !!t.quick;
}

function toggleInboxFilter() {
  inboxOnly = !inboxOnly;
  render();
}

function updateInboxButton() {
  const btn = document.getElementById('btnInboxFilter');
  const count = tasks.filter(isInboxTask).length;
  if (!count && inboxOnly) inboxOnly = false;
  const badge = document.getElementById('quickInboxBadge');
  badge.innerText = count;
  badge.classList.toggle('hidden', count === 0);
  btn.classList.toggle('hidden', count === 0 && !inboxOnly);
  document.getElementById('inboxCountLabel').innerText = inboxOnly ? `Eingang (${count}) · alle zeigen` : `${count} im Eingang`;
  btn.className = btn.className
    .replace(/\b(bg|text|border|hover:bg)-(amber|slate|white)[^\s]*/g, '')
    .replace(/\bdark:[^\s]*/g, '')
    .trim() + (inboxOnly
      ? ' bg-amber-500 text-white border-amber-500 hover:bg-amber-400'
      : ' bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700/50 hover:bg-amber-100');
}

function getInboxBadge() {
  return `<span class="px-1.5 py-px rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 inline-flex items-center gap-1 flex-shrink-0" title="Schnell erfasst – noch nicht zugeordnet">${icon('inbox', 'text-[9px]')}Eingang</span>`;
}
