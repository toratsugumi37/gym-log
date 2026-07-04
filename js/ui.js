// 엔트리포인트: 상태 관리 + 렌더링 + 이벤트. 데이터 가공은 store.js에 위임.

import { apiGet, apiPost, cachedGet } from './api.js';
import { ensureConfig } from './config.js';
import { createQueue } from './queue.js';
import {
  groupByExercise, groupByDate, nextSetNumber, summarizeSession, todayStr, newId,
} from './store.js';
import { renderChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);
const queue = createQueue(localStorage);

let todayRecords = [];
let exercises = [];
let selectedExercise = null;
let offline = false;

// ---- 오늘 탭 ----

function pendingIds() {
  return new Set(queue.all().map((r) => r.id));
}

function renderExerciseButtons() {
  const box = $('#exercise-buttons');
  box.innerHTML = '';
  for (const name of exercises) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (name === selectedExercise ? ' selected' : '');
    btn.textContent = name;
    btn.onclick = () => selectExercise(name);
    box.appendChild(btn);
  }
}

async function selectExercise(name) {
  selectedExercise = name;
  $('#exercise-input').value = name;
  renderExerciseButtons();
  $('#last-session').textContent = '지난번 기록 불러오는 중…';
  try {
    const { records } = await apiGet({ action: 'last', exercise: name, before: todayStr() });
    if (records.length) {
      const top = records.reduce((a, b) => (b.weight > a.weight ? b : a));
      $('#last-session').textContent = `지난번: ${summarizeSession(records)}`;
      $('#weight-input').value = top.weight;
      $('#reps-input').value = top.reps;
    } else {
      $('#last-session').textContent = '이 종목은 첫 기록이에요!';
    }
  } catch {
    $('#last-session').textContent = '';
  }
}

function renderToday() {
  const pending = pendingIds();
  const box = $('#today-list');
  const groups = groupByExercise(todayRecords);
  box.innerHTML = groups.length
    ? ''
    : '<p class="muted">아직 기록이 없어요. 첫 세트를 추가해보세요!</p>';
  for (const g of groups) {
    const div = document.createElement('div');
    div.className = 'group';
    const h = document.createElement('h3');
    h.textContent = g.exercise;
    div.appendChild(h);
    for (const r of g.sets) {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML =
        `<span>${r.set}세트</span><span>${r.weight}kg × ${r.reps}</span>` +
        (pending.has(r.id) ? '<span class="badge">전송 대기</span>' : '') +
        '<button type="button" class="del">삭제</button>';
      row.querySelector('.del').onclick = () => deleteSet(r);
      div.appendChild(row);
    }
    box.appendChild(div);
  }
  $('#pending-badge').hidden = queue.size() === 0;
  $('#offline-badge').hidden = !offline;
}

function addSet() {
  const exercise = $('#exercise-input').value.trim();
  const weight = Number($('#weight-input').value) || 0;
  const reps = Number($('#reps-input').value);
  if (!exercise) { $('#exercise-input').focus(); return; }
  if (!reps) { $('#reps-input').focus(); return; }
  const record = {
    id: newId(),
    date: todayStr(),
    exercise,
    weight,
    reps,
    set: nextSetNumber(todayRecords, exercise),
  };
  todayRecords.push(record);
  queue.push(record);
  if (!exercises.includes(exercise)) exercises.unshift(exercise);
  selectedExercise = exercise;
  renderExerciseButtons();
  renderToday();
  flushQueue();
}

function deleteSet(record) {
  todayRecords = todayRecords.filter((r) => r.id !== record.id);
  if (pendingIds().has(record.id)) {
    queue.remove(record.id); // 아직 서버에 없음 — 대기열에서만 제거
  } else {
    apiPost({ action: 'delete', id: record.id }).catch(() => {});
  }
  renderToday();
}

let flushing = false;
async function flushQueue() {
  if (flushing) return;
  flushing = true;
  for (const record of queue.all()) {
    try {
      await apiPost({ action: 'add', record });
      queue.remove(record.id);
    } catch {
      break; // 네트워크 불안정 — 다음 기회에 재시도
    }
  }
  flushing = false;
  renderToday();
}

// ---- 지난 기록 탭 ----

async function renderHistory() {
  const box = $('#history-list');
  box.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    const { data, offline: off } = await cachedGet({ action: 'history', days: 90 }, 'history');
    const days = groupByDate(data.records);
    box.innerHTML = days.length ? '' : '<p class="muted">기록이 없어요</p>';
    for (const day of days) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = day.date;
      det.appendChild(sum);
      for (const g of day.groups) {
        const p = document.createElement('p');
        p.textContent = `${g.exercise}: ` +
          g.sets.map((s) => `${s.weight}kg×${s.reps}`).join(', ');
        det.appendChild(p);
      }
      box.appendChild(det);
    }
    if (off) box.insertAdjacentHTML('afterbegin', '<p class="badge">오프라인 데이터</p>');
  } catch {
    box.innerHTML = '<p class="muted">불러오기 실패</p>';
  }
}

// ---- 차트 탭 ----

async function renderChartTab() {
  const select = $('#chart-exercise');
  if (!select.options.length) {
    for (const name of exercises) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  }
  const exercise = select.value;
  if (!exercise) {
    $('#chart-box').innerHTML = '<p class="muted">기록이 쌓이면 차트가 나와요</p>';
    return;
  }
  try {
    const { data } = await cachedGet({ action: 'chart', exercise }, `chart.${exercise}`);
    renderChart($('#chart-box'), data.series);
  } catch {
    $('#chart-box').innerHTML = '<p class="muted">불러오기 실패</p>';
  }
}

// ---- 탭 전환 & 초기화 ----

function showTab(name) {
  for (const sec of document.querySelectorAll('.tab-panel')) {
    sec.hidden = sec.id !== `tab-${name}`;
  }
  for (const btn of document.querySelectorAll('.tab-bar button')) {
    btn.classList.toggle('selected', btn.dataset.tab === name);
  }
  if (name === 'history') renderHistory();
  if (name === 'chart') renderChartTab();
}

async function init() {
  ensureConfig();
  document.querySelectorAll('.tab-bar button').forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
  $('#add-btn').onclick = addSet;
  $('#chart-exercise').onchange = renderChartTab;
  $('#exercise-input').oninput = () => {
    selectedExercise = $('#exercise-input').value.trim();
    renderExerciseButtons();
  };
  showTab('today');

  try {
    const [ex, today] = await Promise.all([
      cachedGet({ action: 'exercises' }, 'exercises'),
      cachedGet({ action: 'today', date: todayStr() }, 'today'),
    ]);
    exercises = ex.data.exercises;
    offline = ex.offline || today.offline;
    // 서버 기록 + 아직 전송 안 된 오늘 대기열 합치기 (id 중복 제거)
    const serverIds = new Set(today.data.records.map((r) => r.id));
    todayRecords = today.data.records.concat(
      queue.all().filter((r) => r.date === todayStr() && !serverIds.has(r.id)),
    );
  } catch {
    offline = true;
    todayRecords = queue.all().filter((r) => r.date === todayStr());
  }
  // 서버 종목 목록에 없는 오늘 기록 종목도 버튼으로 노출 (오프라인 대비)
  for (const r of todayRecords) {
    if (!exercises.includes(r.exercise)) exercises.unshift(r.exercise);
  }
  renderExerciseButtons();
  renderToday();
  flushQueue();
}

init();
