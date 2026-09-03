import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      data: {
        service: "aura-core-api",
        version: "0.1.0",
        release: process.env.RELEASE_SHA ?? process.env.COMMIT_REF ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
        database: "not-probed",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
