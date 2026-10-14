import { createHash, randomBytes, randomUUID } from "node:crypto";
import { identityMode } from "../services/auth-server/lib/identity-mode";
import { createInterface } from "node:readline";
import { z } from "zod";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { portalIdSchema } from "@aura/contracts";
import {
  loadCoreConfig,
  quoteIdentifier,
} from "../services/core-api/lib/config";
import {
  withCoreTransaction,
  closePool,
  warmPool,
} from "../services/core-api/lib/db";
import {
  experienceOverview,
  experienceStudent,
  experienceClassroom,
} from "../services/core-api/lib/experience-queries";
import { experienceCommand } from "../services/core-api/lib/experience-commands";
import { loadProjectSources } from "../services/core-api/lib/project-sources";
import {
  lmsOverview,
  lmsCourseDetail,
  readLmsAttachment,
} from "../services/core-api/lib/lms-queries";
import { lmsCommand } from "../services/core-api/lib/lms-commands";
import {
  overview,
  approvePolicy,
  lockPlan,
  executePlan,
  exportPlan,
  readSource,
  setReviewPaused,
} from "../services/core-api/lib/chapter11/service";
import { planWithAgent } from "../services/core-api/lib/chapter11/planning";
import {
  editDraft,
  recordOutcome,
  restoreVersion,
  reviewQueue,
} from "../services/core-api/lib/chapter11/review";
import {
  decideSupportCase,
  replayAgentRun,
  supportDecisionInput,
} from "../services/core-api/lib/support-commands";
import {
  createPaymentAttempt,
  loadPaymentReceipt,
  paymentAttemptInput,
} from "../services/core-api/lib/payment-commands";
import {
  AccessError,
  bindActorToPortal as bindWith,
  type Query,
} from "../services/core-api/lib/portal-session";
import {
  DEVICE_TOKENS_DDL,
  findDeviceTokens,
  isDeviceTokenShape,
  issueDeviceToken,
  purgeDeviceTokens,
  redeemDeviceToken,
  revokeDeviceTokens,
} from "../services/core-api/lib/device-tokens";
import { sourceNames } from "../services/core-api/lib/chapter11/engine";
import { captureModelCredentials } from "../services/core-api/lib/chapter11/provider";

loadCoreConfig();
// GROQ_API_KEY / CH11_MODEL_API_KEY are allowlisted for the model adapter only:
// captured into the provider module and removed from the worker environment.
captureModelCredentials();
if (
  !["project", "college-project"].includes(identityMode()) ||
  !["project", "college-project"].includes(
    process.env.CORE_IDENTITY_REALM ?? "",
  )
)
  throw new Error("Streamlit requires a dedicated college project runtime");
const authSchema = quoteIdentifier(process.env.AUTH_DATABASE_SCHEMA!);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const uuid = (value: unknown) => z.string().uuid().parse(value);
const dummy = await hashPassword(randomBytes(24).toString("hex"));
// Start-up housekeeping: five statements with no parameters, sent as one simple
// query (one round trip to the database, not five).
await withCoreTransaction(async (c) => {
  await c.query(
    [
      `CREATE TABLE IF NOT EXISTS ${authSchema}.streamlit_sessions(token_hash text PRIMARY KEY,user_id text NOT NULL,portal text NOT NULL,expires_at timestamptz NOT NULL)`,
      `ALTER TABLE ${authSchema}.streamlit_sessions ADD COLUMN IF NOT EXISTS auth_session_id text, ADD COLUMN IF NOT EXISTS credential_hash text`,
      `CREATE TABLE IF NOT EXISTS ${authSchema}.streamlit_login_attempts(email_hash text PRIMARY KEY,window_at timestamptz NOT NULL,attempts int NOT NULL)`,
      `DELETE FROM ${authSchema}.streamlit_sessions WHERE expires_at<now()`,
      `DELETE FROM ${authSchema}.streamlit_login_attempts WHERE window_at<now()-interval '1 day'`,
      // Remembered devices (Core migration 012): the deployed engine does not run the
      // Core migrations, so the same idempotent statements run here, under a lock
      // because up to three engine processes start together.
      `SELECT pg_advisory_xact_lock(420043)`,
      ...DEVICE_TOKENS_DDL,
    ].join(";\n"),
  );
  await purgeDeviceTokens(c);
});

async function login(raw: unknown) {
  const input = z
      .object({
        email: z.string().trim().email().max(254),
        password: z.string().min(1).max(1000),
        portal: portalIdSchema,
        source: z.string().max(100).default("server-local"),
        remember: z.boolean().default(false),
      })
      .strict()
      .parse(raw),
    email = input.email.toLowerCase();
  // The housekeeping, both limit checks and the account lookup do not depend on
  // each other, so they run together: sign-in pays for one round of trips to the
  // database instead of four. The limits are still checked before the password.
  const housekeeping = withCoreTransaction((c) =>
    c.query(
      `DELETE FROM ${authSchema}.streamlit_login_attempts WHERE window_at<now()-interval '15 minutes'`,
    ),
  );
  // Only failed attempts count toward the limit (#38): a successful sign-in
  // never uses up the allowance, so a harness or a busy mentor is not locked out.
  const failedAttempts = async (key: string) =>
    withCoreTransaction(
      async (c) =>
        (
          await c.query(
            `SELECT attempts FROM ${authSchema}.streamlit_login_attempts WHERE email_hash=$1 AND window_at>=now()-interval '15 minutes'`,
            [sha(key)],
          )
        ).rows[0]?.attempts ?? 0,
    );
  const recordFailure = async (key: string) =>
    withCoreTransaction((c) =>
      c.query(
        `INSERT INTO ${authSchema}.streamlit_login_attempts(email_hash,window_at,attempts) VALUES($1,now(),1) ON CONFLICT(email_hash) DO UPDATE SET attempts=CASE WHEN streamlit_login_attempts.window_at<now()-interval '15 minutes' THEN 1 ELSE streamlit_login_attempts.attempts+1 END,window_at=CASE WHEN streamlit_login_attempts.window_at<now()-interval '15 minutes' THEN now() ELSE streamlit_login_attempts.window_at END`,
        [sha(key)],
      ),
    );
  const sourceKey = "source:" + input.source,
    emailKey = "email:" + input.source + ":" + email;
  const lookup = withCoreTransaction(
    async (c) =>
      (
        await c.query(
          `SELECT u.id,a.password FROM ${authSchema}."user" u JOIN ${authSchema}.account a ON a."userId"=u.id AND a."providerId"='credential' WHERE lower(u.email)=$1`,
          [email],
        )
      ).rows[0],
  );
  const [, sourceFailures, emailFailures, user] = await Promise.all([
    housekeeping,
    failedAttempts(sourceKey),
    failedAttempts(emailKey),
    lookup,
  ]);
  if (!(sourceFailures < 120 && emailFailures < 10))
    throw new AccessError(
      "RATE_LIMITED",
      "Too many sign-in attempts. Wait fifteen minutes and retry.",
      429,
    );
  const valid = await verifyPassword({
    hash: user?.password ?? dummy,
    password: input.password,
  });
  if (!user?.password || !valid) {
    await recordFailure(sourceKey);
    await recordFailure(emailKey);
    throw new AccessError(
      "UNAUTHENTICATED",
      "Check your account email and password",
      401,
    );
  }
  // Binding the account to the workspace and storing the session share one
  // transaction and one statement for the two inserts (4 round trips, was 10).
  // A refused workspace throws before anything is inserted, as before. With
  // "keep me signed in" the same transaction also stores a remembered-device token.
  const credentialHash = sha(user.password);
  return withCoreTransaction(async (c) => {
    const actor = await bindWith(c, user.id, input.portal);
    const token = await openSession(c, user.id, input.portal, credentialHash);
    return {
      token,
      actor,
      ...(input.remember
        ? { deviceToken: await issueDeviceToken(c, { userId: user.id, portal: input.portal, credentialHash }) }
        : {}),
    };
  });
}
// A workspace session: the opaque token goes to the browser's session state, only its
// hash is stored (two inserts, one statement).
async function openSession(c: Query, userId: string, portal: string, credentialHash: string) {
  const token = randomBytes(32).toString("base64url"),
    authId = randomUUID();
  await c.query(
    `WITH s AS (INSERT INTO ${authSchema}.session(id,"expiresAt",token,"updatedAt","userId") VALUES($1,now()+interval '8 hours',$2,now(),$3) RETURNING id) INSERT INTO ${authSchema}.streamlit_sessions(token_hash,user_id,portal,expires_at,auth_session_id,credential_hash) SELECT $2,$3,$4,now()+interval '8 hours',s.id,$5 FROM s`,
    [authId, sha(token), userId, portal, credentialHash],
  );
  return token;
}
// The current password hash of each account (the credential a remembered device or a
// session was issued under); an account without one is absent from the map.
async function credentialHashes(c: Query, userIds: string[]) {
  if (!userIds.length) return new Map<string, string>();
  const rows = (
    await c.query(
      `SELECT "userId" AS user_id,encode(sha256(password::bytea),'hex') AS hash FROM ${authSchema}.account WHERE "providerId"='credential' AND "userId"=ANY($1)`,
      [userIds],
    )
  ).rows;
  return new Map<string, string>(rows.map((r) => [r.user_id as string, r.hash as string]));
}
const deviceTokensInput = z.partialRecord(portalIdSchema, z.string().refine(isDeviceTokenShape)).default({});
const UNREMEMBERED = new AccessError(
  "UNAUTHENTICATED",
  "This device is no longer remembered. Sign in with your email and password.",
  401,
);
// Remembered devices at the sign-in page. Reports which of the browser's tokens are
// still good (with the account name, so the person can pick one) and which are dead
// (the browser clears those cookies). With `auto`, the most recently used workspace is
// opened in the same call: no form, no password.
async function deviceResume(raw: unknown) {
  const input = z
    .object({ tokens: deviceTokensInput, auto: z.boolean().default(false) })
    .strict()
    .parse(raw);
  return withCoreTransaction(async (c) => {
    const found = await findDeviceTokens(c, input.tokens);
    const hashes = await credentialHashes(c, [...new Set(found.map((f) => f.userId))]);
    const usable = found.filter((f) => hashes.get(f.userId) === f.credentialHash);
    const names = new Map<string, string>(
      (!usable.length
        ? []
        : (
        await c.query(
          `SELECT external_subject,display_name FROM people WHERE external_subject=ANY($1) AND generation_id=(SELECT current_generation_id FROM institution_revisions WHERE singleton)`,
          [usable.map((u) => u.userId)],
        )
      ).rows
      ).map((r) => [r.external_subject as string, r.display_name as string]),
    );
    const remembered = usable.map((u) => ({
      portal: u.portal,
      displayName: names.get(u.userId) ?? "",
      lastUsedAt: u.lastUsedAt,
    }));
    const dead = (kept: { portal: string }[]) =>
      Object.keys(input.tokens).filter((portal) => !kept.some((k) => k.portal === portal));
    const first = remembered[0];
    if (!input.auto || !first) return { remembered, invalid: dead(remembered) };
    const opened = await openDevice(c, first.portal, input.tokens[first.portal]!, hashes);
    if (!opened.ok) {
      const rest = remembered.filter((r) => r.portal !== first.portal);
      return { remembered: rest, invalid: dead(rest) };
    }
    const rest = remembered.filter((r) => r.portal !== first.portal);
    return { resumed: opened.result, remembered: rest, invalid: dead([...rest, first]) };
  });
}
async function openDevice(c: Query, portal: string, token: string, known?: Map<string, string>) {
  const hashes = known ?? new Map<string, string>();
  const outcome = await redeemDeviceToken(c, {
    token,
    portal,
    credentialHashFor: async (userId) => {
      if (!hashes.has(userId))
        for (const [id, hash] of await credentialHashes(c, [userId])) hashes.set(id, hash);
      return hashes.get(userId) ?? null;
    },
  });
  if (!outcome.ok) return outcome;
  const session = await openSession(c, outcome.userId, portal, hashes.get(outcome.userId)!);
  return {
    ok: true as const,
    result: {
      portal,
      token: session,
      actor: outcome.actor,
      ...(outcome.rotated ? { deviceToken: outcome.rotated } : {}),
    },
  };
}
// One remembered workspace chosen on the sign-in page.
async function deviceLogin(raw: unknown) {
  const input = z
    .object({ portal: portalIdSchema, token: z.string().refine(isDeviceTokenShape) })
    .strict()
    .parse(raw);
  const opened = await withCoreTransaction((c) => openDevice(c, input.portal, input.token));
  if (!opened.ok) throw opened.error ?? UNREMEMBERED;
  return opened.result;
}
async function authenticated(token: unknown) {
  if (typeof token !== "string" || token.length < 40 || token.length > 100)
    throw new AccessError("UNAUTHENTICATED", "Sign in to continue", 401);
  const value = token;
  // The session check and the account binding are one transaction (4 round trips
  // to the database, was 10); both still run on every request.
  return withCoreTransaction(async (c) => {
    const session = (
      await c.query(
        `SELECT s.user_id,s.portal FROM ${authSchema}.streamlit_sessions s JOIN ${authSchema}.session b ON b.id=s.auth_session_id AND b."expiresAt">now() JOIN ${authSchema}.account a ON a."userId"=s.user_id AND a."providerId"='credential' WHERE s.token_hash=$1 AND s.expires_at>now() AND s.credential_hash=encode(sha256(a.password::bytea),'hex')`,
        [sha(value)],
      )
    ).rows[0];
    if (!session)
      throw new AccessError("UNAUTHENTICATED", "Sign in again to continue", 401);
    return bindWith(c, session.user_id, session.portal);
  });
}
// Read-only actions that may be served inside a batch (and one at a time).
const BATCHABLE_READS = new Set([
  "overview",
  "sources",
  "student",
  "classroom",
  "lms_overview",
  "lms_course",
  "review_overview",
  "review_queue",
  "receipt",
]);
async function readAction(
  a: Awaited<ReturnType<typeof authenticated>>,
  action: string,
  p: Record<string, unknown>,
) {
  if (action === "overview") return experienceOverview(a);
  if (action === "sources") {
    // Source records are evidence for staff; students and parents never see them.
    if (a.role === "student" || a.role === "parent")
      throw new AccessError("FORBIDDEN", "Source records are for staff only", 403);
    return loadProjectSources(a);
  }
  if (action === "student") return experienceStudent(a, uuid(p.studentId));
  if (action === "classroom") return experienceClassroom(a, uuid(p.offeringId));
  if (action === "lms_overview") return lmsOverview(a);
  if (action === "lms_course") return lmsCourseDetail(a, uuid(p.courseId));
  if (action === "review_overview") return overview(a);
  if (action === "review_queue") return reviewQueue(a);
  if (action === "receipt") return loadPaymentReceipt(a, uuid(p.transactionId));
  throw new AccessError("UNKNOWN_ACTION", "That action is unavailable", 404);
}
function failure(error: unknown) {
  const e = error as Error & { code?: string; status?: number };
  const expected =
    error instanceof AccessError ||
    (typeof e.status === "number" && e.status < 500);
  return {
    code:
      error instanceof z.ZodError
        ? "INVALID_INPUT"
        : expected
          ? e.code
          : "REQUEST_FAILED",
    status: error instanceof z.ZodError ? 400 : expected ? e.status : 500,
    message:
      error instanceof z.ZodError
        ? error.issues[0]?.message
        : expected
          ? e.message
          : "The action could not complete. Refresh and retry.",
    ...(expected && typeof (e as { retryAfterSeconds?: unknown }).retryAfterSeconds === "number"
      ? { retryAfterSeconds: (e as { retryAfterSeconds: number }).retryAfterSeconds }
      : {}),
  };
}
async function dispatch(
  action: string,
  p: Record<string, unknown>,
  token: unknown,
) {
  if (action === "login") return login(p);
  if (action === "device_resume") return deviceResume(p);
  if (action === "device_login") return deviceLogin(p);
  // Opens the database connections before they are needed. Takes no input, needs
  // no session and returns nothing about the data.
  if (action === "warm") return { connections: await warmPool(4) };
  if (action === "logout") {
    if (typeof token !== "string")
      throw new AccessError("UNAUTHENTICATED", "Sign in to continue", 401);
    // `forget` (the default) is "Sign out": the remembered-device tokens of this
    // account in this workspace are revoked with the session. "Switch workspace"
    // sends forget=false and keeps them.
    const out = z
      .object({ forget: z.boolean().default(true), deviceToken: z.string().optional() })
      .strict()
      .parse(p);
    await withCoreTransaction(async (c) => {
      if (out.forget) {
        const owner = (
          await c.query(
            `SELECT user_id,portal FROM ${authSchema}.streamlit_sessions WHERE token_hash=$1`,
            [sha(token)],
          )
        ).rows[0];
        await revokeDeviceTokens(c, {
          userId: owner?.user_id ?? "",
          portal: owner?.portal ?? "",
          token: out.deviceToken,
        });
      }
      await c.query(
        `DELETE FROM ${authSchema}.session WHERE id IN(SELECT auth_session_id FROM ${authSchema}.streamlit_sessions WHERE token_hash=$1)`,
        [sha(token)],
      );
      await c.query(
        `DELETE FROM ${authSchema}.streamlit_sessions WHERE token_hash=$1`,
        [sha(token)],
      );
    });
    return { signedOut: true };
  }
  const a = await authenticated(token),
    cmd = z
      .string()
      .uuid()
      .parse(p.commandId ?? randomUUID()),
    body = { ...p };
  delete body.commandId;
  if (action === "actor") return a;
  if (action === "batch") {
    // Several read-only actions for one page, authenticated once and run
    // together, so a page pays for one trip to the database instead of one each.
    const requests = z
      .array(
        z.object({
          action: z.string(),
          payload: z.record(z.string(), z.unknown()).default({}),
        }),
      )
      .min(1)
      .max(8)
      .parse(p.requests);
    return Promise.all(
      requests.map(async (item) => {
        try {
          if (!BATCHABLE_READS.has(item.action))
            throw new AccessError("UNKNOWN_ACTION", "That action is unavailable", 404);
          return { ok: true, data: await readAction(a, item.action, item.payload) };
        } catch (error) {
          return { ok: false, error: failure(error) };
        }
      }),
    );
  }
  if (BATCHABLE_READS.has(action)) return readAction(a, action, p);
  if (action === "experience_command") return experienceCommand(a, cmd, body);
  if (action === "lms_command") return lmsCommand(a, cmd, body);
  if (action === "lms_attachment")
    return readLmsAttachment(
      a,
      z.enum(["lessons", "assignments", "submissions"]).parse(p.kind),
      uuid(p.id),
    );
  if (action === "policy_approve") return approvePolicy(a, body, cmd);
  if (action === "plan_save") return planWithAgent(a, body, { commandId: cmd });
  if (action === "plan_revise")
    return planWithAgent(a, p.input, {
      id: uuid(p.planId),
      expectedRevision: z.number().int().nonnegative().parse(p.expectedRevision),
      commandId: cmd,
    });
  if (action === "plan_lock")
    return lockPlan(
      a,
      uuid(p.planId),
      z.number().int().nonnegative().parse(p.expectedRevision),
    );
  if (action === "plan_execute") return executePlan(a, uuid(p.planId));
  if (action === "plan_export") return exportPlan(a, uuid(p.planId));
  if (action === "plan_pause")
    return setReviewPaused(a, uuid(p.planId), {
      paused: p.paused,
      expectedRevision: p.expectedRevision,
      reason: p.reason,
    });
  if (action === "source_evidence")
    return readSource(
      a,
      uuid(p.studentId),
      z.enum(sourceNames).parse(p.source),
    );
  if (action === "draft_edit") {
    delete body.caseId;
    return editDraft(a, uuid(p.caseId), cmd, body);
  }
  if (action === "case_decide") {
    delete body.caseId;
    return decideSupportCase(
      a,
      uuid(p.caseId),
      cmd,
      supportDecisionInput.parse(body),
    );
  }
  if (action === "version_restore") {
    delete body.planId;
    return restoreVersion(a, uuid(p.planId), cmd, body);
  }
  if (action === "outcome") {
    delete body.planId;
    return recordOutcome(a, uuid(p.planId), cmd, body);
  }
  if (action === "replay") return replayAgentRun(a, uuid(p.runId), cmd);
  if (action === "payment")
    return createPaymentAttempt(
      a,
      uuid(p.invoiceId),
      cmd,
      paymentAttemptInput.parse(body),
    );
  throw new AccessError("UNKNOWN_ACTION", "That action is unavailable", 404);
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let id: unknown = null;
  try {
    if (Buffer.byteLength(line) > 2900000)
      throw new AccessError(
        "REQUEST_TOO_LARGE",
        "Request exceeds the supported size",
        413,
      );
    const raw = z
      .object({
        id: z.string(),
        action: z.string(),
        payload: z.record(z.string(), z.unknown()).default({}),
        token: z.string().optional(),
      })
      .strict()
      .parse(JSON.parse(line));
    id = raw.id;
    const data = await dispatch(raw.action, raw.payload, raw.token);
    process.stdout.write(JSON.stringify({ id, ok: true, data }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ id, ok: false, error: failure(error) }) + "\n");
  }
}
await closePool();
