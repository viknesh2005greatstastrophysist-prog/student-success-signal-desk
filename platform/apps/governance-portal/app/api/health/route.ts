import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      data: {
        service: "aura-ai-governance",
        release: process.env.RELEASE_SHA ?? process.env.COMMIT_REF ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
