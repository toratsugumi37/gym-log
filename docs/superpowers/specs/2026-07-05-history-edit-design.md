# 지난 기록 수정/삭제 + 요일 표시 설계 (2026-07-05)

## 목적

잘못 입력한 과거 기록을 사용자가 직접 고치고 지울 수 있게 한다. 지금은 "오늘" 탭 세트만 수정/삭제되고 "지난 기록" 탭은 보기 전용이다. 지난 기록 탭에서도 오늘과 동일하게 세트를 탭해 수정/삭제하고, 날짜에 요일을 표시한다.

## 범위

프론트만(js/ui.js, js/store.js, index.html, css/style.css). 백엔드는 이미 있는 `edit`/`delete` 액션 재사용 — 변경 없음.

## 1. 세트 수정 시트를 콜백 기반으로 재사용

현재 `openSetSheet(record)`는 오늘 탭 전용(내부에서 `todayRecords`/`renderToday`에 강결합). 이를 콜백 주입형으로 바꿔 오늘·지난 기록 양쪽이 쓴다.

- `openSetSheet(record, { onSave, onDelete })`
  - `onSave(weight, reps) → Promise` : 저장 로직(호출자가 제공)
  - `onDelete() → void|Promise` : 삭제 로직(호출자가 제공)
  - 시트 제목(`#sheet-title`)에 `record.exercise` 표시.
- `saveSheet()`: 무게/횟수 검증(0~2000 / 1~1000) 후 `history.back()`(시트 닫기) → `await onSave(weight, reps)`.
- `deleteFromSheet()`: `history.back()` → `onDelete()`.
- 검증 실패 시 시트 유지 + 토스트 안내(닫지 않음).

오늘 탭 알약은 기존 동작을 콜백으로 감싸 넘긴다:
- `onSave`: 낙관적으로 `r.weight/r.reps` 갱신 + `renderToday()` + `apiPost edit`, 실패 시 되돌리고 토스트.
- `onDelete`: 기존 `deleteSet(r)` (오프라인 큐 보호 유지).

## 2. 지난 기록 탭을 알약 + 편집 가능하게

현재 renderHistory는 종목별 세트를 `<p>텍스트</p>`로 표시(읽기 전용). 이를 오늘 탭과 같은 알약으로 바꾸고 편집 가능하게 한다.

- 모듈 상태 `historyRecords`에 마지막으로 불러온 기록을 보관.
- `renderHistory()`: `cachedGet` 후 `historyRecords = data.records` 저장 → `paintHistory()`.
- `paintHistory()`: `groupByDate(historyRecords)`로 날짜별 `<details>`, 각 종목 라벨 + `.pill-wrap`에 세트 알약. 알약 탭 → `openHistorySheet(s)`.
- 편집은 `historyRecords`를 낙관적으로 조작 후 `paintHistory()`(재fetch 안 함)로 즉시 반영, 서버 실패 시 되돌리고 토스트:
  - `onSave`: `s.weight/s.reps` 갱신 → paintHistory → `apiPost edit`, 실패 시 되돌림+토스트.
  - `onDelete`: `historyRecords`에서 해당 id 제거 → paintHistory → `apiPost delete`, 실패 시 원위치 복원+토스트(`not found`는 이미 삭제로 간주하고 성공 처리).
- 세트 객체 `s`는 `groupByExercise`가 원본 레코드를 참조로 담으므로 `s` 변경이 `historyRecords`에 반영된다.

과거 날짜에 세트를 **새로 추가**하는 기능은 범위 외(수정/삭제만).

## 3. 요일 표시

- `store.js`에 순수 함수 `formatDateLabel(dateStr) → 'M월 D일 (요일)'` 추가(테스트 대상).
  - 'YYYY-MM-DD'를 로컬 기준으로 파싱(`new Date(y, m-1, d)`)해 시간대에 따른 요일 밀림 방지.
  - 요일 배열 `['일','월','화','수','목','금','토']`.
  - 예: `formatDateLabel('2026-07-05') → '7월 5일 (일)'`.
- 지난 기록 `<summary>`에 이 라벨 사용.

## 4. 토스트

- `index.html`에 `<div id="toast" class="toast" hidden></div>` 추가(#app 안).
- `toast(msg)`: 텍스트 설정 + 표시, 2.2초 후 자동 숨김(중복 호출 시 타이머 리셋).
- 하단 탭바 위, 화면 하단 중앙에 어두운 알약 형태. `prefers-reduced-motion` 무관(페이드만).
- 지난 기록 수정/삭제 실패, 오늘 세트 수정 실패 등에 사용.

## 오프라인 처리

- 지난 기록 수정/삭제: 온라인에서만. 실패 시 낙관적 변경을 되돌리고 토스트.
- 오늘 세트 추가/삭제: 기존 오프라인 큐 유지(변경 없음). 오늘 세트 수정: 기존대로 낙관적+실패 롤백.

## 테스트

- `store.test.js`: `formatDateLabel` (요일 계산 정확성, 한 자리/두 자리 월·일, 시간대 무관) — 순수 함수.
- 기존 29개 유지.
- E2E(Playwright): 지난 기록 탭에서 세트 알약 표시·요일 라벨 확인, 알약 탭→시트 수정 저장→서버 반영·재렌더, 삭제→제거, 실패 토스트, 오늘 탭 수정/삭제 회귀 확인. 라이트/다크.

## 하지 않는 것 (YAGNI)

- 과거 날짜에 세트 추가.
- 종목 통째로/하루 통째로 삭제.
- 요일별 필터/통계.
