import type { NextConfig } from "next";
const nextConfig: NextConfig = { transpilePackages: ["@aura/contracts", "@aura/portal-kit"], allowedDevOrigins: ["127.0.0.1"] };
export default nextConfig;
