"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireAdmin } from "@/lib/tenant";
import { QboError, fetchCompanyInfo, qboFetch, revokeConnection } from "@/lib/qbo";
import { importWindowStart, pagedQuery, runImport } from "@/lib/qbo-import";
import { importOverheadPool } from "@/lib/overhead";

const log = (companyId: string, userId: string, status: string, message: string, qboId: string | null = null, entity = "Connection") =>
  db.insert(s.syncLogs).values({ companyId, userId, entity, qboId, direction: "PULL", status, message, createdAt: new Date().toISOString() });

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

/** Imports (or re-syncs) from QuickBooks. First run also records how projects are set up in QuickBooks. */
export async function importFromQbo(form: FormData) {
  const t = await requireAdmin();
  if (!t.company.qboRealmId) redirect("/settings");
  if (t.company.sampleDataLoadedAt) redirect("/settings?qbo=remove_sample");
  const mode = String(form.get("mode") ?? "");
  if (mode === "jobs" || mode === "customers") await db.update(s.companies).set({ qboProjectMode: mode }).where(eq(s.companies.id, t.company.id));

  // one run at a time per company (a run older than 15 minutes is treated as dead)
  const recent = await db.query.qboImportRuns.findFirst({
    where: and(eq(s.qboImportRuns.companyId, t.company.id), eq(s.qboImportRuns.status, "RUNNING"), gte(s.qboImportRuns.startedAt, new Date(Date.now() - 15 * 60_000).toISOString())),
  });
  if (recent) redirect("/settings?qbo=import_running");

  const startedAt = new Date().toISOString();
  const [run] = await db.insert(s.qboImportRuns).values({ companyId: t.company.id, userId: t.userId, status: "RUNNING", since: importWindowStart(), startedAt }).returning();
  let outcome = "imported";
  try {
    const query = pagedQuery((q) => qboFetch(t.company.id, `query?query=${encodeURIComponent(q)}`));
    const summary = await runImport({ companyId: t.company.id, query });
    await db.update(s.qboImportRuns).set({ status: "OK", finishedAt: new Date().toISOString(), summary: JSON.stringify(summary) }).where(eq(s.qboImportRuns.id, run.id));
    // Overhead pool (P&L). A failure here doesn't undo the import.
    try {
      await importOverheadPool({ companyId: t.company.id, report: (path) => qboFetch(t.company.id, path) });
    } catch (e) {
      await log(t.company.id, t.userId, "ERROR", `Overhead pool (Profit and Loss) not refreshed: ${e instanceof Error ? e.message : String(e)}`, t.company.qboRealmId, "Import");
    }
    await log(t.company.id, t.userId, "OK", `Imported: ${summary.projects} projects (${summary.newProjects} new), ${summary.costLines} cost lines (${summary.needsCoding} to code), ${summary.timeEntries} time entries, ${summary.invoices} invoices`, t.company.qboRealmId, "Import");
  } catch (e) {
    const tid = e instanceof QboError && e.intuitTid ? ` (intuit_tid ${e.intuitTid})` : "";
    const message = `${e instanceof Error ? e.message : String(e)}${tid}`;
    await db.update(s.qboImportRuns).set({ status: "ERROR", finishedAt: new Date().toISOString(), error: message }).where(eq(s.qboImportRuns.id, run.id));
    await log(t.company.id, t.userId, "ERROR", `Import failed: ${message}`, t.company.qboRealmId, "Import");
    outcome = e instanceof QboError && e.reconnect ? "expired" : "import_failed";
  }
  revalidatePath("/", "layout");
  redirect(`/settings?qbo=${outcome}`);
}
