// Dialoge: Aufgaben-Formular, Menü, Export/Import, KI-Schnellimport
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

function openTaskModal(isEdit = false) {
  const modal = document.getElementById('taskModal');
  const title = document.getElementById('modalTitle');
  if (!isEdit) {
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
    document.getElementById('taskStartDate').value = toISO(new Date());
    document.getElementById('taskEndDate').value = addDays(5);
    document.getElementById('taskProgress').value = 0;
    updateProgressDisplay(0);
    document.getElementById('taskGroup').value = '';
    document.getElementById('taskOwner').value = '';
    document.getElementById('taskMilestone').checked = false;
    title.innerHTML = '<svg class="icon text-emerald-500" aria-hidden="true"><use href="#i-plus"></use></svg> Neue Aufgabe erstellen';
  }
  document.getElementById('aiAutoCopy').checked = isAiAutoCopy();
  modal.classList.remove('hidden');
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.add('hidden');
}

function editTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  document.getElementById('taskId').value = task.id;
  document.getElementById('taskTitle').value = task.title || '';
  document.getElementById('taskGroup').value = task.group || '';
  document.getElementById('taskOwner').value = task.owner || '';
  document.getElementById('taskMilestone').checked = !!task.milestone;
  document.getElementById('taskPhase').value = task.phase || '';
  document.getElementById('taskPriority').value = task.priority || 'Mittel';
  document.getElementById('taskStatus').value = task.status || 'Offen';
  document.getElementById('taskProgress').value = task.progress || 0;
  updateProgressDisplay(task.progress || 0);

  document.getElementById('taskStartDate').value = task.startDate || toISO(new Date());
  document.getElementById('taskEndDate').value = task.endDate || task.deadline || addDays(5);

  document.getElementById('taskNextAction').value = task.nextAction || '';
  document.getElementById('taskNotes').value = task.notes || '';

  document.getElementById('modalTitle').innerHTML = '<svg class="icon text-emerald-500" aria-hidden="true"><use href="#i-square-pen"></use></svg> Aufgabe bearbeiten';
  document.getElementById('aiAutoCopy').checked = isAiAutoCopy();
  document.getElementById('taskModal').classList.remove('hidden');
}

function deleteTask(id) {
  const task = tasks.find(t => t.id === id);
  const name = task ? task.title : 'Aufgabe';

  tasks.forEach(t => {
    t.dependsOn = t.dependsOn.filter(pid => pid !== id);
  });

  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  render();
  showToast(`"${name}" wurde gelöscht.`);
}

function handleTaskSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('taskId').value;
  const title = document.getElementById('taskTitle').value.trim();
  const group = document.getElementById('taskGroup').value.trim();
  const owner = document.getElementById('taskOwner').value.trim();
  const milestone = document.getElementById('taskMilestone').checked;
  // Vorgänger werden im Gantt verknüpft (⊕ am Balken) – das Formular behält sie unverändert bei
  const dependsOn = id ? [...((getTask(id) || {}).dependsOn || [])] : [];
  const phase = document.getElementById('taskPhase').value;
  const priority = document.getElementById('taskPriority').value;
  const status = document.getElementById('taskStatus').value;
  const progress = parseInt(document.getElementById('taskProgress').value, 10) || 0;
  const startDate = document.getElementById('taskStartDate').value;
  const endDate = document.getElementById('taskEndDate').value;
  const nextAction = document.getElementById('taskNextAction').value.trim();
  const notes = document.getElementById('taskNotes').value.trim();

  let saved = null;
  if (id) {
    const index = tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const oldStatus = tasks[index].status;
      const oldEndDate = tasks[index].endDate;
      tasks[index] = { 
        ...tasks[index], 
        title, group, owner, milestone, dependsOn, phase, priority, progress, startDate, endDate, nextAction, notes,
        status: oldStatus,
        quick: false,
        updatedAt: new Date().toISOString()
      };
      saved = tasks[index];
      setTaskStatus(saved, status);
      saved.progress = progress;
      // Enddatum von Hand geändert = neue Planung -> Markierung "automatisch verlängert" entfällt
      if (endDate !== oldEndDate) {
        delete saved.originalEndDate;
        delete saved.extendedCount;
      }
    }
  } else {
    const now = new Date().toISOString();
    saved = {
      id: 't-' + Date.now(),
      title, group, owner, milestone, dependsOn, phase, priority, status, progress, startDate, endDate, nextAction, notes,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      doneAt: status === 'Erledigt' ? now : '',
      blockedSince: status === 'Blockiert' ? now : ''
    };
    tasks.push(saved);
  }

  if (saved) {
    // Ende -> Anfang: nicht vor dem Ende der Vorgänger beginnen, Nachfolger mitziehen
    const shifted = shiftAfterPredecessors(saved);
    cascadeDependentTasks(saved.id);
    const msg = id ? 'Aufgabe aktualisiert' : 'Neue Aufgabe hinzugefügt';
    showToast(shifted ? `${msg} – Start auf ${formatDate(saved.startDate)} verschoben (nach Vorgängern)` : msg);
  }

  saveTasks();
  closeTaskModal();
  render();

  // KI-Rechtschreibprüfung: Prompt + JSON der gespeicherten Aufgabe gleich in die Zwischenablage
  if (saved && document.getElementById('aiAutoCopy').checked) copyProofreadForTask(saved);
}

function toggleMenu() {
  const menu = document.getElementById('dropdownMenu');
  menu.classList.toggle('hidden');
}

window.onclick = function(event) {
  if (!event.target.closest('#menuButton') && !event.target.closest('#dropdownMenu')) {
    const menu = document.getElementById('dropdownMenu');
    if (menu && !menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
    }
  }
};

function exportJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `${currentWorkspace.projectName}_backup_${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast(`JSON-Export für ${currentWorkspace.projectName} heruntergeladen`);
}

function exportCSV() {
  if (tasks.length === 0) {
    showToast('Keine Daten zum Exportieren vorhanden', 'error');
    return;
  }
  const headers = ['ID', 'Titel', 'Gruppe', 'Abhaengig_von', 'Phase', 'Prioritaet', 'Status', 'Fortschritt_Prozent', 'Startdatum', 'Enddatum', 'Naechster_Schritt', 'Notizen'];
  const rows = tasks.map(t => [
    t.id,
    `"${(t.title || '').replace(/"/g, '""')}"`,
    `"${(t.group || '').replace(/"/g, '""')}"`,
    `"${(t.dependsOn || []).join(',')}"`,
    `"${(t.phase || '').replace(/"/g, '""')}"`,
    `"${(t.priority || '').replace(/"/g, '""')}"`,
    `"${(t.status || '').replace(/"/g, '""')}"`,
    t.progress || 0,
    `"${t.startDate || ''}"`,
    `"${t.endDate || ''}"`,
    `"${(t.nextAction || '').replace(/"/g, '""')}"`,
    `"${(t.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\n');
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", encodeURI(csvContent));
  downloadAnchor.setAttribute("download", `${currentWorkspace.projectName}_aufgaben_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('CSV-Export heruntergeladen');
}

function buildBaseSystemPrompt(customCommand = '') {
  const todayISO = toISO(new Date());
  const baseInstructions = `Du bist ein spezialisierter Assistent für Projektmanagement, Kanban und 2D/3D Gantt-Charts
in der industriellen Automatisierungstechnik (Sondermaschinenbau, SPS-Programmierung z. B. Siemens TIA Portal,
HMI / WinCC Unified, Robotik, Inbetriebnahme). Verwende die dort übliche Fachsprache und korrekte deutsche Rechtschreibung.
Erstelle für jede Aufgabe ausschließlich ein valides JSON-Array ohne umschließenden Markdown-Text oder Begrüßung.

FORMAT-VORGABEN:
- "title": Kurzer prägnanter Aufgabentitel (String)
- "group": Gruppe / Baugruppe / Arbeitspaket, zu der die Aufgabe gehört (String, z. B. "FG14 Klopfer")
- "depends_on": Optional Vorgänger-Aufgabe(n) als Name oder ID – String oder Array von Strings. Die Aufgabe startet erst nach dem Ende aller Vorgänger (Ende → Anfang)
- "category": Genau einer der folgenden Werte: "Konzept" | "Vorbereitung" | "Umsetzung" | "Schnittstellen" | "Inbetriebnahme" | "Doku"
- "priority": Genau einer der Werte: "high" | "medium" | "low" (oder "Hoch" | "Mittel" | "Niedrig")
- "status": Genau einer der Werte: "todo" | "in_progress" | "blocked" | "done" (oder "Offen" | "In Arbeit" | "Blockiert" | "Erledigt")
- "progress": Ganzzahl 0 bis 100
- "startDate": Datum im Format "YYYY-MM-DD" (Standard: heute = ${todayISO})
- "endDate": Zieldatum im Format "YYYY-MM-DD"
- "next_step": Konkreter, nächster auszuführender Arbeitsschritt
- "notes": Wichtige Details, Blocker-Gründe oder Spezifikationen`;

  if (customCommand && customCommand.trim().length > 0) {
    return `${baseInstructions}

AUFGABENBESCHREIBUNG / BENUTZERBEFEHL:
"${customCommand.trim()}"

Erzeuge dafür nun das passende JSON-Objekt im definierten Format.`;
  }

  return baseInstructions;
}

function updateDynamicPromptText() {
  const customCmd = document.getElementById('aiCustomCommandInput').value;
  const fullPrompt = buildBaseSystemPrompt(customCmd);
  const previewArea = document.getElementById('aiPromptPreviewArea');
  previewArea.value = fullPrompt;
  document.getElementById('promptCharCount').innerText = `${fullPrompt.length} Zeichen`;
}

function clearCustomCommand() {
  document.getElementById('aiCustomCommandInput').value = '';
  updateDynamicPromptText();
}

function copySystemPromptToClipboard() {
  const previewArea = document.getElementById('aiPromptPreviewArea');
  previewArea.select();
  previewArea.setSelectionRange(0, 99999);

  try {
    document.execCommand('copy');
    const btn = document.getElementById('btnCopyPrompt');
    btn.innerHTML = '<svg class="icon text-emerald-300" aria-hidden="true"><use href="#i-check"></use></svg> Kopiert!';
    btn.classList.remove('bg-indigo-600');
    btn.classList.add('bg-emerald-600');
    showToast('KI-Prompt in Zwischenablage kopiert');
    setTimeout(() => {
      btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-copy"></use></svg> <span>Prompt kopieren</span>';
      btn.classList.add('bg-indigo-600');
      btn.classList.remove('bg-emerald-600');
    }, 2200);
  } catch (err) {
    showToast('Fehler beim Kopieren in Zwischenablage', 'error');
  }
}

function pasteSampleToInput() {
  const sample = [
    {
      "title": "FG14 Schublade Klopfer programmieren",
      "group": "FG14 Klopfer",
      "category": "Umsetzung",
      "priority": "high",
      "status": "todo",
      "progress": 0,
      "startDate": toISO(new Date()),
      "endDate": addDays(4),
      "next_step": "Zylinder-Ansteuerung in SPS schreiben",
      "notes": "Voraussetzung für Testlauf"
    },
    {
      "title": "Klopfer-Zyklus testen",
      "group": "FG14 Klopfer",
      "category": "Inbetriebnahme",
      "priority": "high",
      "status": "todo",
      "depends_on": ["FG14 Schublade Klopfer programmieren"],
      "progress": 0,
      "startDate": addDays(5),
      "endDate": addDays(9),
      "next_step": "Endlagensensorik und Taktzeit messen",
      "notes": "Startet unmittelbar nach Abschluss der Klopfer-Programmierung"
    }
  ];
  document.getElementById('aiJsonInput').value = JSON.stringify(sample, null, 2);
}

function openAiImportModal() {
  updateDynamicPromptText();
  document.getElementById('aiImportModal').classList.remove('hidden');
}

function closeAiImportModal() {
  document.getElementById('aiImportModal').classList.add('hidden');
}

function normalizePriority(val) {
  if (!val) return 'Mittel';
  const s = String(val).toLowerCase().trim();
  if (s === 'high' || s === 'hoch') return 'Hoch';
  if (s === 'low' || s === 'niedrig' || s === 'tief') return 'Niedrig';
  return 'Mittel';
}

function normalizeStatus(val) {
  if (!val) return 'Offen';
  const s = String(val).toLowerCase().trim();
  if (s === 'in_progress' || s === 'in progress' || s === 'in arbeit' || s === 'progress') return 'In Arbeit';
  if (s === 'blocked' || s === 'blockiert' || s === 'block') return 'Blockiert';
  if (s === 'testing' || s === 'in_test' || s === 'im testen' || s === 'test') return 'Im Testen';
  if (s === 'cancelled' || s === 'canceled' || s === 'abgebrochen') return 'Abgebrochen';
  if (s === 'done' || s === 'erledigt' || s === 'completed' || s === 'finished') return 'Erledigt';
  return 'Offen';
}

function normalizeCategory(val) {
  if (!val) return 'Konzept';
  const s = String(val).trim();
  const valid = ['Konzept', 'Vorbereitung', 'Umsetzung', 'Schnittstellen', 'Inbetriebnahme', 'Doku'];
  const match = valid.find(v => v.toLowerCase() === s.toLowerCase());
  return match || 'Schnittstellen';
}

function processAiJsonImport() {
  let rawText = document.getElementById('aiJsonInput').value.trim();
  if (!rawText) {
    showToast('Bitte Text oder JSON in Schritt 2 einfügen', 'error');
    return;
  }

  if (rawText.startsWith('```')) {
    rawText = rawText.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  }

  try {
    let parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed)) {
      parsed = [parsed];
    }

    let addedCount = 0;
    const newlyAdded = [];

    parsed.forEach(item => {
      const title = item.title || item.name || item.aufgabe || item.arbeitspaket;
      if (!title) return;

      const normStatus = normalizeStatus(item.status);
      const normPriority = normalizePriority(item.priority || item.prio);
      const normPhase = normalizeCategory(item.category || item.phase || item.kategorie);

      let progressVal = typeof item.progress === 'number' ? Math.max(0, Math.min(100, item.progress)) : null;
      if (progressVal === null) {
        if (normStatus === 'Erledigt') progressVal = 100;
        else if (normStatus === 'In Arbeit') progressVal = 50;
        else if (normStatus === 'Blockiert') progressVal = 20;
        else progressVal = 0;
      }

      const newTask = {
        id: 't-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        title: title.trim(),
        group: String(item.group || item.gruppe || '').trim(),
        dependsOn: normalizeDeps(item.depends_on || item.dependsOn || item.vorgaenger),
        phase: normPhase,
        priority: normPriority,
        status: normStatus,
        progress: progressVal,
        startDate: item.startDate || item.start || toISO(new Date()),
        endDate: item.endDate || item.deadline || item.ende || addDays(7),
        nextAction: item.next_step || item.nextAction || item.naechsterSchritt || item.action || '',
        createdAt: new Date().toISOString(),
        notes: item.notes || item.notizen || item.details || ''
      };

      tasks.push(newTask);
      newlyAdded.push(newTask);
      addedCount++;
    });

    // Resolve title-based dependency names to IDs
    newlyAdded.forEach(task => {
      task.dependsOn = [...new Set(task.dependsOn.map(ref => {
        const matchedParent = tasks.find(p => p.id !== task.id && (p.id === ref || p.title.toLowerCase() === ref.toLowerCase()));
        return matchedParent ? matchedParent.id : null;
      }).filter(pid => pid && !wouldCauseCircularDependency(pid, task.id)))];
    });
    newlyAdded.forEach(task => {
      shiftAfterPredecessors(task);
      cascadeDependentTasks(task.id);
    });

    if (addedCount > 0) {
      saveTasks();
      render();
      closeAiImportModal();
      showToast(`${addedCount} Aufgabe(n) erfolgreich ins Board übernommen`);
    } else {
      showToast('Keine gültige Aufgabenstruktur gefunden', 'error');
    }
  } catch (err) {
    showToast('JSON-Syntax fehlerhaft. Bitte JSON prüfen.', 'error');
  }
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        tasks = imported.map(normalizeTask);
        dropDanglingDeps();
        saveTasks('import');
        render();
        showToast(`${imported.length} Aufgaben erfolgreich importiert`);
        if (currentView === 'gantt') setTimeout(scrollGanttToToday, 60);
      } else {
        showToast('Ungültiges Dateiformat', 'error');
      }
    } catch (err) {
      showToast('Fehler beim Einlesen der JSON-Datei', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function resetToSampleData() {
  tasks = JSON.parse(JSON.stringify(DEFAULT_TASKS)).map(normalizeTask);
  saveTasks('reset');
  render();
  showToast('Demodaten wiederhergestellt');
}
