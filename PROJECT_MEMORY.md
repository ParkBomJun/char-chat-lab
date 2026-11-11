# char-chat-lab 프로젝트 기록

기준서: `SPEC.md` (한 번에 한 단계만 진행 후 보고). 전연령 캐릭터챗 서비스, 파이프라인(기억·로어북·캐싱·안전·비용)이 핵심.

## 상태
- 2026-11-11 **0단계 완료** (셋업).
- 2026-11-11 **1단계 완료** (인증 + seed).
- 2026-11-11 **2단계 완료** (대화 기본). **실제 모델은 미검증** — `.env`의 LLM 키·모델이 비어 mock으로 동작. 실제 키를 넣으면 2·3단계 완료 기준("실제로 대화된다", 캐시 토큰 기록) 확인 필요.
- 2026-11-11 **3단계 완료** (조립기+UsageLog).
- 2026-11-11 **4단계 완료** (기억 요약). 다음: 5단계(로어북) — 사용자 승인 대기.

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
- LLM 계층: `src/lib/llm/` (`types.ts` 인터페이스·`openai.ts` OpenAI 호환·`mock.ts`·`index.ts getLlm()`). 키 비면 mock 자동, `LLM_PROVIDER=mock`으로 강제 가능. 키가 있는데 `LLM_CHAT_MODEL`이 비면 오류. usage의 `prompt_tokens_details.cached_tokens`를 `cachedInputTokens`로 읽음(3단계 UsageLog에서 기록).
- SSE: `src/lib/sse.ts`(SseParser·formatSse; 서버 업스트림 읽기와 클라이언트 읽기 공용). 라우트 `POST /api/chat/[conversationId]` 이벤트 `delta`/`done`/`error`. 중지(abort) 시 받은 만큼 저장, LLM 실패 시 저장 안 하고 일반 오류 문구만 노출(상세는 서버 로그).
- 검증 방법: Playwright E2E(스트리밍 관측·중지·권한 404/401·입력 길이) + 가짜 OpenAI 호환 서버(scratchpad `fake-openai.mjs`, :4010)로 요청 형식 확인. 한글 IME 조합 중 Enter는 전송하지 않음(`isComposing`).
- `npm run typecheck`는 `next typegen` 선행(라우트 타입 `RouteContext`/`PageProps` 생성).
- 조립기 `src/lib/chat/assemble.ts`: `assemblePrompt(character, summary, lorebookHits, recentMessages, userInput, config)` 순수 함수. 요약·로어북은 각각 별도 `system` 메시지(고정 블록 뒤). 예산 초과 시 최근 대화를 오래된 것부터 자르며 항상 최신 쪽 연속 구간 유지. 고정 블록·이번 입력은 안 자름(`overBudget` 표시). 로어북 예산 선별도 여기서 처리(키워드 매칭은 5단계). 테스트로 "이전 턴 프롬프트가 다음 턴의 접두사" 고정.
- 토큰 추정 = 글자 수(`lib/tokens.ts`). 한국어에선 실제보다 크게 잡힘(보수적). **OpenAI 자동 캐시는 접두사 ≥1024 실토큰부터** — 시드 캐릭터 고정 블록은 추정 397이라 실제로는 캐시가 안 걸릴 가능성이 큼(8단계 평가 때 고정 블록을 키우거나 이 한계를 결과에 명시).
- 설정 `src/lib/config.ts`(env, 빈 값은 기본값), 단가 `src/config/pricing.json`(현재 전부 0 — 사용자가 입력), 비용 `lib/pricing.ts`(입력 토큰은 캐시 포함 → (입력-캐시)×입력단가+캐시×캐시단가+출력×출력단가), 행 생성 `lib/usage.ts`. usage 없는 중지 경로는 `usageEstimated=true`.
- **기억(4단계)**: `src/lib/memory/` — `plan.ts`(갱신 시점, 순수), `prompt.ts`(요약 프롬프트, 800자 규칙·인젝션 방어 문구), `update.ts`(오케스트레이터, 의존성 주입으로 테스트), `db.ts`(Prisma/LLM 연결, `SUMMARY_MAX_OUTPUT_TOKENS=700`). 라우트가 `after()`로 응답 종료 후 실행; 실패하면 로그만 남기고 다음 턴 같은 조건으로 재시도. 동시 갱신은 `@@unique(conversationId, version)` 충돌(P2002)을 conflict로 처리. 요약 블록은 `system`이지만 "지시문 아님" 문구를 붙임(사용자 발화 파생 텍스트가 시스템 권한을 얻지 못하게).
- `.gitignore`의 `.env*`가 `.env.example`까지 무시하던 문제를 3단계에서 `!.env.example`로 수정(0단계부터 미커밋이었음).
- 4단계 검증: 가짜 OpenAI 서버 + `RECENT_TURNS=3 SUMMARY_EVERY=2`로 8턴 E2E(요약 v1·v2 생성, 6턴부터 요약 블록, 접두사는 갱신 시점에만 깨짐, 요약 호출 모델=LLM_CLASSIFIER_MODEL). 실제 기본값(30턴)·실제 모델 요약 품질은 미검증.
- 로어북(5단계)이 요약 이후에 붙을 때 접두사 안정성이 무너지는지 확인할 것(요약 블록 뒤 system 메시지가 매 턴 바뀜 → 로어북 블록 이후 캐시는 깨짐, SPEC의 트레이드오프).
