# syntax=docker/dockerfile:1
# 운영 이미지. 타깃: runner(앱), migrate(마이그레이션+seed 일회성 작업)

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
# prisma generate는 DB에 접속하지 않지만 설정 파일이 URL을 읽으므로 더미 값을 준다. 실제 값은 런타임에 주입한다.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate \
 && npm run build

# 일회성 작업: 스키마 마이그레이션 적용 후 seed(없는 데이터만 생성, SEED_PRESERVE=1)
FROM builder AS migrate
# Prisma 마이그레이션 엔진이 OpenSSL을 찾는다(없으면 경고). 앱 이미지(runner)에는 필요 없다.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
# standalone 출력: 실행에 필요한 파일만 들어 있다
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
