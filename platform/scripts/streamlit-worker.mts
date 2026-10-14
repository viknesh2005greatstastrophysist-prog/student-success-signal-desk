import { createHash, randomBytes, randomUUID } from "node:crypto";
import { identityMode } from "../services/auth-server/lib/identity-mode";
import { createInterface } from "node:readline";
import { z } from "zod";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import {
  actorContextSchema,
  portalIdSchema,
  portalAllowedRoles,
} from "@aura/contracts";
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
    ].join(";\n"),
  );
});

class AccessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 403,
  ) {
    super(message);
  }
}
type Query = Pick<import("pg").PoolClient, "query">;
async function bindWith(c: Query, userId: string, portal: string) {
  const result = await c.query(
    `SELECT p.id AS person_id,p.display_name,p.email,r.role,r.department_id,sp.id AS student_id FROM institution_revisions ir JOIN people p ON p.generation_id=ir.current_generation_id JOIN role_assignments r ON r.generation_id=ir.current_generation_id AND r.person_id=p.id AND r.active LEFT JOIN student_profiles sp ON sp.generation_id=ir.current_generation_id AND sp.person_id=p.id WHERE ir.singleton AND p.external_subject=$1 LIMIT 2`,
    [userId],
  );
  if (result.rowCount !== 1)
    throw new AccessError(
      "UNAUTHENTICATED",
      "Account has no unique active college assignment",
      401,
    );
  const row = result.rows[0]!;
  const actor = actorContextSchema.parse({
    subject: userId,
    personId: row.person_id,
    role: row.role,
    departmentId: row.department_id ?? undefined,
    studentId: row.student_id ?? undefined,
  });
  if (!portalAllowedRoles[portalIdSchema.parse(portal)].includes(actor.role))
    throw new AccessError(
      "PORTAL_DENIED",
      "This account cannot enter the selected workspace",
    );
  return { ...actor, displayName: row.display_name, email: row.email };
}
async function login(raw: unknown) {
  const input = z
      .object({
        email: z.string().trim().email().max(254),
        password: z.string().min(1).max(1000),
        portal: portalIdSchema,
        source: z.string().max(100).default("server-local"),
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
  const token = randomBytes(32).toString("base64url"),
    authId = randomUUID();
  // Binding the account to the workspace and storing the session share one
  // transaction and one statement for the two inserts (4 round trips, was 10).
  // A refused workspace throws before anything is inserted, as before.
  const actor = await withCoreTransaction(async (c) => {
    const bound = await bindWith(c, user.id, input.portal);
    await c.query(
      `WITH s AS (INSERT INTO ${authSchema}.session(id,"expiresAt",token,"updatedAt","userId") VALUES($1,now()+interval '8 hours',$2,now(),$3) RETURNING id) INSERT INTO ${authSchema}.streamlit_sessions(token_hash,user_id,portal,expires_at,auth_session_id,credential_hash) SELECT $2,$3,$4,now()+interval '8 hours',s.id,$5 FROM s`,
      [authId, sha(token), user.id, input.portal, sha(user.password)],
    );
    return bound;
  });
  return { token, actor };
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
  // Opens the database connections before they are needed. Takes no input, needs
  // no session and returns nothing about the data.
  if (action === "warm") return { connections: await warmPool(4) };
  if (action === "logout") {
    if (typeof token !== "string")
      throw new AccessError("UNAUTHENTICATED", "Sign in to continue", 401);
    await withCoreTransaction(async (c) => {
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
