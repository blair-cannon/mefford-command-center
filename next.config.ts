import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vinext inspects multipart requests before dispatching API routes. Allow the
  // 8 MB Word attachment plus its form envelope; the API still enforces 8 MB.
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
};

export default nextConfig;
