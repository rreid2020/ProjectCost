import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/projectcost.db";

const globalForDb = globalThis as unknown as { client?: ReturnType<typeof createClient> };
const client = globalForDb.client ?? createClient({ url });
if (process.env.NODE_ENV !== "production") globalForDb.client = client;

export const db = drizzle(client, { schema });
export { schema };
