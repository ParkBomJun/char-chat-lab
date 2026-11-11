# char-chat-lab 프로젝트 기록

기준서: `SPEC.md` (한 번에 한 단계만 진행 후 보고). 전연령 캐릭터챗 서비스, 파이프라인(기억·로어북·캐싱·안전·비용)이 핵심.

## 상태
- 2026-11-11 **0단계 완료** (셋업).
- 2026-11-11 **1단계 완료** (인증 + seed). 다음: 2단계(대화 기본, LLM 어댑터, SSE) — 사용자 승인·LLM 제공사/모델 결정 대기.

## 결정·메모
- 위치 `~/char-chat-lab/`. Next 16.4 / React 19 / Prisma 7.10(client 출력 `src/generated/prisma`, gitignore, 어댑터 `@prisma/adapter-pg` 필수) / Vitest 5.
- Prisma 8.0은 rc라 7.x 사용. `@types/node`는 vitest 호환 위해 22.
- Prisma 설정 파일은 `prisma.config.ts` (init이 `prisma7.config.ts`로 만들어서 이름 변경).
- Docker 연동됨. 로컬 Postgres는 **호스트 5433**(5432는 다른 프로젝트 booking-postgres가 사용, 3000은 Grafana → dev 서버는 `npx next dev -p 3100` 등 다른 포트 권장). 남의 컨테이너는 건드리지 않는다.
- Auth.js v5 beta(`next-auth@beta`)+bcryptjs+zod. 세션 JWT. 데모 계정은 `.env`의 DEMO_EMAIL/DEMO_PASSWORD로 seed(`npx prisma db seed`). seed 캐릭터 `하루`(자리표시 내용).
- `prisma generate`는 스키마 변경마다 다시(0단계 때 빈 스키마로 생성돼 있어 타입 오류 났음).
- 검증 방법: curl로 `/api/auth/*` 흐름 + Playwright(scratchpad에 별도 설치, 캐시된 chromium `executablePath` 지정)로 가입/로그인/로그아웃 E2E. 프로젝트 의존성엔 넣지 않음. React 19는 액션 후 폼을 리셋하므로 실패 시 이메일을 state로 되돌려 유지.
- Next 16 주의: `cacheComponents`는 끔, `force-dynamic` 사용 가능. 미들웨어는 `proxy.ts`로 개명됨(아직 미사용; 보호는 페이지에서 `auth()`로).
- SPEC.md 사본은 Desktop 원본에서 복사. 스키마·설계 변경 시 이 사본을 고친다.
- Next가 만드는 `AGENTS.md`는 "Next 문서는 node_modules/next/dist/docs/ 참고" 안내.
