import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      data: {
        service: "aura-core-api",
        version: "0.1.0",
        database: "not-probed",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
