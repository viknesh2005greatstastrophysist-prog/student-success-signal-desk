import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { getDashboard, mutateDashboard, type ActionInput } from "@/lib/aura/service";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected ecosystem error";
  const status = /authorised|assignment|active application role/.test(message) ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const requestedIdentityId = request.nextUrl.searchParams.get("view");
    return NextResponse.json(await getDashboard(userId, requestedIdentityId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const input = await request.json() as ActionInput;
    if (!input || typeof input.action !== "string") {
      return NextResponse.json({ error: "Invalid action payload" }, { status: 400 });
    }
    return NextResponse.json(await mutateDashboard(userId, input));
  } catch (error) {
    return errorResponse(error);
  }
}
