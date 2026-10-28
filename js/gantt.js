// Gantt-Chart: Zeichnen, Gruppenzeilen, Verbindungspfeile, Zoom
// Teil des Projekt-Status-Boards – klassisches Script (kein ES-Modul), damit es auch per file:// läuft.

// 2D Gantt Rendering
function getStatusBarColors(status, isDark) {
  if (status === 'Im Testen') {
    return [isDark ? 'bg-violet-600/90 border-violet-400 text-violet-100' : 'bg-violet-600 border-violet-700 text-white shadow-sm', isDark ? 'bg-violet-400/50' : 'bg-violet-800/50'];
  }
  if (status === 'Abgebrochen') {
    return [isDark ? 'bg-slate-800/60 border-slate-600 border-dashed text-slate-400 line-through' : 'bg-slate-200 border-slate-400 border-dashed text-slate-500 line-through', isDark ? 'bg-slate-600/30' : 'bg-slate-300/60'];
  }
  if (status === 'Erledigt') {
    return [isDark ? 'bg-emerald-600/90 border-emerald-400 text-emerald-100' : 'bg-emerald-600 border-emerald-700 text-white shadow-sm', isDark ? 'bg-emerald-400/50' : 'bg-emerald-700/60'];
  }
  if (status === 'Blockiert') {
    return [isDark ? 'bg-rose-600/90 border-rose-400 text-rose-100' : 'bg-rose-600 border-rose-700 text-white shadow-sm', isDark ? 'bg-rose-400/50' : 'bg-rose-700/60'];
  }
  if (status === 'Offen') {
    return [isDark ? 'bg-slate-700/90 border-slate-500 text-slate-200' : 'bg-slate-500 border-slate-600 text-white shadow-sm', isDark ? 'bg-slate-500/50' : 'bg-slate-600/60'];
  }
  return [isDark ? 'bg-blue-600/90 border-blue-400 text-blue-100' : 'bg-blue-600 border-blue-700 text-white shadow-sm', isDark ? 'bg-blue-400/50' : 'bg-blue-700/60'];
}

const DEP_STYLE = {
  done: { color: '#10b981', marker: 'arrowhead-done', dash: '', label: 'Freigegeben (Vorgänger erledigt)' },
  wait: { color: '#6366f1', marker: 'arrowhead-wait', dash: '', label: 'Wartet (Vorgänger läuft noch)' },
  conflict: { color: '#ef4444', marker: 'arrowhead-conflict', dash: '5,4', label: 'KONFLIKT: Nachfolger beginnt vor Ende des Vorgängers' }
};
const DEP_SEVERITY = { done: 0, wait: 1, conflict: 2 };

// Orthogonaler Pfad mit abgerundeten Ecken durch die gegebenen Punkte
function roundedPath(points, radius) {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const lenIn = Math.hypot(cx - px, cy - py);
    const lenOut = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    const ax = cx - ((cx - px) / lenIn) * r;
    const ay = cy - ((cy - py) / lenIn) * r;
    const bx = cx + ((nx - cx) / lenOut) * r;
    const by = cy + ((ny - cy) / lenOut) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L ${last[0]} ${last[1]}`;
}

// Ende -> Anfang: vom Balkenende des Vorgängers zum Balkenanfang des Nachfolgers
function buildDependencyPath(from, to) {
  const OUT = 12;
  const x1 = from.endX + 2;
  const y1 = from.centerY;
  const x2 = to.startX - 3;
  const y2 = to.centerY;

  if (x2 - OUT >= x1 + 4) {
    // genug Platz: entlang der Vorgängerzeile, dann senkrecht in die Nachfolgerzeile
    return roundedPath([[x1, y1], [x2 - OUT, y1], [x2 - OUT, y2], [x2, y2]], 6);
  }
  // Nachfolger beginnt links vom Vorgängerende: um die Zeilengrenze herumführen
  const yMid = y2 > y1 ? to.top : to.top + to.height;
  return roundedPath([[x1, y1], [x1 + OUT, y1], [x1 + OUT, yMid], [x2 - OUT, yMid], [x2 - OUT, y2], [x2, y2]], 6);
}

function renderGantt(filteredTasks) {
  const isDark = document.documentElement.classList.contains('dark');
  const labelList = document.getElementById('ganttTaskLabelList');
  const headerRow = document.getElementById('ganttHeaderRow');
  const bodyRows = document.getElementById('ganttBodyRows');
  const todayIndicator = document.getElementById('ganttTodayIndicator');
  const svg = document.getElementById('ganttDependencySvg');
  const arrowGroup = document.getElementById('svgArrowGroup');
  const timelineWrapper = document.getElementById('ganttTimelineWrapper');

  clearDependencyHighlight();
  labelList.innerHTML = '';
  headerRow.innerHTML = '';
  bodyRows.innerHTML = '';
  if (arrowGroup) arrowGroup.innerHTML = '';
  cachedBarPositions = {};
  cachedGroupPositions = {};

  if (filteredTasks.length === 0) {
    labelList.innerHTML = '<div class="p-4 text-xs text-slate-400 dark:text-slate-500">Keine Aufgaben</div>';
    headerRow.innerHTML = '<div class="p-4 text-xs text-slate-400 dark:text-slate-500">Keine Timeline-Daten</div>';
    todayIndicator.classList.add('hidden');
    svg.setAttribute('width', 0);
    svg.setAttribute('height', 0);
    return;
  }

  let minDate = new Date();
  let maxDate = new Date();

  filteredTasks.forEach((t, i) => {
    const s = new Date(t.startDate || toISO(new Date()));
    const e = new Date(t.endDate || t.startDate || toISO(new Date()));
    if (i === 0) {
      minDate = new Date(s);
      maxDate = new Date(e);
    } else {
      if (s < minDate) minDate = new Date(s);
      if (e > maxDate) maxDate = new Date(e);
    }
  });

  const dayWidth = ganttDayWidth;

  // Heute immer im Zeitraum; Rand links/rechts wächst beim Rauszoomen mit
  const todayStart = new Date();
  if (todayStart < minDate) minDate = new Date(todayStart);
  if (todayStart > maxDate) maxDate = new Date(todayStart);
  // halbe Bildschirmbreite Puffer je Seite, damit Zoomen an der Mausposition immer möglich ist
  const halfViewDays = Math.ceil(timelineWrapper.clientWidth / dayWidth / 2);
  const padDays = Math.max(3, Math.round(140 / dayWidth), halfViewDays);
  minDate.setDate(minDate.getDate() - padDays);
  maxDate.setDate(maxDate.getDate() + padDays);
  minDate.setHours(0, 0, 0, 0);
  maxDate.setHours(0, 0, 0, 0);

  // Beim Rauszoomen die sichtbare Breite mit Zeit füllen statt mit leerer Fläche
  const minVisibleDays = Math.ceil(timelineWrapper.clientWidth / dayWidth) + 1;
  if ((maxDate - minDate) / 86400000 < minVisibleDays) {
    maxDate = new Date(minDate);
    maxDate.setDate(maxDate.getDate() + minVisibleDays);
  }
  ganttMinDate = new Date(minDate);

  const totalDays = Math.max(1, Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24)));

  const totalTimelineWidth = totalDays * dayWidth;
  document.getElementById('ganttInnerTimeline').style.width = `${totalTimelineWidth}px`;

  let curr = new Date(minDate);
  let dayIndex = 0;

  while (curr <= maxDate) {
    const cell = document.createElement('div');
    const isMonday = curr.getDay() === 1;
    const isMonthStart = curr.getDate() === 1;
    // Trennlinien je nach Zoomstufe: Tage > Wochen > Monate
    const showLine = dayWidth >= 12 || (dayWidth >= 5 ? isMonday || isMonthStart : isMonthStart);
    cell.className = `${showLine ? 'border-l' : ''} ${isMonthStart && dayWidth < 28 ? 'border-slate-400 dark:border-slate-600' : 'border-slate-200 dark:border-slate-800/80'} text-[10px] text-slate-500 dark:text-slate-400 flex flex-col justify-center select-none flex-shrink-0 relative overflow-visible whitespace-nowrap ${dayWidth >= 28 ? 'items-center' : 'items-start pl-1'}`;
    cell.style.width = `${dayWidth}px`;

    const isWeekend = curr.getDay() === 0 || curr.getDay() === 6;
    if (isWeekend && dayWidth >= 5) cell.classList.add('bg-slate-200/40', 'dark:bg-slate-900/40');

    const isTodayCell = curr.toDateString() === new Date().toDateString();
    if (isTodayCell) cell.classList.add('text-emerald-600', 'dark:text-emerald-400', 'font-bold', 'bg-emerald-500/10');

    const monthLabel = curr.toLocaleDateString('de-DE', { month: dayWidth < 5 ? 'short' : 'long', year: curr.getMonth() === 0 || dayIndex === 0 ? 'numeric' : undefined });
    if (dayWidth >= 56) {
      // Tage: Wochentag + Datum
      cell.innerHTML = `
        <span class="text-[9px] uppercase text-slate-400 dark:text-slate-500">${curr.toLocaleDateString('de-DE', { weekday: 'short' })}${isMonday ? ` · KW ${getWeekNumber(curr)}` : ''}</span>
        <span class="${isTodayCell ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'}">${curr.getDate()}.${curr.getMonth() + 1}.</span>
      `;
    } else if (dayWidth >= 28) {
      // Wochen: jeden Tag die Zahl, montags Datum + KW
      if (isMonday || isMonthStart || dayIndex === 0) {
        cell.innerHTML = `
          <span class="text-[9px] text-slate-700 dark:text-slate-400 font-semibold">${curr.getDate()}.${curr.getMonth() + 1}.</span>
          <span class="text-[8px] text-slate-400 dark:text-slate-500">KW ${getWeekNumber(curr)}</span>
        `;
      } else {
        cell.innerHTML = `<span class="text-[9px] text-slate-400 dark:text-slate-500">${curr.getDate()}</span>`;
      }
    } else if (dayWidth >= 8) {
      // Monate: oben Monat, unten Kalenderwochen
      cell.innerHTML = `
        <span class="text-[9px] font-semibold text-slate-700 dark:text-slate-300 h-3.5">${isMonthStart || dayIndex === 0 ? monthLabel : ''}</span>
        <span class="text-[8px] text-slate-400 dark:text-slate-500 h-3">${isMonday && dayWidth * 7 >= 30 ? `KW ${getWeekNumber(curr)}` : ''}</span>
      `;
    } else if (isMonthStart || dayIndex === 0) {
      // Quartal / Jahr: nur Monate
      cell.innerHTML = `<span class="text-[9px] font-semibold text-slate-700 dark:text-slate-300">${monthLabel}</span>`;
    }

    headerRow.appendChild(cell);
    curr.setDate(curr.getDate() + 1);
    dayIndex++;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffToToday = (today - minDate) / (1000 * 60 * 60 * 24);
  if (diffToToday >= 0 && diffToToday <= totalDays) {
    todayIndicator.classList.remove('hidden');
    todayIndicator.style.left = `${diffToToday * dayWidth + (dayWidth / 2)}px`;
  } else {
    todayIndicator.classList.add('hidden');
  }

  // Pixel-Spanne eines Zeitraums auf der Timeline
  const spanPx = (startStr, endStr) => {
    const s = new Date(startStr || toISO(new Date()));
    const e = new Date(endStr || startStr || toISO(new Date()));
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    const startOffsetDays = (s - minDate) / (1000 * 60 * 60 * 24);
    const durationDays = Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
    const left = Math.max(0, startOffsetDays * dayWidth);
    return { left, width: Math.max(dayWidth * 0.8, durationDays * dayWidth), durationDays };
  };

  let y = 0;

  const renderGroupRow = (group) => {
    const collapsed = isGroupCollapsed(group.key);
    const color = getGroupColor(group.key);
    const ids = group.tasks.map(t => t.id).join(',');
    const doneCount = group.tasks.filter(t => t.status === 'Erledigt').length;

    let gStart = null;
    let gEnd = null;
    let weightSum = 0;
    let progressSum = 0;
    group.tasks.forEach(t => {
      if (!gStart || t.startDate < gStart) gStart = t.startDate;
      if (!gEnd || t.endDate > gEnd) gEnd = t.endDate;
      const dur = spanPx(t.startDate, t.endDate).durationDays;
      weightSum += dur;
      progressSum += (t.progress || 0) * dur;
    });
    const pct = weightSum ? Math.round(progressSum / weightSum) : 0;
    const conflicts = group.tasks.reduce((n, t) => n + getPredecessors(t).filter(p => getDependencyState(p, t) === 'conflict').length, 0);
    const canRename = groupBy === 'group' && group.key !== NO_GROUP;

    // LEFT GROUP HEADER
    const left = document.createElement('div');
    left.className = `gantt-left-row gantt-group-left h-10 pl-2 pr-3 flex items-center justify-between text-xs border-b border-slate-200 dark:border-slate-800/60 bg-slate-100 dark:bg-slate-900/90 ${collapsed ? 'collapsed' : ''}`;
    left.style.borderLeft = `4px solid ${color}`;
    left.dataset.groupTasks = ids;
    left.title = collapsed ? 'Gruppe aufklappen' : 'Gruppe zuklappen';
    left.onclick = (e) => toggleGroup(group.key, e);
    left.ondragover = handleGroupDragOver;
    left.ondragleave = handleGroupDragLeave;
    left.ondrop = (e) => handleGroupDrop(e, group.key);
    left.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <svg class="icon group-chevron text-[10px] text-slate-500 dark:text-slate-400 w-3" aria-hidden="true"><use href="#i-chevron-down"></use></svg>
        <span class="font-semibold text-slate-800 dark:text-slate-100 truncate" title="${escapeHTML(group.key)}">${escapeHTML(group.key)}</span>
        <span class="text-[10px] px-1.5 py-px rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0" title="${doneCount} von ${group.tasks.length} erledigt">${doneCount}/${group.tasks.length}</span>
        ${conflicts ? `<svg class="icon text-rose-500 text-[10px] flex-shrink-0" title="${conflicts} Abhängigkeitskonflikt(e) in dieser Gruppe" aria-hidden="true"><use href="#i-triangle-alert"></use></svg>` : ''}
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        ${canRename ? `<button type="button" data-rename-group class="p-1 rounded text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-white dark:hover:bg-slate-800 transition" title="Gruppe umbenennen"><svg class="icon text-[9px]" aria-hidden="true"><use href="#i-pencil"></use></svg></button>` : ''}
        <button type="button" data-add-group class="p-1 rounded text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-white dark:hover:bg-slate-800 transition" title="Aufgabe in dieser Gruppe anlegen"><svg class="icon text-[10px]" aria-hidden="true"><use href="#i-plus"></use></svg></button>
        <span class="text-[11px] font-mono font-semibold ml-1" style="color:${color}">${pct}%</span>
      </div>
    `;
    left.querySelector('[data-add-group]').onclick = (e) => addTaskToGroup(group.key, e);
    if (canRename) left.querySelector('[data-rename-group]').onclick = (e) => renameGroup(group.key, e);
    labelList.appendChild(left);

    // RIGHT GROUP SUMMARY ROW
    const span = spanPx(gStart, gEnd);
    const row = document.createElement('div');
    row.className = 'gantt-group-row h-10 relative border-b border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-900/40 cursor-pointer';
    row.style.width = `${totalTimelineWidth}px`;
    row.dataset.groupTasks = ids;
    row.onclick = (e) => toggleGroup(group.key, e);
    row.innerHTML = `
      <div class="gantt-group-bar absolute" style="left:${span.left}px; width:${span.width}px; top:13px; height:14px;"
           title="${escapeHTML(group.key)}: ${formatDate(gStart)} bis ${formatDate(gEnd)} – ${pct}% (${group.tasks.length} Aufgaben)">
        <div class="absolute inset-x-0 top-0 h-[9px] rounded-sm overflow-hidden" style="background:${color}33; border:1px solid ${color};">
          <div class="h-full" style="width:${pct}%; background:${color}; opacity:0.8;"></div>
        </div>
        <span class="absolute left-0 bottom-0 w-0 h-0" style="border-top:6px solid ${color}; border-right:6px solid transparent;"></span>
        <span class="absolute right-0 bottom-0 w-0 h-0" style="border-top:6px solid ${color}; border-left:6px solid transparent;"></span>
        <span class="absolute top-[-2px] whitespace-nowrap text-[10px] font-semibold pointer-events-none" style="left:${span.width + 8}px; color:${color};">${escapeHTML(group.key)}${collapsed ? ` · ${group.tasks.length} Aufgaben` : ''}</span>
      </div>
    `;
    bodyRows.appendChild(row);

    cachedGroupPositions[group.key] = {
      id: `group:${group.key}`,
      startX: span.left,
      endX: span.left + span.width,
      centerY: y + 18,
      top: y,
      height: GROUP_H
    };
    y += GROUP_H;
  };

  const renderTaskRow = (task, groupKey) => {
    const isSelf = linkingPredecessorId === task.id;
    const isInvalid = linkingPredecessorId && (isSelf || wouldCauseCircularDependency(linkingPredecessorId, task.id));
    const isValidTarget = linkingPredecessorId && !isInvalid;
    const color = groupKey !== null ? getGroupColor(groupKey) : null;

    const preds = getPredecessors(task);
    const succs = getSuccessors(task.id);
    const conflictPreds = preds.filter(p => getDependencyState(p, task) === 'conflict');
    const openPreds = preds.filter(p => !isClosed(p));

    let depInfo = '';
    if (conflictPreds.length) {
      depInfo = `<span class="text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1 flex-shrink-0" title="Beginnt vor dem Ende von: ${escapeHTML(conflictPreds.map(p => p.title).join(', '))}"><svg class="icon text-[9px]" aria-hidden="true"><use href="#i-triangle-alert"></use></svg>Konflikt</span>`;
    } else if (openPreds.length) {
      depInfo = `<span class="text-indigo-600 dark:text-indigo-400 flex items-center gap-1 flex-shrink-0" title="Wartet auf: ${escapeHTML(openPreds.map(p => p.title).join(', '))}"><svg class="icon text-[9px]" aria-hidden="true"><use href="#i-hourglass"></use></svg>wartet auf ${openPreds.length}</span>`;
    } else if (preds.length) {
      depInfo = `<span class="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 flex-shrink-0" title="Alle Vorgänger erledigt: ${escapeHTML(preds.map(p => p.title).join(', '))}"><svg class="icon text-[9px]" aria-hidden="true"><use href="#i-circle-check"></use></svg>freigegeben</span>`;
    }
    const succInfo = succs.length
      ? `<span class="text-slate-400 dark:text-slate-500 flex items-center gap-1 flex-shrink-0" title="Nachfolger: ${escapeHTML(succs.map(s => s.title).join(', '))}"><svg class="icon text-[9px]" aria-hidden="true"><use href="#i-move-right"></use></svg>${succs.length}</span>`
      : '';

    // LEFT ROW
    const labelRow = document.createElement('div');
    labelRow.className = `gantt-left-row h-14 ${color ? 'pl-4' : 'pl-3'} pr-3 flex items-center justify-between text-xs transition border-b border-slate-200 dark:border-slate-800/60 ${isValidTarget ? 'valid-target bg-emerald-500/5' : ''} ${isInvalid ? 'invalid-target' : ''}`;
    if (color) labelRow.style.boxShadow = `inset 3px 0 0 ${color}55`;
    labelRow.draggable = !linkingPredecessorId;
    labelRow.id = `gantt-label-${task.id}`;
    labelRow.dataset.taskId = task.id;

    if (!linkingPredecessorId) {
      labelRow.ondragstart = (e) => handleLeftRowDragStart(e, task.id);
      labelRow.ondragover = (e) => handleLeftRowDragOver(e);
      labelRow.ondragleave = (e) => handleLeftRowDragLeave(e);
      labelRow.ondrop = (e) => handleLeftRowDrop(e, task.id);
      labelRow.ondragend = (e) => handleLeftRowDragEnd(e);
    }

    labelRow.onclick = (e) => handleTaskClickInGantt(task.id, e);
    labelRow.onmouseenter = () => highlightDependencyChain(task.id);
    labelRow.onmouseleave = clearDependencyHighlight;

    labelRow.innerHTML = `
      <div class="flex items-center gap-2 truncate pr-2 min-w-0">
        <span class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab px-0.5" title="Ziehen zum Sortieren oder in eine andere Gruppe verschieben">
          <svg class="icon text-xs" aria-hidden="true"><use href="#i-grip-vertical"></use></svg>
        </span>
        <div class="truncate min-w-0">
          <div class="font-medium text-slate-900 dark:text-slate-200 truncate" title="${escapeHTML(task.title)}">${escapeHTML(task.title)}</div>
          <div class="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5 min-w-0">
            ${[
              task.owner ? `<span class="flex-shrink-0 font-semibold text-slate-600 dark:text-slate-300" title="Verantwortlich"><svg class="icon text-[8px] mr-0.5" aria-hidden="true"><use href="#i-user"></use></svg>${escapeHTML(task.owner)}</span>` : '',
              `<span class="flex-shrink-0 ${task.status === 'Blockiert' ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}" ${task.blockReason || task.waitingFor ? `title="${escapeHTML([task.blockReason, task.waitingFor ? 'Wartet auf: ' + task.waitingFor : ''].filter(Boolean).join(' – '))}"` : ''}>${escapeHTML(task.status)}${task.status === 'Blockiert' && (task.blockReason || task.waitingFor) ? ' <svg class="icon text-[8px]" aria-hidden="true"><use href="#i-info"></use></svg>' : ''}</span>`,
              (groupBy === 'phase' ? '' : task.phase) ? `<span class="truncate">${escapeHTML(task.phase)}</span>` : '',
              depInfo,
              succInfo
            ].filter(Boolean).join('<span class="flex-shrink-0">•</span>')}
          </div>
        </div>
      </div>
      <span class="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold flex-shrink-0">${task.progress || 0}%</span>
    `;
    labelList.appendChild(labelRow);

    // RIGHT ROW
    const row = document.createElement('div');
    row.className = `gantt-row h-14 relative flex items-center border-b border-slate-100 dark:border-slate-800/60 ${isValidTarget ? 'valid-target bg-emerald-500/5' : ''} ${isInvalid ? 'invalid-target' : ''}`;
    row.style.width = `${totalTimelineWidth}px`;
    row.id = `gantt-row-${task.id}`;
    row.dataset.taskId = task.id;
    row.onclick = (e) => handleTaskClickInGantt(task.id, e);
    row.onmouseenter = () => highlightDependencyChain(task.id);
    row.onmouseleave = clearDependencyHighlight;

    let span = spanPx(task.startDate, task.endDate);
    if (task.milestone) {
      // Raute in der Mitte des Endtages
      const end = spanPx(task.endDate, task.endDate);
      span = { left: end.left + dayWidth / 2 - 11, width: 22, durationDays: 1 };
    }
    cachedBarPositions[task.id] = {
      id: task.id,
      startX: span.left,
      endX: span.left + span.width,
      centerY: y + ROW_H / 2,
      top: y,
      height: ROW_H,
      title: task.title
    };

    let [barColor, progressFillColor] = getStatusBarColors(task.status, isDark);
    if (isSelf) {
      barColor += ' ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 animate-pulse';
    }

    const barWrapper = document.createElement('div');
    barWrapper.className = 'gantt-bar-wrapper';
    barWrapper.style.left = `${span.left}px`;

    const barTooltip = `${escapeHTML(task.title)} (${task.status})\n${formatDate(task.startDate)} bis ${formatDate(task.endDate)} - ${task.progress || 0}%${task.owner ? `\nVerantwortlich: ${escapeHTML(task.owner)}` : ''}${task.blockReason ? `\nBlockiert: ${escapeHTML(task.blockReason)}` : ''}${preds.length ? `\nNach: ${escapeHTML(preds.map(p => p.title).join(', '))}` : ''}`;
    const isShort = span.width < 110;
    const outsideLabel = isShort
      ? `<span class="ml-1.5 text-[11px] font-medium whitespace-nowrap text-slate-700 dark:text-slate-300 pointer-events-none ${task.status === 'Abgebrochen' ? 'line-through opacity-60' : ''}">${escapeHTML(task.title)}${task.milestone ? ` · ${formatDate(task.endDate)}` : ''}</span>`
      : '';

    const connectBtn = `
      <!-- THE HOVER PLUS (+) CONNECTOR HANDLE -->
      <button type="button" 
              onclick="startDependencyLinking('${task.id}', event)" 
              class="dep-connect-btn ml-1.5 w-6 h-6 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center text-xs font-bold shadow-lg shadow-rose-500/40 hover:scale-110 active:scale-95 transition-all cursor-pointer border border-white/40 flex-shrink-0"
              title="Abhängigkeit erstellen: Klicke hier und danach auf den Nachfolger-Task!">
        <svg class="icon text-[11px] pointer-events-none" aria-hidden="true"><use href="#i-plus"></use></svg>
      </button>`;

    if (task.milestone) {
      const milestoneColor = isClosed(task) ? '#10b981' : '#f59e0b';
      barWrapper.innerHTML = `
        <div class="gantt-bar w-[22px] h-[22px] flex items-center justify-center ${isSelf ? 'animate-pulse' : ''}" onclick="handleTaskClickInGantt('${task.id}', event)" title="Meilenstein: ${barTooltip}">
          <div class="w-4 h-4 rotate-45 rounded-[3px] border-2 shadow" style="background:${milestoneColor}; border-color:${isDark ? '#fde68a' : '#92400e'};"></div>
        </div>
        ${connectBtn}
        ${outsideLabel}
      `;
      row.appendChild(barWrapper);
      bodyRows.appendChild(row);
      y += ROW_H;
      return;
    }

    barWrapper.innerHTML = `
      <!-- The Main Time Bar -->
      <div class="gantt-bar h-8 rounded-lg border flex items-center px-2.5 overflow-hidden text-xs select-none relative ${barColor}"
           style="width: ${span.width}px;${color ? ` box-shadow: inset 3px 0 0 ${color};` : ''}"
           onclick="handleTaskClickInGantt('${task.id}', event)"
           title="${barTooltip}">
        <div class="absolute left-0 top-0 bottom-0 ${progressFillColor} pointer-events-none transition-all" style="width: ${task.progress || 0}%;"></div>
        ${isShort
          ? (span.width >= 44 ? `<div class="relative z-10 w-full text-center text-[10px] font-mono font-medium">${task.progress || 0}%</div>` : '')
          : `<div class="relative z-10 truncate flex items-center justify-between w-full font-medium">
          <span class="truncate drop-shadow-xs">${escapeHTML(task.title)}</span>
          <span class="ml-1.5 text-[10px] font-mono opacity-95">${task.progress || 0}%</span>
        </div>`}
      </div>
      ${connectBtn}
      ${outsideLabel}
    `;

    row.appendChild(barWrapper);
    bodyRows.appendChild(row);
    y += ROW_H;
  };

  buildGroups(filteredTasks).forEach(group => {
    if (group.key !== null) renderGroupRow(group);
    if (!isGroupCollapsed(group.key)) group.tasks.forEach(task => renderTaskRow(task, group.key));
  });

  // Abstandshalter, damit beide Spalten gleich weit scrollen (horizontale Scrollbar der Timeline ausgleichen)
  const scrollbarH = timelineWrapper.offsetHeight - timelineWrapper.clientHeight;
  const rightSpacer = document.createElement('div');
  rightSpacer.style.height = '24px';
  bodyRows.appendChild(rightSpacer);
  const leftSpacer = document.createElement('div');
  leftSpacer.style.height = `${24 + Math.max(0, scrollbarH)}px`;
  labelList.appendChild(leftSpacer);

  svg.setAttribute('width', totalTimelineWidth);
  svg.setAttribute('height', y);
  svg.style.width = `${totalTimelineWidth}px`;
  svg.style.height = `${y}px`;

  // Endpunkt einer Aufgabe: eigener Balken oder – bei zugeklappter Gruppe – der Sammelbalken
  const visibleIds = new Set(filteredTasks.map(t => t.id));
  const endpointOf = (task) => {
    if (cachedBarPositions[task.id]) return cachedBarPositions[task.id];
    if (!visibleIds.has(task.id)) return null;
    return cachedGroupPositions[getGroupKey(task)] || null;
  };

  // Kanten sammeln (bei zugeklappten Gruppen zusammenfassen)
  const edges = new Map();
  filteredTasks.forEach(task => {
    getPredecessors(task).forEach(pred => {
      const from = endpointOf(pred);
      const to = endpointOf(task);
      if (!from || !to || from === to) return;
      const sig = `${from.id}>${to.id}`;
      const state = getDependencyState(pred, task);
      if (!edges.has(sig)) {
        edges.set(sig, { from, to, state, pairs: [] });
      }
      const edge = edges.get(sig);
      if (DEP_SEVERITY[state] > DEP_SEVERITY[edge.state]) edge.state = state;
      edge.pairs.push({ pred, task });
    });
  });

  const svgNS = 'http://www.w3.org/2000/svg';
  edges.forEach(edge => {
    const style = DEP_STYLE[edge.state];
    const d = buildDependencyPath(edge.from, edge.to);
    const single = edge.pairs.length === 1;

    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', 'dep-edge');
    g.dataset.from = edge.pairs[0].pred.id;
    g.dataset.to = edge.pairs[0].task.id;

    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', d);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', style.color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round');
    if (style.dash) line.setAttribute('stroke-dasharray', style.dash);
    line.setAttribute('marker-end', `url(#${style.marker})`);
    line.setAttribute('class', 'dep-line');

    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', edge.from.endX + 2);
    dot.setAttribute('cy', edge.from.centerY);
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', style.color);
    dot.setAttribute('class', 'dep-line');

    // breiter, unsichtbarer Klickbereich
    const hit = document.createElementNS(svgNS, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '12');
    hit.setAttribute('class', 'dep-hit');
    const title = document.createElementNS(svgNS, 'title');
    const lines = edge.pairs.map(p => `${p.pred.title}  ➔  ${p.task.title}`).join('\n');
    title.textContent = `${lines}\n${style.label}\n${single ? 'Klick: Abhängigkeit lösen' : 'Gruppe aufklappen, um einzelne Abhängigkeiten zu lösen'}`;
    hit.appendChild(title);
    hit.onclick = (e) => {
      if (single) confirmRemoveDependency(edge.pairs[0].task.id, edge.pairs[0].pred.id, e);
      else e.stopPropagation();
    };

    g.appendChild(line);
    g.appendChild(dot);
    g.appendChild(hit);
    arrowGroup.appendChild(g);
  });
}

function scrollGanttToToday() {
  const todayIndicator = document.getElementById('ganttTodayIndicator');
  const wrapper = document.getElementById('ganttTimelineWrapper');
  if (todayIndicator && wrapper && !todayIndicator.classList.contains('hidden')) {
    const left = parseFloat(todayIndicator.style.left || 0);
    wrapper.scrollTo({
      left: Math.max(0, left - wrapper.clientWidth / 2),
      behavior: 'smooth'
    });
  }
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function setGanttZoom(preset) {
  applyGanttZoom(ZOOM_PRESETS[preset]);
}

// factor > 1 = reinzoomen (weniger Zeitraum), < 1 = rauszoomen (mehr Zeitraum)
function zoomGantt(factor, anchorClientX) {
  applyGanttZoom(ganttDayWidth * factor, anchorClientX);
}

// Setzt den Zoom und hält das Datum unter dem Anker (Maus bzw. Mitte) an derselben Stelle
function applyGanttZoom(newDayWidth, anchorClientX) {
  const wrapper = document.getElementById('ganttTimelineWrapper');
  const rect = wrapper.getBoundingClientRect();
  const anchorX = anchorClientX !== undefined ? anchorClientX - rect.left : wrapper.clientWidth / 2;
  const anchorDay = ganttMinDate ? (wrapper.scrollLeft + anchorX) / ganttDayWidth : null;
  const anchorDate = anchorDay !== null ? ganttMinDate.getTime() + anchorDay * 86400000 : null;

  ganttDayWidth = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newDayWidth));
  try { localStorage.setItem(ZOOM_KEY, String(ganttDayWidth)); } catch (e) {}
  updateZoomControls();
  renderGantt(getFilteredTasks());

  if (anchorDate !== null && ganttMinDate) {
    const newDay = (anchorDate - ganttMinDate.getTime()) / 86400000;
    wrapper.scrollLeft = Math.max(0, newDay * ganttDayWidth - anchorX);
  }
}

function updateZoomControls() {
  const active = Object.entries(ZOOM_PRESETS).find(([, w]) => Math.abs(w - ganttDayWidth) < 0.5);
  document.querySelectorAll('[data-zoom-preset]').forEach(btn => {
    const isActive = active && btn.id === `ganttZoom${active[0].charAt(0).toUpperCase()}${active[0].slice(1)}`;
    btn.className = isActive
      ? 'px-2 py-1 rounded bg-emerald-600 text-white font-medium shadow transition'
      : 'px-2 py-1 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition';
  });
  const wrapper = document.getElementById('ganttTimelineWrapper');
  const days = Math.round((wrapper.clientWidth || 900) / ganttDayWidth);
  const info = days >= 120 ? `≈ ${Math.round(days / 30.4)} Monate sichtbar` : days >= 21 ? `≈ ${Math.round(days / 7)} Wochen sichtbar` : `≈ ${days} Tage sichtbar`;
  document.getElementById('ganttZoomInfo').innerText = info;
}

function initGanttZoom() {
  try {
    const stored = parseFloat(localStorage.getItem(ZOOM_KEY));
    if (stored >= ZOOM_MIN && stored <= ZOOM_MAX) ganttDayWidth = stored;
  } catch (e) {}
  updateZoomControls();

  // Strg/⌘ + Mausrad (bzw. Pinch auf dem Trackpad) zoomt an der Mausposition
  document.getElementById('ganttTimelineWrapper').addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomGantt(Math.exp(-e.deltaY * 0.0025), e.clientX);
  }, { passive: false });
  window.addEventListener('resize', updateZoomControls);
}
