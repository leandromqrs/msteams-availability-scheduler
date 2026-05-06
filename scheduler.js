// Teams Availability Scheduler - Schedule Configuration Page

const DEFAULT_CONFIG = {
  manualMode: false,
  forceAvailableMode: false,
  respectMeetingsMode: true,
  schedule: {
    general: [],
    monday: [], tuesday: [], wednesday: [], thursday: [],
    friday: [], saturday: [], sunday: [],
  },
  lastKeepAlive: null,
};

const DAY_NAMES = [
  { key: 'monday',    label: 'Monday' },
  { key: 'tuesday',   label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday',  label: 'Thursday' },
  { key: 'friday',    label: 'Friday' },
  { key: 'saturday',  label: 'Saturday' },
  { key: 'sunday',    label: 'Sunday' },
];

const ALL_KEYS = [
  { key: 'general', label: 'All Days' },
  ...DAY_NAMES,
];

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'busy',      label: 'Busy' },
  { value: 'away',      label: 'Away' },
  { value: 'dnd',       label: 'Do Not Disturb' },
];

let config = { ...DEFAULT_CONFIG };

async function loadConfig() {
  const storage = await chrome.storage.local.get(['config']);
  if (storage.config) {
    config = { ...DEFAULT_CONFIG, ...storage.config };
    if (!config.schedule) config.schedule = DEFAULT_CONFIG.schedule;
    for (const { key } of ALL_KEYS) {
      if (!Array.isArray(config.schedule[key])) config.schedule[key] = [];
    }
  }
}

async function saveConfig() {
  await chrome.storage.local.set({ config });
  chrome.runtime.sendMessage({ action: 'configChanged' }).catch(() => {});
}

// --- Status picker ---

function createStatusPicker(initialValue, onChange) {
  let currentValue = initialValue || 'available';

  const wrapper = document.createElement('div');
  wrapper.className = 'status-picker';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'status-picker-btn';

  const btnDot = document.createElement('span');
  btnDot.className = `status-dot status-dot--${currentValue}`;
  btn.appendChild(btnDot);

  const dropdown = document.createElement('div');
  dropdown.className = 'status-picker-dropdown';
  dropdown.hidden = true;

  STATUS_OPTIONS.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'status-picker-option';
    if (opt.value === currentValue) item.classList.add('is-selected');

    const dot = document.createElement('span');
    dot.className = `status-dot status-dot--${opt.value}`;

    const lbl = document.createElement('span');
    lbl.textContent = opt.label;

    item.appendChild(dot);
    item.appendChild(lbl);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      currentValue = opt.value;
      btnDot.className = `status-dot status-dot--${opt.value}`;
      dropdown.querySelectorAll('.status-picker-option').forEach(el => el.classList.remove('is-selected'));
      item.classList.add('is-selected');
      dropdown.hidden = true;
      onChange(opt.value);
    });

    dropdown.appendChild(item);
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.status-picker-dropdown').forEach(d => {
      if (d !== dropdown) d.hidden = true;
    });
    dropdown.hidden = !dropdown.hidden;
  });

  document.addEventListener('click', () => { dropdown.hidden = true; });

  wrapper.appendChild(btn);
  wrapper.appendChild(dropdown);
  wrapper.getValue = () => currentValue;
  return wrapper;
}

// --- Clone button ---

function buildCloneBtn(dayKey, interval) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-clone-interval';
  btn.title = 'Duplicate this interval';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';

  btn.addEventListener('click', async () => {
    if (!Array.isArray(config.schedule[dayKey])) config.schedule[dayKey] = [];
    config.schedule[dayKey].push({ ...interval });
    await saveConfig();
    renderSchedule();
  });

  return btn;
}

// --- Analog clock picker ---

let _activeClockOverlay = null;

function showClockDialog(initH, initM, onConfirm) {
  if (_activeClockOverlay) { _activeClockOverlay.remove(); _activeClockOverlay = null; }

  let hours = initH, minutes = initM, mode = 'hours';
  const SIZE = 256, CX = 128, CY = 128, R = 116, OUTER_R = 94, INNER_R = 62;

  const overlay = document.createElement('div');
  overlay.className = 'clk-overlay';
  _activeClockOverlay = overlay;

  const dialog = document.createElement('div');
  dialog.className = 'clk-dialog';

  const header = document.createElement('div');
  header.className = 'clk-header';

  const hBtn = document.createElement('button');
  hBtn.type = 'button'; hBtn.className = 'clk-part clk-part--h active';

  const colon = document.createElement('span');
  colon.className = 'clk-colon'; colon.textContent = ':';

  const mBtn = document.createElement('button');
  mBtn.type = 'button'; mBtn.className = 'clk-part clk-part--m';

  header.append(hBtn, colon, mBtn);

  const face = document.createElement('div');
  face.className = 'clk-face';

  const modeLabel = document.createElement('div');
  modeLabel.className = 'clk-mode-label';

  const acts = document.createElement('div');
  acts.className = 'clk-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button'; cancelBtn.className = 'clk-btn clk-btn--cancel';
  cancelBtn.textContent = 'Cancel';

  const okBtn = document.createElement('button');
  okBtn.type = 'button'; okBtn.className = 'clk-btn clk-btn--ok';
  okBtn.textContent = 'OK';

  acts.append(cancelBtn, okBtn);
  dialog.append(header, modeLabel, face, acts);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const fmt = n => String(n).padStart(2, '0');

  function syncHeader() {
    hBtn.textContent = fmt(hours);
    mBtn.textContent = fmt(minutes);
    hBtn.classList.toggle('active', mode === 'hours');
    mBtn.classList.toggle('active', mode === 'minutes');
    modeLabel.textContent = mode === 'hours' ? 'Select hour' : 'Select minute';
  }

  function mk(tag, ns) {
    return ns ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  }

  function svgAttr(el, attrs) {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function polar(val, total, r) {
    const a = (val / total) * 2 * Math.PI - Math.PI / 2;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  }

  let currentSvg = null;

  function renderFace() {
    face.innerHTML = '';

    const svg = svgAttr(mk('svg', true), {
      width: SIZE, height: SIZE,
      viewBox: `0 0 ${SIZE} ${SIZE}`,
    });
    svg.style.display = 'block';
    svg.style.userSelect = 'none';
    svg.style.pointerEvents = 'none';
    currentSvg = svg;

    const addEl = (tag, attrs, parent = svg) => {
      const el = svgAttr(mk(tag, true), attrs);
      parent.appendChild(el);
      return el;
    };

    addEl('circle', { cx: CX, cy: CY, r: R, fill: '#ebebf5' });

    if (mode === 'hours') {
      const selIsOuter = hours >= 1 && hours <= 12;
      const selPt = selIsOuter
        ? polar(hours, 12, OUTER_R)
        : polar(hours === 0 ? 0 : hours - 12, 12, INNER_R);

      addEl('line', { x1: CX, y1: CY, x2: selPt.x, y2: selPt.y, stroke: '#6264a7', 'stroke-width': 2, 'stroke-linecap': 'round' });

      for (let h = 1; h <= 12; h++) {
        const p = polar(h, 12, OUTER_R);
        const sel = hours === h;
        if (sel) addEl('circle', { cx: p.x, cy: p.y, r: 18, fill: '#6264a7' });
        const t = addEl('text', {
          x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
          'font-size': 14, fill: sel ? 'white' : '#333', 'font-weight': sel ? 700 : 400,
          'font-family': 'inherit',
        });
        t.textContent = h;
      }

      for (let i = 0; i <= 11; i++) {
        const h = i === 0 ? 0 : i + 12;
        const p = polar(i, 12, INNER_R);
        const sel = hours === h;
        if (sel) addEl('circle', { cx: p.x, cy: p.y, r: 15, fill: '#6264a7' });
        const t = addEl('text', {
          x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
          'font-size': 11, fill: sel ? 'white' : '#555', 'font-weight': sel ? 700 : 400,
          'font-family': 'inherit',
        });
        t.textContent = fmt(h);
      }
    } else {
      const mp = polar(minutes, 60, OUTER_R);
      addEl('line', { x1: CX, y1: CY, x2: mp.x, y2: mp.y, stroke: '#6264a7', 'stroke-width': 2, 'stroke-linecap': 'round' });

      for (let m = 0; m < 60; m++) {
        const p = polar(m, 60, OUTER_R);
        const sel = minutes === m;
        if (m % 5 === 0) {
          if (sel) addEl('circle', { cx: p.x, cy: p.y, r: 18, fill: '#6264a7' });
          const t = addEl('text', {
            x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
            'font-size': 13, fill: sel ? 'white' : '#333', 'font-weight': sel ? 700 : 400,
            'font-family': 'inherit',
          });
          t.textContent = fmt(m);
        } else {
          if (sel) addEl('circle', { cx: p.x, cy: p.y, r: 18, fill: '#6264a7' });
          else addEl('circle', { cx: p.x, cy: p.y, r: 2, fill: '#aaa' });
        }
      }
    }

    addEl('circle', { cx: CX, cy: CY, r: 5, fill: '#6264a7' });
    face.appendChild(svg);
  }

  function pick(clientX, clientY, commit) {
    if (!currentSvg) return;
    const rect = currentSvg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const angle = ((Math.atan2(dy, dx) + Math.PI / 2) + 2 * Math.PI) % (2 * Math.PI);
    const scale = rect.width / SIZE;

    if (mode === 'hours') {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const isInner = dist < (OUTER_R + INNER_R) / 2 * scale;
      let h = Math.round((angle / (2 * Math.PI)) * 12);
      if (isInner) { h = h % 12; hours = h === 0 ? 0 : h + 12; }
      else { hours = h === 0 ? 12 : h; }
      if (commit) { mode = 'minutes'; }
    } else {
      minutes = Math.round((angle / (2 * Math.PI)) * 60) % 60;
    }

    syncHeader();
    renderFace();
  }

  let dragging = false;
  const onMouseMove = (e) => { if (dragging) pick(e.clientX, e.clientY, false); };
  const onMouseUp   = (e) => {
    if (!dragging) return;
    dragging = false;
    pick(e.clientX, e.clientY, true);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  face.style.cursor = 'pointer';
  face.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    pick(e.clientX, e.clientY, false);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  hBtn.addEventListener('click', () => { mode = 'hours'; syncHeader(); renderFace(); });
  mBtn.addEventListener('click', () => { mode = 'minutes'; syncHeader(); renderFace(); });
  cancelBtn.addEventListener('click', () => { overlay.remove(); _activeClockOverlay = null; });
  okBtn.addEventListener('click', () => {
    overlay.remove(); _activeClockOverlay = null;
    onConfirm(hours, minutes);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); _activeClockOverlay = null; }
  });

  syncHeader();
  renderFace();
}

// --- Time picker (text input + clock button) ---

function createTimePicker(initialValue, onChange) {
  const [ih, im] = (initialValue || '09:00').split(':').map(Number);
  let h = isNaN(ih) ? 9 : ih;
  let m = isNaN(im) ? 0 : im;
  const fmt2 = n => String(n).padStart(2, '0');

  const wrapper = document.createElement('div');
  wrapper.className = 'time-picker-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'time-picker-input';
  input.value = `${fmt2(h)}:${fmt2(m)}`;
  input.maxLength = 5;
  input.placeholder = 'HH:MM';

  const commit = () => {
    const match = input.value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const nh = parseInt(match[1], 10);
      const nm = parseInt(match[2], 10);
      if (nh >= 0 && nh <= 23 && nm >= 0 && nm <= 59) {
        h = nh; m = nm;
        input.value = `${fmt2(h)}:${fmt2(m)}`;
        onChange(`${fmt2(h)}:${fmt2(m)}`);
        return;
      }
    }
    input.value = `${fmt2(h)}:${fmt2(m)}`;
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  const clockBtn = document.createElement('button');
  clockBtn.type = 'button';
  clockBtn.className = 'time-picker-clock-btn';
  clockBtn.title = 'Open clock picker';
  clockBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>';

  clockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showClockDialog(h, m, (newH, newM) => {
      h = newH; m = newM;
      input.value = `${fmt2(h)}:${fmt2(m)}`;
      onChange(`${fmt2(h)}:${fmt2(m)}`);
    });
  });

  wrapper.appendChild(input);
  wrapper.appendChild(clockBtn);
  wrapper.getValue = () => `${fmt2(h)}:${fmt2(m)}`;
  return wrapper;
}

// --- Drag & drop ---

let _dragState = null;

function createIntervalElement(dayKey, interval, index) {
  const div = document.createElement('div');
  div.className = 'interval-item';
  div.draggable = false;

  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.title = 'Drag to reorder';
  handle.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';

  handle.addEventListener('mousedown', () => {
    div.draggable = true;
    const reset = () => {
      if (!_dragState) div.draggable = false;
      window.removeEventListener('mouseup', reset);
    };
    window.addEventListener('mouseup', reset);
  });

  div.addEventListener('dragstart', (e) => {
    _dragState = { dayKey, index };
    div.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  div.addEventListener('dragend', () => {
    div.draggable = false;
    div.classList.remove('is-dragging');
    _dragState = null;
    document.querySelectorAll('.day-schedule').forEach(el => el.classList.remove('drop-active'));
  });

  const startPicker = createTimePicker(interval.start || '09:00', async (val) => {
    interval.start = val;
    await saveConfig();
  });

  const sep = document.createElement('span');
  sep.className = 'time-separator';
  sep.textContent = '→';

  const endPicker = createTimePicker(interval.end || '17:00', async (val) => {
    interval.end = val;
    await saveConfig();
  });

  const statusPicker = createStatusPicker(interval.status || 'available', async (value) => {
    interval.status = value;
    await saveConfig();
  });

  const cloneBtn = buildCloneBtn(dayKey, interval);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove-interval';
  removeBtn.title = 'Remove interval';
  removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  removeBtn.addEventListener('click', async () => {
    config.schedule[dayKey].splice(index, 1);
    await saveConfig();
    renderSchedule();
  });

  div.appendChild(handle);
  div.appendChild(startPicker);
  div.appendChild(sep);
  div.appendChild(endPicker);
  div.appendChild(statusPicker);
  div.appendChild(cloneBtn);
  div.appendChild(removeBtn);
  return div;
}

// --- Day section ---

function renderDaySection({ key, label, isGeneral }) {
  const dayDiv = document.createElement('div');
  dayDiv.className = isGeneral ? 'day-schedule day-schedule--general' : 'day-schedule';

  const header = document.createElement('div');
  header.className = 'day-header';

  const title = document.createElement('h3');
  if (isGeneral) {
    title.innerHTML = `<span class="general-badge">All Days</span> ${label}`;
  } else {
    title.textContent = label;
  }

  const actions = document.createElement('div');
  actions.className = 'day-actions';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-interval';
  addBtn.textContent = '+ Add';
  addBtn.addEventListener('click', async () => {
    if (!Array.isArray(config.schedule[key])) config.schedule[key] = [];
    config.schedule[key].push({ start: '09:00', end: '17:00', status: 'available' });
    await saveConfig();
    renderSchedule();
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-clear-day';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', async () => {
    config.schedule[key] = [];
    await saveConfig();
    renderSchedule();
  });

  actions.appendChild(addBtn);
  actions.appendChild(clearBtn);
  header.appendChild(title);
  header.appendChild(actions);
  dayDiv.appendChild(header);

  const slots = config.schedule[key] || [];
  if (slots.length > 0) {
    const list = document.createElement('div');
    list.className = 'intervals-list';
    slots.forEach((interval, i) => list.appendChild(createIntervalElement(key, interval, i)));
    dayDiv.appendChild(list);
  } else if (isGeneral) {
    const hint = document.createElement('p');
    hint.className = 'general-hint';
    hint.textContent = 'Slots added here apply to every day of the week.';
    dayDiv.appendChild(hint);
  }

  dayDiv.addEventListener('dragover', (e) => {
    if (!_dragState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dayDiv.classList.add('drop-active');
  });

  dayDiv.addEventListener('dragleave', (e) => {
    if (!dayDiv.contains(e.relatedTarget)) {
      dayDiv.classList.remove('drop-active');
    }
  });

  dayDiv.addEventListener('drop', async (e) => {
    e.preventDefault();
    dayDiv.classList.remove('drop-active');
    if (!_dragState) return;

    const { dayKey: srcKey, index: srcIdx } = _dragState;
    _dragState = null;

    const srcSlots = config.schedule[srcKey];
    if (!srcSlots || !srcSlots[srcIdx]) return;
    const moved = srcSlots[srcIdx];

    srcSlots.splice(srcIdx, 1);

    const list = dayDiv.querySelector('.intervals-list');
    let insertIdx = 0;
    if (list) {
      const items = [...list.querySelectorAll('.interval-item:not(.is-dragging)')];
      insertIdx = items.length;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { insertIdx = i; break; }
      }
    }

    if (!Array.isArray(config.schedule[key])) config.schedule[key] = [];
    config.schedule[key].splice(insertIdx, 0, moved);

    await saveConfig();
    renderSchedule();
  });

  return dayDiv;
}

function renderSchedule() {
  const container = document.getElementById('scheduleContainer');
  container.innerHTML = '';

  container.appendChild(renderDaySection({ key: 'general', label: 'General Schedule', isGeneral: true }));

  const divider = document.createElement('div');
  divider.className = 'schedule-divider';
  divider.textContent = 'Per-day overrides';
  container.appendChild(divider);

  DAY_NAMES.forEach(({ key, label }) => {
    container.appendChild(renderDaySection({ key, label, isGeneral: false }));
  });
}

async function init() {
  await loadConfig();
  renderSchedule();
}

document.addEventListener('DOMContentLoaded', init);
