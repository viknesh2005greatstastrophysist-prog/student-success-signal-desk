import type { NextConfig } from "next";
import { auraSecurityHeaders } from "../../next-security";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { externalDir: true },
  allowedDevOrigins: ["127.0.0.1"],
  headers: auraSecurityHeaders,
};

export default nextConfig;
