# 오늘 탭 UX 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "오늘" 탭을 상태 뱃지 제거·종목 검색 자동완성·세트 알약 압축·세트 수정·± 스테퍼·오늘 요약·추가 피드백·앱 내 뒤로가기로 개편한다.

**Architecture:** 프론트 바닐라 JS 중심(ui.js) + 순수 로직은 store.js(테스트), 피드백은 feedback.js. 백엔드는 api/sets.js에 세트 수정(edit) 액션과 종목 목록 확대만 추가. 인증·스키마·다른 탭 구조는 불변.

**Tech Stack:** 바닐라 JS(ESM), node:test, mysql2, Vercel 서버리스.

## Global Constraints

- 프레임워크·빌드도구 금지. 백엔드 의존성은 기존 `mysql2`, `bcryptjs`만.
- 레코드 형태 유지: `{ id, date, exercise, weight, reps, set }`.
- 검증 규칙 재사용: 무게 유한수 0~2000, 횟수 정수 1~1000, 종목 1~50자.
- 오프라인 보장은 추가·삭제만(큐). 세트 수정은 낙관적+실패 시 롤백(오프라인 큐잉 안 함).
- 사용자 입력 문자열은 textContent로만 DOM에 넣는다(innerHTML 금지 — XSS 방지).
- `prefers-reduced-motion` 존중, 포커스 링 유지.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 파일 구조

```
js/store.js       + summarizeToday, filterExercises, hasExercise (순수, 테스트)
js/feedback.js    신규: feedbackAdd() (진동+사운드)
js/ui.js          오늘 탭 로직 대폭 개편 (자동완성/알약/시트/스테퍼/요약/피드백/뒤로가기)
index.html        오늘 탭 마크업 교체 + 세트 수정 시트 + 상태 알약 제거
css/style.css     자동완성/알약/시트/스테퍼/요약 스타일 + 상태알약 스타일 제거
api/sets.js       exercises LIMIT 200 + POST edit 액션
tests/store.test.js  테스트 추가
```

---

### Task 1: store.js 순수 함수 (요약·필터)

**Files:**
- Modify: `js/store.js`
- Test: `tests/store.test.js`

**Interfaces:**
- Produces (ui.js가 import):
  - `summarizeToday(records) → { exercises:number, sets:number, volume:number }`
  - `filterExercises(list, query) → string[]` (부분일치, 공백·대소문자 무시; 빈 쿼리는 전체)
  - `hasExercise(list, name) → boolean` (공백·대소문자 무시 정확일치)

- [ ] **Step 1: 실패 테스트 추가** — `tests/store.test.js` 끝에

```js
import { summarizeToday, filterExercises, hasExercise } from '../js/store.js';

test('summarizeToday: 종목수·세트수·볼륨 합계', () => {
  const recs = [
    { exercise: '벤치프레스', weight: 60, reps: 10 },
    { exercise: '벤치프레스', weight: 62.5, reps: 8 },
    { exercise: '스쿼트', weight: 80, reps: 5 },
  ];
  assert.deepEqual(summarizeToday(recs), { exercises: 2, sets: 3, volume: 60 * 10 + 62.5 * 8 + 80 * 5 });
  assert.deepEqual(summarizeToday([]), { exercises: 0, sets: 0, volume: 0 });
});

test('filterExercises: 부분일치, 공백·대소문자 무시', () => {
  const list = ['벤치프레스', '인클라인 벤치', '스쿼트'];
  assert.deepEqual(filterExercises(list, '벤치'), ['벤치프레스', '인클라인 벤치']);
  assert.deepEqual(filterExercises(list, '인클라인벤치'), ['인클라인 벤치']);
  assert.deepEqual(filterExercises(list, ''), list);
  assert.deepEqual(filterExercises(list, '데드'), []);
});

test('hasExercise: 공백·대소문자 무시 정확일치', () => {
  const list = ['벤치프레스', 'Lat Pulldown'];
  assert.equal(hasExercise(list, '벤치프레스'), true);
  assert.equal(hasExercise(list, 'lat  pulldown'), true);
  assert.equal(hasExercise(list, '벤치'), false);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` → FAIL (함수 없음)

- [ ] **Step 3: 구현** — `js/store.js` 끝에 추가

```js
export function summarizeToday(records) {
  const exercises = new Set(records.map((r) => r.exercise)).size;
  const sets = records.length;
  const volume = records.reduce((s, r) => s + r.weight * r.reps, 0);
  return { exercises, sets, volume };
}

const normEx = (s) => String(s).toLowerCase().replace(/\s+/g, '');

export function filterExercises(list, query) {
  const q = normEx(query);
  if (!q) return list.slice();
  return list.filter((name) => normEx(name).includes(q));
}

export function hasExercise(list, name) {
  const target = normEx(name);
  return list.some((e) => normEx(e) === target);
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` → PASS (29 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/store.js tests/store.test.js
git commit -m "feat: 오늘 요약·종목 필터 순수 함수"
```

---

### Task 2: 백엔드 — 세트 수정 + 종목 목록 확대

**Files:**
- Modify: `api/sets.js`

**Interfaces:**
- Produces:
  - `GET /api/sets?action=exercises` → 최근순 distinct 종목 **최대 200개**
  - `POST /api/sets {action:'edit', id, weight, reps}` → `{ok:true}` (검증 실패 400). 값이 같아도 성공 처리.

- [ ] **Step 1: exercises LIMIT 변경** — `api/sets.js`의 exercises 분기

Before:
```js
    const rows = await q(
      'SELECT exercise FROM workout_sets WHERE user_id=? GROUP BY exercise ORDER BY MAX(id) DESC LIMIT 30',
      [userId],
    );
```
After:
```js
    const rows = await q(
      'SELECT exercise FROM workout_sets WHERE user_id=? GROUP BY exercise ORDER BY MAX(id) DESC LIMIT 200',
      [userId],
    );
```

- [ ] **Step 2: edit 액션 추가** — `post()` 함수의 `delete` 분기 앞에 추가

```js
  if (body.action === 'edit') {
    const weight = Number(body.weight);
    const reps = Number(body.reps);
    if (!Number.isFinite(weight) || weight < 0 || weight > 2000) {
      return res.status(400).json({ ok: false, error: 'bad weight' });
    }
    if (!Number.isInteger(reps) || reps < 1 || reps > 1000) {
      return res.status(400).json({ ok: false, error: 'bad reps' });
    }
    await q(
      'UPDATE workout_sets SET weight=?, reps=? WHERE user_id=? AND client_id=?',
      [weight, reps, userId, String(body.id || '')],
    );
    // 값이 같으면 affectedRows=0이 될 수 있어 404로 오판하지 않는다(멱등 처리).
    return res.json({ ok: true });
  }
```

- [ ] **Step 3: 커밋**

```bash
git add api/sets.js
git commit -m "feat: 세트 수정(edit) API + 종목 목록 200개"
```

---

### Task 3: 피드백 모듈

**Files:**
- Create: `js/feedback.js`

**Interfaces:**
- Produces: `feedbackAdd()` — 진동(지원 시)+짧은 사운드. 실패는 조용히 무시.

- [ ] **Step 1: 구현** — `js/feedback.js`

```js
// 세트 추가 시 피드백. iOS는 진동 API가 막혀 no-op → 사운드/시각으로 대체.

let audioCtx;

export function feedbackAdd() {
  try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* 무시 */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(now);
    o.stop(now + 0.13);
  } catch { /* 무시 */ }
}
```

- [ ] **Step 2: 커밋**

```bash
git add js/feedback.js
git commit -m "feat: 세트 추가 피드백 모듈(진동+사운드)"
```

---

### Task 4: HTML + CSS (마크업 교체 + 스타일)

**Files:**
- Modify: `index.html` (오늘 탭, 상태알약 제거, 세트 시트 추가)
- Modify: `css/style.css` (신규 컴포넌트 스타일, 상태알약 제거, --label-3 추가)

**Interfaces:**
- Consumes: ui.js가 참조할 id들 (`#today-summary`, `#exercise-suggest`, `.stepper`, `#set-sheet`, `#sheet-weight/#sheet-reps/#sheet-save/#sheet-delete/#sheet-title`).
- Produces: 새 DOM 구조. 세트 알약/시트/스테퍼/자동완성 시각.

- [ ] **Step 1: index.html — 상태 알약 제거.** `#app` 안의 다음 블록 삭제:

```html
    <div class="status-pills">
      <span id="pending-badge" class="badge" hidden>전송 대기</span>
      <span id="offline-badge" class="badge badge-gray" hidden>오프라인</span>
    </div>
```

- [ ] **Step 2: index.html — 오늘 탭 교체.** `<section id="tab-today" ...>...</section>` 전체를 아래로:

```html
      <section id="tab-today" class="tab-panel">
        <h1 class="large-title">오늘</h1>
        <p id="today-summary" class="today-summary" hidden></p>

        <p class="section-label">새 세트</p>
        <div class="card">
          <div id="exercise-buttons" class="chips"></div>
          <div class="suggest-wrap">
            <input id="exercise-input" type="text" maxlength="50" autocomplete="off" placeholder="종목 (예: 벤치프레스)">
            <div id="exercise-suggest" class="suggest" hidden></div>
          </div>
          <p id="last-session" class="hint"></p>
          <div class="stepper-row">
            <div class="stepper" data-for="weight-input" data-step="2.5" data-min="0" data-max="2000">
              <button type="button" class="step-minus" aria-label="무게 감소">−</button>
              <input id="weight-input" type="number" inputmode="decimal" min="0" max="2000" step="0.5" placeholder="무게(kg)">
              <button type="button" class="step-plus" aria-label="무게 증가">+</button>
            </div>
            <div class="stepper" data-for="reps-input" data-step="1" data-min="1" data-max="1000">
              <button type="button" class="step-minus" aria-label="횟수 감소">−</button>
              <input id="reps-input" type="number" inputmode="numeric" min="1" max="1000" step="1" placeholder="횟수">
              <button type="button" class="step-plus" aria-label="횟수 증가">+</button>
            </div>
          </div>
          <button id="add-btn" type="button" class="primary">세트 추가</button>
          <p id="today-notice" class="error"></p>
        </div>

        <div id="today-list"></div>
      </section>
```

- [ ] **Step 3: index.html — 세트 수정 시트 추가.** `<nav class="tab-bar">` 바로 앞(= `</main>` 뒤)에 삽입:

```html
    <div id="set-sheet" class="sheet-backdrop" hidden>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="세트 수정">
        <div class="sheet-handle"></div>
        <h3 id="sheet-title" class="sheet-title">세트 수정</h3>
        <div class="stepper-row">
          <div class="stepper" data-for="sheet-weight" data-step="2.5" data-min="0" data-max="2000">
            <button type="button" class="step-minus" aria-label="무게 감소">−</button>
            <input id="sheet-weight" type="number" inputmode="decimal" min="0" max="2000" step="0.5" placeholder="무게(kg)">
            <button type="button" class="step-plus" aria-label="무게 증가">+</button>
          </div>
          <div class="stepper" data-for="sheet-reps" data-step="1" data-min="1" data-max="1000">
            <button type="button" class="step-minus" aria-label="횟수 감소">−</button>
            <input id="sheet-reps" type="number" inputmode="numeric" min="1" max="1000" step="1" placeholder="횟수">
            <button type="button" class="step-plus" aria-label="횟수 증가">+</button>
          </div>
        </div>
        <button id="sheet-save" type="button" class="primary">저장</button>
        <button id="sheet-delete" type="button" class="danger-btn">삭제</button>
      </div>
    </div>
```

- [ ] **Step 4: css/style.css — 상태알약 제거 + --label-3 추가.**

`.status-pills { ... }` 규칙 블록 삭제. `:root`에 `--label-3: #c7c7cc;` 추가, 다크 블록에 `--label-3: #48484a;` 추가.

- [ ] **Step 5: css/style.css — 기존 `.set-row` 블록 3개(.set-row, .set-row span:first-child/nth-child, .set-row .del) 삭제** (알약으로 대체). `.group h3` 규칙을 `.group h3 { font-size: 17px; font-weight: 600; color: var(--label); }` 로 교체(패딩 제거).

- [ ] **Step 6: css/style.css 끝에 신규 스타일 추가.**

```css
/* 오늘 요약 */
.today-summary { font-size: 15px; font-weight: 500; color: var(--label-2); padding: 0 2px 14px; margin-top: -6px; }

/* 종목 자동완성 */
.suggest-wrap { position: relative; }
.suggest {
  position: absolute; top: calc(100% - 4px); left: 0; right: 0; z-index: 30;
  background: var(--card); border-radius: 12px; overflow: hidden auto; max-height: 264px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
}
.suggest-item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 12px 14px; font-size: 16px; color: var(--label); font-family: inherit;
  border-top: 0.5px solid var(--sep);
}
.suggest-item:first-child { border-top: none; }
.suggest-item:active { background: var(--fill); }
.suggest-new { color: var(--blue); font-weight: 600; }

/* ± 스테퍼 */
.stepper-row { display: flex; gap: 10px; }
.stepper { flex: 1; display: flex; align-items: center; background: var(--fill); border-radius: 11px; margin-bottom: 10px; }
.stepper input { margin: 0; background: none; text-align: center; border-radius: 0; padding: 13px 2px; }
.stepper button { border: none; background: none; color: var(--accent); font-size: 22px; font-weight: 500; width: 42px; padding: 12px 0; font-family: inherit; flex: 0 0 auto; }
.stepper button:active { opacity: 0.5; }

/* 세트 알약 */
.group-head { display: flex; align-items: baseline; justify-content: space-between; padding: 13px 16px 10px; }
.group-meta { font-size: 13px; color: var(--label-2); font-variant-numeric: tabular-nums; }
.pill-wrap { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 14px; }
.set-pill {
  flex: 0 0 auto; background: var(--fill); color: var(--label); border: none; border-radius: 9px;
  padding: 8px 12px; font-size: 15px; font-weight: 600; font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.set-pill:active { background: var(--sep); }
.set-pill.pending { opacity: 0.45; }
@keyframes pillpop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
.set-pill.pop { animation: pillpop 0.28s ease; }

/* 세트 수정 바텀 시트 */
.sheet-backdrop { position: fixed; inset: 0; z-index: 100; display: flex; align-items: flex-end; background: rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity 0.2s ease; }
.sheet-backdrop.open { opacity: 1; }
.sheet {
  width: 100%; max-width: 500px; margin: 0 auto; background: var(--bg);
  border-radius: 20px 20px 0 0; padding: 10px 16px calc(20px + env(safe-area-inset-bottom, 0));
  transform: translateY(100%); transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-backdrop.open .sheet { transform: translateY(0); }
.sheet-handle { width: 36px; height: 5px; border-radius: 3px; background: var(--label-3); margin: 6px auto 14px; }
.sheet-title { text-align: center; font-size: 17px; font-weight: 600; margin-bottom: 16px; }
.sheet .danger-btn { margin-top: 8px; background: transparent; }
```

- [ ] **Step 7: 테스트 유지 확인 + 커밋** — Run: `npm test` → PASS (29)

```bash
git add index.html css/style.css
git commit -m "feat: 오늘 탭 마크업/스타일 (알약·스테퍼·시트·자동완성·요약)"
```

---

### Task 5: ui.js 개편 (자동완성·알약·시트·스테퍼·요약·피드백·뒤로가기)

**Files:**
- Modify: `js/ui.js`

**Interfaces:**
- Consumes: Task 1(`summarizeToday, filterExercises, hasExercise`), Task 3(`feedbackAdd`), Task 4 DOM ids.
- Produces: 개편된 오늘 탭 동작 + 앱 내 뒤로가기.

- [ ] **Step 1: import 추가** — 상단 import 수정

```js
import {
  groupByExercise, groupByDate, nextSetNumber, summarizeSession, todayStr, newId,
  summarizeToday, filterExercises, hasExercise,
} from './store.js';
import { feedbackAdd } from './feedback.js';
```

- [ ] **Step 2: 모듈 상태 추가** — 기존 상태 변수 옆에

```js
let currentTab = 'today';
let justAddedId = null;
let editingRecord = null;
let suppressPush = false;
```

- [ ] **Step 3: `renderToday` 교체** — 세트 알약 렌더 + 요약, 뱃지 참조 제거

```js
function renderToday() {
  const pending = pendingIds();
  const box = $('#today-list');
  box.innerHTML = '';
  const groups = groupByExercise(todayRecords);
  if (!groups.length) {
    box.innerHTML = '<p class="muted">아직 기록이 없어요. 첫 세트를 추가해보세요!</p>';
  }
  for (const g of groups) {
    const top = g.sets.reduce((a, b) => (b.weight > a.weight ? b : a));
    const card = document.createElement('div');
    card.className = 'group';
    const head = document.createElement('div');
    head.className = 'group-head';
    const h3 = document.createElement('h3');
    h3.textContent = g.exercise;
    const meta = document.createElement('span');
    meta.className = 'group-meta';
    meta.textContent = `${g.sets.length}세트 · 최고 ${top.weight}kg`;
    head.append(h3, meta);
    card.appendChild(head);
    const wrap = document.createElement('div');
    wrap.className = 'pill-wrap';
    for (const r of g.sets) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'set-pill'
        + (pending.has(r.id) ? ' pending' : '')
        + (r.id === justAddedId ? ' pop' : '');
      pill.textContent = `${r.weight}×${r.reps}`;
      pill.setAttribute('aria-label', `${r.set}세트 ${r.weight}kg ${r.reps}회, 탭하면 수정`);
      pill.onclick = () => openSetSheet(r);
      wrap.appendChild(pill);
    }
    card.appendChild(wrap);
    box.appendChild(card);
  }
  updateSummary();
}

function updateSummary() {
  const el = $('#today-summary');
  const s = summarizeToday(todayRecords);
  if (!s.sets) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `${s.exercises}종목 · ${s.sets}세트 · 총 ${Math.round(s.volume).toLocaleString()}kg`;
}
```

- [ ] **Step 4: `addSet`에 피드백 + justAddedId** — `addSet` 끝부분 교체

기존 끝:
```js
  selectedExercise = exercise;
  renderExerciseButtons();
  renderToday();
  flushQueue();
}
```
교체:
```js
  selectedExercise = exercise;
  justAddedId = record.id;
  renderExerciseButtons();
  renderToday();
  requestAnimationFrame(() => { justAddedId = null; });
  feedbackAdd();
  flushQueue();
}
```

- [ ] **Step 5: 자동완성 함수 추가**

```js
function hideSuggest() {
  const box = $('#exercise-suggest');
  box.hidden = true;
  box.innerHTML = '';
}

function updateSuggest() {
  const box = $('#exercise-suggest');
  const val = $('#exercise-input').value.trim();
  box.innerHTML = '';
  const matches = filterExercises(exercises, val).slice(0, 8);
  for (const name of matches) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'suggest-item';
    row.textContent = name;
    row.addEventListener('pointerdown', (e) => { e.preventDefault(); selectExercise(name); });
    box.appendChild(row);
  }
  if (val && !hasExercise(exercises, val)) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'suggest-item suggest-new';
    add.textContent = `'${val}' 새 종목으로 추가`;
    add.addEventListener('pointerdown', (e) => { e.preventDefault(); selectExercise(val); });
    box.appendChild(add);
  }
  box.hidden = box.children.length === 0;
}
```

- [ ] **Step 6: `selectExercise` 끝에 `hideSuggest()` 추가** — 함수 마지막 줄 `renderExerciseButtons();` 다음(try 진입 전)에 `hideSuggest();` 삽입:

```js
async function selectExercise(name) {
  selectedExercise = name;
  $('#exercise-input').value = name;
  renderExerciseButtons();
  hideSuggest();
  $('#last-session').textContent = '지난번 기록 불러오는 중…';
  // ...이하 기존 그대로...
```

- [ ] **Step 7: 세트 수정 시트 함수 추가**

```js
function openSetSheet(record) {
  editingRecord = record;
  $('#sheet-weight').value = record.weight;
  $('#sheet-reps').value = record.reps;
  const sheet = $('#set-sheet');
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  history.pushState({ tab: currentTab, overlay: 'sheet' }, '');
}

function closeSetSheet() {
  const sheet = $('#set-sheet');
  sheet.classList.remove('open');
  setTimeout(() => { sheet.hidden = true; }, 220);
  editingRecord = null;
}

async function saveSheet() {
  if (!editingRecord) return;
  const weight = Number($('#sheet-weight').value) || 0;
  const reps = Number($('#sheet-reps').value);
  if (!Number.isFinite(weight) || weight < 0 || weight > 2000) { setNotice('무게는 0~2000 사이로 입력해주세요'); return; }
  if (!Number.isInteger(reps) || reps < 1 || reps > 1000) { setNotice('횟수는 1~1000 사이 정수로 입력해주세요'); return; }
  const rec = editingRecord;
  const prevW = rec.weight;
  const prevR = rec.reps;
  rec.weight = weight;
  rec.reps = reps;
  renderToday();
  history.back(); // 시트 닫기 (popstate → closeSetSheet)
  try {
    await apiPost('/api/sets', { action: 'edit', id: rec.id, weight, reps });
  } catch {
    rec.weight = prevW;
    rec.reps = prevR;
    renderToday();
    setNotice('수정 실패 — 다시 시도해주세요');
  }
}

function deleteFromSheet() {
  if (!editingRecord) return;
  const rec = editingRecord;
  history.back(); // 시트 닫기
  deleteSet(rec);
}
```

- [ ] **Step 8: `showTab`에 currentTab + history push** — 함수 시작/끝 수정

```js
function showTab(name) {
  currentTab = name;
  for (const sec of document.querySelectorAll('.tab-panel')) {
    sec.hidden = sec.id !== `tab-${name}`;
  }
  for (const btn of document.querySelectorAll('.tab-bar button')) {
    btn.classList.toggle('selected', btn.dataset.tab === name);
  }
  if (!suppressPush) history.pushState({ tab: name, overlay: null }, '');
  if (name === 'history') renderHistory();
  if (name === 'chart') renderChartTab();
  if (name === 'body') renderBodyTab();
}
```

- [ ] **Step 9: popstate 핸들러 추가**

```js
function onPopState(e) {
  if (!$('#set-sheet').hidden) { closeSetSheet(); return; }
  const tab = (e.state && e.state.tab) || 'today';
  suppressPush = true;
  showTab(tab);
  suppressPush = false;
}
```

- [ ] **Step 10: `bindEvents`에 신규 이벤트 배선 추가** — 함수 안에 추가(기존 유지)

```js
  // 종목 자동완성
  const exInput = $('#exercise-input');
  exInput.addEventListener('input', updateSuggest);
  exInput.addEventListener('focus', updateSuggest);
  exInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSuggest(); });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.suggest-wrap')) hideSuggest();
  });

  // ± 스테퍼 (오늘 폼 + 시트 공용, 위임)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.step-plus, .step-minus');
    if (!btn) return;
    const stepper = btn.closest('.stepper');
    const input = document.getElementById(stepper.dataset.for);
    const step = Number(stepper.dataset.step);
    const min = Number(stepper.dataset.min);
    const max = Number(stepper.dataset.max);
    const dir = btn.classList.contains('step-plus') ? 1 : -1;
    const cur = Number(input.value) || 0;
    let next = Math.round((cur + dir * step) * 100) / 100;
    next = Math.max(min, Math.min(max, next));
    input.value = String(next);
  });

  // 세트 수정 시트
  $('#sheet-save').onclick = saveSheet;
  $('#sheet-delete').onclick = deleteFromSheet;
  $('#set-sheet').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'set-sheet') history.back(); // 바깥탭 → 닫기
  });

  // 앱 내 뒤로가기
  window.addEventListener('popstate', onPopState);
```

`$('#exercise-input').oninput = ...` 기존 배선은 제거하고 위 addEventListener('input')이 대신한다. 단, 기존 oninput은 `selectedExercise`/`renderExerciseButtons`도 했으므로 그 로직을 input 리스너에 합친다:

```js
  exInput.addEventListener('input', () => {
    selectedExercise = exInput.value.trim();
    renderExerciseButtons();
    updateSuggest();
  });
```
(위 focus/keydown/pointerdown/스테퍼/시트/popstate 배선은 그대로 두고, input 리스너만 이 통합본으로.)

- [ ] **Step 11: `startApp`에서 초기 history 상태 + 뱃지 제거 반영** — `showTab('today')` 부분 교체

기존:
```js
  showTab('today');
  loadToday();
```
교체:
```js
  history.replaceState({ tab: 'today', overlay: null }, '');
  suppressPush = true;
  showTab('today');
  suppressPush = false;
  loadToday();
```

- [ ] **Step 12: 뱃지/오프라인표시 참조 제거**
  - `renderToday`에서는 이미 제거됨(Step 3).
  - `renderHistory`의 `if (off) box.insertAdjacentHTML('afterbegin', '<p class="badge">오프라인 데이터</p>');` 줄 삭제.
  - `renderBodyTab`의 동일한 `if (off) list.insertAdjacentHTML(...)` 줄 삭제.
  - (두 함수의 `off` 구조분해는 남겨도 무해하나, 미사용 경고 피하려면 `const { data } = await cachedGet(...)`로 변경.)

- [ ] **Step 13: 로컬 테스트 + 커밋** — Run: `npm test` → PASS (29)

```bash
git add js/ui.js
git commit -m "feat: 오늘 탭 개편 (자동완성·세트 알약·수정 시트·스테퍼·요약·피드백·뒤로가기)"
```

---

### Task 6: 로컬 E2E 검증 + 배포

**Files:** 없음(검증·배포)

- [ ] **Step 1: dev 서버 기동** — `node --env-file=.env scripts/dev-server.mjs` (백그라운드)

- [ ] **Step 2: Playwright E2E** — 임시 계정으로:
  1. 가입 → 오늘 탭
  2. 종목칸에 "벤" 입력 → 자동완성에 기존 종목(없으면 "'벤' 새 종목 추가") 표시
  3. 세트 3개 추가 → 알약 3개가 한 카드에 wrap, 요약 "1종목 · 3세트 · 총 …kg" 표시
  4. `+2.5`/`−1` 버튼 → 입력값 변화
  5. 알약 탭 → 시트 열림 → 무게 수정 저장 → 알약 텍스트 갱신, 서버 반영
  6. 알약 탭 → 시트 → 삭제 → 알약 제거
  7. 뒤로가기: 시트 열고 브라우저 back → 시트만 닫힘; 다른 탭 갔다가 back → 이전 탭
  8. 상태 뱃지(#pending-badge 등)가 DOM에 없음 확인
  9. 라이트·다크 스크린샷 검토

- [ ] **Step 3: 임시 계정 DB 정리** (username 스코프 삭제)

- [ ] **Step 4: 배포** — `npx vercel deploy --prod --yes --token <VERCEL_TOKEN>` → Ready 확인 → 프로덕션 헬스체크(200, `/api` 정상)

- [ ] **Step 5: dev 서버 종료**

---

## 수동 E2E 체크리스트 (요약)

1. 뱃지 안 뜸(정상 상황) / 오프라인에서 추가·삭제해도 재접속 시 반영
2. 종목 자동완성: 기존 골라쓰기 + 새 종목 추가, 오타 중복 방지
3. 세트 알약 압축(많아도 wrap), 추가 시 톡 애니메이션
4. 세트 수정 시트: 무게/횟수 수정·삭제, ± 버튼
5. 오늘 요약 실시간 갱신
6. 폰 뒤로가기: 시트 닫힘 → 탭 이동 → 앱 나감(루트)
7. 라이트/다크 정상
