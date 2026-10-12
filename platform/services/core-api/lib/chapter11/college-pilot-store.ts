import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { digest, parallelMap } from "./engine";
import type { CollegeAttendanceReview } from "./college-attendance-review";
import { collegeDatasetHash, chooseReadinessOrder, collectCollegeSources, formatReadinessPacket, requiredTasks, snapshotReferences, validateOrder, validateReadinessPacket,
  type OrderingResult, type Packet, type ReadinessComposer, type Snapshot } from "./college-pilot-engine";

type Row = Record<string, unknown>;
type Job = { run_id: string; student_id: string; revision: number; state: string; stage: string; checkpoint: string; lease: string; lease_until: number; error_code: string | null };
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const commandSchema = z.object({ commandId: z.string().uuid(), expectedRevision: z.number().int().positive(), note: z.string().trim().min(8).max(1000) }).strict();
const eventHash = (previousHash: string, subject: string, kind: string, body: unknown, actor: string, at: string) => digest({ previousHash, subject, kind, body, actor, at });

/** Private SQLite ledger. Student names/SRNs are never persisted in model inputs or this ledger. */
export class CollegePilot {
  readonly db: DatabaseSync;
  readonly datasetHash: string;
  private readonly advancing = new Set<string>();
  private readonly profilePromises = new Map<string, Promise<OrderingResult>>();
  constructor(readonly directory: string, readonly review: CollegeAttendanceReview, readonly composer?: ReadinessComposer) {
    if (process.env.NODE_ENV === "production") throw new Error("LOCAL_PILOT_NOT_FOR_HOSTED_PORTAL_ACCESS");
    const path = resolve(directory, "pilot.sqlite");
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("PILOT_DATABASE_SYMLINK_REJECTED");
    this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.datasetHash = collegeDatasetHash(review);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,dataset_hash TEXT NOT NULL,mode TEXT NOT NULL,paused INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,plan_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(run_id TEXT NOT NULL REFERENCES runs(id),student_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'queued',stage TEXT NOT NULL DEFAULT 'planned',checkpoint TEXT NOT NULL DEFAULT '{}',lease TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,error_code TEXT,PRIMARY KEY(run_id,student_id));
      CREATE TABLE IF NOT EXISTS versions(run_id TEXT NOT NULL,student_id TEXT NOT NULL,revision INTEGER NOT NULL,packet_hash TEXT NOT NULL,packet TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(run_id,student_id,revision));
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,student_id TEXT NOT NULL,revision INTEGER NOT NULL,packet_hash TEXT NOT NULL,kind TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS followups(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,student_id TEXT NOT NULL,revision INTEGER NOT NULL,task_code TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,previous_hash TEXT NOT NULL,event_hash TEXT NOT NULL,subject TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
    for (const table of ["versions", "decisions", "followups", "events", "commands", "profiles"]) for (const verb of ["UPDATE", "DELETE"]) this.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${verb} BEFORE ${verb} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable pilot ledger'); END;`);
  }
  close() { this.db.close(); }
  private tx<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private event(subject: string, kind: string, body: unknown, actor = "runtime") {
    const previous = this.db.prepare("SELECT event_hash FROM events ORDER BY seq DESC LIMIT 1").get() as Row | undefined;
    const previousHash = previous ? String(previous.event_hash) : "0".repeat(64), at = new Date().toISOString();
    this.db.prepare("INSERT INTO events(previous_hash,event_hash,subject,kind,body,actor,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(previousHash, eventHash(previousHash, subject, kind, body, actor, at), subject, kind, JSON.stringify(body), actor, at);
  }
  private command<T>(commandId: string, input: unknown, work: () => T): T {
    z.string().uuid().parse(commandId); const inputHash = digest(input);
    return this.tx(() => {
      const previous = this.db.prepare("SELECT * FROM commands WHERE id=?").get(commandId) as Row | undefined;
      if (previous) { if (previous.input_hash !== inputHash) throw new Error("COMMAND_ID_REUSED_WITH_DIFFERENT_INPUT"); return parse<T>(previous.result); }
      const result = work(); this.db.prepare("INSERT INTO commands VALUES(?,?,?)").run(commandId, inputHash, JSON.stringify(result)); return result;
    });
  }
  private run(id: string) {
    z.string().uuid().parse(id);
    const run = this.db.prepare("SELECT * FROM runs WHERE id=? AND dataset_hash=?").get(id, this.datasetHash) as Row | undefined;
    if (!run) throw new Error("RUN_OUT_OF_SCOPE"); return run;
  }
  private job(runId: string, studentId: string): Job {
    this.run(runId); z.string().uuid().parse(studentId);
    if (!this.review.students.some(s => s.id === studentId)) throw new Error("STUDENT_OUT_OF_SCOPE");
    const row = this.db.prepare("SELECT * FROM jobs WHERE run_id=? AND student_id=?").get(runId, studentId) as Job | undefined;
    if (!row) throw new Error("JOB_NOT_FOUND"); return row;
  }
  createRun(mode: "model" | "deterministic", commandId: string, actor: string) {
    z.enum(["model", "deterministic"]).parse(mode);
    return this.command(commandId, { action: "create_run", mode, datasetHash: this.datasetHash, actor }, () => {
      const id = randomUUID(), at = new Date().toISOString();
      const plan = { datasetHash: this.datasetHash, studentIds: this.review.students.map(s => s.id), purpose: "source_readiness", mode,
        concurrency: 4, maxModelAttemptsPerProfile: 2, riskScoreAllowed: false, studentPublicationAllowed: false };
      this.db.prepare("INSERT INTO runs(id,dataset_hash,mode,created_at,plan_hash) VALUES(?,?,?,?,?)").run(id, this.datasetHash, mode, at, digest(plan));
      for (const student of this.review.students) this.db.prepare("INSERT INTO jobs(run_id,student_id) VALUES(?,?)").run(id, student.id);
      this.event(id, "plan.locked", plan, actor); return { runId: id, students: plan.studentIds.length, planHash: digest(plan) };
    });
  }
  overview() {
    const runs = this.db.prepare("SELECT * FROM runs WHERE dataset_hash=? ORDER BY created_at DESC").all(this.datasetHash);
    const jobs = this.db.prepare("SELECT j.run_id,j.student_id,j.revision,j.state,j.stage,j.error_code FROM jobs j JOIN runs r ON r.id=j.run_id WHERE r.dataset_hash=? ORDER BY j.student_id").all(this.datasetHash);
    return { datasetHash: this.datasetHash, model: this.composer?.modelId ?? null, localOnly: true, scope: "source_readiness", riskScore: null,
      studentPublicationAllowed: false, runs, jobs, modelProfiles: this.db.prepare("SELECT p.body FROM profiles p JOIN runs r ON r.id=p.run_id WHERE r.dataset_hash=?").all(this.datasetHash).map(row => parse<OrderingResult>(row.body)), audit: this.verifyAudit() };
  }
  caseDetail(runId: string, studentId: string) {
    const job = this.job(runId, studentId), version = this.db.prepare("SELECT * FROM versions WHERE run_id=? AND student_id=? AND revision=?").get(runId, studentId, job.revision) as Row | undefined;
    return { ...job, checkpoint: parse<{ snapshot?: Snapshot; references?: unknown; ordering?: OrderingResult }>(job.checkpoint),
      packet: version ? parse<Packet>(version.packet) : null, packetHash: version?.packet_hash ?? null,
      decisions: this.db.prepare("SELECT * FROM decisions WHERE run_id=? AND student_id=? ORDER BY created_at").all(runId, studentId),
      followups: this.db.prepare("SELECT * FROM followups WHERE run_id=? AND student_id=? ORDER BY created_at").all(runId, studentId),
      events: this.db.prepare("SELECT * FROM events WHERE subject=? ORDER BY seq").all(`${runId}:${studentId}`).map(row => ({ ...row, body: parse(row.body) })) };
  }
  private async ordering(snapshot: Snapshot, model: boolean, runId: string) {
    const composer = model ? this.composer : undefined;
    const key = digest({ tasks: requiredTasks(snapshot), model: composer?.modelId ?? null, runId });
    const cached = this.db.prepare("SELECT body FROM profiles WHERE id=?").get(key);
    if (cached) return { ...parse<OrderingResult>(cached.body), reusedProfile: true };
    if (!this.profilePromises.has(key)) this.profilePromises.set(key, (async () => {
      const result = await chooseReadinessOrder(snapshot, composer);
      // Missing configuration is a recorded degraded model request, not model execution.
      if (model && !composer) result.fallback = true;
      this.tx(() => { this.db.prepare("INSERT OR IGNORE INTO profiles VALUES(?,?,?)").run(key, runId, JSON.stringify(result)); this.event(key, "model.profile_validated", result); });
      return result;
    })());
    return { ...await this.profilePromises.get(key)!, reusedProfile: false };
  }
  async advance(runId: string, stopAfterStage?: "collected") {
    const run = this.run(runId);
    if (run.paused || this.advancing.has(runId)) return { paused: !!run.paused, busy: this.advancing.has(runId), processed: 0 };
    this.advancing.add(runId);
    try {
      const jobs = this.tx(() => {
        const candidates = this.db.prepare("SELECT * FROM jobs WHERE run_id=? AND state IN ('queued','processing') AND lease_until<=? ORDER BY student_id LIMIT 4").all(runId, Date.now()) as Job[];
        for (const job of candidates) { job.lease = randomUUID(); this.db.prepare("UPDATE jobs SET state='processing',lease=?,lease_until=? WHERE run_id=? AND student_id=?").run(job.lease, Date.now() + 180000, runId, job.student_id); }
        return candidates;
      });
      await parallelMap(jobs, 4, async job => {
        const subject = `${runId}:${job.student_id}`;
        try {
          const checkpoint = parse<{ snapshot?: Snapshot; references?: unknown; ordering?: OrderingResult }>(job.checkpoint);
          if (!checkpoint.snapshot) {
            checkpoint.snapshot = await collectCollegeSources(this.review, job.student_id);
            this.tx(() => { this.db.prepare("UPDATE jobs SET stage='collected',checkpoint=? WHERE run_id=? AND student_id=? AND lease=?").run(JSON.stringify(checkpoint), runId, job.student_id, job.lease);
              this.event(subject, "collectors.completed", { snapshotHash: digest(checkpoint.snapshot), sources: checkpoint.snapshot!.sources, cellCount: checkpoint.snapshot!.cells.length }); });
          }
          if (stopAfterStage === "collected") { this.db.prepare("UPDATE jobs SET lease_until=0 WHERE run_id=? AND student_id=? AND lease=?").run(runId, job.student_id, job.lease); return; }
          checkpoint.references = snapshotReferences(checkpoint.snapshot);
          const currentSnapshot = await collectCollegeSources(this.review, job.student_id);
          if (digest(currentSnapshot) !== digest(checkpoint.snapshot)) throw new Error("FROZEN_SOURCE_MISMATCH");
          this.tx(() => { this.db.prepare("UPDATE jobs SET stage='retrieved',checkpoint=? WHERE run_id=? AND student_id=? AND lease=?").run(JSON.stringify(checkpoint), runId, job.student_id, job.lease);
            this.event(subject, "quality.blocked_risk_and_retrieved", { reason: "unconfirmed_sources_and_missing_linked_evidence", riskScore: null, references: checkpoint.references }); });
          checkpoint.ordering = await this.ordering(checkpoint.snapshot, run.mode === "model", runId);
          const packet = formatReadinessPacket(checkpoint.snapshot, checkpoint.ordering.order);
          validateReadinessPacket(packet, checkpoint.snapshot);
          this.tx(() => {
            const current = this.job(runId, job.student_id);
            if (current.lease !== job.lease) throw new Error("JOB_LEASE_LOST");
            const revision = current.revision + 1;
            this.db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?)").run(runId, job.student_id, revision, digest(packet), JSON.stringify(packet), new Date().toISOString());
            this.db.prepare("UPDATE jobs SET revision=?,state='awaiting_review',stage='human_review',checkpoint=?,lease='',lease_until=0,error_code=NULL WHERE run_id=? AND student_id=?")
              .run(revision, JSON.stringify(checkpoint), runId, job.student_id);
            this.event(subject, "packet.validated_awaiting_local_review", { revision, packetHash: digest(packet), snapshotHash: packet.snapshotHash, method: checkpoint.ordering!.method, inputHash: checkpoint.ordering!.inputHash, studentPublicationAllowed: false });
          });
        } catch (error) {
          const code = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : "PILOT_STAGE_FAILED";
          this.tx(() => { this.db.prepare("UPDATE jobs SET state='failed',error_code=?,lease='',lease_until=0 WHERE run_id=? AND student_id=? AND lease=?").run(code, runId, job.student_id, job.lease); this.event(subject, "execution.failed", { code }); });
        }
      });
      return { paused: false, busy: false, processed: jobs.length };
    } finally { this.advancing.delete(runId); }
  }
  setPaused(runId: string, paused: boolean, commandId: string, actor: string) {
    this.run(runId);
    return this.command(commandId, { action: "pause", runId, paused, actor }, () => { this.db.prepare("UPDATE runs SET paused=? WHERE id=?").run(paused ? 1 : 0, runId); this.event(runId, paused ? "run.paused" : "run.resumed", {}, actor); return { paused }; });
  }
  retry(runId: string, studentId: string, commandId: string, actor: string) {
    return this.command(commandId, { action: "retry", runId, studentId, actor }, () => { const job = this.job(runId, studentId); if (job.state !== "failed") throw new Error("ONLY_FAILED_JOBS_CAN_RETRY");
      this.db.prepare("UPDATE jobs SET state='queued',error_code=NULL WHERE run_id=? AND student_id=?").run(runId, studentId); this.event(`${runId}:${studentId}`, "execution.retry_requested", {}, actor); return { state: "queued" }; });
  }
  edit(runId: string, studentId: string, input: unknown, actor: string) {
    const raw = z.object({ ...commandSchema.shape, taskCodes: z.array(z.string()).min(1).max(8) }).strict().parse(input);
    return this.command(raw.commandId, { action: "edit", runId, studentId, raw, actor }, () => {
      const job = this.job(runId, studentId); if (job.revision !== raw.expectedRevision) throw new Error("STALE_REVISION");
      if (!["awaiting_review", "rejected", "approved", "withdrawn"].includes(job.state)) throw new Error("PACKET_NOT_EDITABLE");
      const checkpoint = parse<{ snapshot: Snapshot }>(job.checkpoint), order = validateOrder({ taskCodes: raw.taskCodes }, requiredTasks(checkpoint.snapshot));
      const packet = formatReadinessPacket(checkpoint.snapshot, order), revision = job.revision + 1;
      this.db.prepare("INSERT INTO versions VALUES(?,?,?,?,?,?)").run(runId, studentId, revision, digest(packet), JSON.stringify(packet), new Date().toISOString());
      this.db.prepare("UPDATE jobs SET revision=?,state='awaiting_review' WHERE run_id=? AND student_id=?").run(revision, runId, studentId);
      this.event(`${runId}:${studentId}`, "packet.human_edited", { revision, priorRevision: job.revision, note: raw.note, packetHash: digest(packet), approvalRequiredAgain: true }, actor); return { revision, state: "awaiting_review" };
    });
  }
  decide(runId: string, studentId: string, kind: "approve" | "reject" | "withdraw" | "restore", input: unknown, actor: string) {
    z.enum(["approve", "reject", "withdraw", "restore"]).parse(kind);
    const raw = commandSchema.parse(input);
    return this.command(raw.commandId, { action: kind, runId, studentId, raw, actor }, () => {
      const job = this.job(runId, studentId);
      if (job.revision !== raw.expectedRevision) throw new Error("STALE_REVISION");
      const allowed = kind === "withdraw" ? ["approved"] : kind === "restore" ? ["withdrawn"] : ["awaiting_review"];
      if (!allowed.includes(job.state)) throw new Error("INVALID_REVIEW_TRANSITION");
      const packet = this.db.prepare("SELECT packet_hash,packet FROM versions WHERE run_id=? AND student_id=? AND revision=?").get(runId, studentId, job.revision)!;
      validateReadinessPacket(parse<Packet>(packet.packet), parse<{ snapshot: Snapshot }>(job.checkpoint).snapshot);
      const state = kind === "reject" ? "rejected" : kind === "withdraw" ? "withdrawn" : "approved";
      this.db.prepare("INSERT INTO decisions VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(), runId, studentId, job.revision, String(packet.packet_hash), kind, raw.note, actor, new Date().toISOString());
      this.db.prepare("UPDATE jobs SET state=? WHERE run_id=? AND student_id=?").run(state, runId, studentId);
      this.event(`${runId}:${studentId}`, `clarification_plan.${kind}`, { revision: job.revision, packetHash: packet.packet_hash, note: raw.note, meaning: "local clarification checklist only; no institutional sign-off or student publication" }, actor); return { state, revision: job.revision, studentPublicationAllowed: false };
    });
  }
  followup(runId: string, studentId: string, input: unknown, actor: string) {
    const raw = z.object({ ...commandSchema.shape, taskCode: z.string(), status: z.enum(["in_progress", "response_recorded"]) }).strict().parse(input);
    return this.command(raw.commandId, { action: "followup", runId, studentId, raw, actor }, () => {
      const job = this.job(runId, studentId); if (job.revision !== raw.expectedRevision) throw new Error("STALE_REVISION");
      if (job.state !== "approved") throw new Error("LOCAL_CHECKLIST_APPROVAL_REQUIRED");
      const packet = parse<Packet>(this.db.prepare("SELECT packet FROM versions WHERE run_id=? AND student_id=? AND revision=?").get(runId, studentId, job.revision)!.packet);
      if (!packet.tasks.some(t => t.code === raw.taskCode)) throw new Error("TASK_OUT_OF_SCOPE");
      this.db.prepare("INSERT INTO followups VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(), runId, studentId, job.revision, raw.taskCode, raw.status, raw.note, actor, new Date().toISOString());
      this.event(`${runId}:${studentId}`, "clarification.followup_recorded", { taskCode: raw.taskCode, status: raw.status, note: raw.note, sourceDefinitionsChanged: false, riskScore: null }, actor); return { status: raw.status, sourceDefinitionsChanged: false };
    });
  }
  verifyAudit() {
    let previous = "0".repeat(64); const events = this.db.prepare("SELECT * FROM events ORDER BY seq").all();
    for (const row of events) {
      if (row.previous_hash !== previous || row.event_hash !== eventHash(previous, String(row.subject), String(row.kind), parse(row.body), String(row.actor), String(row.created_at))) return { valid: false, events: events.length };
      previous = String(row.event_hash);
    }
    return { valid: true, events: events.length, head: previous };
  }
  async replay(runId: string, studentId: string) {
    const detail = this.caseDetail(runId, studentId), snapshot = detail.checkpoint.snapshot;
    if (!snapshot || !detail.packet) throw new Error("PACKET_NOT_READY");
    validateReadinessPacket(detail.packet, snapshot);
    const current = await collectCollegeSources(this.review, studentId);
    const audit = this.verifyAudit();
    const versionHashesValid = this.db.prepare("SELECT packet,packet_hash FROM versions WHERE run_id=? AND student_id=?").all(runId, studentId).every(row => digest(parse(row.packet)) === row.packet_hash);
    return { valid: audit.valid && versionHashesValid && digest(current) === digest(snapshot) && digest(detail.packet) === detail.packetHash,
      sourceHashMatches: digest(current) === digest(snapshot), versionHashesValid, audit, modelRegenerationClaimed: false, riskScore: null };
  }
  exportCase(runId: string, studentId: string) { return { schemaVersion: "aura.private-college-pilot-export.v1", datasetHash: this.datasetHash, privacy: "private_pseudonymized", ...this.caseDetail(runId, studentId) }; }
  publish(runId: string, studentId: string): never { this.job(runId, studentId); throw new Error("DATA_NOT_READY_FOR_STUDENT_PUBLICATION"); }
}
