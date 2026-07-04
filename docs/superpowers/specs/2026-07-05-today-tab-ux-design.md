# "오늘" 탭 UX 개편 + 편의 기능 설계 (2026-07-05)

## 목적

운동 기록의 핵심 화면인 "오늘" 탭을 더 세련되고 편하게 만든다. 상태 뱃지를 없애 잡음을 줄이고, 종목 입력을 검색 자동완성으로 바꾸고, 세트가 세로로 무한히 쌓이지 않게 압축 표시하며, 세트 수정·증량 버튼·오늘 요약·피드백·앱 내 뒤로가기를 추가한다.

## 범위

프론트(index.html, css/style.css, js/ui.js, js/store.js) 위주 + 백엔드 소폭(api/sets.js에 세트 수정, 종목 목록 전체 반환). 인증·DB 스키마·다른 탭 구조는 그대로.

## 1. 상태 뱃지 제거

- `#pending-badge`, `#offline-badge`, `.status-pills` 컨테이너를 화면에서 제거한다.
- **오프라인 큐 메커니즘은 유지**: 세트 추가/삭제는 낙관적 UI + `queue`/`deleteQueue`로 계속 동작(오프라인에도 기록 유실 없음). 다만 사용자에게 뱃지로 알리지 않는다.
- 영구 실패(400) dead-letter 처리는 유지하되, 알림은 `#today-notice`(빨강 한 줄)로만 표시.

## 2. 종목 검색 자동완성

- 종목 입력칸(`#exercise-input`) 아래에 자동완성 드롭다운(`#exercise-suggest`)을 띄운다.
- 입력값으로 알려진 종목 목록을 부분일치 필터(대소문자·공백 무시)해서 보여준다. 항목 탭 → 종목 선택 + 지난 무게/횟수 자동 채움(기존 `selectExercise`) + 드롭다운 닫힘.
- 입력값과 정확히 일치하는 종목이 목록에 없으면 드롭다운 맨 아래에 **"'{입력값}' 새 종목으로 추가"** 항목. 탭 → 그 이름으로 선택(새 종목).
- 상단 최근 종목 칩(`#exercise-buttons`)은 유지(자주 하는 종목 한 탭용).
- 드롭다운은 입력 포커스 아웃/항목 선택/바깥 탭/Esc 시 닫힘.
- 백엔드: `GET /api/sets?action=exercises`가 최근순 전체 distinct 종목을 반환(기존 LIMIT 30 → LIMIT 200). 개인용 규모에서 충분.

## 3. 세트 압축 표시 (알약)

기존: 세트마다 `.set-row` 한 줄이 아래로 쌓임 → 세트 많으면 화면이 길어짐.

변경: 종목별 카드에서 세트를 **가로로 채워지는 작은 알약**으로 표시하고, 넘치면 wrap.

```
벤치프레스                     3세트 · 최고 62.5kg
[60×10] [60×8] [62.5×8]
```

- 종목 카드 헤더: 종목명 + `N세트 · 최고 Wkg`(최고 무게 세트 기준).
- 각 세트 = 알약 버튼(`.set-pill`), 텍스트 `무게×횟수`. 세트번호는 알약 순서로 자연히 드러나므로 생략(헤더의 세트 수로 충분). 접근성용 aria-label에 "N세트 무게×횟수" 포함.
- 아무리 많아도 종목당 2~3줄. 세로 스크롤 대폭 감소.
- 전송 대기 중인(아직 서버 미확정) 알약은 살짝 흐리게(opacity) 표시 — 텍스트 뱃지 대신 은은한 상태 표현.

## 4. 세트 수정 / 삭제 (바텀 시트)

- 세트 알약 탭 → 하단에서 올라오는 시트(`#set-sheet`): 무게·횟수 입력(± 버튼 포함) + [저장] + [삭제].
- 저장 → 낙관적 수정 + `POST /api/sets {action:'edit', id, weight, reps}`. 실패 시 이전 값으로 되돌리고 `#today-notice`에 "수정 실패 — 다시 시도" 표시.
  - 오프라인 수정은 큐에 넣지 않는다(추가·삭제만 오프라인 보장). 실패 시 롤백. (개인용 v1 범위)
- 삭제 → 기존 `deleteSet` 로직 재사용(오프라인 큐 보호 유지).
- 상시 노출되던 빨강 "삭제" 버튼은 제거(시트 안으로 이동) → 리스트가 깔끔.
- 백엔드: `api/sets.js` POST에 `action:'edit'` 추가. `UPDATE workout_sets SET weight=?, reps=? WHERE user_id=? AND client_id=?`. 검증은 기존 무게 0~2000·횟수 1~1000 규칙 재사용. 미존재 시 404.

## 5. 무게 / 횟수 ± 버튼

- 무게 입력: `[−2.5] [ 60 ] [+2.5]` (0 밑으로 안 내려감, 상한 2000).
- 횟수 입력: `[−1] [ 10 ] [+1]` (1~1000).
- 세트 추가 폼과 수정 시트 양쪽에 동일 스테퍼 컴포넌트 사용.
- 직접 타이핑도 그대로 가능.

## 6. 오늘 요약

- "오늘" 라지 타이틀 아래에 요약 한 줄/작은 카드: `N종목 · M세트 · 총 Xkg`.
  - 종목 수 = 오늘 distinct 종목, 세트 수 = 오늘 세트 총개수, 총 볼륨 = Σ(무게×횟수), 천단위 콤마.
- 오늘 기록이 없으면 요약 숨김.
- 순수 계산은 `store.js`에 `summarizeToday(records)` 추가(테스트 대상).

## 7. 세트 추가 피드백

- 추가 시 새 알약이 scale-in "톡" 애니메이션(`prefers-reduced-motion` 존중, reduce면 애니메이션 없음).
- 진동: `if (navigator.vibrate) navigator.vibrate(8)` — 안드로이드 동작, iOS는 무시(no-op).
- 사운드: 짧고 부드러운 틱(WebAudio, 버튼 탭 제스처 내에서 재생). try/catch로 실패 무시.
- **한계 명시**: iOS Safari/홈화면 앱은 진동 API를 막아 실제 햅틱 불가 → iOS에선 시각 애니메이션 + 사운드로 대체.

## 8. 앱 내 뒤로가기 (History API)

SPA라 폰 뒤로가기가 탭/시트를 인지하지 못해 앱을 벗어나던 문제 해결.

- 앱 시작 시 `history.replaceState({tab:'today', overlay:null}, '')`.
- 사용자가 탭 전환 시 `history.pushState({tab, overlay:null}, '')`.
- 시트(세트 수정) 열 때 `history.pushState({tab:현재, overlay:'sheet'}, '')`.
- `popstate` 핸들러:
  1. 현재 시트가 열려 있으면 → 시트만 닫고 종료(뒤로가기 소비).
  2. 아니면 `event.state?.tab`(없으면 'today')으로 **프로그램적** 탭 전환(다시 push하지 않음).
  3. 첫 진입 이전으로 가면 state가 우리 것이 아니므로 기본 동작(앱 나감) 허용.
- 시트를 UI 버튼/바깥탭으로 닫을 때는 `history.back()`을 호출해 히스토리와 DOM 상태를 일치시킨다(재진입/중복 닫힘은 플래그로 가드).

## 데이터/인터페이스 요약

- `store.js` 추가: `summarizeToday(records) → {exercises, sets, volume}`; `filterExercises(list, query) → string[]`(부분일치, 공백·대소문자 무시).
- `api/sets.js`: `exercises` LIMIT 200; POST `edit` 액션.
- 기존 함수(`groupByExercise`, `nextSetNumber`, `summarizeSession`, `todayStr`, `newId`)·큐·인증은 변경 없음.

## 테스트

- 순수 로직 node:test: `summarizeToday`, `filterExercises`(부분일치·공백무시·정확일치 판정), 기존 26개 유지.
- 백엔드 `edit`는 DB 필요 → 로컬 dev + Playwright E2E로 검증.
- 프론트 E2E(Playwright): 자동완성 선택/새 종목 추가, 알약 표시·wrap, 세트 수정·삭제, ± 버튼, 요약 갱신, 뒤로가기(시트 닫힘/탭 이동). 라이트·다크 스크린샷 검토.

## 하지 않는 것 (YAGNI)

- 세트 편집의 오프라인 큐잉(추가·삭제만 오프라인 보장).
- 종목 이름 변경/삭제 관리 화면, 종목 카테고리.
- 세트 순서 드래그 재정렬.
- 사운드/햅틱 on-off 설정 화면(기본 켜짐, 은은하게).
