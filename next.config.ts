import type { NextConfig } from "next";

// cacheComponents/partialPrefetching은 끈다: 모든 화면이 로그인 사용자별 동적 화면이고,
// 핵심 경로가 SSE 라우트라 정적 셸 이점이 없다. (결정: 1단계)
const nextConfig: NextConfig = {};

export default nextConfig;
