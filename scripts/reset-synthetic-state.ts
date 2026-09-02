import { pool } from "../lib/aura/db";
import { initialState } from "../lib/aura/runtime";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO aura_state (id, state, version) VALUES (1, $1::jsonb, 1)
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, version = aura_state.version + 1, updated_at = NOW()`,
      [JSON.stringify(initialState())],
    );
    await client.query(
      `INSERT INTO aura_audit_events (event_type, actor_user_id, actor_role, subject_id, state, detail)
       VALUES ('SYNTHETIC_BASELINE_INSTALLED', 'deployment/migration', 'RUNTIME', 'CSE-AI-SYNTHETIC', 'COMPLETED', $1::jsonb)`,
      [JSON.stringify({ interventionCount: 0, mentorGateRequired: true })],
    );
    await client.query("COMMIT");
    process.stdout.write("Installed the mentor-gated synthetic baseline; historical append-only records were retained.\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
