# gym-log 백엔드 전환: MySQL(DB) + 로그인 설계 (2026-07-04)

## 목적

구글 시트/Apps Script 백엔드를 관계형 DB + 계정 시스템으로 교체한다. 로그인하면 기기·브라우저 어디서든 같은 기록을 보고, URL/토큰 입력 없이 아이디/비밀번호만으로 쓴다. 회원정보는 헬스에 필요한 것만 받고, 몸 상태(몸무게 등)는 날짜별로 기록해 변화를 본다. 전부 무료.

## 스택 결정

- **호스팅**: Vercel Hobby(무료) 한 프로젝트 — 정적 프론트 + `/api/*` 서버리스 함수(Node).
  GitHub 저장소 연동으로 push 시 자동 배포. 기존 GitHub Pages는 중단.
- **DB**: TiDB Cloud Serverless(무료, MySQL 호환). `mysql2` 드라이버로 접속(TLS 필수).
  MariaDB 요구는 "MySQL 계열이면 됨"으로 완화됨(사용자 확인).
- **탈락안**: Render 무료(15분 유휴 시 슬립 → 첫 접속 30~60초 대기, 헬스장 용도에 부적합),
  Oracle 무료 VM(카드 인증 + 리전 용량 이슈 + 관리 부담).
- 계정 가입(Vercel, TiDB Cloud)은 사용자가 직접 GitHub 로그인으로 진행. 이후 프로젝트 세팅·배포·스키마 생성은 자동화.

## DB 스키마

```sql
CREATE TABLE users (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(30) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,          -- bcrypt
  nickname      VARCHAR(30) NOT NULL,
  birth_year    SMALLINT NULL,
  gender        ENUM('m','f') NULL,
  height_cm     DECIMAL(4,1) NULL,
  goal_weight   DECIMAL(4,1) NULL,              -- 목표 몸무게(kg)
  goal_text     VARCHAR(100) NULL,              -- 목표 한 줄 (예: 벤치 100)
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token      CHAR(64) PRIMARY KEY,              -- 랜덤 hex
  user_id    BIGINT NOT NULL,
  expires_at DATETIME NOT NULL,                 -- 발급 +90일
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_user (user_id)
);

CREATE TABLE workout_sets (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  date       CHAR(10) NOT NULL,                 -- 'YYYY-MM-DD' (사용자 로컬 날짜)
  exercise   VARCHAR(50) NOT NULL,
  weight     DECIMAL(5,1) NOT NULL DEFAULT 0,
  reps       SMALLINT NOT NULL,
  set_no     SMALLINT NOT NULL,
  client_id  VARCHAR(40) NOT NULL,              -- 프론트 생성 ID (오프라인 재전송 멱등키)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sets_client (user_id, client_id),
  INDEX idx_sets_user_date (user_id, date)
);

CREATE TABLE body_metrics (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  date         CHAR(10) NOT NULL,
  weight       DECIMAL(4,1) NULL,
  body_fat_pct DECIMAL(3,1) NULL,
  muscle_mass  DECIMAL(4,1) NULL,
  UNIQUE KEY uq_body_user_date (user_id, date)  -- 하루 1기록, 재입력 시 upsert
);
```

- FK 제약은 선언하지 않는다(TiDB Serverless에서 FK는 지원되나 개인용 규모에서 인덱스+애플리케이션 검증으로 충분).
- 외부에 노출되는 세트 식별자는 `client_id`를 사용한다(기존 프론트 `id` 개념 그대로).

## API (Vercel 서버리스 함수, 모두 same-origin `/api/*`)

인증: `sid` httpOnly 쿠키(세션 토큰, 90일, Secure, SameSite=Lax). 로그인/가입 외 모든 엔드포인트는 세션 검증 실패 시 401 `{ok:false, error:'unauthorized'}` → 프론트가 로그인 화면으로 전환.

- `POST /api/auth?action=join` — {username, password, nickname, birthYear?, gender?, heightCm?, goalWeight?, goalText?} → 가입 + 즉시 로그인(쿠키 발급). username 중복 시 409.
  - 검증: username 4~30자 영숫자, password 8자 이상, nickname 1~30자.
- `POST /api/auth?action=login` — {username, password} → 쿠키 발급. 실패 401 (아이디/비번 구분 없이 동일 메시지).
- `POST /api/auth?action=logout` — 세션 삭제 + 쿠키 만료.
- `GET  /api/auth?action=me` — 로그인 상태 확인 + 프로필 반환 {nickname, birthYear, gender, heightCm, goalWeight, goalText}.
- `POST /api/auth?action=profile` — 프로필 수정(닉네임/생년도/성별/키/목표). 아이디·비번 변경은 범위 외(YAGNI).
- `GET  /api/sets?action=today|history|last|exercises|chart` — 기존 GAS doGet과 동일 파라미터·응답 형태 유지(프론트 수정 최소화). 단 사용자 스코프.
- `POST /api/sets` — {action:'add', record} / {action:'delete', id}. add는 client_id 멱등(중복 시 {ok:true, duplicate:true}).
- `GET  /api/body` — 본인 몸 기록 목록(날짜 오름차순).
- `POST /api/body` — {date, weight?, bodyFatPct?, muscleMass?} upsert. 세 값 모두 null이면 해당 날짜 기록 삭제.

응답 규약은 기존과 동일: `{ok:true, ...}` / `{ok:false, error}`.

## 인증 상세

- 비밀번호: bcryptjs 해시(cost 10). 원문 저장·로깅 금지.
- 세션: 로그인마다 `crypto.randomBytes(32).toString('hex')` 토큰 발급, sessions에 저장, 만료 90일. 요청마다 만료 검증. 로그아웃 시 삭제. (스라이딩 갱신은 YAGNI — 90일 후 재로그인.)
- 쿠키: `sid=<token>; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000; Path=/`.
- same-origin이므로 CORS 설정 불필요. CSRF는 SameSite=Lax + JSON Content-Type 요구로 방어(개인용 규모 충분).

## 프론트 변경

- **로그인/가입 화면**: 비로그인 상태면 앱 대신 표시. 로그인 폼(아이디/비번) ↔ 가입 폼 전환. 가입 폼: 아이디·비번·닉네임(필수) + 생년도·성별·키·목표 몸무게·목표 한 줄(선택, "나중에 입력 가능" 표기).
- **api.js**: GAS 호출 제거 → same-origin `/api/*` fetch (credentials 포함). 401 응답이면 로그인 화면 전환. `config.js`(URL/토큰 프롬프트)와 설정 버튼 삭제.
- **몸 탭 추가** (탭바: 오늘 / 기록 / 차트 / 몸):
  - 오늘 몸무게/체지방률/골격근량 입력(모두 선택, 있는 것만) → 저장(upsert)
  - 몸무게 변화 꺾은선 차트(기존 SVG 차트 재사용) + 목표 몸무게 가로 점선
  - 최근 기록 목록
  - 프로필 수정 폼(닉네임/생년도/성별/키/목표) + 로그아웃 버튼
- **헤더**: 닉네임 표시.
- 오프라인 대기열(add/delete)·낙관적 UI·오늘 캐시는 기존 로직 유지. localStorage 캐시 키에 username 포함(계정 전환 시 섞임 방지).

## 데이터 이관

구글 시트 기록은 이관하지 않는다(기록 거의 없음). 시트·Apps Script는 삭제하지 않고 방치 — 사이트가 더 이상 호출하지 않을 뿐. GitHub Pages는 저장소 설정에서 비활성화하고 README의 주소·안내를 Vercel 기준으로 갱신.

## 테스트

- 순수 로직(store.js, queue.js, chart.js) node:test 유지. GAS용 logic.cjs와 tests/logic.test.js는 삭제(백엔드 SQL로 대체).
- 백엔드: DB 접근을 얇게 유지하고, 검증·변환 로직(입력 검증, 세션 만료 판정, upsert 파라미터 구성)은 순수 함수 모듈로 분리해 node:test.
- E2E: 로컬 `vercel dev`로 가입→로그인→세트 추가→몸 기록→로그아웃 흐름 확인 후 배포. 배포 후 실사이트에서 동일 흐름 재확인.

## 하지 않는 것 (YAGNI)

- 비밀번호 재설정/이메일 인증(아이디·비번 분실 시 DB에서 직접 처리), 아이디·비번 변경 UI
- 소셜 로그인, 프로필 사진, 친구/공유 기능
- 운동 루틴 추천, 타이머, 칼로리
- 프레임워크 도입 — 프론트는 계속 바닐라 JS
