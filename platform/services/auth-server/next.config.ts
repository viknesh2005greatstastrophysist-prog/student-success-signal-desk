import type { NextConfig } from "next";
import { auraIdentitySecurityHeaders } from "../../next-security";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  headers: auraIdentitySecurityHeaders,
};
export default nextConfig;
