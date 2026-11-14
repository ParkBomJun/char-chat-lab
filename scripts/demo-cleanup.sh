#!/usr/bin/env bash
# 공용 데모 계정의 지난 대화를 지운다. 서버의 cron이 하루에 한 번 돌린다(docs/DEPLOY.md).
#
#   scripts/demo-cleanup.sh            # 지운다
#   scripts/demo-cleanup.sh --dry-run  # 지울 개수만 본다
#
# 지우는 것: DEMO_EMAIL 계정의 대화 중, 오늘(한국 시간 자정 이후) 메시지가 하나도 없는 대화.
#           메시지, 응답 품질 지표, 기억 요약은 대화와 함께 지워진다.
# 남기는 것: 오늘 이어진 대화(하루 한도는 오늘 보낸 메시지 수로 세므로, 이것을 지우면 한도가 풀린다),
#           다른 계정의 대화, 비용·사용량 기록(UsageLog), 안전 판정 기록(ModerationEvent).
# 대화 내용은 읽거나 출력하지 않는다. 개수만 출력한다.
#
# 앱 이미지와 무관하게 DB 컨테이너에 SQL을 실행하므로 다시 빌드할 필요가 없다.
# 환경변수: DEMO_EMAIL(없으면 ENV_FILE의 DEMO_EMAIL 줄만 읽는다), ENV_FILE(기본 저장소의 .env.production),
#          DB_CONTAINER(기본 char-chat-lab-prod-db-1), DB_USER·DB_NAME(기본 chatlab)
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *) echo "사용법: $0 [--dry-run]" >&2; exit 2 ;;
esac

ENV_FILE="${ENV_FILE:-.env.production}"
DB_CONTAINER="${DB_CONTAINER:-char-chat-lab-prod-db-1}"
DB_USER="${DB_USER:-chatlab}"
DB_NAME="${DB_NAME:-chatlab}"

email="${DEMO_EMAIL:-}"
if [ -z "$email" ] && [ -f "$ENV_FILE" ]; then
  # 그 한 줄만 읽는다. 따옴표와 앞뒤 공백은 뗀다.
  email="$(grep -m1 '^DEMO_EMAIL=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"'" | xargs || true)"
fi
if [ -z "$email" ]; then
  echo "✗ DEMO_EMAIL을 알 수 없습니다(환경변수나 $ENV_FILE에 없음). 아무것도 지우지 않았습니다." >&2
  exit 1
fi

stamp="$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S KST')"

# createdAt은 UTC 시각(시간대 없음)으로 저장된다. 기준은 한국 시간 오늘 0시를 UTC로 바꾼 값이다.
# 관리자 권한 계정은 DEMO_EMAIL로 잘못 지정돼도 건드리지 않는다(role = 'USER').
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qtA \
  -v email="$email" -v dry="$DRY_RUN" -v stamp="$stamp" <<'SQL'
begin;

create temporary table _cleanup_target on commit drop as
with cutoff as (
  select ((date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') at time zone 'UTC') as t
)
select c.id
from "Conversation" c
join "User" u on u.id = c."userId"
cross join cutoff
where lower(u.email) = lower(:'email')
  and u.role = 'USER'
  and c."createdAt" < cutoff.t
  and not exists (
    select 1 from "Message" m where m."conversationId" = c.id and m."createdAt" >= cutoff.t
  );

select :'stamp' || ' 데모 계정 대화 ' || (
    select count(*) from "Conversation" c join "User" u on u.id = c."userId"
    where lower(u.email) = lower(:'email') and u.role = 'USER'
  ) || '개 중 지난 대화 ' || (select count(*) from _cleanup_target) || '개'
  || case when :dry = 1 then ' (dry-run: 지우지 않음)' else ' 삭제' end;

delete from "Conversation" where :dry = 0 and id in (select id from _cleanup_target);

commit;
SQL
