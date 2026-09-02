import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlers() {
  const { auth } = await import("@/lib/auth");
  return toNextJsHandler(auth);
}

export async function GET(request: Request) {
  return (await handlers()).GET(request);
}

export async function POST(request: Request) {
  return (await handlers()).POST(request);
}
