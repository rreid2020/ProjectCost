// DATABASE_URL picks the driver:
//   postgres://… / postgresql://…  -> node-postgres (Neon in production; use the pooled connection string)
//   memory://                      -> in-memory PGlite (tests)
//   anything else / unset          -> PGlite in a local folder (default ./data/pglite), no Postgres install needed
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { mkdirSync } from "node:fs";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const url = process.env.DATABASE_URL ?? "./data/pglite";
const isPostgres = /^postgres(ql)?:\/\//.test(url);

type Conn = { db: DB; kind: "pg"; pool: Pool } | { db: DB; kind: "pglite"; client: PGlite };

function connect(): Conn {
  if (isPostgres) {
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
    return { kind: "pg", pool, db: drizzlePg(pool, { schema }) };
  }
  const dir = url.replace(/^file:/, "");
  if (url !== "memory://") mkdirSync(dir, { recursive: true });
  const client = url === "memory://" ? new PGlite() : new PGlite(dir);
  // Same query builder API; only the driver differs.
  return { kind: "pglite", client, db: drizzlePglite(client, { schema }) as unknown as DB };
}

// Connect lazily (so `next build` workers that merely import this module don't all open the local
// database) and reuse one connection across Next.js dev hot reloads.
const g = globalThis as unknown as { __pcConn?: Conn };
function conn(): Conn {
  return (g.__pcConn ??= connect());
}

export const db = new Proxy({} as DB, {
  get(_, prop) {
    const real = conn().db;
    const v = Reflect.get(real, prop, real);
    return typeof v === "function" ? v.bind(real) : v;
  },
});
export { schema };

export async function migrateDb() {
  const c = conn(), migrationsFolder = "./drizzle";
  if (c.kind === "pg") await migratePg(c.db, { migrationsFolder });
  else await migratePglite(drizzlePglite(c.client), { migrationsFolder });
}

export async function closeDb() {
  const c = g.__pcConn;
  if (!c) return;
  g.__pcConn = undefined;
  if (c.kind === "pg") await c.pool.end();
  else await c.client.close();
}
