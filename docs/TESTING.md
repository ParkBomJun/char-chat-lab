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
