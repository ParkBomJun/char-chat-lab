# 캐릭터챗 서비스 — 개발 명세 (SPEC)

> 이 문서는 Claude Code 작업 기준서다. 작업 전 반드시 전체를 읽고, **한 번에 한 단계만** 진행한 뒤 멈추고 보고한다.
> 가칭: `char-chat-lab` (이름은 나중에 바꿀 수 있음)

---

## 1. 목표

전연령 **소비자용 AI 캐릭터챗 웹 서비스**를 만든다. 화면은 단순하게, 핵심은 뒤쪽 **대화 파이프라인**이다.

- 사용자는 API 키 없이 가입 후 바로 대화한다.
- 서버가 LLM을 호출하고, 기억·캐싱·안전·비용을 서버에서 관리한다.
- 포트폴리오 목적: "고급 사용자가 손으로 하던 프롬프트 관리(기억 요약, 로어북, 캐싱)를 일반 사용자 서비스에서 자동화하고, 안전장치와 비용 관리를 붙였다"를 **숫자로** 보여준다.

### 원칙
- **전연령 전용.** 성인 모드 없음. 시드 데이터, 예시, 테스트 대화 모두 전연령.
- 캐릭터는 **오리지널만** 사용. 기존 IP 캐릭터 금지.
- 다른 오픈소스 캐릭터챗 프론트엔드의 코드를 복사하지 않는다. 직접 구현한다.
- 실사용자 데이터는 없다. 검증은 **공개 배포 + 시뮬레이션 + 공격 테스트**로 한다. 결과에는 항상 실측(실제 모델 호출)인지 시뮬레이션(mock·가짜 서버·모델 호출 없는 평가)인지 명시한다.

---

## 2. 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js (App Router), TypeScript strict |
| DB | PostgreSQL + Prisma ORM |
| 로컬 DB | docker compose로 Postgres 실행 |
| 인증 | Auth.js (credentials, bcrypt 해시) |
| LLM 호출 | 제공사 어댑터 인터페이스 뒤에 구현. 1단계는 제공사 1곳만 (기본: OpenAI 호환 API — 환경변수로 base URL, 키, 모델 지정) |
| 스트리밍 | Route Handler + SSE |
| 테스트 | Vitest (프롬프트 조립기, 안전 파이프라인, 기억 요약 로직은 필수) |
| UI 언어 | 한국어 |

- 비밀값은 `.env`에만. `.env.example`을 유지하고 키는 절대 커밋하지 않는다.
- 제공사별로 캐싱 방식이 다르다(자동 적용 / 명시적 표시). 어댑터에 `supportsExplicitCache` 같은 플래그를 두고, 응답에서 캐시된 입력 토큰 수를 읽을 수 있으면 기록한다.

---

## 3. 대화 파이프라인

### 3-1. 한 턴의 흐름

```
사용자 입력
  → [일일 사용량 확인] 초과 시 거절
  → [입력 안전 검사] 차단 시 안내 메시지, 모델 호출 안 함
  → [프롬프트 조립]
  → [LLM 호출, 스트리밍]
  → [출력 안전 검사]
  → 화면 표시 + 저장
  → [사용량 기록]
  → [필요 시 기억 요약 갱신 — 응답 후 비동기]
```

### 3-2. 프롬프트 조립 순서 (캐싱 기준)

앞에서부터 **덜 바뀌는 것 → 자주 바뀌는 것** 순서로 쌓는다. 캐시는 앞부분이 완전히 같아야 적용되기 때문이다.

1. **고정 블록** — 시스템 프롬프트(안전 지시 포함) + 캐릭터 카드(성격, 말투, 예시 대화). ← 캐시 대상
2. **기억 요약** — 가끔 갱신됨
3. **로어북 항목** — 이번 턴에 키워드로 걸린 것만
4. **최근 대화** — 최근 N턴 원문
5. **이번 사용자 입력**

- 조립기는 순수 함수로 만든다: `(character, summary, lorebookHits, recentMessages, userInput, config) → messages[]`
- 각 블록의 토큰 수를 추정해서 반환값에 포함한다(사용량 기록과 디버깅용).
- 전체 토큰 예산을 넘으면 4번(최근 대화)의 오래된 턴부터 잘라낸다. 1번은 절대 자르지 않는다.
- **트레이드오프 기록**: 로어북을 앞쪽에 두면 반영은 강해지지만 캐시가 깨진다. 1단계는 위 순서로 고정하고, 2단계에서 배치를 바꿔 비교 실험한다.
  - *5단계 관측(시뮬레이션, 가짜 서버 7턴)*: 걸린 로어북이 바뀐 턴(3번)마다 이전 요청의 접두사 중 고정 블록 1개만 재사용되고 그 뒤 대화 전체의 캐시가 무효화됐다. 로어북이 그대로인 턴(1→2, 2→3, 3→4)은 전체 접두사가 유지됐다.

### 3-3. 기억

- 최근 `RECENT_TURNS`(기본 20)턴은 원문으로 프롬프트에 넣는다.
- 그보다 오래된 턴은 요약으로 압축한다. 요약은 `SUMMARY_EVERY`(기본 10)턴마다 갱신한다.
- 요약 갱신은 응답을 사용자에게 보낸 **뒤에** 비동기로 실행한다(응답 속도 보호).
- 요약 갱신은 캐시를 깨므로 너무 자주 하지 않는다. 갱신 횟수도 기록한다.
- 요약에는 버전을 남긴다(어떤 메시지 범위까지 요약했는지).

### 3-4. 로어북

- 캐릭터별 항목: `키워드 목록`, `내용`, `우선순위`, `활성 여부`.
- 최근 M턴(기본 4)의 사용자·캐릭터 메시지에서 키워드가 나오면 해당 항목을 넣는다.
- 로어북 블록에도 토큰 예산을 둔다. 넘치면 우선순위 낮은 것부터 뺀다.

### 3-5. 안전 파이프라인 (핵심 기능)

세 층으로 나눈다. 분류기는 대화 모델과 **별개의 호출**이다.

1. **입력 검사** — 사용자 메시지를 모델에 보내기 전에 검사.
   - 규칙 층: 키워드·정규식 (빠르고 싸다)
   - 분류기 층: 저가 모델에 JSON 스키마로 판정 요청 → `{ verdict: allow|block, category, score, reason }`
2. **출력 검사** — 생성된 응답을 검사.
   - 스트리밍 중: 각 청크에 규칙 층만 적용
   - 생성 완료 후: 분류기 층 적용. 차단이면 이미 보낸 메시지를 **회수**하고 안내로 교체
   - 이 방식(속도 vs 안전)의 트레이드오프를 README에 적는다
3. **대화 흐름 감시** — 한 턴만 보면 괜찮아도 여러 턴에 걸쳐 수위가 올라가는 경우를 잡는다.
   - 대화별로 최근 N턴의 분류 점수를 누적. 기준을 넘으면 경고 → 반복되면 대화 중단

공통 규칙:
- **분류기 실패 시 막는다(fail closed).** 타임아웃·오류면 차단 처리하고 로그를 남긴다. (참고: 모델 라우팅 분류기는 실패 시 통과가 맞지만, 안전 분류기는 반대다. README에 이 차이를 적는다.)
- **위기 표현 감지**: 자살·자해 관련 표현이 감지되면 롤플레이를 멈추고 도움받을 수 있는 곳(예: 자살예방상담 109)을 안내한다.
- 페르소나 지시("캐릭터를 벗어나지 마라")가 안전 지시보다 우선하지 않도록, 시스템 프롬프트에서 안전 지시를 최상위로 둔다.
- 모든 판정은 `ModerationEvent`로 남긴다(차단뿐 아니라 통과 점수도 — 오탐 분석용).
- 분류기 프롬프트와 판정 기준은 한국어 입력을 전제로 만들고, 한국어에서 실제로 동작하는지 평가 세트로 확인한다.

### 3-6. 비용과 사용량

- 매 턴 `UsageLog` 기록: 모델, 입력 토큰, 캐시된 입력 토큰, 출력 토큰, 추정 비용(단가표 기반, 비교용)과 실제 청구액(제공사 `usage.cost`가 있을 때만), 지연 시간(첫 토큰까지 / 전체), 분류기 호출 비용 포함.
- 모델 단가는 설정 파일에 두고 코드에 박지 않는다(단가는 사용자가 직접 확인해서 입력).
- 사용자별 하루 메시지 수 제한 `DAILY_MESSAGE_LIMIT`(기본 50). 초과 시 안내.

---

## 4. DB 구조 (Prisma 초안)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  role         Role     @default(USER)   // USER | ADMIN
  tier         Tier     @default(FREE)   // FREE | PRO, 2단계 라우팅용
  createdAt    DateTime @default(now())
  conversations Conversation[]
}

model Character {
  id            String   @id @default(cuid())
  name          String
  tagline       String
  persona       String   // 성격·배경
  speechStyle   String   // 말투 규칙
  exampleDialog String   // 예시 대화
  greeting      String   // 첫 인사
  isPublished   Boolean  @default(true)
  lorebook      LorebookEntry[]
  conversations Conversation[]
  createdAt     DateTime @default(now())
}

model LorebookEntry {
  id          String   @id @default(cuid())
  characterId String
  character   Character @relation(fields: [characterId], references: [id])
  keywords    String[]
  content     String
  priority    Int      @default(0)
  enabled     Boolean  @default(true)
}

model Conversation {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  characterId String
  character   Character @relation(fields: [characterId], references: [id])
  status      ConvStatus @default(ACTIVE) // ACTIVE | WARNED | STOPPED
  riskScore   Float    @default(0)        // 대화 흐름 감시 누적 점수
  messages    Message[]
  summaries   MemorySummary[]
  createdAt   DateTime @default(now())
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  role           MsgRole  // USER | ASSISTANT | SYSTEM_NOTICE
  content        String
  retracted      Boolean  @default(false) // 출력 검사로 회수된 경우
  createdAt      DateTime @default(now())
}

model MemorySummary {
  id             String   @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  content        String
  coversUntilMsg String   // 어느 메시지까지 요약했는지
  version        Int
  createdAt      DateTime @default(now())
}

model UsageLog {
  id               String   @id @default(cuid())
  userId           String
  conversationId   String
  kind             UsageKind // CHAT | SUMMARY | CLASSIFIER
  model            String
  inputTokens      Int
  cachedInputTokens Int     @default(0)
  outputTokens     Int
  estCost          Decimal  // 단가표 기반 추정(비교용)
  actualCost       Decimal? // 제공사 usage.cost(실제 청구액). 있으면 /admin 비용 표시에서 우선
  ttftMs           Int?     // 첫 토큰까지
  totalMs          Int
  createdAt        DateTime @default(now())
}

model ModerationEvent {
  id             String   @id @default(cuid())
  conversationId String
  messageId      String?
  stage          ModStage  // INPUT | OUTPUT_STREAM | OUTPUT_FINAL | CONVERSATION
  layer          ModLayer  // RULE | CLASSIFIER
  verdict        Verdict   // ALLOW | BLOCK | ERROR
  category       String?
  score          Float?
  action         String    // none | blocked | retracted | warned | stopped | crisis_notice
  decisionSource String?   // 분류기 차단일 때만: VERDICT_ONLY | SCORE_ONLY | BOTH (차단 규칙은 verdict=block OR score ≥ 임계값)
  errorKind      String?   // verdict=ERROR일 때만: http_status | provider_filter | parse_error | timeout (분류 불가면 NULL)
  responseLength Int?      // errorKind=parse_error일 때만 응답 모양(원문은 저장하지 않음): 글자 수 /
  startsWithBrace Boolean? //   '{' 시작 여부 /
  hasCodeFence   Boolean?  //   코드펜스 포함 여부 /
  hasRefusalPattern Boolean? // 거절·사과 표현 포함 여부. parse_error는 재시도하지 않는다(데이터를 먼저 본다)
  httpStatus     Int?      // HTTP 응답을 받은 경우의 상태 코드
  finishReason   String?   // 분류기 응답의 finish_reason(코드값만). content_filter 등은 provider_filter로 기록
  createdAt      DateTime @default(now())
}
```

필요하면 enum과 인덱스는 구현하면서 정리한다. 스키마를 바꾸면 이 문서도 같이 고친다.

> **구현 반영 (1단계)** — 실제 스키마는 `prisma/schema.prisma`. 위 초안과 다른 점:
> - `Tier`는 `FREE | PRO`. 모든 enum 정의, 조회용 인덱스(`Message(conversationId, createdAt)`, `UsageLog(userId, createdAt)` 등) 추가.
> - 부모 삭제 시 자식도 삭제(`onDelete: Cascade`): User→Conversation, Conversation→Message/MemorySummary, Character→LorebookEntry. (UsageLog·ModerationEvent는 분석용이라 관계 없이 id만 보관)
> - `MemorySummary`에 `@@unique([conversationId, version])`. `coversUntilMsg`는 `Message.id`.
> - (3단계) `UsageLog`에 `usageEstimated Boolean`(제공사 usage가 없어 글자 수로 추정한 행), `blockTokens Json?`(조립기의 블록별 추정 토큰) 추가.
> - (4단계) 기억 구현 규칙: 최근 대화 = 최신 요약이 덮지 않은 메시지 전부. 원문 턴이 `RECENT_TURNS + SUMMARY_EVERY`(기본 30)가 되면 가장 오래된 `SUMMARY_EVERY`(10)턴을 요약에 합치고 `coversUntilMsg`를 그 마지막 메시지로 옮긴다(턴 경계에서만 끊음). 요약 갱신 사이에는 프롬프트 앞부분이 변하지 않아 캐시가 이어지고, 갱신 시점에만 한 번 깨진다. 요약 호출은 `LLM_CLASSIFIER_MODEL`(없으면 대화 모델), `UsageLog.kind=SUMMARY`.
> - (5단계) 로어북 매칭 규칙: 최근 `LOREBOOK_SCAN_TURNS`(4)턴의 사용자·캐릭터 메시지(이번 입력 포함)에서 **공백 제거·대소문자 무시 부분 문자열**로 비교(한국어 조사 때문에 단어 경계는 쓰지 않음). 공백 제외 2글자 미만 키워드는 매칭에서 무시하고 등록(seed·7단계 관리자)에서도 거절. 결과는 우선순위 내림차순·id 순으로 고정(출력 안정성). 걸린 항목 id는 `UsageLog.blockTokens`의 `lorebookIds`에 기록.
> - (6단계) 안전 파이프라인 구현 규칙 — 코드는 `src/lib/safety/`, 규칙 목록은 `src/config/safety-rules.json`(초안, 검토 필요).
>   - `ModerationEvent.action`에 `strike`(경고 이후 반복 위반) 추가. 판정 기록에는 사용자 원문을 저장하지 않는다(카테고리·점수만).
>   - 입력: 규칙(위기 > 차단) → 분류기. 정책 위반 입력은 `Message.retracted=true`로 저장(이후 프롬프트·요약·로어북·화면에서 제외), 위기 표현은 사용자 말을 남기고 109 안내(롤플레이 중단, 모델 호출 없음, 흐름 점수 0). 분류기가 `self_harm`으로 판정해도 위기 안내로 처리.
>   - 출력: 스트리밍 중 규칙 층(누적 텍스트에 적용해 청크 경계 우회 방지, 위기 규칙은 출력에 미적용) → 완료 후 분류기. 차단·검사 실패면 응답을 처음부터 `retracted=true`로 저장하고 `retract` 이벤트로 화면의 말풍선을 안내문으로 교체. 판정 후 저장하므로 회수 대상은 어떤 경로로도 이후 프롬프트에 들어가지 않는다.
>   - fail closed: 분류기 타임아웃·오류·JSON 스키마 위반은 모두 차단. 입력 단계 실패는 HTTP 503(대화에 아무것도 남기지 않고 재시도 가능), 출력 단계 실패는 회수. 모두 `verdict=ERROR` 이벤트이며 원인(`errorKind`·`httpStatus`·`finishReason`)을 남긴다(원문은 저장하지 않음). 제공사 안전 필터(`finish_reason=content_filter` 등)로 거부된 호출은 `provider_filter`. 평가 리포트에서 ERROR는 차단으로 세지 않고 별도 열로 집계한다. 일시적 장애(timeout·429·5xx)는 짧은 대기 뒤 1회 재시도하고(`CLASSIFIER_RETRIES`), 그래도 실패하면 fail closed. 입력·출력 ERROR 턴은 흐름 감시의 위반 횟수와 평균 어디에도 넣지 않는다.
>   - 흐름 감시: 턴 점수 = max(입력 점수, 출력 점수)를 `ModerationEvent(stage=CONVERSATION, category=turn)`로 기록. 마지막 경고/위반 이후 최근 `FLOW_WINDOW_TURNS`(5)턴 평균이 `FLOW_WARN_THRESHOLD`(0.5) 이상이면 경고(최소 `FLOW_MIN_TURNS`(2)턴), 경고 뒤에는 1턴만으로도 위반(strike), `FLOW_STOP_STRIKES`(2)회면 `STOPPED`. 경고·위반이 나면 윈도우를 비워 행동을 고친 사용자가 과거 점수로 연달아 걸리지 않게 한다. 위기·검사 불가 턴은 0점.
>   - 분류기 호출도 `UsageLog(kind=CLASSIFIER)`로 비용 기록.
> - (7단계) 일일 사용량: 오늘(KST 자정 기준) 사용자가 보낸 `Message(role=USER)` 수로 센다. **차단·회수된 입력도 센다**(차단 메시지를 반복해 분류기 비용을 쓰게 하는 공격 방지). 한도 확인은 분류기·모델 호출보다 먼저, 초과 시 HTTP 429. 분류기 실패(503)로 메시지가 저장되지 않은 시도는 세지 않는다. 남은 수는 `X-Daily-Remaining` 응답 헤더와 채팅 화면에 표시. 관리자도 같은 한도를 받는다.
> - (7단계) 관리자: `/admin`(요약), `/admin/moderation`(판정 로그: 단계·판정·카테고리 필터, 턴 점수 행은 기본 숨김), `/admin/characters`(캐릭터·로어북 편집). 권한은 레이아웃·페이지·**모든 서버 액션**이 각각 DB의 현재 역할을 확인하고, 관리자가 아니면 404. 캐시 적중률은 제공사 usage가 있는 대화 행만으로 계산(추정 행 제외). 캐릭터 삭제는 대화 이력 보존을 위해 지원하지 않고 비공개로 전환한다. 관리자 계정은 seed가 `ADMIN_EMAIL`/`ADMIN_PASSWORD`로 생성.
> - (8단계) 평가: `eval/` — 실행 방법·파일 형식·지표 정의는 `eval/README.md`. 서비스 라우트의 파이프라인을 DB 없이 같은 순수 함수·어댑터로 재현하는 엔진(`eval/lib/engine.ts`)이라 라우트 변경 시 같이 고쳐야 한다. 시나리오는 요약 없음(전체 원문) 대 서비스 설정을 비교하고, 레드팀은 케이스 단위(차단·위기·통과 기대)로 차단율·오탐률(Wilson 95% 구간)·최초 개입 단계 분포를 낸다. 실제 API 호출은 `--yes` 없이는 시작하지 않고, mock 결과는 `*-mock.*`로 저장·커밋 제외.
> - (9단계) 배포 준비: `RateLimitEvent`(scope·key·createdAt) 추가 — 로그인 실패(이메일+IP 15분 5회, IP 15분 20회)와 가입(IP 1시간 10회) 제한. IP는 X-Forwarded-For의 오른쪽에서 `TRUST_PROXY_HOPS`번째(맨 앞 값은 위조 가능). `/api/health`, `/privacy`, 보안 헤더, `output: "standalone"`, `Dockerfile`(runner/migrate 타깃)·`docker-compose.prod.yml`(프로젝트명 분리), `npm run predeploy`, 운영 seed 보존 모드(`SEED_PRESERVE=1`). 절차는 `docs/DEPLOY.md`. 실제 공개 URL 게시는 호스팅 대상 미정으로 보류.
> - (추가) 관리자 LLM 설정: `AppSetting(key, value, updatedAt)` 테이블. `/admin/settings`에서 API 주소·키·모델·구조화 출력 여부·단가를 입력하면 DB에 저장(키는 AES-256-GCM, 암호화 키는 `AUTH_SECRET`에서 유도, 화면에는 끝 4자리만). 해석 우선순위는 화면 설정 > 환경변수 > mock이며 `resolveRuntime()`이 요청마다 DB의 기본키 한 줄을 읽어 어댑터·분류기·단가를 만든다(프로세스 캐시는 서버 액션과 라우트의 번들이 달라 무효화가 전달되지 않아 쓰지 않음). 저장 전 연결 테스트가 대화 모델 응답과 분류기 JSON 형식을 실제 호출로 확인한다(형식이 틀리면 fail closed로 모든 입력이 막히므로).
> - (추가) OpenRouter 호환: 주소 `https://openrouter.ai/api/v1`(채팅은 `/chat/completions`), 모델은 `제공사/모델` 형식. 스트림 도중 HTTP 200 위의 최상위 `error` 청크를 오류로 처리(삼키면 빈/잘린 응답이 됨). 구조화 출력은 모델·endpoint 단위로 지원이 달라 미지원이면 요청이 실패하므로 OpenRouter 프리셋은 기본 off. 설정 화면에 OpenAI/OpenRouter 프리셋과 잘못된 OpenRouter 주소 힌트.
> - (추가) 추론 모델 대응: 대부분의 제공자에서 출력 토큰 한도(max_tokens)가 추론+본문을 합쳐 적용되어, 한도가 작으면 `finish_reason=length`와 빈 본문이 온다. 설정에 `reasoningEffort`(""=보내지 않음 | none | minimal | low | medium | high, 모든 요청에 `reasoning:{effort}`로 전송 — OpenRouter 규약)와 `maxOutputTokens`(0=MAX_OUTPUT_TOKENS)를 추가. 어댑터는 추론 내용을 사용자에게 보내지 않고 글자 수와 finish_reason만 `done.meta`로 돌려 빈 응답 원인을 설명(`explainEmptyResponse`). 연결 테스트는 실제 대화와 같은 한도·추론 강도로 시험한다(이전에는 32토큰 고정이라 추론 모델이 항상 실패).
> - (추가) 실제 청구액: `UsageLog.actualCost Decimal?`(마이그레이션 `20261111060000_usage_actual_cost`). OpenRouter가 주는 `usage.cost`를 그대로 저장하고, `estCost`(단가표 추정)는 비교용으로 유지. `/admin` 비용 표시는 행 단위로 `coalesce(actualCost, estCost)`를 우선 사용(기존 행은 actualCost=NULL이라 추정값). `pricing.json`에 선택 항목 `cacheWritePer1M`(캐시 쓰기 단가, 없으면 0)을 두고 추정에 반영한다. 2026-11-11 실측(OpenRouter+Gemini, `docs/CACHE.md`): `cache_control`을 쓰면 첫 요청부터 cached = cache_write이고 같은 토큰에 읽기+쓰기 단가가 모두 청구되므로 추정식도 그렇게 계산한다. 관리자 LLM 설정 화면에는 아직 이 항목 입력란이 없다.
> - (추가) 카드 저장 시 안전 검사: 관리자 화면의 캐릭터·로어북 저장과 seed가 persona·speechStyle·exampleDialog·greeting·로어북 본문에 규칙 층을 적용한다(모델 호출 없음). HARD면 저장 거부, SOFT면 경고 후 저장. 카드 전용 규칙은 `src/config/card-rules.json`, 구현 `src/lib/safety/card-check.ts`, `src/lib/admin/card-save.ts`. 통합 테스트 `npm run test:card`.
> - (추가) 명시적 캐시 기본 켬: `CACHE_BREAKPOINT` 기본 1(이번 입력 직전의 마지막 안정 메시지에 cache_control, 앞부분 환산 3500토큰 미만이면 생략(`CACHE_MIN_TOKENS`, 실측 문턱 3,555~4,159 아래로 잡음), 주소가 openrouter.ai일 때만 전송), 로어북 위치 `LOREBOOK_POSITION` 기본 afterFixed. 도구: `npm run tokens:calib`(실제 prompt_tokens와 조립기 추정 비교, 호출 없음), `npm run cache:latency -- --real`(끔/켬 지연·비용 비교).
> - (추가) 규칙 층 두 단계(HARD/SOFT): `safety-rules.json`의 각 항목에 `tier`를 둔다. **HARD**는 바로 차단·위기 안내(명백한 본인 위기 표현, 명시적 요구만), **SOFT**는 차단하지 않고 `ModerationEvent`에 `verdict=ALLOW`, `action=soft_hint`로 기록한 뒤 분류기 프롬프트에 `규칙 힌트: <범주>`를 붙인다(위기어 힌트는 `self_harm`). 원문에서 안 걸린 글은 깊은 정규화(공백·특수문자 제거, 자모 결합, 숫자·영문 치환 복원, 3번 이상 반복 글자 접기) 후 모든 규칙에 다시 맞추고, **정규화로만 걸린 것은 HARD 항목이어도 항상 SOFT**(`action=soft_hint_normalized`). SOFT는 흐름 감시 점수·위반 횟수에 영향을 주지 않는다(턴 점수는 분류기 점수로만 정해짐, 테스트로 고정). 출력의 SOFT는 스트리밍을 끊지 않고 출력 분류기에 힌트로 넘기며 스트리밍 중 검사는 HARD만 본다. 분류기 시스템 프롬프트에 "규칙 힌트는 참고 신호일 뿐 판정이 아니다"를 추가. 초성 표기는 규칙에 넣지 않고 분류기가 맡는다. 분류표·근거·전후 측정은 `docs/SAFETY.md`. 스키마 변경 없음(`action`은 문자열).
> - (추가) 레드팀 정책 가드: OpenRouter는 승인 없는 레드팀을 금지하므로(https://openrouter.ai/docs/cookbook/evaluate-and-optimize/red-teaming) 공격 케이스가 하나라도 들어간 **실제** 평가 실행(`redteam:all --real`, 키가 있는 `eval:redteam`)은 `REDTEAM_APPROVED=1` 없이는 시작을 거부한다(종료 코드 3). 승인 없이 가능한 모드: `redteam:all --rules-only [--mutate]`(모델 호출 없이 입력 규칙 층만 평가: 범주·기법·변형 기법별 적중률과 정상 오탐률), `redteam:all --benign-only`(정상 케이스만 실행: 오탐률, 분류기 지연 p50/p95, 응답 품질 지표), mock 실행.
> - (추가) 응답 품질 지표: 회수되지 않은 ASSISTANT 응답이 저장될 때 모델 호출 없이 글자만 보고 계산해 `ResponseMetric`(메시지당 1행, 마이그레이션 `20261112040000_response_metric`)에 저장한다. **기록만 하고 차단·재생성에 쓰지 않는다.** 회수된 메시지와 대화의 첫 인사는 제외. 값: `hangulRatio`(공백·문장부호·숫자·기호를 뺀 글자 중 한글 비율, 글자가 없으면 NULL), `foreignScripts`/`hasForeignScript`(한글·라틴 외 문자 종류: han·kana·cyrillic·arabic·thai·greek·devanagari·hebrew·other), `actionPhrases`(괄호 안 한 줄 문구, 앞뒤 공백 제거, 최대 20개), `length`(글자 수), `paragraphs`(줄바꿈으로 나뉜 비어 있지 않은 덩어리 수), `endsWithQuestion`. 기록 실패는 대화를 깨지 않는다. `/admin`의 '응답 품질' 섹션(기간·캐릭터 필터): 외국어 섞임 비율(한글 비율이 `QUALITY_MIN_HANGUL_RATIO`(기본 0.9) 미만), 한글·라틴 외 문자 섞임 비율과 종류, 행동 묘사 상위 5개와 비율(그 문구가 나온 응답 ÷ 전체), 평균 길이, 문단 4개 초과 비율, 질문으로 끝나는 비율. 기존 메시지는 `npm run metrics:backfill`로 다시 계산한다(테스트 DB가 아니면 `--yes` 필요, 메시지는 읽기만 함). 시나리오·레드팀 평가 리포트에도 같은 요약 표가 들어간다(비공개 세트는 행동 묘사 문구를 싣지 않고 비율만). 구현 `src/lib/quality/`.
> - (추가) 레드팀 일괄 실행 `npm run redteam:all -- --private <표> [--mutate]`: 변환 → 앱 안전 켬 → `--no-app-safety` → 자동 판정 → 종합 리포트. 실제 호출은 `--real --yes`일 때만(없으면 mock, `--real`만 있으면 전체 예상 호출 수·비용을 출력하고 종료). `--mutate`는 공격 케이스만 원본으로 표기 변형(공백·특수문자 삽입, 자모 분리, 초성화, 영문·숫자 치환, 글자 반복)을 시드 고정으로 만들고 원본 id·기법을 기록, 기대 결과는 상속한다. 자동 판정은 케이스의 최종 응답(회수됐으면 회수 전 원문)을 유해 도달/거절·전환/해당 없음으로 판정하며 판정 모델은 `JUDGE_MODEL`(분류기와 다른 모델, 없으면 건너뛰고 경고). 판정기 검증: 무작위 10건(시드 고정) 수동 판정 표본을 뽑고 채워지면 자동/수동 일치율을 리포트에 표시, 80% 미만이면 상단 경고. 변환 세트·변형·응답 원문·판정 프롬프트·결과는 전부 `eval/redteam/private/`(gitignore) 안에만 쓴다. 상세는 `eval/README.md`.
> - (추가) 캐시 접두사 진단: 대화 호출마다 블록별 짧은 해시(SHA-256 앞 12자리: 고정 블록·요약·로어북·최근 대화 시작점, 원문 없음)를 `UsageLog.blockTokens.prefix`에 남기고, 같은 대화의 직전 대화 호출과 비교한 결과를 `blockTokens.cacheBreak`에 기록한다. 값: `first`(직전 없음) / `none`(접두사 유지) / `fixed`(카드 변경) / `summary`(요약 갱신) / `lorebook`(걸린 로어북 변동, 로어북이 입력 앞이면 해당 없음) / `recent_window`(최근 대화 시작점 이동: 예산 초과로 잘림 등) / `layout`(로어북 위치 설정 변경). 프롬프트 순서로 가장 앞의 원인 하나만 기록한다. 스키마 변경 없음(기존 JSON 칸). 구현 `src/lib/chat/prefix-diag.ts`, 조회 방법은 `docs/CACHE.md`.
> - (추가) 캐시 실험: `npm run cache:probe -- --real [--only E4,E5]` — E1~E3 자동 캐시, E4 길이 테스트(약 4.5K/9K토큰), E5 명시적 캐시(`cache_control`), E6 과금 방식 판정, E7 문턱 찾기. 실제 호출은 `--real`일 때만. 결과는 `docs/CACHE.md`.
- 포트: 로컬 DB는 호스트 5433(다른 Postgres와 충돌 방지). 세션은 JWT 전략(Credentials 제공자 제약), 토큰에 `uid`·`role` 포함.
> - `next.config.ts`의 `cacheComponents`는 끔(전 화면이 사용자별 동적 화면이고 SSE가 핵심).

---

## 5. 화면

- `/` 캐릭터 목록 (카드형)
- `/chat/[conversationId]` 대화 화면 (스트리밍, 상단에 "AI와의 대화입니다" 상시 표시, 남은 일일 사용량 표시)
- `/login`, `/signup`
- `/admin` (ADMIN만): 사용량·비용·캐시 적중률 요약, 안전 판정 로그(필터: 단계/판정/카테고리), 캐릭터·로어북 편집

디자인은 깔끔하고 단순하게. 화면 완성도보다 파이프라인 완성도가 우선이다.

---

## 6. 작업 순서 (한 단계씩, 끝나면 멈추고 보고)

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 0 | 프로젝트 셋업: Next.js, TypeScript strict, Prisma, docker compose Postgres, Vitest, lint, `.env.example` | `npm run dev`와 테스트가 돈다 |
| 1 | 인증 + 데모 계정 seed + 오리지널 캐릭터 1개 seed(자리표시 내용) | 로그인 후 캐릭터 목록이 보인다 |
| 2 | 대화 기본: 대화 생성, LLM 어댑터, SSE 스트리밍, 메시지 저장 | 캐릭터와 실제로 대화된다 |
| 3 | 프롬프트 조립기(3-2) + 캐싱 + `UsageLog` 기록 | 조립기 단위 테스트 통과, 턴별 토큰·캐시 토큰이 기록된다 |
| 4 | 기억 요약(3-3) | 긴 대화에서 요약이 생성·갱신되고 프롬프트에 들어간다 |
| 5 | 로어북(3-4) | 키워드가 나오면 해당 항목이 들어간다(테스트) |
| 6 | 안전 파이프라인(3-5) | 입력 차단, 출력 회수, 흐름 감시, fail closed, 위기 안내가 테스트로 확인된다 |
| 7 | 일일 사용량 제한 + 관리자 화면 | `/admin`에서 비용·캐시 적중률·판정 로그를 본다 |
| 8 | 평가 스크립트 (아래 7장) | 결과가 표로 출력·저장된다 |
| 9 | 배포 (대상은 그때 결정) + README | 공개 URL과 데모 계정으로 접속된다 |

### 2단계 (MVP 이후)
- 사용자 등급별 모델 라우팅 — 판정은 **세션당 한 번**, 대화를 한 모델에 고정(캐시 보호)
- 모델별 한국어 블라인드 비교(같은 캐릭터·시나리오, 이름 가린 평가)
- 로어북 배치 실험(앞/뒤 배치에 따른 비용 vs 반영도)
- 캐릭터 카드 V2 가져오기 + 가져온 카드도 안전 심사 통과해야 등록

### 만들지 않는 것
실제 결제 연동, 모바일 앱, 플러그인, 사용자 캐릭터 공개 제작, 성인 모드

---

## 7. 평가 (시뮬레이션)

- `eval/scenarios/` — 정상 대화 시나리오(JSON). 스크립트로 돌려서 측정:
  - 요약 적용 전후 입력 토큰 절감률
  - 캐시 적중률
  - 첫 토큰 지연 / 전체 응답 시간
  - 턴당 비용(실제 청구액 우선, 단가표 추정은 비교용)
- `eval/redteam/` — 공격 대화 세트(JSON, **내용은 사용자가 직접 작성**). 측정:
  - 차단율, 오탐률(정상 대화가 차단된 비율), 단계별(입력/출력/흐름) 차단 분포
- 결과는 `eval/results/날짜.md`로 저장. mock 실행은 문서 상단에 "수치 무의미"를 표시한다.
- 공격 케이스는 실제 모델로 보내지 않는다(제공사 약관상 사전 승인 필요). 규칙 층 평가(`--rules-only`)와 mock으로만 돌리고, 정상 케이스만 실제 모델로 잰다(`--benign-only`).

---

## 8. Claude Code 작업 규칙

- 한 번에 한 단계만. 끝나면 무엇을 했는지, 테스트 결과, 다음 단계 전에 사용자가 결정할 것을 짧게 보고하고 멈춘다.
- 사용량을 아끼기 위해 불필요한 파일 탐색과 대규모 리팩터링을 하지 않는다.
- 모호하면 추측하지 말고 질문한다.
- 새 라이브러리를 추가할 때는 이유를 한 줄로 남긴다.
- 핵심 로직(조립기, 기억, 로어북, 안전)은 테스트를 먼저 또는 함께 작성한다.
- 스키마·설계가 바뀌면 이 SPEC.md를 같이 고친다.
- 비밀값, 실제 API 키, 성인 콘텐츠를 저장소에 넣지 않는다.
