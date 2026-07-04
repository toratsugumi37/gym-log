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
