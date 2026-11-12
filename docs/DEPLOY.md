# 배포 가이드

운영 이미지(`Dockerfile`)와 운영 구성(`docker-compose.prod.yml`)을 기준으로 합니다. 이 구성은 로컬에서 실제로 올려 검증했습니다(마이그레이션, seed 보존 모드, 헬스체크, 비루트 실행, 채팅, 관리자 화면, 보안 헤더). **공개 URL에 올리는 단계는 호스팅 계정이 필요해 아직 하지 않았습니다.**

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
4. 앞단 프록시(또는 PaaS의 라우터)가 이 포트로 전달하도록 설정하고 HTTPS를 붙입니다.

`docker-compose.prod.yml`의 프로젝트 이름은 `char-chat-lab-prod`로 분리되어 있어 개발용 `docker-compose.yml`의 DB를 건드리지 않습니다. DB 포트는 호스트에 열지 않습니다.

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
| `CONTACT_EMAIL` | 권장 | `/privacy` 페이지의 삭제 요청 연락처 |
| `APP_PORT` | | compose가 호스트에 여는 앱 포트(기본 3000) |

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

- [ ] `npm run predeploy -- --env-file …` 오류 0건
- [ ] 데모·관리자 비밀번호가 개발용 값이 아님, 서로 다름
- [ ] 실제 `LLM_API_KEY`·모델 입력(서비스 전용 키), `pricing.json`에 모델 단가가 있는지 확인, 제공사 월 사용 한도 설정
- [ ] 앞단 프록시가 TLS 종료 + `X-Forwarded-For` 부착, `TRUST_PROXY_HOPS` 맞춤
- [ ] `/api/health` 응답, 데모 계정으로 로그인·대화·차단 동작 확인
- [ ] 평가 결과를 README에 반영: 정상 케이스는 `npm run redteam:all -- --private <표> --benign-only --real --yes`, 공격 케이스는 `--rules-only`(모델 호출 없음)로만. 공격 케이스는 실제 모델로 보내지 않는다(제공사 약관상 사전 승인 필요)
- [ ] `/privacy`에 연락처 표시(`CONTACT_EMAIL`)

## 알려진 한계 (운영 관점)

- 계정 자가 삭제, 이메일 인증, 비밀번호 재설정이 없습니다.
- CSP는 설정하지 않았습니다(기본 보안 헤더만).
- 로그 수집·알림·백업은 포함되어 있지 않습니다(DB 볼륨 백업은 호스트에서 따로 구성).
