// Abhängigkeiten (Ende -> Anfang), Verknüpfungsmodus, Hervorhebung, Drag & Drop der Gantt-Zeilen
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

// -------------------------------------------------------------
// DEPENDENCIES (Ende -> Anfang, mehrere Vorgänger je Aufgabe)
// -------------------------------------------------------------
function getTask(id) {
  return tasks.find(t => t.id === id);
}

function getPredecessors(task) {
  return (task.dependsOn || []).map(getTask).filter(Boolean);
}

function getSuccessors(taskId) {
  return tasks.filter(t => (t.dependsOn || []).includes(taskId));
}

function getAncestors(taskId, acc = new Set()) {
  const t = getTask(taskId);
  (t ? t.dependsOn : []).forEach(pid => {
    if (!acc.has(pid)) {
      acc.add(pid);
      getAncestors(pid, acc);
    }
  });
  return acc;
}

function getDescendants(taskId, acc = new Set()) {
  getSuccessors(taskId).forEach(s => {
    if (!acc.has(s.id)) {
      acc.add(s.id);
      getDescendants(s.id, acc);
    }
  });
  return acc;
}

// 'done'     = Vorgänger erledigt, Nachfolger freigegeben
// 'conflict' = Nachfolger beginnt, bevor der Vorgänger endet
// 'wait'     = Vorgänger läuft noch, Termine passen
function getDependencyState(pred, succ) {
  if (isClosed(pred)) return 'done';
  if (new Date(succ.startDate) <= new Date(pred.endDate)) return 'conflict';
  return 'wait';
}

function getConflictCount() {
  let n = 0;
  tasks.forEach(t => getPredecessors(t).forEach(p => { if (getDependencyState(p, t) === 'conflict') n++; }));
  return n;
}

// Frühester Start = Tag nach dem spätesten Ende aller Vorgänger
function getEarliestStart(task) {
  let min = null;
  getPredecessors(task).forEach(p => {
    const d = new Date(p.endDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    if (!min || d > min) min = d;
  });
  return min;
}

// Verschiebt die Aufgabe hinter ihre Vorgänger (Dauer bleibt erhalten). true, wenn verschoben.
function shiftAfterPredecessors(task) {
  const minStart = getEarliestStart(task);
  if (!minStart) return false;
  const currStart = new Date(task.startDate);
  currStart.setHours(0, 0, 0, 0);
  if (currStart >= minStart) return false;
  const currEnd = new Date(task.endDate);
  const durationDays = Math.max(0, Math.round((currEnd - currStart) / (1000 * 60 * 60 * 24)));
  task.startDate = toISO(minStart);
  const newEnd = new Date(minStart);
  newEnd.setDate(newEnd.getDate() + durationDays);
  task.endDate = toISO(newEnd);
  return true;
}

// Cascade date shifts to all (transitive) successors
function cascadeDependentTasks(predecessorId, path = new Set()) {
  if (path.has(predecessorId)) return;
  path.add(predecessorId);
  getSuccessors(predecessorId).forEach(task => {
    if (shiftAfterPredecessors(task)) cascadeDependentTasks(task.id, path);
  });
  path.delete(predecessorId);
}

function resolveAllConflicts() {
  const before = getConflictCount();
  tasks.forEach(t => {
    shiftAfterPredecessors(t);
    cascadeDependentTasks(t.id);
  });
  saveTasks();
  render();
  showToast(`${before} Abhängigkeitskonflikt(e) aufgelöst – Nachfolger wurden verschoben.`);
}

// Würde "targetId hängt von sourceId ab" einen Kreis erzeugen?
function wouldCauseCircularDependency(sourceId, targetId) {
  if (sourceId === targetId) return true;
  return getAncestors(sourceId).has(targetId);
}

// 2D Dependency Linking
function startDependencyLinking(sourceTaskId, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const sourceTask = tasks.find(t => t.id === sourceTaskId);
  if (!sourceTask) return;

  linkingPredecessorId = sourceTaskId;
  document.body.classList.add('is-linking-dependency');

  const banner = document.getElementById('dependencyLinkingBanner');
  const nameSpan = document.getElementById('linkingSourceTaskName');
  nameSpan.innerText = `"${sourceTask.title}"`;
  banner.classList.remove('hidden');

  if (cachedBarPositions[sourceTaskId]) {
    linkingStartCoords = {
      x: cachedBarPositions[sourceTaskId].endX + 6,
      y: cachedBarPositions[sourceTaskId].centerY
    };
  }

  showToast(`Verknüpfungsmodus aktiv: Wähle die Nachfolge-Aufgabe aus.`);
  render();
}

function cancelDependencyLinking() {
  linkingPredecessorId = null;
  linkingStartCoords = null;
  document.body.classList.remove('is-linking-dependency');
  document.getElementById('dependencyLinkingBanner').classList.add('hidden');
  const liveLine = document.getElementById('svgLiveLinkLine');
  if (liveLine) liveLine.classList.add('hidden');
  render();
}

window.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && linkingPredecessorId) {
    cancelDependencyLinking();
  }
});

document.addEventListener('mousemove', function(e) {
  if (!linkingPredecessorId || !linkingStartCoords) return;
  const timelineWrapper = document.getElementById('ganttTimelineWrapper');
  const svg = document.getElementById('ganttDependencySvg');
  const liveLine = document.getElementById('svgLiveLinkLine');
  if (!timelineWrapper || !svg || !liveLine) return;

  const rect = svg.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;

  const startX = linkingStartCoords.x;
  const startY = linkingStartCoords.y;
  const deltaX = Math.max(25, (currentX - startX) / 2);

  liveLine.setAttribute('d', `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${currentX - deltaX} ${currentY}, ${currentX} ${currentY}`);
  liveLine.classList.remove('hidden');
});

function handleTaskClickInGantt(targetTaskId, e) {
  if (e) e.stopPropagation();

  if (!linkingPredecessorId) {
    editTask(targetTaskId);
    return;
  }

  if (linkingPredecessorId === targetTaskId) {
    showToast('Eine Aufgabe kann nicht von sich selbst abhängen!', 'error');
    return;
  }

  if (wouldCauseCircularDependency(linkingPredecessorId, targetTaskId)) {
    showToast('Zirkuläre Abhängigkeit nicht erlaubt!', 'error');
    cancelDependencyLinking();
    return;
  }

  const targetTask = tasks.find(t => t.id === targetTaskId);
  const sourceTask = tasks.find(t => t.id === linkingPredecessorId);

  if (targetTask && sourceTask) {
    if (targetTask.dependsOn.includes(linkingPredecessorId)) {
      showToast(`"${targetTask.title}" hängt bereits von "${sourceTask.title}" ab.`, 'error');
    } else {
      targetTask.dependsOn.push(linkingPredecessorId);
      const shifted = shiftAfterPredecessors(targetTask);
      cascadeDependentTasks(targetTask.id);
      saveTasks();
      showToast(`Abhängigkeit verknüpft: "${sourceTask.title}" ➔ "${targetTask.title}"${shifted ? ' (Termin verschoben)' : ''}`);
    }
  }

  cancelDependencyLinking();
}

// Ohne predId werden alle Vorgänger der Aufgabe gelöst
function removeDependency(taskId, predId, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const t = getTask(taskId);
  if (!t) return;
  const removed = predId ? [predId] : [...t.dependsOn];
  t.dependsOn = predId ? t.dependsOn.filter(id => id !== predId) : [];
  saveTasks();
  render();
  const names = removed.map(id => (getTask(id) || {}).title || 'Vorgänger').join('", "');
  showToast(`Abhängigkeit gelöst: "${t.title}" hängt nicht mehr von "${names}" ab.`);
}

function confirmRemoveDependency(taskId, predId, e) {
  if (e) e.stopPropagation();
  const t = getTask(taskId);
  const p = getTask(predId);
  if (!t || !p) return;
  if (confirm(`Abhängigkeit lösen?\n\n"${p.title}"  ➔  "${t.title}"`)) {
    removeDependency(taskId, predId);
  }
}

// Hover: komplette Abhängigkeitskette (Vorgänger + Nachfolger) hervorheben
function highlightDependencyChain(taskId) {
  if (linkingPredecessorId) return;
  const view = document.getElementById('ganttView');
  const related = new Set([taskId, ...getAncestors(taskId), ...getDescendants(taskId)]);
  if (related.size === 1) return;
  view.classList.add('dep-focus');
  view.querySelectorAll('[data-task-id]').forEach(el => {
    el.classList.toggle('dep-related', related.has(el.dataset.taskId));
  });
  view.querySelectorAll('[data-group-tasks]').forEach(el => {
    el.classList.toggle('dep-related', el.dataset.groupTasks.split(',').some(id => related.has(id)));
  });
  view.querySelectorAll('.dep-edge').forEach(el => {
    el.classList.toggle('dep-related', related.has(el.dataset.from) && related.has(el.dataset.to));
  });
}

function clearDependencyHighlight() {
  const view = document.getElementById('ganttView');
  view.classList.remove('dep-focus');
  view.querySelectorAll('.dep-related').forEach(el => el.classList.remove('dep-related'));
}

// Left sidebar drag and drop: sortieren und in andere Gruppe verschieben
function handleLeftRowDragStart(e, taskId) {
  draggedLeftTaskId = taskId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', taskId);
  e.currentTarget.classList.add('dragging');
  clearDependencyHighlight();
}

function handleLeftRowDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  const rect = row.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;

  row.classList.remove('drag-over-top', 'drag-over-bottom');
  if (e.clientY < mid) {
    row.classList.add('drag-over-top');
  } else {
    row.classList.add('drag-over-bottom');
  }
}

function handleLeftRowDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
}

function handleLeftRowDrop(e, targetTaskId) {
  e.preventDefault();
  const row = e.currentTarget;
  const insertAfter = e.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
  row.classList.remove('drag-over-top', 'drag-over-bottom');

  const sourceId = draggedLeftTaskId;
  draggedLeftTaskId = null;
  if (!sourceId || sourceId === targetTaskId) return;

  const globalSourceIndex = tasks.findIndex(t => t.id === sourceId);
  if (globalSourceIndex === -1 || !getTask(targetTaskId)) return;

  const [movedItem] = tasks.splice(globalSourceIndex, 1);
  const targetTask = getTask(targetTaskId);
  const globalTargetIndex = tasks.indexOf(targetTask);
  tasks.splice(globalTargetIndex + (insertAfter ? 1 : 0), 0, movedItem);

  const targetKey = getGroupKey(targetTask);
  const movedGroup = groupBy !== 'none' && getGroupKey(movedItem) !== targetKey;
  if (movedGroup) assignTaskToGroup(movedItem, targetKey);

  saveTasks();
  render();
  showToast(movedGroup ? `"${movedItem.title}" ➔ Gruppe "${targetKey}"` : `Aufgabe "${movedItem.title}" verschoben`);
}

function handleGroupDragOver(e) {
  if (!draggedLeftTaskId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over-group');
}

function handleGroupDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-group');
}

// Auf Gruppenkopf fallen lassen = ans Ende dieser Gruppe verschieben
function handleGroupDrop(e, key) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over-group');
  const sourceId = draggedLeftTaskId;
  draggedLeftTaskId = null;
  const task = getTask(sourceId);
  if (!task) return;

  tasks.splice(tasks.indexOf(task), 1);
  let lastIndex = -1;
  tasks.forEach((t, i) => { if (getGroupKey(t) === key) lastIndex = i; });
  tasks.splice(lastIndex === -1 ? tasks.length : lastIndex + 1, 0, task);

  const changed = getGroupKey(task) !== key;
  if (changed) assignTaskToGroup(task, key);
  saveTasks();
  render();
  showToast(changed ? `"${task.title}" ➔ Gruppe "${key}"` : `"${task.title}" ans Gruppenende verschoben`);
}

function handleLeftRowDragEnd(e) {
  e.currentTarget.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
  document.querySelectorAll('.gantt-left-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
  document.querySelectorAll('.drag-over-group').forEach(r => r.classList.remove('drag-over-group'));
  draggedLeftTaskId = null;
}
