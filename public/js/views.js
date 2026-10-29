// Ansichten: Umschalten, Kanban, Tabelle, Render-Einstieg
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

// View Switching (Gantt 2D, Kanban, Table)
function switchView(view) {
  currentView = view;
  const ganttView = document.getElementById('ganttView');
  const kanbanView = document.getElementById('kanbanView');
  const tableView = document.getElementById('tableView');

  const btnGantt = document.getElementById('btnViewGantt');
  const btnKanban = document.getElementById('btnViewKanban');
  const btnTable = document.getElementById('btnViewTable');

  const views = [ganttView, kanbanView, tableView].filter(Boolean);
  const buttons = [btnGantt, btnKanban, btnTable].filter(Boolean);

  views.forEach(v => v.classList.add('hidden'));
  buttons.forEach(b => {
    b.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200';
  });

  if (view === 'gantt' && ganttView && btnGantt) {
    ganttView.classList.remove('hidden');
    btnGantt.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all bg-emerald-600 text-white shadow-sm';
    setTimeout(scrollGanttToToday, 60);
  } else if (view === 'kanban' && kanbanView && btnKanban) {
    kanbanView.classList.remove('hidden');
    kanbanView.classList.add('grid');
    btnKanban.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all bg-emerald-600 text-white shadow-sm';
  } else if (view === 'table' && tableView && btnTable) {
    tableView.classList.remove('hidden');
    btnTable.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all bg-emerald-600 text-white shadow-sm';
  }
  render();
}

// Kanban Rendering
function renderKanban(filteredTasks) {
  const colMap = {
    'Offen': { el: document.getElementById('colOffen'), badge: document.getElementById('badgeCountOffen'), list: [] },
    'In Arbeit': { el: document.getElementById('colInArbeit'), badge: document.getElementById('badgeCountInArbeit'), list: [] },
    'Im Testen': { el: document.getElementById('colImTesten'), badge: document.getElementById('badgeCountImTesten'), list: [] },
    'Blockiert': { el: document.getElementById('colBlockiert'), badge: document.getElementById('badgeCountBlockiert'), list: [] },
    'Erledigt': { el: document.getElementById('colErledigt'), badge: document.getElementById('badgeCountErledigt'), list: [] }
  };

  Object.values(colMap).forEach(col => col.el.innerHTML = '');

  // innerhalb der Spalten nach Gruppe sortiert
  const ordered = buildGroups(filteredTasks, groupBy === 'status' ? 'none' : groupBy).flatMap(g => g.tasks);
  ordered.forEach(task => {
    if (task.status === 'Abgebrochen') {
      colMap['Erledigt'].list.push(task);
    } else if (colMap[task.status]) {
      colMap[task.status].list.push(task);
    } else {
      colMap['Offen'].list.push(task);
    }
  });

  Object.keys(colMap).forEach(key => {
    const item = colMap[key];
    item.badge.innerText = item.list.length;

    if (item.list.length === 0) {
      item.el.innerHTML = `
        <div class="h-28 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-800/80 rounded-xl text-slate-400 dark:text-slate-600 text-xs">
          <span>Keine Aufgaben</span>
        </div>
      `;
      return;
    }

    item.list.forEach(t => {
      const card = document.createElement('div');
      card.className = 'kanban-card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl p-3.5 shadow-sm space-y-2.5';
      card.draggable = true;
      card.id = `card-${t.id}`;
      card.dataset.taskId = t.id;

      card.ondragstart = (e) => handleDragStart(e, t.id);
      card.ondragend = (e) => handleDragEnd(e);

      const isOverdue = t.endDate && new Date(t.endDate) < new Date().setHours(0,0,0,0) && !isClosed(t);
      const preds = getPredecessors(t);
      const groupColor = getGroupColor(t.group || NO_GROUP);
      card.style.borderLeft = `4px solid ${t.group ? groupColor : 'transparent'}`;

      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <span class="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug break-words flex-1 ${t.status === 'Abgebrochen' ? 'line-through opacity-60' : ''}">${t.milestone ? '<span class="inline-block w-2 h-2 rotate-45 bg-amber-500 mr-1.5 align-middle" title="Meilenstein"></span>' : ''}${escapeHTML(t.title)}</span>
          <div class="flex items-center gap-1 opacity-70 hover:opacity-100 transition">
            <button onclick="editTask('${t.id}')" title="Bearbeiten" class="p-1 hover:text-emerald-500 text-slate-400 dark:text-slate-400">
              <svg class="icon text-xs" aria-hidden="true"><use href="#i-pencil"></use></svg>
            </button>
            <button onclick="deleteTask('${t.id}')" title="Löschen" class="p-1 hover:text-rose-500 text-slate-400 dark:text-slate-400">
              <svg class="icon text-xs" aria-hidden="true"><use href="#i-trash-2"></use></svg>
            </button>
          </div>
        </div>

        <div class="flex items-center flex-wrap gap-1.5">
          ${isInboxTask(t) ? getInboxBadge() : ''}
          ${getExtendedBadge(t)}
          ${t.group ? getGroupBadge(t.group) : ''}
          ${getPhaseBadge(t.phase)}
          ${getPriorityBadge(t.priority)}
          ${t.owner ? `<span class="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1"><svg class="icon text-[8px]" aria-hidden="true"><use href="#i-user"></use></svg>${escapeHTML(t.owner)}</span>` : ''}
        </div>

        ${preds.length ? `<div class="space-y-1">${preds.map(p => getDependencyChip(p, t)).join('')}</div>` : ''}

        ${t.status === 'Blockiert' && (t.blockReason || t.waitingFor) ? `
          <div class="text-[10px] text-rose-700 dark:text-rose-300 bg-rose-500/10 border border-rose-500/25 px-2 py-1 rounded-md space-y-0.5">
            ${t.blockReason ? `<div class="flex gap-1.5"><svg class="icon text-[9px] mt-0.5" aria-hidden="true"><use href="#i-ban"></use></svg><span>${escapeHTML(t.blockReason)}</span></div>` : ''}
            ${t.waitingFor ? `<div class="flex gap-1.5"><svg class="icon text-[9px] mt-0.5" aria-hidden="true"><use href="#i-clock-alert"></use></svg><span>Wartet auf: ${escapeHTML(t.waitingFor)}</span></div>` : ''}
          </div>` : ''}

        <!-- Progress bar -->
        <div class="space-y-1">
          <div class="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
            <span>Fortschritt</span>
            <span class="font-semibold text-slate-800 dark:text-slate-200">${t.progress || 0}%</span>
          </div>
          <div class="w-full bg-slate-100 dark:bg-slate-950 rounded-full h-1.5 border border-slate-200 dark:border-slate-800">
            <div class="bg-emerald-500 h-1.5 rounded-full transition-all" style="width: ${t.progress || 0}%"></div>
          </div>
        </div>

        ${t.nextAction ? `
          <div class="bg-slate-50 dark:bg-slate-950/70 rounded-lg p-2 border border-slate-200 dark:border-slate-800/60 text-[11px] text-slate-700 dark:text-slate-300 flex items-start gap-1.5">
            <svg class="icon text-emerald-500 dark:text-emerald-400 mt-0.5" aria-hidden="true"><use href="#i-move-right"></use></svg>
            <div class="flex-1">
              <span class="text-slate-400 dark:text-slate-500 font-medium block text-[9px] uppercase tracking-wider">Nächster Schritt</span>
              <span class="leading-tight">${escapeHTML(t.nextAction)}</span>
            </div>
          </div>
        ` : ''}

        <div class="pt-2 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <div class="flex items-center gap-1.5 ${isOverdue ? 'text-rose-600 dark:text-rose-400 font-medium' : ''}">
            <svg class="icon text-xs" aria-hidden="true"><use href="#i-clock"></use></svg>
            <span>${formatDate(t.endDate)}</span>
            ${isOverdue ? '<span class="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-300 px-1 rounded font-medium border border-rose-500/20">Fällig</span>' : ''}
          </div>
          <div>
            <select onchange="updateTaskStatusDirectly('${t.id}', this.value)" class="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[10px] text-slate-700 dark:text-slate-300 rounded px-1.5 py-0.5 outline-none">
              ${getStatusOptions(t.status)}
            </select>
          </div>
        </div>
      `;
      item.el.appendChild(card);
    });
  });
}

// Table Rendering
function renderTable(filteredTasks) {
  const tbody = document.getElementById('tableBody');
  const emptyState = document.getElementById('tableEmptyState');
  tbody.innerHTML = '';

  if (filteredTasks.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  let list = [...filteredTasks];
  if (sortColumn) {
    list.sort((a, b) => {
      let valA = a[sortColumn] || '';
      let valB = b[sortColumn] || '';
      if (sortColumn === 'priority') {
        const weight = { 'Hoch': 3, 'Mittel': 2, 'Niedrig': 1 };
        valA = weight[valA] || 0;
        valB = weight[valB] || 0;
      } else if (sortColumn === 'progress') {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  buildGroups(list).forEach(group => {
    const collapsed = isGroupCollapsed(group.key);
    if (group.key !== null) {
      const color = getGroupColor(group.key);
      const doneCount = group.tasks.filter(t => t.status === 'Erledigt').length;
      const head = document.createElement('tr');
      head.className = `cursor-pointer bg-slate-100 dark:bg-slate-900/90 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 ${collapsed ? 'collapsed' : ''}`;
      head.onclick = (e) => toggleGroup(group.key, e);
      head.innerHTML = `
        <td colspan="9" class="py-2 px-3 text-xs" style="box-shadow: inset 4px 0 0 ${color};">
          <div class="flex items-center gap-2">
            <svg class="icon group-chevron text-[10px] text-slate-500 w-3" aria-hidden="true"><use href="#i-chevron-down"></use></svg>
            <span class="font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(group.key)}</span>
            <span class="text-[10px] px-1.5 py-px rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">${doneCount}/${group.tasks.length} erledigt</span>
          </div>
        </td>`;
      tbody.appendChild(head);
    }
    if (!collapsed) group.tasks.forEach(t => renderTableRow(t, group.key));
  });

  function renderTableRow(t, groupKey) {
    const tr = document.createElement('tr');
    tr.dataset.taskId = t.id;
    tr.className = 'hover:bg-slate-50 dark:hover:bg-slate-800/40 transition border-b border-slate-100 dark:border-slate-800/60';

    const isOverdue = t.endDate && new Date(t.endDate) < new Date().setHours(0,0,0,0) && !isClosed(t);
    const preds = getPredecessors(t);

    tr.innerHTML = `
      <td class="py-3.5 px-4" ${groupKey !== null ? `style="box-shadow: inset 4px 0 0 ${getGroupColor(groupKey)}55;"` : ''}>
        <div class="font-medium text-slate-900 dark:text-slate-100 ${t.status === 'Abgebrochen' ? 'line-through opacity-60' : ''}">${t.milestone ? '<span class="inline-block w-2 h-2 rotate-45 bg-amber-500 mr-1.5 align-middle" title="Meilenstein"></span>' : ''}${escapeHTML(t.title)}${isInboxTask(t) ? ` ${getInboxBadge()}` : ''}${t.originalEndDate && !isClosed(t) ? ` ${getExtendedBadge(t)}` : ''}${t.owner ? ` <span class="ml-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap"><svg class="icon text-[8px]" aria-hidden="true"><use href="#i-user"></use></svg> ${escapeHTML(t.owner)}</span>` : ''}</div>
        ${t.group && groupBy !== 'group' ? `<div class="mt-1">${getGroupBadge(t.group)}</div>` : ''}
        ${t.notes ? `<div class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs mt-0.5">${escapeHTML(t.notes)}</div>` : ''}
      </td>
      <td class="py-3.5 px-4">${getPhaseBadge(t.phase)}</td>
      <td class="py-3.5 px-4">${getPriorityBadge(t.priority)}</td>
      <td class="py-3.5 px-4">
        <select onchange="updateTaskStatusDirectly('${t.id}', this.value)" class="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 rounded-lg px-2.5 py-1 outline-none">
          ${getStatusOptions(t.status)}
        </select>
      </td>
      <td class="py-3.5 px-4">
        <div class="flex items-center gap-2">
          <div class="w-16 bg-slate-100 dark:bg-slate-950 rounded-full h-1.5 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div class="bg-emerald-500 h-1.5 rounded-full" style="width: ${t.progress || 0}%"></div>
          </div>
          <span class="text-xs text-slate-600 dark:text-slate-400 font-mono">${t.progress || 0}%</span>
        </div>
      </td>
      <td class="py-3.5 px-4 text-xs text-slate-700 dark:text-slate-300">
        <div class="flex items-center gap-1.5 ${isOverdue ? 'text-rose-600 dark:text-rose-400 font-medium' : ''}">
          <span>${formatDate(t.startDate)} – ${formatDate(t.endDate)}</span>
          ${isOverdue ? '<svg class="icon text-rose-500 text-[10px]" title="Überfällig" aria-hidden="true"><use href="#i-triangle-alert"></use></svg>' : ''}
        </div>
      </td>
      <td class="py-3.5 px-4 text-xs">
        ${preds.length
          ? `<div class="space-y-1 max-w-[220px]">${preds.map(p => getDependencyChip(p, t, true)).join('')}</div>`
          : '<span class="text-slate-400 dark:text-slate-600">-</span>'}
      </td>
      <td class="py-3.5 px-4">
        <div class="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5 max-w-xs truncate">
          ${t.nextAction ? `<svg class="icon text-emerald-500 dark:text-emerald-400 text-[10px]" aria-hidden="true"><use href="#i-arrow-right"></use></svg> ${escapeHTML(t.nextAction)}` : '<span class="text-slate-400 dark:text-slate-600">-</span>'}
        </div>
      </td>
      <td class="py-3.5 px-4 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="editTask('${t.id}')" class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition" title="Bearbeiten">
            <svg class="icon text-xs" aria-hidden="true"><use href="#i-pencil"></use></svg>
          </button>
          <button onclick="deleteTask('${t.id}')" class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-rose-500 transition" title="Löschen">
            <svg class="icon text-xs" aria-hidden="true"><use href="#i-trash-2"></use></svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function updateGanttToolbar(filtered) {
  const n = getConflictCount();
  document.getElementById('btnResolveConflicts').classList.toggle('hidden', n === 0);
  document.getElementById('conflictCountLabel').innerText = `${n} Konflikt${n === 1 ? '' : 'e'}`;

  const keys = groupBy === 'none' ? [] : buildGroups(filtered).map(g => g.key);
  const allCollapsed = keys.length > 0 && keys.every(k => isGroupCollapsed(k));
  document.getElementById('btnToggleAllGroups').classList.toggle('hidden', keys.length === 0);
  document.getElementById('btnToggleAllGroupsLabel').innerText = allCollapsed ? 'Alle aufklappen' : 'Alle zuklappen';
}

function render() {
  populateGroupControls();
  updateInboxButton();
  updateOverviewSummary();
  const filtered = getFilteredTasks();
  updateMetrics();
  updateGanttToolbar(filtered);

  if (currentView === 'gantt') {
    renderGantt(filtered);
  } else if (currentView === 'kanban') {
    renderKanban(filtered);
  } else if (currentView === 'table') {
    renderTable(filtered);
  }
}

function sortTable(column) {
  if (sortColumn === column) {
    sortAsc = !sortAsc;
  } else {
    sortColumn = column;
    sortAsc = true;
  }

  ['title', 'phase', 'priority', 'status', 'progress', 'startDate'].forEach(col => {
    const icon = document.getElementById(`sortIcon_${col}`);
    if (icon) {
      if (col === sortColumn) {
        setIcon(icon, sortAsc ? 'arrow-up' : 'arrow-down', 'ml-1 text-emerald-500');
      } else {
        setIcon(icon, 'arrow-up-down', 'ml-1 text-slate-300 dark:text-slate-600');
      }
    }
  });
  render();
}

// Drag & Drop
function handleDragStart(e, id) {
  draggedTaskId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => {
    const el = document.getElementById(`card-${id}`);
    if (el) el.classList.add('dragging');
  }, 0);
}

function handleDragEnd(e) {
  const el = document.getElementById(`card-${draggedTaskId}`);
  if (el) el.classList.remove('dragging');
  draggedTaskId = null;
  document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drop-highlight'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = e.currentTarget;
  if (!col.classList.contains('drop-highlight')) {
    col.classList.add('drop-highlight');
  }
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drop-highlight');
}

function handleDrop(e, newStatus) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-highlight');
  if (!draggedTaskId) return;

  const taskIndex = tasks.findIndex(t => t.id === draggedTaskId);
  if (taskIndex !== -1 && tasks[taskIndex].status !== newStatus) {
    setTaskStatus(tasks[taskIndex], newStatus);
    saveTasks();
    render();
    showToast(`Status auf "${newStatus}" gesetzt`);
  }
}

function updateTaskStatusDirectly(id, newStatus) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    setTaskStatus(task, newStatus);
    saveTasks();
    render();
    showToast(`Status aktualisiert: ${newStatus}`);
  }
}

function updateProgressDisplay(val) {
  document.getElementById('progressValueText').innerText = `${val}%`;
}

function syncStatusProgress() {
  const status = document.getElementById('taskStatus').value;
  const progressInput = document.getElementById('taskProgress');
  if (status === 'Erledigt') {
    progressInput.value = 100;
  } else if (status === 'Offen' && progressInput.value == 100) {
    progressInput.value = 0;
  }
  updateProgressDisplay(progressInput.value);
}
