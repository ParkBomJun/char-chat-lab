-- AlterTable: 캐시 쓰기 토큰(제공사 usage의 cache_write_tokens). 이 컬럼이 생기기 전의 행과 usage가 없는 행은 NULL(구분 불가)
ALTER TABLE "UsageLog" ADD COLUMN "cacheWriteTokens" INTEGER;
