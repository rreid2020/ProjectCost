/**
 * Deletes the local PGlite database and recreates it empty. Stop `npm run dev` first (PGlite allows one process).
 * Sample data is now loaded per company from onboarding ("Start with sample data").
 */
import { rmSync } from "node:fs";

const url = process.env.DATABASE_URL ?? "./data/pglite";
if (/^postgres(ql)?:\/\//.test(url)) {
  console.error("DATABASE_URL points at a Postgres server; refusing to reset it. This script only resets local PGlite.");
  process.exit(1);
}
rmSync(url.replace(/^file:/, ""), { recursive: true, force: true });

import("../src/db")
  .then(async ({ migrateDb, closeDb }) => { await migrateDb(); await closeDb(); })
  .then(() => { console.log("Local database reset:", url); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
