/** Applies SQL migrations in ./drizzle to DATABASE_URL (Neon in production, local PGlite otherwise). */
import { migrateDb, closeDb } from "../src/db";

migrateDb()
  .then(() => console.log("Database is up to date."))
  .then(closeDb)
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
