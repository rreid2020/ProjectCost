"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireAdmin } from "@/lib/tenant";
import { QboError, fetchCompanyInfo, revokeConnection } from "@/lib/qbo";

const log = (companyId: string, userId: string, status: string, message: string, qboId: string | null = null) =>
  db.insert(s.syncLogs).values({ companyId, userId, entity: "Connection", qboId, direction: "PULL", status, message, createdAt: new Date().toISOString() });

/** Revokes the grant at Intuit and forgets the tokens. Data already in ProjectCost stays. */
export async function disconnectQbo() {
  const t = await requireAdmin({ allowInactive: true });
  await revokeConnection(t.company.id);
  await db.update(s.companies).set({ qboRealmId: null, qboConnectedAt: null }).where(eq(s.companies.id, t.company.id));
  await log(t.company.id, t.userId, "OK", `Disconnected from QuickBooks company "${t.company.qboCompanyName ?? t.company.qboRealmId}"`, t.company.qboRealmId);
  revalidatePath("/", "layout");
  redirect("/settings?qbo=disconnected");
}

/** Calls CompanyInfo with the stored tokens (refreshing them if needed) and records the result. */
export async function testQboConnection() {
  const t = await requireAdmin({ allowInactive: true });
  if (!t.company.qboRealmId) redirect("/settings");
  let status = "tested";
  try {
    const info = await fetchCompanyInfo(t.company.id, t.company.qboRealmId);
    await db.update(s.companies).set({ qboCompanyName: info.CompanyName }).where(eq(s.companies.id, t.company.id));
    await log(t.company.id, t.userId, "OK", `Connection OK: "${info.CompanyName}"`, t.company.qboRealmId);
  } catch (e) {
    const tid = e instanceof QboError && e.intuitTid ? ` (intuit_tid ${e.intuitTid})` : "";
    await log(t.company.id, t.userId, "ERROR", `Connection test failed: ${e instanceof Error ? e.message : String(e)}${tid}`, t.company.qboRealmId);
    status = e instanceof QboError && e.reconnect ? "expired" : "test_failed";
  }
  revalidatePath("/settings");
  redirect(`/settings?qbo=${status}`);
}
