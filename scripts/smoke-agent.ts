import { executeAgentCycle, MODEL_ID } from "../lib/aura/agent";
import { pool } from "../lib/aura/db";
import { initialState } from "../lib/aura/runtime";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = initialState();
    const result = await executeAgentCycle(client, state, "smoke/local-authorised-operator");
    process.stdout.write(JSON.stringify({
      ok: true,
      runId: result.runId,
      modelId: MODEL_ID,
      modelUsed: result.modelUsed,
      lineageRecords: result.lineage.length,
      dataBlocked: result.lineage.filter((item) => item.status === "DATA_BLOCKED").length,
      repaired: result.lineage.filter((item) => item.repairArtifactId).length,
    }, null, 2));
    process.stdout.write("\n");
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
