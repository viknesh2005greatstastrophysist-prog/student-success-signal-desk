import type { NextConfig } from "next";
import { resolvePortalOrigins } from "@aura/contracts";

const scriptPolicy = process.env.NODE_ENV === "production"
  ? "'self' 'unsafe-inline'"
  : "'self' 'unsafe-inline' 'unsafe-eval'";

const portalFormTargets = Object.values(resolvePortalOrigins(process.env.AURA_PORTAL_ORIGINS_JSON)).flat().join(" ");

function headers(formTargets = "'self'") {
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src ${scriptPolicy}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${formTargets}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}

export const auraSecurityHeaders: NonNullable<NextConfig["headers"]> = async () => [
  { source: "/(.*)", headers: headers() },
];

export const auraIdentitySecurityHeaders: NonNullable<NextConfig["headers"]> = async () => [
  { source: "/(.*)", headers: headers(`'self' ${portalFormTargets}`) },
];

export function auraPortalRewrites(paths: readonly string[]): NonNullable<NextConfig["rewrites"]> {
  return async () => paths.map((source) => ({ source, destination: "/" }));
}
