# char-chat-lab 프로젝트 기록

기준서: `SPEC.md`. 전연령 캐릭터챗 서비스, 파이프라인(기억·로어북·캐싱·안전·비용)이 핵심.
마지막 갱신: 2026-11-12. 인계 문서는 바탕화면 `char-chat-lab-보고서/HANDOFF-2026-11-12.md`(저장소 밖).

## 목적과 일정

- 채용 지원용 포트폴리오(AI 캐릭터챗 신사업 팀 소프트웨어 엔지니어). **공고 마감 11월 16일, 제출 목표 11월 15일(일).** 완성도보다 날짜가 우선.
- 서류에서 보여 줄 것: 공개 URL과 데모 계정, 공개 저장소, README의 실측 숫자.
- 실사용자는 없다. 검증은 공개 배포, 실제 모델 실측, mock 파이프라인. 문서에는 항상 실측과 시뮬레이션(mock)을 구분해 적는다.

## 항상 지킬 규칙

1. 한 번에 한 작업. 끝나면 한 일, 테스트 결과, 사용자가 정할 것만 짧게 보고하고 멈춘다.
2. **실제 API 호출은 사용자가 명시적으로 시킬 때만.** 테스트와 E2E는 테스트 DB(5434)와 mock, 포트 3110.
3. **공격 케이스를 실제 모델로 보내지 않는다.** OpenRouter는 승인 없는 레드팀을 금지한다(https://openrouter.ai/docs/cookbook/evaluate-and-optimize/red-teaming). 사용자는 승인 요청을 **하지 않기로** 했다.
   - `REDTEAM_APPROVED=1`을 설정하거나 가드를 우회하지 않는다.
   - README와 문서에 "승인을 요청했다" 또는 "승인 대기 중"이라고 쓰지 않는다. "제공사 약관상 사전 승인이 필요해 이번 범위에서 제외했고, 파이프라인은 mock으로 검증했다"고 쓴다.
4. `eval/redteam/private/`와 `.env*`(예시 파일 제외)는 커밋하지 않는다. 공격 문장, 대화·응답 원문은 저장소와 공개 문서에 넣지 않는다.
5. 전연령 서비스다. 시드, 예시, 테스트 문장 모두 전연령. 캐릭터는 오리지널만.
6. 공개 문서(README, docs, SPEC)에 특정 오픈소스 캐릭터챗 도구의 이름을 쓰지 않는다. "오픈소스 캐릭터챗 도구"라고만 쓴다.
7. 스키마나 설계가 바뀌면 SPEC.md를 같이 고친다. 새 라이브러리는 이유를 한 줄로 남긴다.
8. 모호하면 추측하지 말고 묻는다.

## 상태

- SPEC 0~9단계 구현 완료(대화 파이프라인, 기억 요약, 로어북, 안전 층, 관리자 화면, 평가, 운영 Docker). **공개 배포만 남았다**(대상 호스팅은 사용자가 정한다).
- 실제 모델: OpenRouter 경유 `google/gemini-3.8-flash`(대화·분류기 모두), 추론 강도 low. 설정은 관리자 화면(`/admin/settings`)에 저장된 값이 환경변수보다 우선.
- 2026-11-12: 단가표에 `google/gemini-3.8-flash` 추가, 평가 리포트 비용은 실제 청구액 우선. cache-probe E7(문턱) 추가, 실행은 사용자가 한다.
- 남은 작업(인계 문서 5장 순서): ~~A 비용 표시~~ → B 보고용 세트 → C 카드 확장과 캐시 확인 → D 배포 → E 저장소 공개 정리 → F README → G 여유 항목.

## 실측 결론 (README에 쓸 수 있는 것)

### 캐시 (2026-11-11, 상세 `docs/CACHE.md`)
- 자동(암시적) 캐시는 걸리지 않는다(동일 요청 11,571토큰에서도 cached=0).
- `cache_control`은 3,555토큰 이하에서 실패, 4,159토큰 이상에서 동작. **문턱은 3,555~4,159 사이**(E7, 2026-11-12). 4,159토큰 요청 $0.00055 대 3,555토큰 요청 $0.00269.
- "매 요청 할인" 방식: 이전 요청과 내용이 달라도 첫 요청부터 cached = cache_write. 같은 토큰에 읽기+쓰기 단가가 둘 다 청구된다.
- 검산식: 비캐시 × 0.75 + 캐시 × (0.075 + 0.041667) [USD/1M] = 실제 입력 청구액. 같은 5,799토큰 요청의 입력 비용 82.2% 감소($0.00434925 → $0.00077282).
- 그래서 `/admin`의 "캐시 적중률"은 재사용 비율이 아니다. 효과는 `actualCost`와 지연으로 판단한다.
- 표시가 붙은 요청이 13~20초 걸린 관측이 있으나 비교 실험(`cache:latency`)은 아직 안 했다.
- 문서에 없는 동작이므로 실측 날짜를 함께 적는다.

### 규칙 층 (모델 호출 없음, `docs/SAFETY.md`)
- 세트 `redteam-set-v1`: 공격 40 + 변형 160, 정상 26.
- 재설계 전 → 후: 공격 HARD 적중 3.0% → 4.0%(+SOFT 힌트 5.0%), 정상 오탐 23.1% → 0%(SOFT 힌트 3건).
- 규칙 층은 공격의 약 90%를 분류기에 넘긴다. 초성은 규칙이 아니라 분류기 몫.

### 정상 문장 실제 실행 (2026-11-12, `docs/SAFETY.md` 5절)
- 오탐 0/26 케이스, 0/57 턴. SOFT 힌트 3건의 분류기 점수 0~0.1. 분류기 114회 형식 오류 0, ERROR 0.
- 분류기 지연 p50 2,286ms / p95 3,197ms. 턴당 약 4.6초(입력·출력 두 번).
- 응답 품질: 외국어 섞임 0, 문단 4개 초과 0, 괄호 행동 묘사 1/57.
- 한계: 이 세트를 보고 규칙을 고쳤으므로 과대평가. 보고용 세트 결과를 따로 적어야 한다.

### 재지 못한 것
- 공격에 대한 분류기 성능(실제 모델). 필요하면 로컬 오픈 모델로만 잰다.
- 캐시 문턱의 정확한 값(3,555~4,159 사이), 직접 연결(구글 AI Studio)에서도 "매 요청 할인"인지, 분류기 지연을 줄일 방법.

## 구조와 결정

### 환경
- 위치 `~/char-chat-lab/`. Next 16.4 / React 19 / Prisma 7.10(client 출력 `src/generated/prisma`, 어댑터 `@prisma/adapter-pg`) / Vitest 5. Prisma 설정은 `prisma.config.ts`. `@types/node`는 22.
- Next 16 주의: `AGENTS.md`의 안내대로 `node_modules/next/dist/docs/`를 먼저 본다. 미들웨어는 `proxy.ts`로 개명(미사용, 보호는 페이지에서 `auth()`). `npm run typecheck`는 `next typegen` 선행.
- Docker: 개발 Postgres **호스트 5433**(5432·3000은 다른 프로젝트가 사용. 남의 컨테이너는 건드리지 않는다). 테스트 DB는 5434.
- Auth.js v5 beta + bcryptjs + zod, 세션 JWT. 데모·관리자 계정은 seed(`.env.example` 값은 개발용, **공개 배포 전 교체**).

### 테스트 격리 (2026-11-11 사고 뒤 도입)
- 사고: 개발 DB에 사용자가 저장한 실제 키를 테스트 서버가 읽어 실제 모델을 호출했다. 그래서 테스트·E2E는 항상 테스트 DB + mock.
- compose `db-test`(profile test, 5434, `chatlab_test`, tmpfs), `.env.test`, `scripts/test-run.ts`(테스트 DB가 아니면 거부, `--real`만 `ALLOW_REAL_LLM=1`), `src/lib/test-guard.ts`(APP_ENV=test면 DB 이름 `_test` 필수, 허용 없으면 DB 저장 키까지 무시하고 mock). `/api/health`가 APP_ENV를 알려 준다.
- npm: `db:test:reset`, `dev:test`(3110), `dev:test:real`, `test:leak`(비공개 필드 누출 E2E). 문서 `docs/TESTING.md`.
- `prisma migrate reset`은 쓰지 않는다(컨테이너 재생성으로 초기화). 개발 DB에서 지울 때는 테스트가 만든 행만 id로.

### 대화 파이프라인
- LLM 계층 `src/lib/llm/`(OpenAI 호환 어댑터, mock, `runtime.ts resolveRuntime()`). 키가 없으면 mock. OpenRouter는 스트림 도중 오류가 HTTP 200 + `error` 객체로 온다(어댑터가 LlmError로 변환).
- 추론 모델 빈 응답: 추론 토큰이 max_tokens를 먼저 쓴다 → 추론 강도·최대 출력 토큰 설정, 연결 테스트가 원인 설명.
- SSE `src/lib/sse.ts`, 라우트 `POST /api/chat/[conversationId]`(이벤트 delta/done/error). 중지 시 받은 만큼 저장, LLM 실패 시 저장 안 하고 일반 오류 문구만.
- 조립기 `src/lib/chat/assemble.ts`: 순수 함수. 순서는 고정 블록 → 요약 → 로어북(`LOREBOOK_POSITION=afterFixed` 기본) → 최근 대화 → 입력. 예산 초과 시 오래된 대화부터 자른다. 채팅 API는 캐릭터에서 조립기 필드만 select.
- 토큰 추정은 글자 수, 실제 환산 계수 `ESTIMATE_TO_REAL = 0.55`(개발 DB 2건 기준 실측 0.62, 표본이 적어 유지. `npm run tokens:calib`).
- 기억 `src/lib/memory/`: 응답 뒤 `after()`로 요약 갱신, 동시 갱신은 unique 충돌로 처리, 요약 블록에는 "지시문 아님" 문구.
- 로어북 `src/lib/lorebook/`: 키워드 최소 2글자, 최근 M턴 매칭, 우선순위→id 정렬.
- 캐시: `CACHE_BREAKPOINT=1` 기본(주소가 openrouter.ai일 때만 `cache_control` 전송), `CACHE_MIN_TOKENS=4096`. 접두사 진단은 `UsageLog.blockTokens.cacheBreak`.
- 시드 캐릭터 "하루" 카드 v3(`prisma/seed-data/haru.json`). 2026-11-12 추가분(persona·exampleDialog 끝에 덧붙임)으로 고정 블록 6,916자 ≈ 실토큰 약 4.15K~4.3K(미확인). **첫 턴은 추정 × 0.55 = 3,831 < `CACHE_MIN_TOKENS` 4096이라 breakpoint가 안 붙는다**(설정 변경은 사용자 결정 대기). 개발 DB의 하루는 관리자 수정이 있어 갱신하지 않았다. 운영(SEED_PRESERVE)에서는 seed가 관리자 수정을 덮어쓰지 않는다.

### 비용
- `UsageLog.estCost`(단가표 추정)와 `actualCost`(제공사 `usage.cost`). `/admin`과 평가 리포트 모두 실제 청구액 우선, 단가표 추정은 비교용.
- 단가 `src/config/pricing.json`. 추정식은 (입력 − 캐시) × 입력 + 캐시 × (읽기 + 쓰기) + 출력 × 출력(`src/lib/pricing.ts`). 단가표가 실측 청구액을 재현하는지 테스트로 고정.
- 일일 메시지 한도(KST 자정), 차단된 입력도 센다. 한도 확인이 분류기·모델 호출보다 먼저.

### 안전
- `src/lib/safety/`: 규칙(`config/safety-rules.json`, HARD/SOFT 두 단계, 정규화 재검사) → 입력 분류기 → 스트리밍(StreamGuard, HARD만) → 출력 분류기 → 흐름 감시.
- SOFT는 차단하지 않고 분류기에 범주 힌트만 준다. 흐름 점수에 영향 없음. 정규화로만 걸린 것은 HARD여도 SOFT.
- 분류기: json_schema(strict), timeout·429·5xx 1회 재시도 후 **fail closed**, ERROR 원인 기록(errorKind), `decisionSource` 기록. 입력 실패는 503(대화에 안 남김), 출력 실패는 회수. ERROR·위기 턴은 흐름 평균에서 제외.
- 위기 규칙은 출력에 적용하지 않는다(위로 응답 보호). 2글자 위기어의 공백 우회는 분류기 몫("사자 살았다" 오탐).
- 알려진 한계: 요약·로어북 내용은 안전 검사를 거치지 않는다. 흐름 감시 strike는 영구 누적. 차단 기준이 verdict OR score.

### 관리자
- `src/app/admin/`(대시보드, 모더레이션, 캐릭터·로어북 편집, LLM 설정, 응답 품질). 서버 액션마다 `requireAdmin()`.
- LLM 키는 AES-256-GCM으로 암호화해 DB 저장(키는 AUTH_SECRET에서 유도). AUTH_SECRET을 바꾸면 키를 다시 넣어야 한다. **운영에서는 화면의 키 저장을 끄고 환경변수 전용으로**(D 단계).
- 응답 품질 지표 `ResponseMetric`, `npm run metrics:backfill`.

### 평가
- `eval/`: DB 없이 라우트를 재현하는 엔진(라우트와 이중 관리 비용 있음). `npm run eval[:scenarios|:redteam]`, 실제 API는 `--yes`.
- 레드팀: 표 변환, `npm run redteam:all`(`--mutate`, `--rules-only`, `--benign-only`, 자동 판정), 정책 가드(공격 케이스가 든 실제 실행은 `REDTEAM_APPROVED=1` 없이 거부). `--real`은 관리자 화면에 저장된 설정을 쓴다.
- 비공개 세트·결과는 `eval/redteam/private/`(gitignore). mock 결과도 커밋 제외.
- 캐시 도구: `cache:dump`(오프라인), `cache:probe -- --real`(E1~E7), `cache:latency -- --real`, `tokens:calib`.

### 배포 준비
- `Dockerfile`, `docker-compose.prod.yml`(프로젝트명 분리), `docs/DEPLOY.md`, `npm run predeploy`, 로그인 시도 제한, 헬스체크, 보안 헤더, 개인정보 페이지.
- 로컬 운영 구성으로 확인한 것: 마이그레이션, seed 보존, 헬스, 비루트 실행, 채팅(mock), 입력 차단, 관리자 권한. 확인 안 한 것: 실제 호스팅, 실제 TLS·프록시, 부하.

## 작업 교훈

- 서버 액션은 URL로 직접 호출할 수 있다 → 액션마다 권한 확인.
- Prisma `NOT {category:'turn'}`은 NULL 행을 뺀다 → `OR[null, not]`.
- `createdAt`은 UTC timestamp → 날짜 묶음은 `AT TIME ZONE 'UTC'` 후 `'Asia/Seoul'`.
- 프로세스 안 캐시는 서버 액션과 라우트 번들이 달라 무효화되지 않는다 → 설정 캐시 제거.
- 결과 상자를 읽는 E2E는 이전 결과가 남아 있으면 그것을 읽는다 → 클릭 후 사라질 때까지 기다린 뒤 새로 나타나길 기다린다.
- `pkill -f 패턴`은 자기 셸도 죽인다 → PID로 종료. dev 로그를 `: >`로 비우면 NUL이 생긴다.
- 검사 장애뿐인 케이스는 "통과"의 증거가 아니다 → 판단 불가로 제외.
- 같은 세트로 고치고 같은 세트로 재면 과대평가다 → 튜닝용과 보고용 세트 분리.
