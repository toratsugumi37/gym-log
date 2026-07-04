# MySQL(TiDB) + 로그인 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구글 시트 백엔드를 TiDB(MySQL 호환) + 세션 로그인으로 교체하고, 몸 상태(몸무게/체지방/골격근) 기록 탭을 추가한다.

**Architecture:** Vercel 한 프로젝트에 정적 프론트 + `/api/*` Node 서버리스 함수. DB는 TiDB Cloud Serverless(mysql2, TLS). 인증은 bcrypt + 세션 토큰(httpOnly 쿠키 90일). 프론트는 기존 바닐라 JS를 유지하고 api.js만 same-origin으로 교체, 로그인 화면과 몸 탭을 추가한다.

**Tech Stack:** Node 20+(서버리스), mysql2, bcryptjs, 바닐라 JS(ESM), node:test, Vercel CLI.

## Global Constraints

- 프론트는 프레임워크·빌드 도구 금지(바닐라 JS 유지). 백엔드 의존성은 `mysql2`, `bcryptjs` 둘만.
- API 응답 규약: `{ok:true, ...}` / `{ok:false, error}`. 세션 만료/미로그인은 HTTP 401 + `{ok:false, error:'unauthorized'}`.
- 레코드 JSON 형태 유지: `{id, date, exercise, weight, reps, set}` (id = client_id, date = 'YYYY-MM-DD').
- 쿠키: `sid=<64자 hex>; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000; Path=/`.
- 비밀번호 원문 저장·로깅 금지. bcrypt cost 10.
- `.env`(DATABASE_URL)는 절대 커밋 금지.
- localStorage 키: 대기열 `gymlog.pending.<username>` / `gymlog.pendingDeletes.<username>`, 캐시 `gymlog.cache.u.<username>.<이름>`.
- 검증 규칙: username `/^[A-Za-z0-9_]{4,30}$/`, password 8자 이상, nickname 1~30자.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 파일 구조 (최종)

```
├── index.html                 로그인/가입 화면 + 앱(탭 4개)
├── css/style.css              폼·에러·몸 탭 스타일 추가
├── js/
│   ├── api.js                 same-origin fetch + 401 처리 + 캐시 폴백  [재작성]
│   ├── auth-ui.js             로그인/가입 화면 로직                     [신규]
│   ├── ui.js                  부팅 흐름 + 몸 탭                        [재작성]
│   ├── store.js, queue.js     그대로
│   └── chart.js               목표선(extra 범위) 지원                   [수정]
│   └── config.js              [삭제]
├── api/
│   ├── _lib/db.js             mysql2 풀 (configFromUrl은 순수·테스트 대상)
│   ├── _lib/session.js        세션 발급/검증/삭제 (readToken은 순수)
│   ├── _lib/validate.js       입력 검증 (전부 순수·테스트 대상)
│   ├── auth.js                join/login/logout/me/profile
│   ├── sets.js                운동 세트 CRUD (기존 GAS 액션 호환)
│   └── body.js                몸 기록 목록/upsert
├── apps-script/               [삭제]
├── schema.sql                 테이블 4개 DDL
├── scripts/
│   ├── init-db.mjs            schema.sql 적용
│   └── dev-server.mjs         로컬 정적+API 서버 (Vercel 핸들러 어댑터)
└── tests/                     logic.test.js 삭제, validate/db/session/chart 추가
```

---

### Task 1: 정리 + 의존성

**Files:**
- Delete: `apps-script/` (전체), `tests/logic.test.js`, `js/config.js`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Produces: `mysql2`, `bcryptjs` 설치됨. `npm test` 동작 유지(남은 테스트 15개).

주의: `js/config.js`를 지우면 `js/api.js`·`js/ui.js`가 깨진 import를 가진다 — Task 7에서 재작성되므로 이 시점의 `npm test`(순수 로직만)는 영향 없다.

- [ ] **Step 1: 파일 삭제**

```bash
rm -rf apps-script tests/logic.test.js js/config.js
```

- [ ] **Step 2: package.json 수정** (전체 교체)

```json
{
  "name": "gym-log",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "dev": "node --env-file=.env scripts/dev-server.mjs"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "mysql2": "^3.11.0"
  }
}
```

- [ ] **Step 3: .gitignore에 추가**

```
.env
```

- [ ] **Step 4: 설치 + 테스트**

Run: `npm install && npm test`
Expected: 설치 성공, 11 tests pass (store 6 + queue 2 + chart 3 — logic 7개는 삭제됨)

- [ ] **Step 5: 커밋**

```bash
git add -A && git commit -m "chore: GAS 제거, mysql2/bcryptjs 의존성 추가"
```

---

### Task 2: 입력 검증 모듈 (validate.js)

**Files:**
- Create: `api/_lib/validate.js`
- Test: `tests/validate.test.js`

**Interfaces:**
- Produces (Task 5의 핸들러들이 import):
  - `validateJoin(body) → {ok:true, value:{username,password,nickname,birthYear,gender,heightCm,goalWeight,goalText}} | {ok:false,error}`
  - `validateProfile(body) → {ok:true, value:{nickname,birthYear,gender,heightCm,goalWeight,goalText}} | {ok:false,error}`
  - `validateSetRecord(record) → {ok:true, value:{date,exercise,weight,reps,set,id}} | {ok:false,error}`
  - `validateBodyEntry(body) → {ok:true, value:{date,weight,bodyFatPct,muscleMass}} | {ok:false,error}` (세 수치는 null 허용)
- 선택 항목은 미입력('' 또는 null/undefined) 시 `null`로 정규화.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/validate.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJoin, validateProfile, validateSetRecord, validateBodyEntry,
} from '../api/_lib/validate.js';

test('validateJoin: 정상 입력 + 선택 항목 정규화', () => {
  const r = validateJoin({
    username: 'pjy_1', password: 'password1', nickname: ' 근육맨 ',
    birthYear: '1995', gender: 'm', heightCm: '175.5', goalWeight: '', goalText: '벤치 100',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    username: 'pjy_1', password: 'password1', nickname: '근육맨',
    birthYear: 1995, gender: 'm', heightCm: 175.5, goalWeight: null, goalText: '벤치 100',
  });
});

test('validateJoin: 잘못된 아이디/비번/닉네임 거부', () => {
  assert.equal(validateJoin({ username: 'ab', password: 'password1', nickname: 'n' }).ok, false);
  assert.equal(validateJoin({ username: '한글아이디', password: 'password1', nickname: 'n' }).ok, false);
  assert.equal(validateJoin({ username: 'user1', password: 'short', nickname: 'n' }).ok, false);
  assert.equal(validateJoin({ username: 'user1', password: 'password1', nickname: '' }).ok, false);
});

test('validateJoin: 선택 항목이 이상하면 거부', () => {
  assert.equal(validateJoin({ username: 'user1', password: 'password1', nickname: 'n', gender: 'x' }).ok, false);
  assert.equal(validateJoin({ username: 'user1', password: 'password1', nickname: 'n', birthYear: '999' }).ok, false);
});

test('validateProfile: 닉네임 필수, 나머지 선택', () => {
  const r = validateProfile({ nickname: '닉', goalWeight: '80' });
  assert.equal(r.ok, true);
  assert.equal(r.value.goalWeight, 80);
  assert.equal(r.value.heightCm, null);
  assert.equal(validateProfile({ nickname: '' }).ok, false);
});

test('validateSetRecord: 정상/비정상', () => {
  const good = validateSetRecord({ date: '2026-07-04', exercise: '벤치프레스', weight: 60, reps: 10, set: 1, id: 'abc-1' });
  assert.equal(good.ok, true);
  assert.equal(validateSetRecord({ date: '26-7-4', exercise: '벤치', weight: 60, reps: 10, set: 1, id: 'a' }).ok, false);
  assert.equal(validateSetRecord({ date: '2026-07-04', exercise: '', weight: 60, reps: 10, set: 1, id: 'a' }).ok, false);
  assert.equal(validateSetRecord({ date: '2026-07-04', exercise: '벤치', weight: -1, reps: 10, set: 1, id: 'a' }).ok, false);
  assert.equal(validateSetRecord({ date: '2026-07-04', exercise: '벤치', weight: 0, reps: 10, set: 1, id: 'a' }).ok, true);
});

test('validateBodyEntry: 수치는 전부 선택, 빈 값은 null', () => {
  const r = validateBodyEntry({ date: '2026-07-04', weight: '81.5', bodyFatPct: '', muscleMass: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { date: '2026-07-04', weight: 81.5, bodyFatPct: null, muscleMass: null });
  assert.equal(validateBodyEntry({ date: 'x' }).ok, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module ... validate.js`

- [ ] **Step 3: 구현** — `api/_lib/validate.js`

```js
// 요청 본문 검증. 전부 순수 함수 — DB/네트워크 접근 금지.

const USERNAME_RE = /^[A-Za-z0-9_]{4,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function optNum(v, min, max) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return { ok: false };
  return { ok: true, value: n };
}

function profileFields(b) {
  const birthYear = optNum(b.birthYear, 1900, 2100);
  if (!birthYear.ok) return { ok: false, error: '생년도 값이 이상해요' };
  const gender = b.gender === null || b.gender === undefined || b.gender === '' ? null : b.gender;
  if (gender !== null && gender !== 'm' && gender !== 'f') return { ok: false, error: '성별 값이 이상해요' };
  const heightCm = optNum(b.heightCm, 50, 300);
  if (!heightCm.ok) return { ok: false, error: '키 값이 이상해요' };
  const goalWeight = optNum(b.goalWeight, 10, 500);
  if (!goalWeight.ok) return { ok: false, error: '목표 몸무게 값이 이상해요' };
  const goalText = b.goalText === null || b.goalText === undefined
    ? null
    : String(b.goalText).trim().slice(0, 100) || null;
  return {
    ok: true,
    value: {
      birthYear: birthYear.value,
      gender,
      heightCm: heightCm.value,
      goalWeight: goalWeight.value,
      goalText,
    },
  };
}

export function validateJoin(b) {
  if (!USERNAME_RE.test(b.username || '')) {
    return { ok: false, error: '아이디는 영문/숫자/_ 4~30자예요' };
  }
  if (typeof b.password !== 'string' || b.password.length < 8) {
    return { ok: false, error: '비밀번호는 8자 이상이어야 해요' };
  }
  const nickname = String(b.nickname || '').trim();
  if (!nickname || nickname.length > 30) return { ok: false, error: '닉네임은 1~30자예요' };
  const prof = profileFields(b);
  if (!prof.ok) return prof;
  return { ok: true, value: { username: b.username, password: b.password, nickname, ...prof.value } };
}

export function validateProfile(b) {
  const nickname = String(b.nickname || '').trim();
  if (!nickname || nickname.length > 30) return { ok: false, error: '닉네임은 1~30자예요' };
  const prof = profileFields(b);
  if (!prof.ok) return prof;
  return { ok: true, value: { nickname, ...prof.value } };
}

export function validateSetRecord(r) {
  if (!r || typeof r !== 'object') return { ok: false, error: 'bad record' };
  if (!DATE_RE.test(r.date || '')) return { ok: false, error: 'bad date' };
  const exercise = String(r.exercise || '').trim();
  if (!exercise || exercise.length > 50) return { ok: false, error: 'bad exercise' };
  const weight = Number(r.weight);
  if (!Number.isFinite(weight) || weight < 0 || weight > 2000) return { ok: false, error: 'bad weight' };
  const reps = Number(r.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > 1000) return { ok: false, error: 'bad reps' };
  const set = Number(r.set);
  if (!Number.isInteger(set) || set < 1 || set > 1000) return { ok: false, error: 'bad set' };
  const id = String(r.id || '');
  if (!id || id.length > 40) return { ok: false, error: 'bad id' };
  return { ok: true, value: { date: r.date, exercise, weight, reps, set, id } };
}

export function validateBodyEntry(b) {
  if (!DATE_RE.test(b.date || '')) return { ok: false, error: 'bad date' };
  const weight = optNum(b.weight, 10, 500);
  if (!weight.ok) return { ok: false, error: '몸무게 값이 이상해요' };
  const bodyFatPct = optNum(b.bodyFatPct, 1, 80);
  if (!bodyFatPct.ok) return { ok: false, error: '체지방률 값이 이상해요' };
  const muscleMass = optNum(b.muscleMass, 5, 200);
  if (!muscleMass.ok) return { ok: false, error: '골격근량 값이 이상해요' };
  return {
    ok: true,
    value: { date: b.date, weight: weight.value, bodyFatPct: bodyFatPct.value, muscleMass: muscleMass.value },
  };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` → PASS (17 tests)

- [ ] **Step 5: 커밋**

```bash
git add api/_lib/validate.js tests/validate.test.js
git commit -m "feat: API 입력 검증 모듈"
```

---

### Task 3: DB 연결 + 스키마 (db.js, schema.sql, init-db)

**Files:**
- Create: `api/_lib/db.js`, `schema.sql`, `scripts/init-db.mjs`
- Test: `tests/db.test.js`

**Interfaces:**
- Produces:
  - `configFromUrl(urlStr) → mysql2 설정 객체` (순수 — 테스트 대상)
  - `q(sql, params?) → Promise<rows>` — 핸들러들이 쓰는 유일한 DB 진입점 (INSERT면 ResultSetHeader 반환: `.insertId`, `.affectedRows`)
- `DATABASE_URL` 형식: `mysql://user:pass@host:4000/gymlog`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/db.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { configFromUrl } from '../api/_lib/db.js';

test('configFromUrl: URL을 mysql2 설정으로 변환 (TLS 필수)', () => {
  const c = configFromUrl('mysql://user1:p%40ss@gateway.tidbcloud.com:4000/gymlog');
  assert.equal(c.host, 'gateway.tidbcloud.com');
  assert.equal(c.port, 4000);
  assert.equal(c.user, 'user1');
  assert.equal(c.password, 'p@ss');
  assert.equal(c.database, 'gymlog');
  assert.equal(c.ssl.rejectUnauthorized, true);
});

test('configFromUrl: 포트 생략 시 4000', () => {
  assert.equal(configFromUrl('mysql://u:p@h/gymlog').port, 4000);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` → FAIL (`Cannot find module ... db.js`)

- [ ] **Step 3: 구현** — `api/_lib/db.js`

```js
// TiDB Serverless(MySQL 호환) 연결. 서버리스 함수 인스턴스당 풀 1개를 재사용한다.

import mysql from 'mysql2/promise';

export function configFromUrl(urlStr) {
  const u = new URL(urlStr);
  return {
    host: u.hostname,
    port: Number(u.port || 4000),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionLimit: 1,
    maxIdle: 1,
  };
}

let pool;

export function getPool() {
  if (!pool) pool = mysql.createPool(configFromUrl(process.env.DATABASE_URL));
  return pool;
}

export async function q(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}
```

- [ ] **Step 4: schema.sql 작성** (스펙의 DDL 그대로)

```sql
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(30) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  nickname      VARCHAR(30) NOT NULL,
  birth_year    SMALLINT NULL,
  gender        ENUM('m','f') NULL,
  height_cm     DECIMAL(4,1) NULL,
  goal_weight   DECIMAL(4,1) NULL,
  goal_text     VARCHAR(100) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(64) PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_user (user_id)
);

CREATE TABLE IF NOT EXISTS workout_sets (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  date       CHAR(10) NOT NULL,
  exercise   VARCHAR(50) NOT NULL,
  weight     DECIMAL(5,1) NOT NULL DEFAULT 0,
  reps       SMALLINT NOT NULL,
  set_no     SMALLINT NOT NULL,
  client_id  VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sets_client (user_id, client_id),
  INDEX idx_sets_user_date (user_id, date)
);

CREATE TABLE IF NOT EXISTS body_metrics (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  date         CHAR(10) NOT NULL,
  weight       DECIMAL(4,1) NULL,
  body_fat_pct DECIMAL(3,1) NULL,
  muscle_mass  DECIMAL(4,1) NULL,
  UNIQUE KEY uq_body_user_date (user_id, date)
);
```

- [ ] **Step 5: scripts/init-db.mjs 작성**

```js
// DATABASE_URL의 DB에 schema.sql을 적용한다.
// 실행: node --env-file=.env scripts/init-db.mjs

import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { configFromUrl } from '../api/_lib/db.js';

const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const conn = await mysql.createConnection({
  ...configFromUrl(process.env.DATABASE_URL),
  multipleStatements: true,
});
await conn.query(sql);
const [tables] = await conn.query('SHOW TABLES');
console.log('적용 완료:', tables.map((t) => Object.values(t)[0]).join(', '));
await conn.end();
```

- [ ] **Step 6: 테스트 + 커밋**

Run: `npm test` → PASS (19 tests)

```bash
git add api/_lib/db.js schema.sql scripts/init-db.mjs tests/db.test.js
git commit -m "feat: DB 연결 모듈 + 스키마"
```

---

### Task 4: 세션 모듈 (session.js)

**Files:**
- Create: `api/_lib/session.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Produces (핸들러들이 import):
  - `readToken(req) → string|null` — Cookie 헤더에서 sid 추출 (순수 — 테스트 대상)
  - `createSession(res, userId) → Promise<void>` — 토큰 발급 + Set-Cookie
  - `requireUser(req, res) → Promise<userId|null>` — 실패 시 401 응답까지 보내고 null 반환
  - `destroySession(req, res) → Promise<void>` — 세션 삭제 + 쿠키 만료

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/session.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readToken } from '../api/_lib/session.js';

const T = 'a'.repeat(64);

test('readToken: 쿠키에서 sid 추출', () => {
  assert.equal(readToken({ headers: { cookie: `sid=${T}` } }), T);
  assert.equal(readToken({ headers: { cookie: `foo=1; sid=${T}; bar=2` } }), T);
});

test('readToken: 없거나 형식이 다르면 null', () => {
  assert.equal(readToken({ headers: {} }), null);
  assert.equal(readToken({ headers: { cookie: 'sid=short' } }), null);
  assert.equal(readToken({ headers: { cookie: `notsid=${T}` } }), null);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` → FAIL

- [ ] **Step 3: 구현** — `api/_lib/session.js`

```js
// 세션 토큰 발급/검증. remember me = 90일 httpOnly 쿠키.

import crypto from 'node:crypto';
import { q } from './db.js';

const MAX_AGE_SEC = 90 * 24 * 60 * 60;

export function readToken(req) {
  const cookie = (req.headers && req.headers.cookie) || '';
  const m = cookie.match(/(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/);
  return m ? m[1] : null;
}

export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))',
    [token, userId],
  );
  res.setHeader(
    'Set-Cookie',
    `sid=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SEC}; Path=/`,
  );
}

export async function requireUser(req, res) {
  const token = readToken(req);
  if (token) {
    const rows = await q(
      'SELECT user_id FROM sessions WHERE token = ? AND expires_at > NOW()',
      [token],
    );
    if (rows.length) return rows[0].user_id;
  }
  res.status(401).json({ ok: false, error: 'unauthorized' });
  return null;
}

export async function destroySession(req, res) {
  const token = readToken(req);
  if (token) await q('DELETE FROM sessions WHERE token = ?', [token]);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npm test` → PASS (21 tests)

```bash
git add api/_lib/session.js tests/session.test.js
git commit -m "feat: 세션 모듈 (90일 httpOnly 쿠키)"
```

---

### Task 5: API 핸들러 3개 (auth, sets, body)

**Files:**
- Create: `api/auth.js`, `api/sets.js`, `api/body.js`

**Interfaces:**
- Consumes: Task 2~4의 `validate.js`, `db.js(q)`, `session.js`
- Produces (프론트 api.js가 호출):
  - `POST /api/auth?action=join|login|logout|profile`, `GET /api/auth?action=me`
    - join/login/me 성공 응답: `{ok:true, user:{username,nickname,birthYear,gender,heightCm,goalWeight,goalText}}`
    - login 실패: 401 `{ok:false, error:'아이디 또는 비밀번호가 틀렸어요'}` (세션 만료의 `'unauthorized'`와 문자열이 다름 — 프론트가 구분)
    - join 중복: 409 `{ok:false, error:'이미 있는 아이디예요'}`
  - `GET /api/sets?action=today|history|last|exercises|chart` — 기존 GAS와 동일 파라미터/응답
  - `POST /api/sets` — `{action:'add', record}` / `{action:'delete', id}` (add 중복 시 `{ok:true, duplicate:true}`, delete 미존재 시 `{ok:false, error:'not found'}`)
  - `GET /api/body` → `{ok:true, rows:[{date,weight,bodyFatPct,muscleMass}]}` (날짜 오름차순)
  - `POST /api/body` — `{date, weight?, bodyFatPct?, muscleMass?}` upsert. 세 수치 모두 null이면 해당 날짜 삭제.

DB 없이는 실행 불가 — Task 9의 로컬 E2E에서 검증된다.

- [ ] **Step 1: api/auth.js 작성**

```js
import bcrypt from 'bcryptjs';
import { q } from './_lib/db.js';
import { createSession, destroySession, requireUser } from './_lib/session.js';
import { validateJoin, validateProfile } from './_lib/validate.js';

function userPayload(row) {
  return {
    username: row.username,
    nickname: row.nickname,
    birthYear: row.birth_year,
    gender: row.gender,
    heightCm: row.height_cm === null ? null : Number(row.height_cm),
    goalWeight: row.goal_weight === null ? null : Number(row.goal_weight),
    goalText: row.goal_text,
  };
}

export default async function handler(req, res) {
  const action = req.query.action;
  try {
    if (req.method === 'GET' && action === 'me') return await me(req, res);
    if (req.method === 'POST' && action === 'join') return await join(req, res);
    if (req.method === 'POST' && action === 'login') return await login(req, res);
    if (req.method === 'POST' && action === 'logout') return await logout(req, res);
    if (req.method === 'POST' && action === 'profile') return await profile(req, res);
    return res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: '서버 오류' });
  }
}

async function join(req, res) {
  const v = validateJoin(req.body || {});
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
  const u = v.value;
  const hash = await bcrypt.hash(u.password, 10);
  let result;
  try {
    result = await q(
      `INSERT INTO users (username, password_hash, nickname, birth_year, gender, height_cm, goal_weight, goal_text)
       VALUES (?,?,?,?,?,?,?,?)`,
      [u.username, hash, u.nickname, u.birthYear, u.gender, u.heightCm, u.goalWeight, u.goalText],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: '이미 있는 아이디예요' });
    }
    throw err;
  }
  await createSession(res, result.insertId);
  const rows = await q('SELECT * FROM users WHERE id = ?', [result.insertId]);
  return res.json({ ok: true, user: userPayload(rows[0]) });
}

async function login(req, res) {
  const { username, password } = req.body || {};
  const rows = await q('SELECT * FROM users WHERE username = ?', [String(username || '')]);
  const bad = () => res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 틀렸어요' });
  if (!rows.length) return bad();
  const match = await bcrypt.compare(String(password || ''), rows[0].password_hash);
  if (!match) return bad();
  await createSession(res, rows[0].id);
  return res.json({ ok: true, user: userPayload(rows[0]) });
}

async function logout(req, res) {
  await destroySession(req, res);
  return res.json({ ok: true });
}

async function me(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const rows = await q('SELECT * FROM users WHERE id = ?', [userId]);
  if (!rows.length) return res.status(401).json({ ok: false, error: 'unauthorized' });
  return res.json({ ok: true, user: userPayload(rows[0]) });
}

async function profile(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const v = validateProfile(req.body || {});
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
  const p = v.value;
  await q(
    'UPDATE users SET nickname=?, birth_year=?, gender=?, height_cm=?, goal_weight=?, goal_text=? WHERE id=?',
    [p.nickname, p.birthYear, p.gender, p.heightCm, p.goalWeight, p.goalText, userId],
  );
  const rows = await q('SELECT * FROM users WHERE id = ?', [userId]);
  return res.json({ ok: true, user: userPayload(rows[0]) });
}
```

- [ ] **Step 2: api/sets.js 작성**

```js
import { q } from './_lib/db.js';
import { requireUser } from './_lib/session.js';
import { validateSetRecord } from './_lib/validate.js';

function rowToRecord(r) {
  return {
    id: r.client_id,
    date: r.date,
    exercise: r.exercise,
    weight: Number(r.weight),
    reps: r.reps,
    set: r.set_no,
  };
}

export default async function handler(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  try {
    if (req.method === 'GET') return await get(req, res, userId);
    if (req.method === 'POST') return await post(req, res, userId);
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: '서버 오류' });
  }
}

async function get(req, res, userId) {
  const p = req.query;
  if (p.action === 'today') {
    const rows = await q(
      'SELECT * FROM workout_sets WHERE user_id=? AND date=? ORDER BY id',
      [userId, String(p.date || '')],
    );
    return res.json({ ok: true, records: rows.map(rowToRecord) });
  }
  if (p.action === 'history') {
    const days = Math.min(Number(p.days) || 90, 365);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = await q(
      'SELECT * FROM workout_sets WHERE user_id=? AND date>=? ORDER BY id',
      [userId, cutoff],
    );
    return res.json({ ok: true, records: rows.map(rowToRecord) });
  }
  if (p.action === 'last') {
    const rows = await q(
      `SELECT * FROM workout_sets
       WHERE user_id=? AND exercise=? AND date = (
         SELECT MAX(date) FROM workout_sets WHERE user_id=? AND exercise=? AND date < ?
       ) ORDER BY set_no`,
      [userId, String(p.exercise || ''), userId, String(p.exercise || ''), String(p.before || '')],
    );
    return res.json({ ok: true, records: rows.map(rowToRecord) });
  }
  if (p.action === 'exercises') {
    const rows = await q(
      'SELECT exercise FROM workout_sets WHERE user_id=? GROUP BY exercise ORDER BY MAX(id) DESC LIMIT 30',
      [userId],
    );
    return res.json({ ok: true, exercises: rows.map((r) => r.exercise) });
  }
  if (p.action === 'chart') {
    const rows = await q(
      'SELECT date, MAX(weight) AS w FROM workout_sets WHERE user_id=? AND exercise=? GROUP BY date ORDER BY date',
      [userId, String(p.exercise || '')],
    );
    return res.json({ ok: true, series: rows.map((r) => ({ date: r.date, weight: Number(r.w) })) });
  }
  return res.status(400).json({ ok: false, error: 'unknown action' });
}

async function post(req, res, userId) {
  const body = req.body || {};
  if (body.action === 'add') {
    const v = validateSetRecord(body.record);
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
    const r = v.value;
    try {
      await q(
        `INSERT INTO workout_sets (user_id, date, exercise, weight, reps, set_no, client_id)
         VALUES (?,?,?,?,?,?,?)`,
        [userId, r.date, r.exercise, r.weight, r.reps, r.set, r.id],
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.json({ ok: true, duplicate: true });
      throw err;
    }
    return res.json({ ok: true });
  }
  if (body.action === 'delete') {
    const result = await q(
      'DELETE FROM workout_sets WHERE user_id=? AND client_id=?',
      [userId, String(body.id || '')],
    );
    if (result.affectedRows === 0) return res.status(404).json({ ok: false, error: 'not found' });
    return res.json({ ok: true });
  }
  return res.status(400).json({ ok: false, error: 'unknown action' });
}
```

- [ ] **Step 3: api/body.js 작성**

```js
import { q } from './_lib/db.js';
import { requireUser } from './_lib/session.js';
import { validateBodyEntry } from './_lib/validate.js';

export default async function handler(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const rows = await q(
        'SELECT date, weight, body_fat_pct, muscle_mass FROM body_metrics WHERE user_id=? ORDER BY date',
        [userId],
      );
      return res.json({
        ok: true,
        rows: rows.map((r) => ({
          date: r.date,
          weight: r.weight === null ? null : Number(r.weight),
          bodyFatPct: r.body_fat_pct === null ? null : Number(r.body_fat_pct),
          muscleMass: r.muscle_mass === null ? null : Number(r.muscle_mass),
        })),
      });
    }
    if (req.method === 'POST') {
      const v = validateBodyEntry(req.body || {});
      if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
      const b = v.value;
      if (b.weight === null && b.bodyFatPct === null && b.muscleMass === null) {
        await q('DELETE FROM body_metrics WHERE user_id=? AND date=?', [userId, b.date]);
        return res.json({ ok: true, deleted: true });
      }
      await q(
        `INSERT INTO body_metrics (user_id, date, weight, body_fat_pct, muscle_mass)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE weight=VALUES(weight), body_fat_pct=VALUES(body_fat_pct), muscle_mass=VALUES(muscle_mass)`,
        [userId, b.date, b.weight, b.bodyFatPct, b.muscleMass],
      );
      return res.json({ ok: true });
    }
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: '서버 오류' });
  }
}
```

- [ ] **Step 4: 기존 테스트 유지 확인 + 커밋**

Run: `npm test` → PASS (21 tests)

```bash
git add api/
git commit -m "feat: API 핸들러 (auth/sets/body)"
```

---

### Task 6: 로컬 개발 서버 (dev-server.mjs)

**Files:**
- Create: `scripts/dev-server.mjs`

**Interfaces:**
- Produces: `npm run dev` → http://localhost:8730 에서 정적 파일 + `/api/*` 서빙.
  Vercel 핸들러 시그니처(`req.query`, `req.body`, `res.status().json()`)를 로컬 http 서버에 어댑트.

- [ ] **Step 1: 구현**

```js
// Vercel 서버리스 핸들러를 로컬에서 실행하는 개발 서버.
// 실행: node --env-file=.env scripts/dev-server.mjs  (npm run dev)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, parse as parseUrl } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const handlers = {
  '/api/auth': (await import('../api/auth.js')).default,
  '/api/sets': (await import('../api/sets.js')).default,
  '/api/body': (await import('../api/body.js')).default,
};

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const { pathname, query } = parseUrl(req.url, true);

  if (handlers[pathname]) {
    req.query = query;
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    }
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
    };
    try {
      await handlers[pathname](req, res);
    } catch (err) {
      console.error(err);
      if (!res.writableEnded) res.status(500).json({ ok: false, error: 'dev server error' });
    }
    return;
  }

  const filePath = pathname === '/' ? '/index.html' : pathname;
  try {
    const body = await readFile(join(root, filePath));
    res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8730, () => console.log('dev server: http://localhost:8730'));
```

- [ ] **Step 2: 커밋**

```bash
git add scripts/dev-server.mjs
git commit -m "feat: 로컬 개발 서버 (Vercel 핸들러 어댑터)"
```

---

### Task 7: 프론트 API 클라이언트 + 로그인 화면

**Files:**
- Create: `js/auth-ui.js`
- Rewrite: `js/api.js`
- Modify: `index.html`, `css/style.css`

**Interfaces:**
- Consumes: Task 5의 API 규약
- Produces (Task 8의 ui.js가 import):
  - api.js: `apiGet(path, params) → Promise<data>`, `apiPost(path, body) → Promise<data>`, `cachedGet(path, params, cacheKey) → Promise<{data, offline}>`, `setUnauthorizedHandler(fn)`
    - 401+`error==='unauthorized'`이면 등록된 핸들러 호출 후 throw. cachedGet은 unauthorized면 캐시 폴백 안 함.
  - auth-ui.js: `initAuth(onSuccess)` (폼 이벤트 바인딩, 성공 시 `onSuccess(user)`), `showAuthScreen()`
- index.html 구조: `#auth-screen`(로그인/가입 폼) + `#app`(기존 탭 UI + 몸 탭 + `#nickname`). 앱 요소 id는 기존 유지.

- [ ] **Step 1: js/api.js 전체 교체**

```js
// same-origin /api/* 호출. 세션 쿠키는 브라우저가 자동으로 붙인다.

let onUnauthorized = () => {};

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (res.status === 401 && data.error === 'unauthorized') {
    onUnauthorized();
    throw new Error('unauthorized');
  }
  if (!data.ok) throw new Error(data.error || 'API 오류');
  return data;
}

export async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params);
  return request(`${path}?${qs}`);
}

export async function apiPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function cachedGet(path, params, cacheKey, storage = localStorage) {
  const key = `gymlog.cache.${cacheKey}`;
  try {
    const data = await apiGet(path, params);
    storage.setItem(key, JSON.stringify(data));
    return { data, offline: false };
  } catch (err) {
    if (err.message === 'unauthorized') throw err; // 로그아웃 상태에서 캐시를 보여주면 안 됨
    const cached = storage.getItem(key);
    if (cached) return { data: JSON.parse(cached), offline: true };
    throw err;
  }
}
```

- [ ] **Step 2: index.html 전체 교체**

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
  <section id="auth-screen" hidden>
    <h1 class="auth-title">운동 기록</h1>

    <form id="login-form">
      <input id="login-username" type="text" placeholder="아이디" autocomplete="username" autocapitalize="none">
      <input id="login-password" type="password" placeholder="비밀번호" autocomplete="current-password">
      <p id="login-error" class="error"></p>
      <button type="submit" class="primary">로그인</button>
      <button type="button" id="show-join" class="ghost wide">처음이에요 — 회원가입</button>
    </form>

    <form id="join-form" hidden>
      <input id="join-username" type="text" placeholder="아이디 (영문/숫자 4~30자)" autocomplete="username" autocapitalize="none">
      <input id="join-password" type="password" placeholder="비밀번호 (8자 이상)" autocomplete="new-password">
      <input id="join-nickname" type="text" placeholder="닉네임">
      <details class="optional-box">
        <summary>몸 정보 입력 (선택 — 나중에 몸 탭에서 가능)</summary>
        <div class="row">
          <input id="join-birth" type="number" inputmode="numeric" placeholder="생년도 (예: 1995)">
          <select id="join-gender">
            <option value="">성별</option>
            <option value="m">남</option>
            <option value="f">여</option>
          </select>
        </div>
        <div class="row">
          <input id="join-height" type="number" inputmode="decimal" step="0.1" placeholder="키(cm)">
          <input id="join-goal-weight" type="number" inputmode="decimal" step="0.1" placeholder="목표 몸무게(kg)">
        </div>
        <input id="join-goal-text" type="text" placeholder="목표 한 줄 (예: 벤치 100 치기)">
      </details>
      <p id="join-error" class="error"></p>
      <button type="submit" class="primary">가입하기</button>
      <button type="button" id="show-login" class="ghost wide">이미 계정 있어요 — 로그인</button>
    </form>
  </section>

  <div id="app" hidden>
    <header>
      <h1>운동 기록</h1>
      <span id="nickname" class="muted"></span>
      <span id="pending-badge" class="badge" hidden>전송 대기</span>
      <span id="offline-badge" class="badge" hidden>오프라인</span>
    </header>

    <nav class="tab-bar">
      <button type="button" data-tab="today" class="selected">오늘</button>
      <button type="button" data-tab="history">기록</button>
      <button type="button" data-tab="chart">차트</button>
      <button type="button" data-tab="body">몸</button>
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

      <section id="tab-body" class="tab-panel" hidden>
        <p class="muted">오늘 몸 상태 (아는 것만 입력)</p>
        <div class="row">
          <input id="body-weight" type="number" inputmode="decimal" step="0.1" placeholder="몸무게(kg)">
          <input id="body-fat" type="number" inputmode="decimal" step="0.1" placeholder="체지방(%)">
          <input id="body-muscle" type="number" inputmode="decimal" step="0.1" placeholder="골격근(kg)">
        </div>
        <button id="body-save-btn" type="button" class="primary">몸 상태 저장</button>
        <p id="goal-line" class="muted"></p>
        <div id="body-chart"></div>
        <div id="body-list"></div>

        <details class="optional-box">
          <summary>프로필 / 목표 수정</summary>
          <input id="profile-nickname" type="text" placeholder="닉네임">
          <div class="row">
            <input id="profile-birth" type="number" inputmode="numeric" placeholder="생년도">
            <select id="profile-gender">
              <option value="">성별</option>
              <option value="m">남</option>
              <option value="f">여</option>
            </select>
          </div>
          <div class="row">
            <input id="profile-height" type="number" inputmode="decimal" step="0.1" placeholder="키(cm)">
            <input id="profile-goal-weight" type="number" inputmode="decimal" step="0.1" placeholder="목표 몸무게(kg)">
          </div>
          <input id="profile-goal-text" type="text" placeholder="목표 한 줄">
          <p id="profile-error" class="error"></p>
          <button id="profile-save-btn" type="button" class="primary">프로필 저장</button>
        </details>
        <button id="logout-btn" type="button" class="ghost wide">로그아웃</button>
      </section>
    </main>
  </div>

  <script type="module" src="js/ui.js"></script>
</body>
</html>
```

- [ ] **Step 3: css/style.css 끝에 추가**

```css
#auth-screen { padding-top: 48px; }
.auth-title { text-align: center; margin-bottom: 24px; }
.error { color: #f87171; font-size: 0.88rem; min-height: 1.2em; margin: 4px 0; }
.wide { width: 100%; margin-top: 8px; padding: 12px; }
.optional-box { margin-bottom: 10px; }
.optional-box summary { color: #9ca3af; font-size: 0.9rem; font-weight: 400; }
.optional-box input, .optional-box select, .optional-box .row { margin-top: 10px; }
#logout-btn { margin-top: 24px; }
#body-list p { padding: 6px 2px; font-size: 0.92rem; border-bottom: 1px solid #1f2937; }
```

- [ ] **Step 4: js/auth-ui.js 작성**

```js
// 로그인/회원가입 화면. 성공하면 onSuccess(user)를 부른다.

import { apiPost } from './api.js';

const $ = (sel) => document.querySelector(sel);

export function showAuthScreen() {
  $('#auth-screen').hidden = false;
  $('#app').hidden = true;
}

function optVal(sel) {
  const v = $(sel).value.trim();
  return v === '' ? null : v;
}

export function initAuth(onSuccess) {
  $('#show-join').onclick = () => {
    $('#login-form').hidden = true;
    $('#join-form').hidden = false;
  };
  $('#show-login').onclick = () => {
    $('#join-form').hidden = true;
    $('#login-form').hidden = false;
  };

  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
      const data = await apiPost('/api/auth?action=login', {
        username: $('#login-username').value.trim(),
        password: $('#login-password').value,
      });
      $('#login-password').value = '';
      onSuccess(data.user);
    } catch (err) {
      $('#login-error').textContent = err.message === 'unauthorized' ? '로그인이 필요해요' : err.message;
    }
  };

  $('#join-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#join-error').textContent = '';
    try {
      const data = await apiPost('/api/auth?action=join', {
        username: $('#join-username').value.trim(),
        password: $('#join-password').value,
        nickname: $('#join-nickname').value.trim(),
        birthYear: optVal('#join-birth'),
        gender: optVal('#join-gender'),
        heightCm: optVal('#join-height'),
        goalWeight: optVal('#join-goal-weight'),
        goalText: optVal('#join-goal-text'),
      });
      $('#join-password').value = '';
      onSuccess(data.user);
    } catch (err) {
      $('#join-error').textContent = err.message;
    }
  };
}
```

- [ ] **Step 5: 커밋** (이 시점에 ui.js는 아직 옛 코드라 앱은 깨져 있음 — Task 8에서 복구)

```bash
git add js/api.js js/auth-ui.js index.html css/style.css
git rm -q js/config.js 2>/dev/null || true
git commit -m "feat: 로그인/가입 화면 + same-origin API 클라이언트"
```

---

### Task 8: ui.js 개편 + 차트 목표선

**Files:**
- Rewrite: `js/ui.js`
- Modify: `js/chart.js`
- Test: `tests/chart.test.js` (테스트 추가)

**Interfaces:**
- Consumes: Task 7의 api.js/auth-ui.js, 기존 store.js/queue.js
- Produces: 전체 앱 동작. chart.js는 `scalePoints(series, w, h, pad?, extra?)` (extra: 범위 계산에만 포함할 값 배열)와 `renderChart(el, series, opts?)` (`opts.goal`: 목표 가로 점선) 지원.

- [ ] **Step 1: chart.js 확장 — 실패하는 테스트 추가** (tests/chart.test.js 끝에)

```js
test('scalePoints: extra 값이 범위 계산에 포함됨', () => {
  const pts = scalePoints(
    [{ date: 'd1', weight: 50 }, { date: 'd2', weight: 100 }], 200, 100, 10, [0]);
  // extra 0이 최소값이 되므로 weight 50은 맨 아래(90)가 아니어야 함
  assert.ok(pts[0].y < 90);
  assert.equal(pts[1].y, 10); // 최대는 그대로 100
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` → 새 테스트 1개 FAIL

- [ ] **Step 3: js/chart.js 전체 교체**

```js
// 외부 라이브러리 없는 SVG 꺾은선 차트.

export function scalePoints(series, width, height, pad = 30, extra = []) {
  if (!series.length) return [];
  const values = series.map((p) => p.weight).concat(extra.filter((v) => v !== null && v !== undefined));
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;
  const y = (v) => pad + innerH - ((v - min) / span) * innerH;
  const pts = series.map((p, i) => ({
    ...p,
    x: pad + (series.length > 1 ? i * step : innerW / 2),
    y: y(p.weight),
  }));
  pts.scaleY = y; // renderChart가 목표선 y좌표 계산에 사용
  return pts;
}

export function renderChart(el, series, opts = {}) {
  const W = 340;
  const H = 220;
  if (!series.length) {
    el.innerHTML = '<p class="muted">아직 기록이 없어요</p>';
    return;
  }
  const goal = opts.goal === null || opts.goal === undefined ? null : Number(opts.goal);
  const pts = scalePoints(series, W, H, 30, goal === null ? [] : [goal]);
  const line = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const dots = pts.map((p) =>
    `<circle cx="${p.x}" cy="${p.y}" r="4"></circle>` +
    `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle">${p.weight}</text>`,
  ).join('');
  const first = series[0].date.slice(5);
  const last = series[series.length - 1].date.slice(5);
  let goalLine = '';
  if (goal !== null) {
    const gy = pts.scaleY(goal);
    goalLine =
      `<line x1="30" y1="${gy}" x2="${W - 30}" y2="${gy}" class="goal" stroke-dasharray="5,4"></line>` +
      `<text x="${W - 28}" y="${gy - 4}" text-anchor="end">목표 ${goal}</text>`;
  }
  el.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="변화 차트">` +
    `${goalLine}<polyline points="${line}" fill="none"></polyline>${dots}` +
    `<text x="30" y="${H - 8}">${first}</text>` +
    `<text x="${W - 30}" y="${H - 8}" text-anchor="end">${last}</text>` +
    '</svg>';
}
```

css/style.css 끝에 추가:

```css
.chart line.goal { stroke: #f59e0b; stroke-width: 1.5; }
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` → PASS (22 tests)

- [ ] **Step 5: js/ui.js 전체 교체**

```js
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

setUnauthorizedHandler(showAuthScreen);

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

function addSet() {
  rolloverIfNewDay();
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
    queue.remove(record.id); // 전송 중이었다면 flushQueue가 서버 행을 정리
  } else {
    deleteQueue.push({ id: record.id });
    flushQueue();
  }
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
      await apiPost('/api/sets', { action: 'add', record });
      if (queue.all().some((r) => r.id === record.id)) {
        queue.remove(record.id);
      } else {
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

async function renderBodyTab() {
  fillProfileForm();
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
    if (today) {
      $('#body-weight').value = today.weight ?? '';
      $('#body-fat').value = today.bodyFatPct ?? '';
      $('#body-muscle').value = today.muscleMass ?? '';
    }
    if (off) list.insertAdjacentHTML('afterbegin', '<p class="badge">오프라인 데이터</p>');
  } catch {
    $('#body-list').innerHTML = '<p class="muted">불러오기 실패</p>';
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
  try { await apiPost('/api/auth?action=logout', {}); } catch { /* 무시 */ }
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
  try {
    const [ex, today] = await Promise.all([
      cachedGet('/api/sets', { action: 'exercises' }, `${cachePrefix}exercises`),
      cachedGet('/api/sets', { action: 'today', date: todayStr() }, `${cachePrefix}today`),
    ]);
    exercises = ex.data.exercises;
    offline = ex.offline || today.offline;
    const serverRecords = today.data.records.filter((r) => r.date === todayStr());
    const serverIds = new Set(serverRecords.map((r) => r.id));
    todayRecords = serverRecords.concat(
      queue.all().filter((r) => r.date === todayStr() && !serverIds.has(r.id)),
    );
  } catch (err) {
    if (err.message === 'unauthorized') return;
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
  showTab('today');
  loadToday();
}

async function main() {
  initAuth(startApp);
  try {
    const { user: me } = await apiGet('/api/auth', { action: 'me' });
    startApp(me);
  } catch {
    showAuthScreen();
  }
}

main();
```

- [ ] **Step 6: 테스트 + 커밋**

Run: `npm test` → PASS (22 tests)

```bash
git add js/ui.js js/chart.js tests/chart.test.js css/style.css
git commit -m "feat: 앱 부팅 흐름 개편 + 몸 탭 + 차트 목표선"
```

---

### Task 9: TiDB 클러스터 생성 + 로컬 E2E

**Files:**
- Create: `.env` (커밋 금지)

**Interfaces:**
- Produces: 운영 DB(스키마 적용됨), `.env`의 `DATABASE_URL`, 로컬에서 전체 흐름 검증 완료

- [ ] **Step 1: TiDB Cloud 클러스터 생성** (브라우저 — 사용자 로그인 상태)

tidbcloud.com 콘솔에서: Create Cluster → **Serverless** (무료) → 리전 Tokyo/Singapore 중 가까운 곳 → 생성.
Connect 화면에서: Generate Password → 접속 정보(host/user/password) 확보 → DB `gymlog` 생성(콘솔 SQL Editor에서 `CREATE DATABASE gymlog;`).

- [ ] **Step 2: .env 작성** (프로젝트 루트, 커밋 금지)

```
DATABASE_URL=mysql://<user>:<password>@<host>:4000/gymlog
```

- [ ] **Step 3: 스키마 적용**

Run: `node --env-file=.env scripts/init-db.mjs`
Expected: `적용 완료: body_metrics, sessions, users, workout_sets`

- [ ] **Step 4: 로컬 E2E** — `npm run dev` (백그라운드) 후 Playwright로:

1. http://localhost:8730 접속 → 로그인 화면 표시
2. 회원가입 (`e2etest01` / `test-pass-1234` / 닉네임 `테스트`) → 앱 진입, 헤더에 닉네임
3. 세트 추가(벤치프레스 60×10) → 목록 표시, 전송 대기 배지 소멸
4. 새로고침 → 자동 로그인(쿠키) + 기록 유지
5. 몸 탭: 몸무게 80.5 저장 → 목록에 표시
6. 로그아웃 → 로그인 화면 → 재로그인 → 기록 그대로
7. 틀린 비밀번호 로그인 → "아이디 또는 비밀번호가 틀렸어요" 표시

- [ ] **Step 5: 테스트 계정 정리 + 커밋 없음** (DB 작업뿐)

```sql
-- 콘솔 SQL Editor 또는 스크립트로:
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username='e2etest01');
DELETE FROM workout_sets WHERE user_id = (SELECT id FROM users WHERE username='e2etest01');
DELETE FROM body_metrics WHERE user_id = (SELECT id FROM users WHERE username='e2etest01');
DELETE FROM users WHERE username='e2etest01';
```

(정리는 Task 10의 프로덕션 E2E 후에 한 번에 해도 된다.)

---

### Task 10: Vercel 배포 + 마이그레이션 마무리

**Files:**
- Modify: `README.md` (전체 재작성)

**Interfaces:**
- Produces: 프로덕션 URL(`https://gym-log-*.vercel.app`), GitHub Pages 비활성화, 최신 README

- [ ] **Step 1: Vercel 로그인/링크** (브라우저 확인 필요할 수 있음 — 사용자 안내)

```bash
npx vercel login          # 브라우저 인증 (구글 가입 계정)
npx vercel link --yes     # 새 프로젝트 gym-log로 링크
```

- [ ] **Step 2: 환경변수 + 배포**

```bash
npx vercel env add DATABASE_URL production   # .env의 값 입력
npx vercel --prod
```

Expected: `https://gym-log-<hash>.vercel.app` 형태 URL 출력, 200 응답

- [ ] **Step 3: 프로덕션 E2E** — Task 9 Step 4와 동일 흐름을 프로덕션 URL에서 반복. 완료 후 테스트 계정 삭제(Task 9 Step 5 SQL).

- [ ] **Step 4: GitHub Pages 비활성화**

```bash
"$LOCALAPPDATA/gh-cli/bin/gh.exe" api -X DELETE repos/toratsugumi37/gym-log/pages
```

- [ ] **Step 5: README.md 전체 교체**

```markdown
# 운동 기록 (gym-log)

휴대폰으로 종목·무게·횟수·세트를 입력하고, 몸무게/체지방 변화도 기록하는 개인 운동 기록 사이트.
Vercel(프론트+API) + TiDB Serverless(MySQL 호환) — 전부 무료.

## 사용

1. 사이트 접속 → 회원가입(아이디/비밀번호/닉네임, 몸 정보는 선택)
2. 한 번 로그인하면 90일 유지
3. 휴대폰 브라우저 메뉴 → **홈 화면에 추가** → 앱처럼 사용

## 구조

- 프론트: 바닐라 JS 정적 파일 (index.html, js/, css/)
- API: `api/*.js` — Vercel Node 서버리스 함수 (auth / sets / body)
- DB: TiDB Cloud Serverless, 스키마는 `schema.sql`
- 인증: bcrypt + 세션 토큰(httpOnly 쿠키 90일). 계정별 데이터 분리.

## 개발

```bash
npm install
npm test                                   # 단위 테스트
cp .env.example .env                       # DATABASE_URL 채우기
node --env-file=.env scripts/init-db.mjs   # 스키마 적용
npm run dev                                # http://localhost:8730
```

배포: `npx vercel --prod` (환경변수 `DATABASE_URL` 필요)

`.env`는 절대 커밋하지 않는다.
```

추가로 `.env.example` 생성:

```
DATABASE_URL=mysql://user:password@gateway01.xxx.tidbcloud.com:4000/gymlog
```

- [ ] **Step 6: 커밋 + push**

```bash
git add README.md .env.example
git commit -m "docs: Vercel+TiDB 구조로 README 갱신, GitHub Pages 중단"
git push origin main
```

- [ ] **Step 7: 사용자 안내** — 새 주소, 가입 안내, 휴대폰 홈 화면 재추가(주소가 바뀜), 기존 시트 방치 안내.

---

## 수동 E2E 체크리스트 (최종)

1. 프로덕션 접속 → 로그인 화면
2. 회원가입(선택 항목 비우고) → 즉시 앱 진입
3. 세트 추가 ×2 → 세트번호 자동 증가, DB 반영
4. 새로고침 → 자동 로그인 + 오늘 기록 유지
5. 다른 브라우저에서 같은 계정 로그인 → 같은 기록 보임
6. 몸 탭: 몸무게 입력·저장 → 목록/차트 표시, 같은 날 재저장 시 덮어씀
7. 프로필에서 목표 몸무게 설정 → 몸 차트에 주황 점선
8. 로그아웃 → 로그인 화면, 뒤로가기로 앱 접근 불가(API 401)
9. 틀린 비번 → 에러 메시지
10. 휴대폰 홈 화면 추가 → standalone 실행
