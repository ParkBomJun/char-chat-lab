import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// cacheComponents/partialPrefetching은 끈다: 모든 화면이 로그인 사용자별 동적 화면이고,
// 핵심 경로가 SSE 라우트라 정적 셸 이점이 없다. (결정: 1단계)
const nextConfig: NextConfig = {
  // Docker 이미지를 작게: 실행에 필요한 파일만 .next/standalone에 모은다 (9단계)
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS는 HTTPS 뒤에서만 의미가 있다. 운영 빌드에만 붙인다.
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
