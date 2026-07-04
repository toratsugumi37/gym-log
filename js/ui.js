// 엔트리포인트: 인증 확인 → 앱 부팅. 데이터 가공은 store.js에 위임.

import { apiGet, apiPost, cachedGet, setUnauthorizedHandler } from './api.js';
import { initAuth, showAuthScreen } from './auth-ui.js';
import { createQueue } from './queue.js';
import {
  groupByExercise, groupByDate, nextSetNumber, summarizeSession, todayStr, newId,
} from './store.js';
import { renderChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);

let user = null;
let cachePrefix = '';
let queue = null;
let deleteQueue = null;
let todayRecords = [];
let exercises = [];
let selectedExercise = null;
let offline = false;
let currentDate = todayStr();
let eventsBound = false;

setUnauthorizedHandler(() => {
  user = null;
  localStorage.removeItem('gymlog.me');
  showAuthScreen();
});

function rolloverIfNewDay() {
  if (currentDate === todayStr()) return;
  currentDate = todayStr();
  todayRecords = todayRecords.filter((r) => r.date === currentDate);
}

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
    const { records } = await apiGet('/api/sets', { action: 'last', exercise: name, before: todayStr() });
    if (selectedExercise !== name) return;
    if (records.length) {
      const top = records.reduce((a, b) => (b.weight > a.weight ? b : a));
      $('#last-session').textContent = `지난번: ${summarizeSession(records)}`;
      $('#weight-input').value = top.weight;
      $('#reps-input').value = top.reps;
    } else {
      $('#last-session').textContent = '이 종목은 첫 기록이에요!';
    }
  } catch {
    if (selectedExercise === name) $('#last-session').textContent = '';
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
  $('#pending-badge').hidden = queue.size() === 0 && deleteQueue.size() === 0;
  $('#offline-badge').hidden = !offline;
}

function setNotice(msg) {
  $('#today-notice').textContent = msg || '';
}

function addSet() {
  rolloverIfNewDay();
  setNotice('');
  const exercise = $('#exercise-input').value.trim();
  const weight = Number($('#weight-input').value) || 0;
  const reps = Number($('#reps-input').value);
  // 서버 검증 규칙을 미리 반영해 불량 레코드가 큐에 박히는 것을 막는다.
  if (!exercise) { $('#exercise-input').focus(); return; }
  if (exercise.length > 50) { setNotice('종목 이름이 너무 길어요 (50자 이내)'); $('#exercise-input').focus(); return; }
  if (!Number.isFinite(weight) || weight < 0 || weight > 2000) { setNotice('무게는 0~2000 사이로 입력해주세요'); $('#weight-input').focus(); return; }
  if (!Number.isInteger(reps) || reps < 1 || reps > 1000) { setNotice('횟수는 1~1000 사이 정수로 입력해주세요'); $('#reps-input').focus(); return; }
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
  // 큐에서 빼되, 전송 중이던 레코드라면 서버에 이미 저장됐을 수 있으므로
  // 삭제 대기열에도 넣어 다음 flush가 서버 행을 확실히 정리하게 한다(delete는 멱등).
  queue.remove(record.id);
  deleteQueue.push({ id: record.id });
  flushQueue();
  renderToday();
}

let flushing = false;
async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of deleteQueue.all()) {
      try {
        await apiPost('/api/sets', { action: 'delete', id: item.id });
        deleteQueue.remove(item.id);
      } catch (err) {
        if (err && err.message === 'not found') deleteQueue.remove(item.id);
        else throw err;
      }
    }
    while (queue.size() > 0) {
      const record = queue.all()[0];
      try {
        await apiPost('/api/sets', { action: 'add', record });
      } catch (err) {
        if (err && (err.status === 400 || err.status === 415)) {
          // 서버가 영구 거부한 레코드 — 큐 헤드를 막지 않도록 버리고 화면에서도 제거
          queue.remove(record.id);
          todayRecords = todayRecords.filter((r) => r.id !== record.id);
          setNotice(`저장 안 된 세트를 버렸어요: ${err.message}`);
          continue;
        }
        throw err; // 네트워크/서버 오류 — 다음 기회에 재시도
      }
      if (queue.all().some((r) => r.id === record.id)) {
        queue.remove(record.id);
      } else {
        // 전송되는 사이 사용자가 삭제함 — 방금 서버에 생긴 행을 정리
        await apiPost('/api/sets', { action: 'delete', id: record.id }).catch(() => {});
      }
    }
  } catch {
    // 네트워크 불안정 — 다음 기회에 재시도
  } finally {
    flushing = false;
  }
  renderToday();
}

// ---- 기록 탭 ----

async function renderHistory() {
  const box = $('#history-list');
  box.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    const { data, offline: off } = await cachedGet(
      '/api/sets', { action: 'history', days: 90 }, `${cachePrefix}history`);
    const days = groupByDate(data.records);
    box.innerHTML = days.length ? '' : '<p class="muted">기록이 없어요</p>';
    for (const day of days) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = day.date;
      det.appendChild(sum);
      for (const g of day.groups) {
        const p = document.createElement('p');
        p.textContent = `${g.exercise}: ` + g.sets.map((s) => `${s.weight}kg×${s.reps}`).join(', ');
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
  const previous = select.value;
  select.innerHTML = '';
  for (const name of exercises) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  if (exercises.includes(previous)) select.value = previous;
  const exercise = select.value;
  if (!exercise) {
    $('#chart-box').innerHTML = '<p class="muted">기록이 쌓이면 차트가 나와요</p>';
    return;
  }
  try {
    const { data } = await cachedGet(
      '/api/sets', { action: 'chart', exercise }, `${cachePrefix}chart.${exercise}`);
    renderChart($('#chart-box'), data.series);
  } catch {
    $('#chart-box').innerHTML = '<p class="muted">불러오기 실패</p>';
  }
}

// ---- 몸 탭 ----

function fillProfileForm() {
  $('#profile-nickname').value = user.nickname || '';
  $('#profile-birth').value = user.birthYear ?? '';
  $('#profile-gender').value = user.gender ?? '';
  $('#profile-height').value = user.heightCm ?? '';
  $('#profile-goal-weight').value = user.goalWeight ?? '';
  $('#profile-goal-text').value = user.goalText ?? '';
  $('#goal-line').textContent = user.goalText
    ? `목표: ${user.goalText}${user.goalWeight ? ` (${user.goalWeight}kg)` : ''}`
    : (user.goalWeight ? `목표 몸무게: ${user.goalWeight}kg` : '');
}

function setBodyInputsEnabled(on) {
  for (const sel of ['#body-weight', '#body-fat', '#body-muscle', '#body-save-btn']) {
    $(sel).disabled = !on;
  }
}

async function renderBodyTab() {
  fillProfileForm();
  // 서버 값을 불러와 폼을 채우기 전에는 저장을 막는다. 프리필 전에 저장하면
  // 오늘 기록의 나머지 필드가 NULL로 덮이거나 행이 삭제될 수 있기 때문.
  setBodyInputsEnabled(false);
  try {
    const { data, offline: off } = await cachedGet('/api/body', {}, `${cachePrefix}body`);
    const rows = data.rows;
    const series = rows
      .filter((r) => r.weight !== null)
      .map((r) => ({ date: r.date, weight: r.weight }));
    renderChart($('#body-chart'), series, { goal: user.goalWeight });
    const list = $('#body-list');
    list.innerHTML = '';
    for (const r of rows.slice(-14).reverse()) {
      const parts = [];
      if (r.weight !== null) parts.push(`${r.weight}kg`);
      if (r.bodyFatPct !== null) parts.push(`체지방 ${r.bodyFatPct}%`);
      if (r.muscleMass !== null) parts.push(`골격근 ${r.muscleMass}kg`);
      const p = document.createElement('p');
      p.textContent = `${r.date} — ${parts.join(' / ')}`;
      list.appendChild(p);
    }
    const today = rows.find((r) => r.date === todayStr());
    // 오늘 기록이 있으면 그 값으로 채우고, 없으면 확실히 비운다(이전 계정/날짜 잔존값 방지).
    $('#body-weight').value = today ? (today.weight ?? '') : '';
    $('#body-fat').value = today ? (today.bodyFatPct ?? '') : '';
    $('#body-muscle').value = today ? (today.muscleMass ?? '') : '';
    if (off) list.insertAdjacentHTML('afterbegin', '<p class="badge">오프라인 데이터</p>');
    setBodyInputsEnabled(true);
  } catch {
    // 불러오기 실패 시 저장을 막아둔 채(덮어쓰기 방지) 재시도만 유도한다.
    $('#body-chart').innerHTML = '';
    $('#body-list').innerHTML =
      '<p class="muted">불러오기 실패 — 다시 몸 탭을 열어주세요</p>';
  }
}

async function saveBody() {
  const val = (sel) => {
    const v = $(sel).value.trim();
    return v === '' ? null : Number(v);
  };
  try {
    await apiPost('/api/body', {
      date: todayStr(),
      weight: val('#body-weight'),
      bodyFatPct: val('#body-fat'),
      muscleMass: val('#body-muscle'),
    });
    renderBodyTab();
  } catch (err) {
    $('#body-list').innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function saveProfile() {
  $('#profile-error').textContent = '';
  const opt = (sel) => {
    const v = $(sel).value.trim();
    return v === '' ? null : v;
  };
  try {
    const data = await apiPost('/api/auth?action=profile', {
      nickname: $('#profile-nickname').value.trim(),
      birthYear: opt('#profile-birth'),
      gender: opt('#profile-gender'),
      heightCm: opt('#profile-height'),
      goalWeight: opt('#profile-goal-weight'),
      goalText: opt('#profile-goal-text'),
    });
    user = data.user;
    $('#nickname').textContent = user.nickname;
    renderBodyTab();
  } catch (err) {
    $('#profile-error').textContent = err.message;
  }
}

async function logout() {
  try {
    await apiPost('/api/auth?action=logout', {});
  } catch (err) {
    // 401(이미 만료)은 로그아웃 성공으로 취급. 그 외(네트워크)는 세션이 살아있을 수
    // 있으므로 로그아웃한 척하지 않고 로그인 상태를 유지한다.
    if (err.status !== 401 && err.message !== 'unauthorized') {
      $('#goal-line').textContent = '로그아웃 실패 — 네트워크 확인 후 다시 시도해주세요';
      return;
    }
  }
  user = null;
  localStorage.removeItem('gymlog.me');
  showAuthScreen();
}

// ---- 탭 전환 & 부팅 ----

function showTab(name) {
  for (const sec of document.querySelectorAll('.tab-panel')) {
    sec.hidden = sec.id !== `tab-${name}`;
  }
  for (const btn of document.querySelectorAll('.tab-bar button')) {
    btn.classList.toggle('selected', btn.dataset.tab === name);
  }
  if (name === 'history') renderHistory();
  if (name === 'chart') renderChartTab();
  if (name === 'body') renderBodyTab();
}

function bindEvents() {
  document.querySelectorAll('.tab-bar button').forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
  $('#add-btn').onclick = addSet;
  $('#chart-exercise').onchange = renderChartTab;
  $('#exercise-input').oninput = () => {
    selectedExercise = $('#exercise-input').value.trim();
    renderExerciseButtons();
  };
  $('#body-save-btn').onclick = saveBody;
  $('#profile-save-btn').onclick = saveProfile;
  $('#logout-btn').onclick = logout;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && user) {
      rolloverIfNewDay();
      renderToday();
      flushQueue();
    }
  });
}

async function loadToday() {
  const bootUser = user; // 계정 전환 시 늦게 도착한 응답을 폐기하기 위한 세대 표시
  try {
    const [ex, today] = await Promise.all([
      cachedGet('/api/sets', { action: 'exercises' }, `${cachePrefix}exercises`),
      cachedGet('/api/sets', { action: 'today', date: todayStr() }, `${cachePrefix}today`),
    ]);
    if (user !== bootUser) return; // 그 사이 로그아웃/다른 계정 로그인됨
    exercises = ex.data.exercises;
    offline = ex.offline || today.offline;
    const serverRecords = today.data.records.filter((r) => r.date === todayStr());
    const serverIds = new Set(serverRecords.map((r) => r.id));
    todayRecords = serverRecords.concat(
      queue.all().filter((r) => r.date === todayStr() && !serverIds.has(r.id)),
    );
  } catch (err) {
    if (user !== bootUser || err.message === 'unauthorized') return;
    offline = true;
    todayRecords = queue.all().filter((r) => r.date === todayStr());
  }
  for (const r of todayRecords) {
    if (!exercises.includes(r.exercise)) exercises.unshift(r.exercise);
  }
  renderExerciseButtons();
  renderToday();
  flushQueue();
}

function startApp(me) {
  user = me;
  cachePrefix = `u.${me.username}.`;
  queue = createQueue(localStorage, `gymlog.pending.${me.username}`);
  deleteQueue = createQueue(localStorage, `gymlog.pendingDeletes.${me.username}`);
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  $('#nickname').textContent = me.nickname;
  if (!eventsBound) {
    bindEvents();
    eventsBound = true;
  }
  todayRecords = [];
  exercises = [];
  selectedExercise = null;
  currentDate = todayStr();
  // 이전 계정의 잔여 입력값·렌더 내용이 새 계정으로 새지 않게 초기화
  for (const sel of ['#exercise-input', '#weight-input', '#reps-input',
    '#body-weight', '#body-fat', '#body-muscle']) {
    $(sel).value = '';
  }
  for (const sel of ['#today-list', '#history-list', '#chart-box', '#body-chart', '#body-list']) {
    $(sel).innerHTML = '';
  }
  $('#chart-exercise').innerHTML = '';
  $('#last-session').textContent = '';
  setNotice('');
  showTab('today');
  loadToday();
}

function onAuthSuccess(me) {
  localStorage.setItem('gymlog.me', JSON.stringify(me));
  startApp(me);
}

async function main() {
  initAuth(onAuthSuccess);
  try {
    const { user: me } = await apiGet('/api/auth', { action: 'me' });
    onAuthSuccess(me);
  } catch (err) {
    if (err.status === 401 || err.message === 'unauthorized') {
      localStorage.removeItem('gymlog.me'); // 세션 만료 — 로그인 필요
      showAuthScreen();
      return;
    }
    // 네트워크/서버 오류 — 마지막 로그인 정보가 있으면 오프라인으로 부팅한다.
    const cached = localStorage.getItem('gymlog.me');
    if (cached) startApp(JSON.parse(cached));
    else showAuthScreen();
  }
}

main();
