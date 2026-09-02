import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationError } from "./authentication";
import { AuthorizationError } from "./security";

export class ConflictError extends Error {
  readonly status = 409;
  constructor(readonly code: string, message: string) { super(message); }
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOT_FOUND";
}

export function noStore<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiFailure(error: unknown) {
  if (error instanceof AuthenticationError || error instanceof AuthorizationError || error instanceof ConflictError || error instanceof NotFoundError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: error.issues[0]?.message ?? "Invalid input" } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error(error);
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "The Core API could not complete the request" } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
