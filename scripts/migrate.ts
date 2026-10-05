/**
 * Applies SQL migrations in ./drizzle to the database (Neon in production, local PGlite otherwise).
 * Prefers DATABASE_URL_UNPOOLED (Neon's direct connection, set by the Vercel integration) for migrations.
 */
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

import("../src/db")
  .then(async ({ migrateDb, closeDb }) => { await migrateDb(); await closeDb(); })
  .then(() => { console.log("Database is up to date."); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
