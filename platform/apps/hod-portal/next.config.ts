import type { NextConfig } from "next";
import { portalViewRoutes,experienceViewRoutes } from "@aura/contracts";
import { auraPortalRewrites, auraSecurityHeaders } from "../../next-security";

const nextConfig: NextConfig = {
  transpilePackages: ["@aura/contracts", "@aura/portal-kit"],
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  headers: auraSecurityHeaders,
  rewrites: auraPortalRewrites([...Object.values(portalViewRoutes.hod),...Object.values(experienceViewRoutes.hod)]),
};
export default nextConfig;
