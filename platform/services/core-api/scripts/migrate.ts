import { closePool } from "../lib/db";
import { migrateCoreDatabase } from "../lib/migrations";

try {
  await migrateCoreDatabase();
  process.stdout.write("AURA Core migrations are current.\n");
} finally {
  await closePool();
}
