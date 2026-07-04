# 운동 기록 (gym-log)

휴대폰으로 종목·무게·횟수·세트를 입력하고, 몸무게/체지방 변화도 기록하는 개인 운동 기록 사이트.
Vercel(프론트+API) + TiDB Serverless(MySQL 호환) — 전부 무료.

## 사용

1. 사이트 접속 → 회원가입(아이디/비밀번호/닉네임, 몸 정보는 선택)
2. 한 번 로그인하면 90일 유지
3. 휴대폰 브라우저 메뉴 → **홈 화면에 추가** → 앱처럼 사용

## 구조

- 프론트: 바닐라 JS 정적 파일 (`index.html`, `js/`, `css/`)
- API: `api/*.js` — Vercel Node 서버리스 함수 (auth / sets / body)
- DB: TiDB Cloud Serverless(MySQL 호환), 스키마는 `schema.sql`
- 인증: bcrypt + 세션 토큰(httpOnly 쿠키 90일). 계정별 데이터 분리.
- 오프라인: 전송 실패한 세트/삭제는 대기열에 쌓였다가 자동 재전송(멱등).

## 개발

```bash
npm install
npm test                                   # 단위 테스트 (Node 20+)
cp .env.example .env                       # DATABASE_URL 채우기
node --env-file=.env scripts/init-db.mjs   # 스키마 적용 (DB 없으면 생성)
npm run dev                                # http://localhost:8730
```

배포: `npx vercel deploy --prod` (Vercel 프로젝트에 환경변수 `DATABASE_URL` 필요)

`.env`는 절대 커밋하지 않는다.
