import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    // 단위 테스트는 어떤 경우에도 실제 키·개발 DB를 쓰지 않는다
    // DATABASE_URL은 어디에도 연결되지 않는 더미(포트 1): 일부 모듈이 DB 클라이언트를 import만 해도 가드를 통과하되, 실수로 쿼리가 나가면 연결 거부로 실패한다.
    env: { APP_ENV: "test", LLM_API_KEY: "", LLM_PROVIDER: "mock", ALLOW_REAL_LLM: "", DATABASE_URL: "postgresql://unit:unit@127.0.0.1:1/unit_test" },
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "eval/**/*.test.ts", "scripts/**/*.test.ts"] },
});
