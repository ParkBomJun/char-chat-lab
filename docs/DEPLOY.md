# 배포 가이드

운영 이미지(`Dockerfile`)와 운영 구성(`docker-compose.prod.yml`)을 기준으로 합니다. 이 구성은 로컬에서 실제로 올려 검증했습니다(마이그레이션, seed 보존 모드, 헬스체크, 비루트 실행, 채팅, 관리자 화면, 보안 헤더). 2026-11-14에 이 구성 그대로 공개 데모를 올렸습니다(맨 아래 "실제 배포 기록").

## 요구사항

| 항목 | 내용 |
| --- | --- |
| 런타임 | Node 22 이미지(`node server.js`, Next standalone 출력) |
| DB | PostgreSQL 15+ (관리형 DB 가능). 앱은 `DATABASE_URL`로 접속 |
| **프록시** | **TLS를 종료하고 `X-Forwarded-For`를 붙이는 앞단이 필요합니다.** 로그인·가입 시도 제한이 이 헤더의 IP에 의존합니다. 프록시 없이 직접 노출하면 모든 요청이 한 IP로 묶여 서로의 제한에 걸립니다 |
| 장시간 응답 | 채팅은 SSE로 최대 수십 초 응답합니다. 프록시·로드밸런서의 유휴/응답 타임아웃을 60초 이상으로 두고 응답 버퍼링을 끕니다(앱이 `X-Accel-Buffering: no`를 보냅니다) |
| 응답 후 작업 | 기억 요약은 `after()`로 응답 뒤에 실행됩니다. 요청 종료 후에도 프로세스가 살아 있는 장기 실행 서버를 권장합니다 |

## 절차 (Docker 호스트 한 대)

```bash
git clone <repo> && cd char-chat-lab
cp .env.example .env.production
```

1. `.env.production`을 채웁니다 (아래 표). 비밀번호·시크릿은 직접 생성합니다.
   ```bash
   openssl rand -base64 32        # AUTH_SECRET
   openssl rand -base64 24        # POSTGRES_PASSWORD, DEMO_PASSWORD, ADMIN_PASSWORD 용도
   ```
2. 점검합니다. 오류가 있으면 배포하지 마세요.
   ```bash
   npm install && npm run predeploy -- --env-file .env.production
   ```
3. 올립니다. DB가 준비되면 `migrate` 작업이 마이그레이션과 seed를 실행하고, 성공해야 앱이 시작됩니다.
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
   curl http://localhost:${APP_PORT:-3000}/api/health     # {"status":"ok"}
   ```
4. 앞단 프록시(또는 PaaS의 라우터)가 이 포트로 전달하도록 설정하고 HTTPS를 붙입니다. 프록시가 따로 없으면 아래 "프록시 구성"을 겹쳐 올립니다.

`docker-compose.prod.yml`의 프로젝트 이름은 `char-chat-lab-prod`로 분리되어 있어 개발용 `docker-compose.yml`의 DB를 건드리지 않습니다. DB 포트는 호스트에 열지 않습니다.

## 프록시 구성 (Caddy)

`docker-compose.proxy.yml`과 `Caddyfile`은 운영 구성 위에 겹쳐 쓰는 앞단 프록시입니다. Caddy 컨테이너가 80·443을 열고 `app:3000`으로 넘기며, 인증서는 자동으로 받습니다.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.proxy.yml up -d --build
curl https://<SITE_ADDRESS>/api/health
```

- `.env.production`에 `SITE_ADDRESS`(공개 주소)와 `APP_BIND=127.0.0.1`을 넣습니다. 앱 포트는 서버 안에서만 열리고 밖으로는 80·443만 열립니다.
- 80으로 온 요청은 443으로 넘어갑니다.
- 채팅은 SSE라서 `Caddyfile`에 `flush_interval -1`(응답을 모아 두지 않음)을 넣었습니다.
- 인증서는 `caddy_data` 볼륨에 남습니다. `docker compose down -v`로 볼륨을 지우면 다시 발급받습니다(발급 횟수 제한이 있습니다).
- Caddy는 밖에서 온 `X-Forwarded-For`를 버리고 접속한 IP를 새로 붙입니다. `TRUST_PROXY_HOPS=1` 그대로 씁니다.
- 로컬 검증은 `SITE_ADDRESS=localhost`로 합니다. 이때는 Caddy가 자체 서명 인증서를 쓰므로 `curl -k`로 확인합니다. 80·443을 이미 쓰고 있으면 `HTTP_PORT`, `HTTPS_PORT`로 호스트 포트를 바꿉니다.

## 공개 데모로 열 때

데모 계정을 공개하면 모르는 사람이 운영자의 API 키로 대화하게 됩니다. 다음 값을 함께 씁니다.

| 변수 | 값 | 이유 |
| --- | --- | --- |
| `SIGNUP_ENABLED` | `false` | 가입이 열려 있으면 계정을 계속 만들어 사용자당 일일 한도를 피할 수 있습니다. 서버 액션이 가입을 거부하고, `/signup`은 안내와 로그인 링크만 보여 주며, `/login`의 가입 링크가 사라집니다 |
| `DEMO_NOTICE` | `true` | 데모 계정은 여러 사람이 같이 쓰므로 대화가 다른 방문자에게 보일 수 있습니다. 로그인 화면과, `DEMO_EMAIL` 계정으로 들어온 대화 화면 위에 안내 한 줄을 보여 줍니다 |
| `DAILY_MESSAGE_LIMIT` | `30` 이하 | 공용 계정 하나의 하루 전체 사용량 상한이 됩니다 |
| `APP_BIND` | `127.0.0.1` | 앱 포트를 밖에 열지 않습니다 |

`npm run predeploy`는 가입이 열려 있을 때, 일일 한도가 30보다 클 때, 실제 키가 있는데 `CONTACT_EMAIL`이 비었을 때 경고합니다.

## 환경변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | compose 사용 시 | DB 비밀번호(12자 이상). compose가 `DATABASE_URL`을 조립 |
| `DATABASE_URL` | 외부 DB 사용 시 | 직접 지정하면 compose의 DB는 쓰지 않아도 됨 |
| `AUTH_SECRET` | ✓ | 세션 서명 키. 32자 이상 |
| `AUTH_TRUST_HOST` 또는 `AUTH_URL` | ✓ | 프록시·도메인 뒤에서 로그인 동작에 필요 (compose가 `AUTH_TRUST_HOST=true`를 설정) |
| `TRUST_PROXY_HOPS` | 권장 | 앞단 프록시 개수(기본 1). XFF의 오른쪽에서 N번째를 클라이언트 IP로 사용 |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | ✓ | 공개 데모 계정. 비밀번호는 `.env.example` 값이면 안 됨 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✓ | 관리자 계정(데모와 다른 비밀번호) |
| `LLM_API_KEY`, `LLM_CHAT_MODEL`, `LLM_CLASSIFIER_MODEL` | 실서비스 시 | 비면 mock 어댑터(가짜 응답). 분류기·요약용은 저가 모델. **운영에서는 이 환경변수 방식을 권장**합니다. 관리자 화면(`/admin/settings`)에서 저장한 설정은 DB에 암호화되어 저장되며 환경변수보다 우선합니다 — 공개 배포에서는 그 화면에서 키를 저장하지 않는 편이 안전합니다 |
| `LLM_BASE_URL` | | OpenAI 호환 주소(기본 OpenAI) |
| `DAILY_MESSAGE_LIMIT` | | 사용자당 하루 메시지 수(기본 50). 비용 방어선이므로 제공사의 월 한도도 함께 설정 |
| `PROMPT_TOKEN_BUDGET` | | 프롬프트 입력 전체 예산(기본 20000). **단위는 실제 토큰이 아니라 글자 수 추정**입니다(실제 토큰은 약 0.55배). 고정 블록(안전 지시 + 카드 + 작은 로어북)은 자르지 않으므로 이 값이 카드보다 작으면 최근 대화가 전부 잘립니다. predeploy가 카드와 비교해 점검합니다 |
| `CONTACT_EMAIL` | 권장 | `/privacy` 페이지의 삭제 요청 연락처 |
| `APP_PORT` | | compose가 호스트에 여는 앱 포트(기본 3000) |
| `APP_BIND` | | 앱 포트를 여는 주소(기본 `0.0.0.0`). 프록시와 같은 서버에 올릴 때는 `127.0.0.1` |
| `SIGNUP_ENABLED` | | 가입 스위치(기본 `true`). `false`면 서버가 가입을 거부 |
| `DEMO_NOTICE` | | 공용 데모 계정 안내(기본 `false`) |
| `SITE_ADDRESS` | 프록시 구성 사용 시 | Caddy가 받을 사이트 주소. 이 주소로 인증서를 발급받음 |
| `HTTP_PORT` / `HTTPS_PORT` | | 프록시가 호스트에 여는 포트(기본 80 / 443) |

나머지 튜닝 값(`RECENT_TURNS`, `FLOW_*`, `CLASSIFIER_*` 등)은 `.env.example` 참고. 모델 단가는 환경변수가 아니라 `src/config/pricing.json`에 넣고 이미지를 다시 빌드합니다.

## 재배포와 데이터

- 재배포마다 `migrate` 작업이 `prisma migrate deploy`(대기 중인 마이그레이션만 적용)와 seed를 실행합니다.
- 운영 compose는 `SEED_PRESERVE=1`로 seed를 돌립니다. **이미 있는 캐릭터·로어북·비밀번호는 덮어쓰지 않고 없는 것만 만듭니다.** (관리자 화면에서 고친 시드 캐릭터가 재배포 때 되돌아가지 않음을 확인했습니다.) 데모·관리자 비밀번호를 일부러 바꾸려면 `SEED_RESET_PASSWORDS=1`을 함께 주고 한 번 실행한 뒤 제거하세요.
- 스키마를 바꿀 때는 `npm run db:migrate`로 마이그레이션을 만들어 커밋합니다.

## 다른 호스팅(PaaS)에 올릴 때

이미지의 `runner` 타깃이 앱이고 `migrate` 타깃이 일회성 작업입니다. 일반적으로 다음에 대응시키면 됩니다.

- **빌드**: `docker build --target runner .`
- **릴리스(배포 전) 명령**: `migrate` 타깃 이미지로 `npx prisma migrate deploy && npx prisma db seed` (`SEED_PRESERVE=1`)
- **시작 명령**: `node server.js` (포트 3000, `HOSTNAME=0.0.0.0`)
- **헬스체크**: `GET /api/health`
- 위 환경변수를 비밀값 저장소에 등록
- 서버리스(함수) 플랫폼은 SSE 장시간 응답·함수 실행 시간 제한·DB 연결 수 한도를 따로 확인해야 하며, 이 저장소에서는 검증하지 않았습니다.

## 공개 전 체크리스트

- [ ] `npm run predeploy -- --env-file …` 오류 0건. 시드 카드와 프롬프트 예산도 같이 봅니다. 운영 DB의 카드를 관리자 화면에서 고쳤다면 DB에 닿는 환경에서 `--db`를 붙여 DB의 카드까지 점검
- [ ] 대화를 몇 턴 한 뒤 `UsageLog`(kind=CHAT)의 `blockTokens.recent`가 0보다 크고 `droppedRecent`가 0인지 확인(이력이 실제로 실리는지)
- [ ] 데모·관리자 비밀번호가 개발용 값이 아님, 서로 다름
- [ ] 실제 `LLM_API_KEY`·모델 입력(서비스 전용 키), `pricing.json`에 모델 단가가 있는지 확인, 제공사 월 사용 한도 설정
- [ ] 공개 데모라면 `SIGNUP_ENABLED=false`, `DEMO_NOTICE=true`, `DAILY_MESSAGE_LIMIT` 30 이하, `APP_BIND=127.0.0.1`
- [ ] 앞단 프록시가 TLS 종료 + `X-Forwarded-For` 부착, `TRUST_PROXY_HOPS` 맞춤
- [ ] `/api/health` 응답, 데모 계정으로 로그인·대화·차단 동작 확인
- [ ] 평가 결과를 README에 반영: 정상 케이스는 `npm run redteam:all -- --private <표> --benign-only --real --yes`, 공격 케이스는 `--rules-only`(모델 호출 없음)로만. 공격 케이스는 실제 모델로 보내지 않는다(제공사 약관상 사전 승인 필요)
- [ ] `/privacy`에 연락처 표시(`CONTACT_EMAIL`)

## 실제 배포 기록 (2026-11-14, Azure VM 한 대)

주소: https://garden-library.koreacentral.cloudapp.azure.com

```
인터넷 ──443──▶ Caddy(자동 HTTPS) ──▶ app(Next.js, 3000) ──▶ db(PostgreSQL, 내부 전용)
                 └ 80은 443으로 넘김
```

1. **인프라**: `infra/terraform/`으로 만들었습니다(`terraform.tfvars.example`을 복사해 값을 채우고 `terraform plan` → `apply`). 리소스 그룹, 가상 네트워크와 서브넷, NSG(80·443 전체, 22는 지정한 IP만), 고정 공인 IP, NIC, VM(Ubuntu 24.04, 2 vCPU · 4GB), 리소스 그룹 예산 알림. cloud-init이 Docker와 compose 플러그인을 설치합니다. 상태 파일과 `terraform.tfvars`는 커밋하지 않습니다.
2. **주소**: 도메인을 사지 않고 공인 IP의 DNS 레이블(`<이름>.<지역>.cloudapp.azure.com`)을 씁니다. Terraform의 `dns_label` 변수입니다.
3. **환경변수**: 서버에서 저장소를 clone하고 `.env.production`을 만들었습니다(권한 600). 비밀번호와 `AUTH_SECRET`은 서버에서 `openssl rand`로 만들어 파일에만 두었습니다. `SIGNUP_ENABLED=false`, `DEMO_NOTICE=true`, `APP_BIND=127.0.0.1`, `DAILY_MESSAGE_LIMIT=30`, `TRUST_PROXY_HOPS=1`, `SITE_ADDRESS=<DNS 레이블 주소>`.
4. **점검**: 서버에 Node를 설치하지 않았으므로 predeploy는 빌드한 이미지 안에서 돌렸습니다.
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.proxy.yml build
   docker run --rm --network none -v "$PWD/.env.production:/app/.env.production:ro" char-chat-lab-prod-migrate:latest npm run -s predeploy -- --env-file .env.production
   ```
5. **기동**: 위 "프록시 구성"의 명령 그대로입니다. Caddy가 첫 기동 때 인증서를 자동으로 받았습니다. 이미지 빌드는 메모리 4GB에서 스왑 없이 끝났습니다.
6. **확인(먼저 키 없이 mock으로)**: HTTPS `/api/health`, 인증서, 80→443 넘김, 앱 포트 3000과 DB 포트가 밖에서 열리지 않음, 보안 헤더, 가입 차단(화면과 서버 액션 직접 호출 모두), 데모·관리자 로그인, 데모 안내 표시, 프록시를 거친 채팅 응답이 나눠서 도착하는지.
7. **실제 모델 연결**: 이 서비스 전용 키를 새로 만들어 제공사 쪽 사용 한도를 걸고, 서버의 `.env.production`에만 넣은 뒤 `up -d`로 앱을 다시 올렸습니다. 관리자 설정 화면에는 키를 저장하지 않습니다. 그 뒤 운영자가 브라우저에서 데모 계정으로 정상 대화를 확인했습니다.

8. **데모 계정 대화 정리**: 공용 계정이라 다른 방문자의 대화가 목록에 쌓입니다. 서버의 cron이 매일 00:10(한국 시간)에 `scripts/demo-cleanup.sh`를 돌려, 데모 계정의 대화 중 그날 메시지가 없는 것을 지웁니다. 하루 한도는 그날 보낸 메시지 수로 세므로 그날 이어진 대화는 남겨 한도가 풀리지 않게 했습니다. 다른 계정의 대화, 비용·사용량 기록, 안전 판정 기록은 지우지 않습니다. DB 컨테이너에 SQL을 실행하는 방식이라 이미지를 다시 빌드하지 않습니다. `--dry-run`은 개수만 보여 줍니다.
   ```bash
   # crontab -e (서버 시계는 UTC. 15:10 UTC = 00:10 한국 시간)
   10 15 * * * $HOME/char-chat-lab/scripts/demo-cleanup.sh >> $HOME/demo-cleanup.log 2>&1
   ```

재배포는 서버에서 `git pull` 뒤 같은 `up -d --build` 명령입니다. 내릴 때는 `infra/terraform/`에서 `terraform destroy`입니다.

배포하면서 찾은 문제: `/privacy`가 정적 페이지로 만들어져 `CONTACT_EMAIL`이 이미지 빌드 시점의 빈 값으로 굳었습니다. 실행할 때 읽도록 고쳤습니다. 환경변수를 읽는 화면은 정적으로 만들어지지 않는지 확인해야 합니다.

### 배포 뒤 발견한 문제 (2026-11-15)

배포한 구성은 `PROMPT_TOKEN_BUDGET`을 따로 두지 않아 당시 기본값 6000을 썼고, 기본 캐릭터의 고정 블록(7,976자)이 그보다 커서 **최근 대화가 모델에 가지 않았습니다**(매 턴 고정 블록과 이번 입력만 전송). 서버의 대화 호출 기록은 이때까지 1건(11-14 19:19 KST)이었고 `blockTokens.recent = 0`, `droppedRecent = 1`이었습니다. 기본값을 20000으로 올리고 predeploy 점검과 관리자 화면 경고, `overBudget` 기록을 추가했습니다. 경위와 영향받은 실측은 `docs/CACHE.md` 8절. 서버에는 수정본을 받아 다시 빌드해야 반영됩니다.

## 알려진 한계 (운영 관점)

- 계정 자가 삭제, 이메일 인증, 비밀번호 재설정이 없습니다.
- CSP는 설정하지 않았습니다(기본 보안 헤더만).
- 로그 수집·알림·백업은 포함되어 있지 않습니다(DB 볼륨 백업은 호스트에서 따로 구성).
