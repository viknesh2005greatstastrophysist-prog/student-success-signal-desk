import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { externalDir: true },
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
