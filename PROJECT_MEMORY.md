# char-chat-lab 프로젝트 기록

기준서: `SPEC.md` (한 번에 한 단계만 진행 후 보고). 전연령 캐릭터챗 서비스, 파이프라인(기억·로어북·캐싱·안전·비용)이 핵심.

## 상태
- 2026-11-11 **0단계 완료** (셋업).
- 2026-11-11 **1단계 완료** (인증 + seed).
- 2026-11-11 **2단계 완료** (대화 기본). **실제 모델은 미검증** — `.env`의 LLM 키·모델이 비어 mock으로 동작. 실제 키를 넣으면 2·3단계 완료 기준("실제로 대화된다", 캐시 토큰 기록) 확인 필요.
- 2026-11-11 **3단계 완료** (조립기+UsageLog).
- 2026-11-11 **4단계 완료** (기억 요약).
- 2026-11-11 **5단계 완료** (로어북).
- 2026-11-11 **6단계 완료** (안전 파이프라인). 규칙 목록·실제 분류기 한국어 성능은 미검증.
- 2026-11-11 **7단계 완료** (일일 제한 + 관리자).
- 2026-11-11 **8단계 완료** (평가 스크립트). **실제 수치는 아직 없음**: 키·모델·단가가 비어 mock/가짜 서버로만 검증. 레드팀 세트는 사용자 작성 대기(`eval/redteam/`). 
- 2026-11-11 **9단계 준비 완료, 공개 배포는 보류**: README·docs/DEPLOY.md·Dockerfile·compose.prod·로그인 제한·헬스체크·보안 헤더·개인정보 페이지·predeploy 완성, 운영 이미지를 로컬에서 실제 기동해 검증. **공개 URL 게시는 배포 대상(호스팅)·계정 미정이라 하지 않음** → 사용자가 대상을 정하면 진행. README의 데모 URL 자리표시 교체 필요.

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
- **로어북(5단계)**: `src/lib/lorebook/` — `keywords.ts`(정규화·검증, 최소 2글자, 항목당 20개/40자), `match.ts`(순수 매칭, 최근 M턴, 우선순위→id 정렬로 출력 안정). 라우트가 활성 항목을 턴마다 조회해 조립기로 넘김(조립기가 `LOREBOOK_TOKEN_BUDGET` 선별). seed에 로어북 3개(`seed-lore-1~3`, 자리표시 내용). 키워드 설정 규칙을 7단계 관리자 편집 화면에서 `validateKeywords`로 재사용할 것.
- 5단계 관측: 로어북이 바뀌는 턴마다 고정 블록 1개만 재사용(그 뒤 전부 캐시 무효), 안 바뀌면 전체 유지 → 2단계 배치 실험 기준 수치. 6단계에서 회수·안내 처리 시 `retracted` 메시지는 이미 조립·매칭에서 제외됨.
- **안전(6단계)** `src/lib/safety/`: `rules.ts`(+`config/safety-rules.json`), `classifier.ts`(LlmClassifier·MockClassifier·parseVerdict·isBlocked), `input.ts`/`output.ts`(검사 로직, StreamGuard), `flow.ts`(흐름 감시 순수함수), `persist.ts`(DB: 이벤트·분류기 비용·흐름 적용), `messages.ts`(안내 문구), `index.ts getClassifier()`. 라우트는 입력검사→조립→스트리밍(StreamGuard)→완료 후 분류기→저장→흐름 감시 순.
- 안전 설계 결정/교훈: ①2글자 위기어("자살")에 공백 우회를 허용하면 "사자 살았다"가 걸려서 3글자 이상에만 허용(띄어 쓴 2글자 우회는 분류기 몫). ②위기 규칙은 출력에 적용 안 함(위로 응답 보호). ③입력 분류기 실패는 503+대화에 안 남김, 출력은 회수. ④위기·검사불가 턴은 흐름 점수 0(힘든 사용자나 장애가 중단 사유가 되면 안 됨). ⑤경고/위반 후 점수 윈도우 리셋. ⑥분류기 프롬프트는 검사 대상을 태그로 감싸고 꺾쇠를 전각 변환(태그 탈출 방지), 구조화 출력(json_schema)+zod 검증, `LLM_STRUCTURED_OUTPUT=off`로 끌 수 있음.
- mock 모드 분류기 표식: `[[block-in]]`/`[[block-out]]`/`[[crisis-in]]`/`[[error-in]]`/`[[error-out]]`/`[[risk:0.6]]` (mock 환경 전용 테스트 장치). 가짜 OpenAI 서버(scratchpad `fake-openai.mjs`)도 같은 표식을 처리해 실제 LlmClassifier 경로를 검증함.
- **README(9단계)에 적을 것**(SPEC 3-5 요구): ①출력 검사 트레이드오프 — 스트리밍 중엔 규칙 층만 즉시, 분류기는 완료 후라 이미 보낸 텍스트를 회수(retract)하는 방식(속도 우선, 노출 시간 존재). 대안은 지연 버퍼(안전 우선, 첫 토큰 지연). ②안전 분류기는 fail closed(오류 시 차단), 모델 라우팅 분류기는 fail open(오류 시 통과)이어야 하는 이유(오차 비용의 방향이 반대).
- 한계(알려진 것): 규칙 목록은 초안이라 오탐·누락 있음("죽고 싶다"가 과장 표현으로 쓰여도 위기 안내가 나감); 요약·로어북 내용은 안전 검사를 거치지 않음(요약은 지시문 아님 문구로만 방어); 흐름 감시의 strike는 영구 누적; 캐릭터 카드 심사는 2단계(MVP 이후).
- **일일 제한/관리자(7단계)**: `lib/kst.ts`(KST 자정 경계), `lib/daily-limit.ts`, 라우트가 안전 검사 전에 429. 관리자 `src/app/admin/`(layout·page·moderation·characters, `actions.ts` 서버 액션), `lib/admin/{guard,forms,stats}.ts`. 교훈: ①서버 액션은 URL로 직접 호출 가능 → 각 액션이 `requireAdmin()`(DB 역할 확인) 호출, 실제로 일반 사용자 세션으로 액션 ID를 훔쳐 호출해 404 확인. ②Prisma `NOT {category:'turn'}`은 NULL 행을 빼므로 `OR[null, not]`로 써야 함. ③`createdAt`은 UTC timestamp(타임존 없음) → 날짜 묶음은 `AT TIME ZONE 'UTC'` 후 `'Asia/Seoul'`. ④폼 검증 실패 시 긴 텍스트 보존은 `useActionState`에서 values 반환(redirect하면 사라짐).
- 관리자 시드 계정은 개발용 임시 비밀번호(`.env.example` 값). **공개 배포 전 반드시 교체**(9단계 체크리스트). 로그인 시도 횟수 제한도 없음(1단계에서 지적).
- 대시보드 수치 검증: 가짜 서버 기준 비용 손계산 일치(대화 3×672+분류기 6×180), 캐시 128/1200=10.7% 일치.
- **평가(8단계)** `eval/`: `run.ts`(CLI), `lib/{engine,metrics,report,schema,load,types}.ts`, `characters/eval-garden.json`(고정 블록 약 3천 토큰 추정, 캐시용), `scenarios/{garden-daily,counseling-light}.json`(각 45턴), `redteam/example.json`(형식 예시만). `npm run eval[:scenarios|:redteam]`. 상세는 `eval/README.md`.
- 8단계 설계 결정/교훈: ①DB 없이 라우트를 재현하는 엔진(순수 함수·어댑터 재사용) — 라우트와 이중 관리라는 비용을 README에 명시. ②요약 전후 비교는 baseline(전체 원문, 예산 절단 없음) 대 서비스 설정, 평가용 프롬프트 예산 30000(안 그러면 긴 카드가 예산을 먹어 절단 효과가 섞임). ③고정 블록이 크면 전체 절감률이 작게 보이므로 이력 부분 절감률을 따로 보고. ④순절감·비용 절감은 음수가 될 수 있음(짧은 대화에선 요약이 손해). ⑤검사 장애(check_failed)뿐인 케이스는 "통과"의 증거도 못 되므로 판단 불가로 제외(초기 구현에서 success로 잘못 분류했던 버그를 테스트로 잡음). ⑥실제 API는 `--yes` 필요. ⑦mock 결과는 커밋 제외.
- mock 실행으로 확인한 것: 요약은 30·40턴 뒤 갱신, counseling-light 18번째 턴(관용 표현 "죽고 싶을 만큼 창피")이 위기 규칙 오탐으로 잡힘(이게 곧 규칙 개선 후보), 가짜 서버로 캐시 128/300=42.7%·비용 손계산 일치.
- 9단계 전에 사용자가 할 일: 실제 키·모델 `.env` 입력, `pricing.json` 단가, `eval/redteam/`에 공격·정상 대화 세트 작성(튜닝용/보고용 분리), 그 뒤 `npm run eval -- --yes`.
- **9단계 교훈**: ①로그인 제한 테스트가 한참 멈춘 원인은 앱이 아니라 테스트의 틀린 비밀번호(7자)가 폼 `minLength=8`에 걸려 제출 자체가 막힌 것(서버 로그에 아무것도 안 남아 헷갈림). 진단은 curl로 Auth.js 콜백을 직접 쳐서 서버 경로가 정상임을 먼저 확인한 게 빨랐음. ②`pkill -f 패턴`은 내 명령 문자열에도 매치돼 셸이 죽음 → PID로 종료. ③dev 로그를 `: >`로 비우면 열린 fd가 오프셋을 유지해 NUL이 생김(grep -a / tr -d '\000'). ④같은 디렉터리의 compose 두 파일은 프로젝트명이 같아 `db` 서비스가 덮어써질 수 있음 → prod는 `name:` 분리(개발 DB 무사 확인). ⑤seed가 배포마다 관리자 수정(시드 캐릭터)을 덮어쓰는 문제 → SEED_PRESERVE, 실제로 수정 유지 확인. ⑥predeploy가 compose 방식(POSTGRES_PASSWORD로 DB URL 조립)을 오류로 보던 결함 수정. ⑦Node는 자체 CA 번들이라 slim 이미지에 ca-certificates가 없어도 HTTPS OK, OpenSSL은 Prisma 마이그레이션 엔진용(migrate 이미지에만).
- 검증한 것(로컬 운영 구성): 마이그레이션·seed 보존·헬스(healthy)·비루트(uid 1001)·이미지 432MB(runner)·HSTS(운영만)·x-powered-by 제거·채팅(mock)·입력 차단·관리자 200/일반 404. 검증 안 한 것: 실제 호스팅, 실제 TLS/프록시, 실제 LLM, 부하.
