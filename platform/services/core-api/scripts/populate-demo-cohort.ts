import { closePool } from "../lib/db";
import { demoCohortReport, populateDemoCohort } from "../lib/populate-demo";

try {
  // Read-only by default. The institution and fictional account checks also run on apply.
  const result = process.argv.includes("--apply")
    ? await populateDemoCohort(message => process.stderr.write(`${message}\n`))
    : await demoCohortReport();
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
} finally { await closePool(); }
