import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required");
const client = new pg.Client({ connectionString });
const suffix = randomUUID().slice(0, 8);
const evidence = { rejectedDecisionBlocked: false, auditMutationBlocked: false, approvedDecisionAllowed: false, causalClaimBlocked: false };

await client.connect();
try {
  await client.query("BEGIN");
  const rejectedDecision = `DEC-REJECT-${suffix}`;
  await client.query(
    `INSERT INTO aura_mentor_decisions (decision_id, case_id, mentor_user_id, outcome, rationale)
     VALUES ($1, 'CASE-TEST', 'mentor-test', 'REJECTED', 'invariant test')`,
    [rejectedDecision],
  );
  await client.query("SAVEPOINT rejected_gate");
  try {
    await client.query(
      `INSERT INTO aura_interventions (intervention_id, decision_id, case_id, mentor_user_id, support_code, status)
       VALUES ($1, $2, 'CASE-TEST', 'mentor-test', 'SUP-TEST', 'PLANNED')`,
      [`INT-REJECT-${suffix}`, rejectedDecision],
    );
  } catch (error) {
    evidence.rejectedDecisionBlocked = String(error.message).includes("mentor approval is required");
    await client.query("ROLLBACK TO SAVEPOINT rejected_gate");
  }

  const audit = await client.query(
    `INSERT INTO aura_audit_events (event_type, actor_user_id, actor_role, subject_id, state)
     VALUES ('INVARIANT_TEST', 'test/runtime', 'RUNTIME', 'CASE-TEST', 'TEMP') RETURNING event_id`,
  );
  await client.query("SAVEPOINT audit_gate");
  try {
    await client.query("UPDATE aura_audit_events SET state = 'MUTATED' WHERE event_id = $1", [audit.rows[0].event_id]);
  } catch (error) {
    evidence.auditMutationBlocked = String(error.message).includes("append-only");
    await client.query("ROLLBACK TO SAVEPOINT audit_gate");
  }

  const approvedDecision = `DEC-APPROVE-${suffix}`;
  const intervention = `INT-APPROVE-${suffix}`;
  await client.query(
    `INSERT INTO aura_mentor_decisions (decision_id, case_id, mentor_user_id, outcome, rationale)
     VALUES ($1, 'CASE-TEST', 'mentor-test', 'APPROVED', 'invariant test')`,
    [approvedDecision],
  );
  await client.query(
    `INSERT INTO aura_interventions (intervention_id, decision_id, case_id, mentor_user_id, support_code, status)
     VALUES ($1, $2, 'CASE-TEST', 'mentor-test', 'SUP-TEST', 'PLANNED')`,
    [intervention, approvedDecision],
  );
  evidence.approvedDecisionAllowed = true;

  await client.query("SAVEPOINT causal_gate");
  try {
    await client.query(
      `INSERT INTO aura_followups (followup_id, intervention_id, recorded_by, operational_outcome, causal_claim)
       VALUES ($1, $2, 'mentor-test', 'test', TRUE)`,
      [`FUP-${suffix}`, intervention],
    );
  } catch {
    evidence.causalClaimBlocked = true;
    await client.query("ROLLBACK TO SAVEPOINT causal_gate");
  }
  await client.query("ROLLBACK");
  if (Object.values(evidence).some((value) => !value)) throw new Error(`Invariant failure: ${JSON.stringify(evidence)}`);
  process.stdout.write(`${JSON.stringify({ ok: true, ...evidence }, null, 2)}\n`);
} finally {
  await client.end();
}
