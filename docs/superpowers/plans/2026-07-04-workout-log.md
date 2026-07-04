# 운동 기록 사이트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종목·무게·횟수·세트를 휴대폰으로 입력하면 구글 시트에 쌓이는 개인 운동 기록 사이트. GitHub Pages + Apps Script로 완전 무료 호스팅.

**Architecture:** 순수 HTML/CSS/JS 정적 사이트(GitHub Pages) ↔ 구글 Apps Script 웹앱(API) ↔ 구글 시트(저장소). 데이터 가공 로직은 순수 함수 모듈로 분리해 Node 내장 테스트 러너로 검증한다.

**Tech Stack:** 바닐라 JS(ES Modules), Google Apps Script, node:test (Node 18+), GitHub Pages, PWA manifest.

## Global Constraints

- 프레임워크·빌드 도구·npm 의존성 금지. 정적 파일 그대로 서빙.
- 테스트는 Node 내장 러너만 사용: `node --test tests/`
- UI 텍스트는 전부 한국어. 모바일 우선 (터치 타깃 크게, 숫자 입력엔 `inputmode`).
- 레코드 JSON 형태는 전 구간 동일: `{ id, date, exercise, weight, reps, set }` (date는 `YYYY-MM-DD` 문자열, weight는 0 허용).
- API 응답은 항상 `{ ok: true, ... }` 또는 `{ ok: false, error: '...' }`.
- 토큰·웹앱 URL을 저장소 코드에 하드코딩 금지 (localStorage에서만).
- localStorage 키 접두사는 `gymlog.` 로 통일.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 추가.

## 파일 구조 (최종)

```
├── index.html               앱 셸 (탭 3개)
├── css/style.css            모바일 우선 스타일
├── js/
│   ├── config.js            웹앱 URL/토큰 관리
│   ├── api.js               GAS API 호출 + 캐시 폴백
│   ├── store.js             순수 데이터 로직 (테스트 대상)
│   ├── queue.js             오프라인 대기열 (테스트 대상)
│   ├── chart.js             SVG 차트 (scalePoints는 테스트 대상)
│   └── ui.js                렌더링 + 이벤트 (엔트리포인트)
├── apps-script/
│   ├── logic.cjs            GAS 순수 로직 — Node 테스트 + GAS 복붙 겸용
│   └── Code.gs              GAS doGet/doPost + 시트 I/O (복붙용)
├── tests/*.test.js          node:test 단위 테스트
├── icons/icon.svg, icon-180.png
├── manifest.webmanifest
├── package.json             {"type":"module"} + test 스크립트만
└── README.md                세팅/배포 가이드
```

---

### Task 1: 프로젝트 뼈대 정리

**Files:**
- Delete: `src/Main.java`, `untitled.iml` (IntelliJ Java 잔재)
- Create: `package.json`, `.gitignore` (덮어쓰기)

**Interfaces:**
- Produces: `npm test` = `node --test tests/`, ESM 프로젝트(`"type": "module"`)

- [ ] **Step 1: Java 잔재 삭제**

```bash
rm -rf src untitled.iml
```

- [ ] **Step 2: package.json 작성**

```json
{
  "name": "gym-log",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 3: .gitignore 덮어쓰기**

```
.idea/
*.iml
node_modules/
```

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "chore: 프로젝트 뼈대 정리 (Java 잔재 제거, ESM 설정)"
```

---

### Task 2: Apps Script 순수 로직 (logic.cjs)

**Files:**
- Create: `apps-script/logic.cjs`
- Test: `tests/logic.test.js`

**Interfaces:**
- Produces (Task 3의 Code.gs가 전역 함수로 호출):
  - `rowsToRecords(rows: any[][]) → Record[]` — 시트 행(날짜,종목,무게,횟수,세트,ID 순)을 레코드로
  - `recordsOnDate(records, date) → Record[]`
  - `lastSession(records, exercise, beforeDate) → Record[]` — beforeDate 이전 가장 최근 날짜의 해당 종목 기록
  - `recentExercises(records) → string[]` — 최근 사용순, 중복 제거
  - `chartSeries(records, exercise) → {date, weight}[]` — 날짜별 최고 무게, 날짜 오름차순
  - `hasId(records, id) → boolean`
- 파일은 GAS에 그대로 복붙 가능해야 함: `var`/`function` 문법만, 끝에 `typeof module` 가드로 CommonJS export.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/logic.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import logic from '../apps-script/logic.cjs';

const rows = [
  ['2026-07-01', '벤치프레스', 60, 10, 1, 'a1'],
  ['2026-07-01', '벤치프레스', 60, 8, 2, 'a2'],
  ['2026-07-01', '스쿼트', 80, 5, 1, 'a3'],
  ['2026-07-03', '벤치프레스', 62.5, 10, 1, 'b1'],
  ['2026-07-04', '스쿼트', 85, 5, 1, 'c1'],
];
const records = logic.rowsToRecords(rows);

test('rowsToRecords: 행을 레코드 객체로 변환', () => {
  assert.deepEqual(records[0], {
    date: '2026-07-01', exercise: '벤치프레스', weight: 60, reps: 10, set: 1, id: 'a1',
  });
});

test('recordsOnDate: 해당 날짜 기록만', () => {
  assert.equal(logic.recordsOnDate(records, '2026-07-01').length, 3);
});

test('lastSession: 기준일 이전 가장 최근 세션', () => {
  const last = logic.lastSession(records, '벤치프레스', '2026-07-04');
  assert.equal(last.length, 1);
  assert.equal(last[0].id, 'b1');
});

test('lastSession: 기록 없으면 빈 배열', () => {
  assert.deepEqual(logic.lastSession(records, '데드리프트', '2026-07-04'), []);
});

test('recentExercises: 최근 사용순 중복 제거', () => {
  assert.deepEqual(logic.recentExercises(records), ['스쿼트', '벤치프레스']);
});

test('chartSeries: 날짜별 최고 무게, 날짜 오름차순', () => {
  assert.deepEqual(logic.chartSeries(records, '벤치프레스'), [
    { date: '2026-07-01', weight: 60 },
    { date: '2026-07-03', weight: 62.5 },
  ]);
});

test('hasId: 중복 ID 감지', () => {
  assert.equal(logic.hasId(records, 'a1'), true);
  assert.equal(logic.hasId(records, 'zzz'), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... logic.cjs`

- [ ] **Step 3: 구현** — `apps-script/logic.cjs`

```js
// 순수 함수 모음 — Google Apps Script에 그대로 복붙되고, Node 테스트에서도 로드된다.
// GAS 호환을 위해 var/function 문법만 사용한다.

function rowsToRecords(rows) {
  return rows.map(function (r) {
    return {
      date: String(r[0]),
      exercise: String(r[1]),
      weight: Number(r[2]),
      reps: Number(r[3]),
      set: Number(r[4]),
      id: String(r[5]),
    };
  });
}

function recordsOnDate(records, date) {
  return records.filter(function (r) { return r.date === date; });
}

function lastSession(records, exercise, beforeDate) {
  var dates = records
    .filter(function (r) { return r.exercise === exercise && r.date < beforeDate; })
    .map(function (r) { return r.date; });
  if (dates.length === 0) return [];
  var last = dates.sort()[dates.length - 1];
  return records.filter(function (r) {
    return r.exercise === exercise && r.date === last;
  });
}

function recentExercises(records) {
  var seen = {};
  var out = [];
  for (var i = records.length - 1; i >= 0; i--) {
    var name = records[i].exercise;
    if (!seen[name]) {
      seen[name] = true;
      out.push(name);
    }
  }
  return out;
}

function chartSeries(records, exercise) {
  var byDate = {};
  records.forEach(function (r) {
    if (r.exercise !== exercise) return;
    if (byDate[r.date] === undefined || r.weight > byDate[r.date]) {
      byDate[r.date] = r.weight;
    }
  });
  return Object.keys(byDate).sort().map(function (d) {
    return { date: d, weight: byDate[d] };
  });
}

function hasId(records, id) {
  return records.some(function (r) { return r.id === id; });
}

if (typeof module !== 'undefined') {
  module.exports = {
    rowsToRecords: rowsToRecords,
    recordsOnDate: recordsOnDate,
    lastSession: lastSession,
    recentExercises: recentExercises,
    chartSeries: chartSeries,
    hasId: hasId,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps-script/logic.cjs tests/logic.test.js
git commit -m "feat: Apps Script 순수 로직 (조회/차트/멱등 체크)"
```

---

### Task 3: Apps Script 웹앱 엔드포인트 (Code.gs)

**Files:**
- Create: `apps-script/Code.gs`

**Interfaces:**
- Consumes: Task 2의 전역 함수들 (GAS 프로젝트 안에서 logic.cjs 내용이 같이 붙여넣어짐)
- Produces (HTTP API — Task 6의 api.js가 호출):
  - `GET ?token=&action=today&date=YYYY-MM-DD` → `{ok, records}`
  - `GET ?token=&action=history&days=90` → `{ok, records}` (최근 N일)
  - `GET ?token=&action=last&exercise=X&before=YYYY-MM-DD` → `{ok, records}`
  - `GET ?token=&action=exercises` → `{ok, exercises}`
  - `GET ?token=&action=chart&exercise=X` → `{ok, series}`
  - `POST` (text/plain JSON) `{token, action:'add', record}` → `{ok}` (같은 id 재전송 시 `{ok, duplicate:true}`)
  - `POST` `{token, action:'delete', id}` → `{ok}`
- 토큰은 GAS 스크립트 속성 `TOKEN`과 대조.

GAS 환경(SpreadsheetApp 등)이 필요해 로컬 단위 테스트 불가 — 얇게 유지하고 배포 후 Task 10에서 curl로 검증한다.

- [ ] **Step 1: 구현** — `apps-script/Code.gs`

```js
// 구글 시트 확장 프로그램 > Apps Script에 logic.cjs 내용과 함께 붙여넣는 파일.
// 배포: 웹 앱, 실행 계정 = 나, 액세스 = 모든 사용자.
// 스크립트 속성에 TOKEN 키로 비밀 토큰을 저장해야 동작한다.

var SHEET_NAME = '기록';
var HEADER = ['날짜', '종목', '무게(kg)', '횟수', '세트번호', '기록ID'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
    sheet.getRange('A:A').setNumberFormat('@'); // 날짜 자동 변환 방지
  }
  return sheet;
}

function readRecords_() {
  var sheet = getSheet_();
  if (sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  var normalized = rows.map(function (r) {
    var d = r[0];
    if (Object.prototype.toString.call(d) === '[object Date]') {
      d = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
    }
    return [d, r[1], r[2], r[3], r[4], r[5]];
  });
  return rowsToRecords(normalized);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return Boolean(expected) && token === expected;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!checkToken_(p.token)) return json_({ ok: false, error: 'bad token' });
  var records = readRecords_();
  if (p.action === 'today') {
    return json_({ ok: true, records: recordsOnDate(records, p.date) });
  }
  if (p.action === 'history') {
    var days = Number(p.days || 90);
    var cutoff = Utilities.formatDate(
      new Date(Date.now() - days * 86400000), 'Asia/Seoul', 'yyyy-MM-dd');
    return json_({
      ok: true,
      records: records.filter(function (r) { return r.date >= cutoff; }),
    });
  }
  if (p.action === 'last') {
    return json_({ ok: true, records: lastSession(records, p.exercise, p.before) });
  }
  if (p.action === 'exercises') {
    return json_({ ok: true, exercises: recentExercises(records) });
  }
  if (p.action === 'chart') {
    return json_({ ok: true, series: chartSeries(records, p.exercise) });
  }
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  if (!checkToken_(body.token)) return json_({ ok: false, error: 'bad token' });

  if (body.action === 'add') {
    var r = body.record;
    if (!r || !r.id || !r.date || !r.exercise) {
      return json_({ ok: false, error: 'bad record' });
    }
    if (hasId(readRecords_(), r.id)) return json_({ ok: true, duplicate: true });
    getSheet_().appendRow([r.date, r.exercise, r.weight, r.reps, r.set, r.id]);
    return json_({ ok: true });
  }

  if (body.action === 'delete') {
    var sheet = getSheet_();
    for (var row = sheet.getLastRow(); row >= 2; row--) {
      if (String(sheet.getRange(row, 6).getValue()) === body.id) {
        sheet.deleteRow(row);
        return json_({ ok: true });
      }
    }
    return json_({ ok: false, error: 'not found' });
  }

  return json_({ ok: false, error: 'unknown action' });
}
```

- [ ] **Step 2: 커밋**

```bash
git add apps-script/Code.gs
git commit -m "feat: Apps Script 웹앱 엔드포인트 (doGet/doPost, 토큰 검증)"
```

---

### Task 4: 프론트 데이터 로직 (store.js)

**Files:**
- Create: `js/store.js`
- Test: `tests/store.test.js`

**Interfaces:**
- Produces (Task 7~8의 ui.js가 import):
  - `groupByExercise(records) → {exercise, sets: Record[]}[]` — 첫 등장 순서 유지, sets는 세트번호 오름차순
  - `groupByDate(records) → {date, groups}[]` — 최근 날짜부터
  - `nextSetNumber(records, exercise) → number` — 최대 세트번호+1, 없으면 1
  - `summarizeSession(records) → string | null` — `"62.5kg × 8 × 2세트"` (최고 무게 세트 기준)
  - `todayStr(now?: Date) → 'YYYY-MM-DD'` (로컬 시간)
  - `newId() → string` (고유 문자열)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/store.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupByExercise, groupByDate, nextSetNumber, summarizeSession, todayStr, newId,
} from '../js/store.js';

const records = [
  { date: '2026-07-04', exercise: '벤치프레스', weight: 60, reps: 10, set: 1, id: 'a1' },
  { date: '2026-07-04', exercise: '스쿼트', weight: 80, reps: 5, set: 1, id: 'a2' },
  { date: '2026-07-04', exercise: '벤치프레스', weight: 62.5, reps: 8, set: 2, id: 'a3' },
];

test('groupByExercise: 종목별로 묶고 첫 등장 순서 유지, 세트 정렬', () => {
  const groups = groupByExercise(records);
  assert.deepEqual(groups.map((g) => g.exercise), ['벤치프레스', '스쿼트']);
  assert.deepEqual(groups[0].sets.map((s) => s.set), [1, 2]);
});

test('nextSetNumber: 최대 세트번호 + 1, 없으면 1', () => {
  assert.equal(nextSetNumber(records, '벤치프레스'), 3);
  assert.equal(nextSetNumber(records, '데드리프트'), 1);
});

test('summarizeSession: 최고 무게 세트 기준 요약', () => {
  const bench = records.filter((r) => r.exercise === '벤치프레스');
  assert.equal(summarizeSession(bench), '62.5kg × 8 × 2세트');
  assert.equal(summarizeSession([]), null);
});

test('todayStr: 로컬 날짜 YYYY-MM-DD', () => {
  assert.equal(todayStr(new Date(2026, 6, 4)), '2026-07-04');
});

test('newId: 매번 다른 값', () => {
  assert.notEqual(newId(), newId());
});

test('groupByDate: 최근 날짜부터', () => {
  const more = records.concat([
    { date: '2026-07-01', exercise: '스쿼트', weight: 75, reps: 5, set: 1, id: 'z1' },
  ]);
  assert.deepEqual(groupByDate(more).map((d) => d.date), ['2026-07-04', '2026-07-01']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... store.js` (logic 테스트 7개는 계속 PASS)

- [ ] **Step 3: 구현** — `js/store.js`

```js
// 화면과 무관한 순수 데이터 가공 로직. ui.js에서 import한다.

export function groupByExercise(records) {
  const groups = [];
  const byName = new Map();
  for (const r of records) {
    let g = byName.get(r.exercise);
    if (!g) {
      g = { exercise: r.exercise, sets: [] };
      byName.set(r.exercise, g);
      groups.push(g);
    }
    g.sets.push(r);
  }
  for (const g of groups) g.sets.sort((a, b) => a.set - b.set);
  return groups;
}

export function groupByDate(records) {
  const dates = [...new Set(records.map((r) => r.date))].sort().reverse();
  return dates.map((date) => ({
    date,
    groups: groupByExercise(records.filter((r) => r.date === date)),
  }));
}

export function nextSetNumber(records, exercise) {
  const nums = records.filter((r) => r.exercise === exercise).map((r) => r.set);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function summarizeSession(records) {
  if (!records.length) return null;
  const top = records.reduce((a, b) => (b.weight > a.weight ? b : a));
  return `${top.weight}kg × ${top.reps} × ${records.length}세트`;
}

export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/store.js tests/store.test.js
git commit -m "feat: 프론트 데이터 로직 (그룹핑/세트번호/요약)"
```

---

### Task 5: 오프라인 대기열 (queue.js)

**Files:**
- Create: `js/queue.js`
- Test: `tests/queue.test.js`

**Interfaces:**
- Produces (Task 7의 ui.js가 import):
  - `createQueue(storage, key?) → { all(): Record[], push(record), remove(id), size(): number }`
  - storage는 localStorage 호환 객체(`getItem`/`setItem`) — 테스트에선 가짜 주입.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/queue.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../js/queue.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test('push/all/remove/size 기본 동작', () => {
  const q = createQueue(fakeStorage());
  assert.deepEqual(q.all(), []);
  q.push({ id: 'a' });
  q.push({ id: 'b' });
  assert.equal(q.size(), 2);
  q.remove('a');
  assert.deepEqual(q.all().map((r) => r.id), ['b']);
});

test('같은 storage로 다시 만들어도 데이터 유지 (영속화)', () => {
  const storage = fakeStorage();
  createQueue(storage).push({ id: 'a' });
  assert.equal(createQueue(storage).size(), 1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... queue.js`

- [ ] **Step 3: 구현** — `js/queue.js`

```js
// 전송 실패한 세트를 localStorage에 쌓아뒀다가 재전송하기 위한 대기열.

export function createQueue(storage, key = 'gymlog.pending') {
  const load = () => JSON.parse(storage.getItem(key) || '[]');
  const save = (items) => storage.setItem(key, JSON.stringify(items));
  return {
    all: () => load(),
    push(record) {
      const items = load();
      items.push(record);
      save(items);
    },
    remove(id) {
      save(load().filter((r) => r.id !== id));
    },
    size: () => load().length,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/queue.js tests/queue.test.js
git commit -m "feat: 오프라인 전송 대기열"
```

---

### Task 6: 설정 + API 클라이언트 (config.js, api.js)

**Files:**
- Create: `js/config.js`, `js/api.js`

**Interfaces:**
- Consumes: 없음 (브라우저 fetch/localStorage/prompt)
- Produces (Task 7~8의 ui.js가 import):
  - `ensureConfig() → {url, token}` — 없으면 prompt로 입력받아 저장
  - `apiGet(params) → Promise<data>` — `{ok:false}`면 throw
  - `apiPost(body) → Promise<data>`
  - `cachedGet(params, cacheKey) → Promise<{data, offline: boolean}>` — 실패 시 마지막 성공 응답 반환

브라우저 I/O 래퍼라 단위 테스트 없음 — Task 10 수동 검증으로 커버.

- [ ] **Step 1: config.js 구현**

```js
// Apps Script 웹앱 URL과 비밀 토큰을 localStorage에 보관한다.
// 공개 저장소에 하드코딩하지 않기 위해 최초 접속 시 입력받는다.

const KEY = 'gymlog.config';

export function getConfig(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveConfig(config, storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(config));
}

export function ensureConfig() {
  const existing = getConfig();
  if (existing && existing.url && existing.token) return existing;
  const url = (prompt('Apps Script 웹앱 URL을 입력하세요 (…/exec 로 끝나는 주소)') || '').trim();
  const token = (prompt('비밀 토큰을 입력하세요') || '').trim();
  const config = { url, token };
  saveConfig(config);
  return config;
}
```

- [ ] **Step 2: api.js 구현**

```js
// Apps Script 웹앱 호출. CORS 제약 때문에 POST는 text/plain으로 보낸다
// (application/json이면 GAS가 preflight를 처리하지 못한다).

import { ensureConfig } from './config.js';

export async function apiGet(params) {
  const { url, token } = ensureConfig();
  const qs = new URLSearchParams({ ...params, token });
  const res = await fetch(`${url}?${qs}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'API 오류');
  return data;
}

export async function apiPost(body) {
  const { url, token } = ensureConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, token }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'API 오류');
  return data;
}

export async function cachedGet(params, cacheKey, storage = localStorage) {
  const key = `gymlog.cache.${cacheKey}`;
  try {
    const data = await apiGet(params);
    storage.setItem(key, JSON.stringify(data));
    return { data, offline: false };
  } catch (err) {
    const cached = storage.getItem(key);
    if (cached) return { data: JSON.parse(cached), offline: true };
    throw err;
  }
}
```

- [ ] **Step 3: 기존 테스트 여전히 통과 확인**

Run: `npm test`
Expected: PASS (15 tests)

- [ ] **Step 4: 커밋**

```bash
git add js/config.js js/api.js
git commit -m "feat: 설정 관리 + API 클라이언트 (캐시 폴백 포함)"
```

---

### Task 7: 앱 셸 + 오늘 탭 (index.html, style.css, ui.js)

**Files:**
- Create: `index.html`, `css/style.css`, `js/ui.js`

**Interfaces:**
- Consumes: store.js(`groupByExercise, groupByDate, nextSetNumber, summarizeSession, todayStr, newId`), queue.js(`createQueue`), api.js(`apiGet, apiPost, cachedGet`), config.js(`ensureConfig`), chart.js(`renderChart` — Task 8에서 생성되므로 **이 태스크에서는 chart.js에 빈 스텁을 함께 만든다**)
- Produces: 동작하는 오늘 탭 (종목 버튼, 지난번 자동 채움, 세트 추가/삭제, 낙관적 UI + 대기열 재전송). 탭 전환 뼈대(지난 기록/차트 렌더 함수 포함 — 컨테이너는 Task 8에서 채워짐).

- [ ] **Step 1: index.html 작성**

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111827">
  <title>운동 기록</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icons/icon-180.png">
</head>
<body>
  <header>
    <h1>운동 기록</h1>
    <span id="pending-badge" class="badge" hidden>전송 대기</span>
    <span id="offline-badge" class="badge" hidden>오프라인</span>
  </header>

  <nav class="tab-bar">
    <button type="button" data-tab="today" class="selected">오늘</button>
    <button type="button" data-tab="history">지난 기록</button>
    <button type="button" data-tab="chart">차트</button>
  </nav>

  <main>
    <section id="tab-today" class="tab-panel">
      <div id="exercise-buttons" class="chips"></div>
      <input id="exercise-input" type="text" placeholder="종목 (예: 벤치프레스)">
      <p id="last-session" class="muted"></p>
      <div class="row">
        <input id="weight-input" type="number" inputmode="decimal" min="0" step="0.5" placeholder="무게(kg)">
        <input id="reps-input" type="number" inputmode="numeric" min="1" placeholder="횟수">
      </div>
      <button id="add-btn" type="button" class="primary">세트 추가</button>
      <div id="today-list"></div>
    </section>

    <section id="tab-history" class="tab-panel" hidden>
      <div id="history-list"></div>
    </section>

    <section id="tab-chart" class="tab-panel" hidden>
      <select id="chart-exercise"></select>
      <div id="chart-box"></div>
    </section>
  </main>

  <script type="module" src="js/ui.js"></script>
</body>
</html>
```

- [ ] **Step 2: css/style.css 작성**

```css
* { box-sizing: border-box; margin: 0; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #111827;
  color: #f9fafb;
  max-width: 480px;
  margin: 0 auto;
  padding: 12px 16px 48px;
}

header { display: flex; align-items: center; gap: 8px; padding: 8px 0 12px; }
h1 { font-size: 1.3rem; }

.badge {
  background: #f59e0b;
  color: #111827;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}

.tab-bar { display: flex; gap: 6px; margin-bottom: 16px; }
.tab-bar button {
  flex: 1;
  padding: 10px 0;
  border: 1px solid #374151;
  border-radius: 10px;
  background: transparent;
  color: #9ca3af;
  font-size: 0.95rem;
}
.tab-bar button.selected { background: #1f2937; color: #f9fafb; border-color: #34d399; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chip {
  padding: 8px 14px;
  border: 1px solid #374151;
  border-radius: 999px;
  background: #1f2937;
  color: #f9fafb;
  font-size: 0.9rem;
}
.chip.selected { border-color: #34d399; color: #34d399; }

input, select {
  width: 100%;
  padding: 12px;
  margin-bottom: 10px;
  border: 1px solid #374151;
  border-radius: 10px;
  background: #1f2937;
  color: #f9fafb;
  font-size: 1rem;
}

.row { display: flex; gap: 8px; }

button.primary {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 10px;
  background: #34d399;
  color: #111827;
  font-size: 1.05rem;
  font-weight: 700;
  margin-bottom: 18px;
}
button.primary:active { opacity: 0.8; }

.muted { color: #9ca3af; font-size: 0.88rem; margin-bottom: 10px; }

.group { margin-bottom: 14px; }
.group h3 { font-size: 1rem; margin-bottom: 6px; color: #34d399; }
.set-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: #1f2937;
  border-radius: 8px;
  margin-bottom: 4px;
}
.set-row span:nth-child(2) { flex: 1; }
.set-row .del {
  border: none;
  background: transparent;
  color: #f87171;
  font-size: 0.85rem;
  padding: 4px;
}

details { background: #1f2937; border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }
summary { font-weight: 700; padding: 4px 0; }
details p { padding: 4px 0; font-size: 0.92rem; }

.chart { width: 100%; }
.chart polyline { stroke: #34d399; stroke-width: 2; }
.chart circle { fill: #34d399; }
.chart text { fill: #9ca3af; font-size: 11px; }
```

- [ ] **Step 3: chart.js 스텁 작성** (Task 8에서 실제 구현으로 교체)

```js
export function renderChart(el) {
  el.innerHTML = '<p class="muted">준비 중</p>';
}
```

- [ ] **Step 4: js/ui.js 작성**

```js
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
  renderExerciseButtons();
  renderToday();
  flushQueue();
}

init();
```

- [ ] **Step 5: 로컬에서 화면 확인**

Run: `npx serve -l 8720 .` (백그라운드) 후 브라우저로 `http://localhost:8720` 접속
Expected: 설정 prompt 2개(URL/토큰 — 아무 값이나 입력) → 오늘 탭 표시, 오프라인 배지, "아직 기록이 없어요" 문구. 콘솔에 모듈 로드 에러 없어야 함.

- [ ] **Step 6: 기존 테스트 통과 확인 + 커밋**

Run: `npm test` → PASS (15 tests)

```bash
git add index.html css/style.css js/ui.js js/chart.js
git commit -m "feat: 앱 셸 + 오늘 탭 (입력/목록/낙관적 UI/대기열)"
```

---

### Task 8: SVG 차트 (chart.js)

**Files:**
- Modify: `js/chart.js` (스텁 → 실제 구현)
- Test: `tests/chart.test.js`

**Interfaces:**
- Consumes: 없음 (순수 + DOM)
- Produces:
  - `scalePoints(series, width, height, pad?) → {date, weight, x, y}[]` — 순수 함수, 테스트 대상
  - `renderChart(el, series)` — el.innerHTML에 SVG 렌더 (ui.js가 호출, 시그니처 유지)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/chart.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scalePoints } from '../js/chart.js';

test('scalePoints: x는 균등 분배, 무거울수록 y가 위(작음)', () => {
  const pts = scalePoints(
    [{ date: 'd1', weight: 50 }, { date: 'd2', weight: 100 }], 200, 100, 10);
  assert.equal(pts[0].x, 10);
  assert.equal(pts[1].x, 190);
  assert.equal(pts[0].y, 90);
  assert.equal(pts[1].y, 10);
});

test('scalePoints: 점 하나면 가로 가운데', () => {
  const pts = scalePoints([{ date: 'd1', weight: 50 }], 200, 100, 10);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].x, 100);
});

test('scalePoints: 빈 시리즈는 빈 배열', () => {
  assert.deepEqual(scalePoints([], 200, 100), []);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `scalePoints`가 export되지 않음

- [ ] **Step 3: 구현** — `js/chart.js` 전체 교체

```js
// 외부 라이브러리 없는 SVG 꺾은선 차트.

export function scalePoints(series, width, height, pad = 30) {
  if (!series.length) return [];
  const weights = series.map((p) => p.weight);
  const min = Math.min(...weights);
  const span = Math.max(...weights) - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;
  return series.map((p, i) => ({
    ...p,
    x: pad + (series.length > 1 ? i * step : innerW / 2),
    y: pad + innerH - ((p.weight - min) / span) * innerH,
  }));
}

export function renderChart(el, series) {
  const W = 340;
  const H = 220;
  if (!series.length) {
    el.innerHTML = '<p class="muted">이 종목은 아직 기록이 없어요</p>';
    return;
  }
  const pts = scalePoints(series, W, H);
  const line = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const dots = pts.map((p) =>
    `<circle cx="${p.x}" cy="${p.y}" r="4"></circle>` +
    `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle">${p.weight}</text>`,
  ).join('');
  const first = series[0].date.slice(5);
  const last = series[series.length - 1].date.slice(5);
  el.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="무게 변화 차트">` +
    `<polyline points="${line}" fill="none"></polyline>${dots}` +
    `<text x="${30}" y="${H - 8}">${first}</text>` +
    `<text x="${W - 30}" y="${H - 8}" text-anchor="end">${last}</text>` +
    '</svg>';
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (18 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/chart.js tests/chart.test.js
git commit -m "feat: SVG 무게 변화 차트"
```

---

### Task 9: PWA (매니페스트 + 아이콘)

**Files:**
- Create: `manifest.webmanifest`, `icons/icon.svg`, `icons/icon-180.png`

**Interfaces:**
- Consumes: index.html의 `<link rel="manifest">`, `<link rel="apple-touch-icon">` (Task 7에서 이미 연결됨)
- Produces: 안드로이드/iOS 홈 화면 추가 지원

- [ ] **Step 1: manifest.webmanifest 작성**

```json
{
  "name": "운동 기록",
  "short_name": "운동기록",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#111827",
  "theme_color": "#111827",
  "icons": [
    { "src": "icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "icons/icon-180.png", "sizes": "180x180", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: icons/icon.svg 작성** (바벨 모양)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#111827"/>
  <rect x="14" y="46" width="72" height="8" rx="4" fill="#f9fafb"/>
  <rect x="20" y="32" width="10" height="36" rx="3" fill="#34d399"/>
  <rect x="70" y="32" width="10" height="36" rx="3" fill="#34d399"/>
</svg>
```

- [ ] **Step 3: icon-180.png 생성** (iOS apple-touch-icon은 PNG만 지원 — PowerShell로 그림)

```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(180, 180)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.ColorTranslator]::FromHtml('#111827'))
$white = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#f9fafb'))
$green = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#34d399'))
$g.FillRectangle($white, 25, 83, 130, 14)
$g.FillRectangle($green, 36, 58, 18, 64)
$g.FillRectangle($green, 126, 58, 18, 64)
$bmp.Save("icons\icon-180.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
```

Expected: `icons/icon-180.png` 파일 생성 (약 1~2KB)

- [ ] **Step 4: 커밋**

```bash
git add manifest.webmanifest icons/
git commit -m "feat: PWA 매니페스트와 아이콘 (홈 화면 추가 지원)"
```

---

### Task 10: README 세팅 가이드

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: Task 3의 API 명세, Task 9까지의 전체 구조
- Produces: 사용자가 따라할 구글 시트/Apps Script/GitHub Pages 세팅 문서

- [ ] **Step 1: README.md 작성**

````markdown
# 운동 기록 (gym-log)

휴대폰으로 종목·무게·횟수·세트를 입력하면 구글 시트에 쌓이는 개인 운동 기록 사이트.
GitHub Pages + Google Apps Script — 전부 무료.

## 세팅 (최초 1회)

### 1. 구글 시트 + Apps Script

1. [sheets.new](https://sheets.new) 에서 새 시트 생성 (이름 예: `운동 기록`)
2. 메뉴 **확장 프로그램 > Apps Script** 클릭
3. 기본 `Code.gs` 내용을 지우고, 이 저장소의 `apps-script/Code.gs` 내용을 붙여넣기
4. **파일 추가(+) > 스크립트**로 `logic` 파일을 만들고 `apps-script/logic.cjs` 내용을 붙여넣기
5. 왼쪽 **프로젝트 설정(톱니바퀴) > 스크립트 속성 > 속성 추가**:
   - 속성: `TOKEN` / 값: 아무 비밀 문자열 (예: 랜덤 20자) — 이게 비밀번호 역할
6. 오른쪽 위 **배포 > 새 배포 > 유형: 웹 앱**
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자**
7. 배포 후 나오는 **웹 앱 URL**(`https://script.google.com/macros/s/…/exec`)을 복사

> 코드를 수정하면 **배포 > 배포 관리 > 연필 아이콘 > 버전: 새 버전**으로 다시 배포해야 반영된다.

### 2. 사이트 접속

1. `https://<username>.github.io/gym-log/` 접속
2. 최초 접속 시 웹 앱 URL과 토큰을 물어봄 → 위에서 만든 값 입력 (브라우저에 저장됨)
3. 휴대폰 브라우저 메뉴에서 **홈 화면에 추가** → 앱처럼 사용

## 동작 확인 (curl)

```bash
# 조회 (빈 기록이면 records: [])
curl -L "<웹앱URL>?token=<토큰>&action=today&date=2026-07-04"

# 세트 추가
curl -L -X POST "<웹앱URL>" -H "Content-Type: text/plain" \
  -d '{"token":"<토큰>","action":"add","record":{"id":"test-1","date":"2026-07-04","exercise":"벤치프레스","weight":60,"reps":10,"set":1}}'
```

## 개발

```bash
npm test          # 단위 테스트 (Node 18+)
npx serve .       # 로컬 서버 (ES 모듈이라 file:// 로는 안 열림)
```

토큰과 웹 앱 URL은 코드에 넣지 않는다 — 브라우저 localStorage(`gymlog.config`)에만 저장.
````

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: 세팅/배포 가이드"
```

---

### Task 11: GitHub 배포 (Pages)

**Files:** 없음 (배포 작업)

**Interfaces:**
- Consumes: Task 1~10의 전체 저장소
- Produces: `https://<username>.github.io/gym-log/` 라이브 사이트

- [ ] **Step 1: gh 인증 확인**

Run: `gh auth status`
Expected: 로그인된 계정 표시. 안 되어 있으면 사용자에게 `! gh auth login` 실행 요청.

- [ ] **Step 2: 브랜치 정리 + 저장소 생성 + push**

```bash
git branch -M main
gh repo create gym-log --public --source . --push
```

Expected: `https://github.com/<username>/gym-log` 생성 및 push 완료

- [ ] **Step 3: GitHub Pages 활성화**

```bash
gh api -X POST "repos/{owner}/gym-log/pages" -f "source[branch]=main" -f "source[path]=/"
```

Expected: 201 응답. 이미 활성화된 경우 409 — 그대로 진행.

- [ ] **Step 4: 배포 확인**

Run (1~2분 후): `curl -sI "https://$(gh api user -q .login).github.io/gym-log/" | head -1`
Expected: `HTTP/2 200`

- [ ] **Step 5: 사용자 안내**

구글 시트/Apps Script 세팅(README 1번 섹션)은 사용자의 구글 계정에서 해야 함.
사용자에게 라이브 URL과 함께 README 절차를 안내하고, 원하면 Chrome 브라우저 자동화로 같이 진행.

---

## 수동 E2E 체크리스트 (Apps Script 배포 후)

1. 사이트 접속 → URL/토큰 입력 → 오늘 탭 로드
2. 새 종목 "벤치프레스" + 60kg × 10 → [세트 추가] → 목록에 즉시 표시 → 구글 시트에 행 추가 확인
3. [세트 추가] 한 번 더 → 세트번호 2로 자동 증가
4. 새로고침 → 기록 유지, 종목 버튼에 "벤치프레스" 표시
5. 종목 버튼 탭 → "지난번: …" 표시 + 무게/횟수 자동 채움 (다른 날짜 기록이 있을 때)
6. 세트 삭제 → 목록과 시트 양쪽에서 제거 확인
7. 비행기 모드에서 세트 추가 → "전송 대기" 배지 → 네트워크 복구 후 새로고침 → 시트에 반영
8. 지난 기록 탭 → 날짜별 목록 / 차트 탭 → 꺾은선 표시
9. 휴대폰에서 홈 화면 추가 → standalone 실행
