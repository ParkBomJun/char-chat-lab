# 테스트·E2E 규칙

**원칙: 테스트와 E2E는 항상 테스트 DB + mock LLM에서 돈다. 실제 LLM 호출은 사람이 명시적으로 플래그를 줄 때만 일어난다.**
개발 DB에는 개발자가 직접 저장한 대화·LLM 설정(API 키)이 들어 있을 수 있어서, 테스트가 거기에 쓰거나 지우거나 그 키로 호출하면 안 된다.

## 구성

| | 개발 | 테스트·E2E |
| --- | --- | --- |
| DB | `chatlab` (호스트 포트 5433, 영구 볼륨) | `chatlab_test` (포트 **5434**, 메모리 tmpfs, `--profile test`로만 기동) |
| 설정 파일 | `.env` | `.env.test` (`cp .env.test.example .env.test`, 커밋 안 됨) |
| 서버 포트 | 3000/3100 등 | **3110** |
| LLM | `.env`/관리자 화면의 키 | **mock** (키가 있어도 무시) |

## 명령

```bash
cp .env.test.example .env.test       # 최초 1회
npm run db:test:reset                # 테스트 DB 컨테이너를 새로 만들고 마이그레이션 + seed (언제든 깨끗한 상태로)
npm run dev:test                     # 테스트 DB + mock 으로 서버 기동 (http://localhost:3110)
npm run dev:test:real                # ★ 실제 LLM 호출을 허용(ALLOW_REAL_LLM=1). .env.test 에 LLM_API_KEY 필요, 비용 발생
npm run db:test:down                 # 테스트 DB 중지
npm test                             # 단위 테스트(DB·네트워크 없음)
```

테스트 DB는 reset하면 초기화되므로 **테스트 뒤에 `DELETE`로 청소할 필요가 없고, 개발 DB에는 어떤 정리 명령도 쓰지 않는다.**

## 가드(여러 겹)

1. **DB 이름 가드** — `APP_ENV=test`인데 `DATABASE_URL`의 DB 이름이 `_test`로 끝나지 않으면 앱의 DB 모듈이 로드 시점에 예외를 던진다(`src/lib/db.ts` → `assertDatabaseMatchesEnv`).
2. **실행기 가드** — `scripts/test-run.ts`(= `dev:test`, `db:test:reset`)가 `.env.test`를 읽어 개발용 `DATABASE_URL`·LLM 키를 덮어쓰고, 테스트 DB가 아니면 시작을 거부한다. 기본은 `LLM_PROVIDER=mock`, `LLM_API_KEY=""`.
3. **LLM 가드** — `APP_ENV=test`에서는 `ALLOW_REAL_LLM=1`이 없으면 환경변수의 키는 물론 **DB에 저장된 키도 무시**하고 mock만 쓴다(`resolveRuntime`). 관리자 화면의 "연결 테스트"도 실제 호출 없이 거부된다. `--real`은 키가 없으면 시작하지 않는다.
4. **단위 테스트 가드** — `vitest.config.ts`가 `APP_ENV=test`, 빈 키, 어디에도 연결되지 않는 더미 DB 주소를 주입한다.
5. **E2E 확인** — E2E 스크립트는 시작할 때 `GET /api/health`가 `{"env":"test"}`를 돌려주는지 확인하고, 아니면 중단한다(개발 서버에 잘못 붙는 것 방지).

가드 2·3은 위 명령으로 실행했을 때만 작동한다. 개발 서버(`npm run dev`)를 띄워 놓고 그쪽으로 E2E를 돌리면 보호되지 않으므로, **E2E는 항상 `npm run dev:test`의 3110 포트로만** 돌린다.

## 그 밖의 실제 호출 관문

- `npm run eval` — API 키가 있으면 실제 호출이므로 `--yes`가 있어야 시작한다(`APP_ENV=test`이면 mock 강제).
- `npm run cache:probe -- --real` — 실제 호출 실험. `--real` 없이는 호출 계획만 출력한다. `npm run cache:dump`는 오프라인이다.

## 비공개 필드 누출 E2E (`npm run test:leak`)

일반 사용자(`demo@example.com`, role=USER)가 받는 응답에 캐릭터의 비공개 필드가 섞이지 않는지 확인한다. 관리자 화면은 대상이 아니다.

```bash
npm run dev:test      # 터미널 A: 3110 포트, 테스트 DB + mock (db:test:reset으로 시드해 둘 것)
npm run test:leak     # 터미널 B
```

- **무엇을 보나**: 테스트 DB의 모든 캐릭터(`persona`·`speechStyle`·`exampleDialog`)와 로어북 본문, 시스템 프롬프트(안전 지시)·분류기 프롬프트·고정 블록 제목 문구에서 문장 지문(앞부분·중간 10글자, 공백 제거)을 뽑아, 아래 응답에 하나라도 나오면 **exit 1로 실패**한다. 이름·소개·인사말과 겹치는 지문은 거짓 양성을 막으려고 뺀다.
  - `/`, `/chat/[id]`의 HTML과 RSC payload, 채팅 API(`POST /api/chat/[id]`)의 SSE 본문·응답 헤더, 405·404·헬스체크 응답. 채팅은 첫 로어북 키워드를 넣어 로어북 경로도 탄다.
- **검사가 헛돌지 않게**: 시작 시 `/api/health`가 `env=test`인지 확인하고 아니면 중단한다(3110이 아닌 서버에 붙는 것 방지). 비공개 값을 일부러 넣은 문자열로 검사기 자체를 점검하고, "내려가야 하는 값"(이름·소개·인사말·SSE 이벤트·RSC payload가 비어 있지 않음)이 실제로 보이는지 대조해 하나라도 안 보이면 실패한다. 로그인 실패나 빈 페이지로 통과하는 일을 막는다.
- **뒷정리**: 스크립트가 만든 대화와 그 부속 기록(메시지·판정 이벤트·사용량 로그)만 테스트 DB에서 지운다.
- **누출이 실제로 있을 때 실패하는지**는 `src/app/page.tsx`에 `persona`를 일부러 출력해 확인했다(실패 후 원복). 카드를 바꿔도 DB에서 지문을 다시 뽑으므로 따로 고칠 것이 없다.
- 프로덕션 모드(`next start`)로 띄운 서버에 쓰려면 서버에 `AUTH_TRUST_HOST=true`가 필요하다. 다른 주소는 `E2E_BASE_URL`로 지정하되 `env=test` 확인은 그대로 적용된다.
- 모델이 응답 텍스트로 persona를 흘리는 경우(프롬프트 유출 유도)는 이 테스트의 대상이 아니라 레드팀의 jailbreak·유출 범주가 본다.

## 카드 저장 검사 통합 테스트 (`npm run test:card`)

관리자 화면의 서버 액션이 쓰는 저장 함수(`src/lib/admin/card-save.ts`)를 테스트 DB에 대고 불러, 안전 규칙 HARD에 걸린 캐릭터·로어북이 저장되지 않고 SOFT는 경고와 함께 저장되는지 확인한다. 서버를 띄울 필요가 없고 모델을 부르지 않는다. `eval/redteam/private/cards/*.json`(비공개)이 있으면 그 카드들이 전부 거부되는지도 본다. 스크립트가 만든 행만 지운다. 관리자 화면의 표시(사유·경고 문구)는 이 테스트가 보지 않는다.

## 턴당 서버 고정 비용 측정 (`npm run bench:turn`)

`npm run dev:test`로 띄운 3110 서버에 mock 대화 턴을 보내 "요청→첫 글자", "마지막 글자→스트림 끝", 전체 시간을 p50/p90으로 낸다. mock 모델·분류기는 거의 즉시 답하므로 인증·DB 왕복·규칙 검사 같은 서버 쪽 비용만 보인다. 실제 모델의 지연(분류기 약 2.3초 × 2)은 여기에 없다. 개발 모드에서는 실행마다 ±20ms쯤 흔들리므로 변경 전후는 번갈아 여러 번 돌려 비교한다.

## 응답 품질 지표 재계산 (`npm run metrics:backfill`)

기존 ASSISTANT 메시지의 `ResponseMetric`을 다시 계산한다(모델 호출 없음, 메시지는 읽기만 함).

```bash
npx tsx scripts/test-run.ts -- npx tsx scripts/metrics-backfill.ts   # 테스트 DB: 바로 실행
npm run metrics:backfill                                             # 개발 DB: 대상만 보여 주고 멈춤(종료 코드 2)
npm run metrics:backfill -- --yes                                    # 개발 DB에 실제로 기록
```

테스트 DB(`APP_ENV=test`)가 아니면 `--yes`가 있어야 쓴다. 회수된 메시지와 대화의 첫 인사는 대상이 아니다.
