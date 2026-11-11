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
- 실사용자 데이터는 없다. 검증은 **공개 배포 + 시뮬레이션 + 공격 테스트**로 한다. 결과는 항상 "시뮬레이션"이라고 명시한다.

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

- 매 턴 `UsageLog` 기록: 모델, 입력 토큰, 캐시된 입력 토큰, 출력 토큰, 추정 비용, 지연 시간(첫 토큰까지 / 전체), 분류기 호출 비용 포함.
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
  tier         Tier     @default(FREE)   // 2단계 라우팅용
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
  estCost          Decimal
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
  createdAt      DateTime @default(now())
}
```

필요하면 enum과 인덱스는 구현하면서 정리한다. 스키마를 바꾸면 이 문서도 같이 고친다.

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
  - 턴당 추정 비용
- `eval/redteam/` — 공격 대화 세트(JSON, **내용은 사용자가 직접 작성**). 측정:
  - 차단율, 오탐률(정상 대화가 차단된 비율), 단계별(입력/출력/흐름) 차단 분포
- 결과는 `eval/results/날짜.md`로 저장. 문서 상단에 "시뮬레이션 결과"라고 명시.

---

## 8. Claude Code 작업 규칙

- 한 번에 한 단계만. 끝나면 무엇을 했는지, 테스트 결과, 다음 단계 전에 사용자가 결정할 것을 짧게 보고하고 멈춘다.
- 사용량을 아끼기 위해 불필요한 파일 탐색과 대규모 리팩터링을 하지 않는다.
- 모호하면 추측하지 말고 질문한다.
- 새 라이브러리를 추가할 때는 이유를 한 줄로 남긴다.
- 핵심 로직(조립기, 기억, 로어북, 안전)은 테스트를 먼저 또는 함께 작성한다.
- 스키마·설계가 바뀌면 이 SPEC.md를 같이 고친다.
- 비밀값, 실제 API 키, 성인 콘텐츠를 저장소에 넣지 않는다.
