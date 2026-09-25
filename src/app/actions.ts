"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema as s } from "@/db";
import { and, eq, max, inArray } from "drizzle-orm";
import { toCents } from "@/lib/format";
import { loadPortfolio } from "@/lib/queries";

const nowIso = () => new Date().toISOString();
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function log(companyId: string, entity: string, message: string, status = "QUEUED") {
  await db.insert(s.syncLogs).values({ companyId, entity, direction: "PUSH", status, message, createdAt: nowIso() });
}

// ---------- Unassigned costs ----------
export async function assignCost(form: FormData) {
  const id = str(form, "id"), projectId = str(form, "projectId"), costCodeId = str(form, "costCodeId");
  if (!projectId || !costCodeId) return;
  const [t] = await db.update(s.costTransactions)
    .set({ projectId, costCodeId, assignedAt: nowIso(), pendingPush: true })
    .where(eq(s.costTransactions.id, id)).returning();
  // When QBO is connected, the sync worker writes ProjectRef + Class back to the QBO line.
  await log(t.companyId, "Bill line", `Assign ${t.docNumber ?? t.id} to project/cost code (writes ProjectRef on QBO line)`);
  revalidatePath("/", "layout");
}

// ---------- Change orders ----------
export async function createChangeOrder(form: FormData) {
  const projectId = str(form, "projectId");
  const [{ n }] = await db.select({ n: max(s.changeOrders.number) }).from(s.changeOrders).where(eq(s.changeOrders.projectId, projectId));
  const [co] = await db.insert(s.changeOrders).values({
    projectId, number: (n ?? 0) + 1, title: str(form, "title") || "Untitled change",
    contractAmountCents: toCents(str(form, "contractAmount")), dateIssued: new Date().toISOString().slice(0, 10),
  }).returning();
  const lines = [0, 1, 2].map((i) => ({ costCodeId: str(form, `code${i}`), costCents: toCents(str(form, `cost${i}`)) })).filter((l) => l.costCodeId && l.costCents);
  if (lines.length) await db.insert(s.changeOrderLines).values(lines.map((l) => ({ ...l, changeOrderId: co.id })));
  revalidatePath(`/projects/${projectId}`);
}

export async function setChangeOrderStatus(form: FormData) {
  const id = str(form, "id"), status = str(form, "status");
  const [co] = await db.update(s.changeOrders).set({ status, dateApproved: status === "APPROVED" ? new Date().toISOString().slice(0, 10) : null })
    .where(eq(s.changeOrders.id, id)).returning();
  if (status === "APPROVED") {
    // approved CO becomes its own schedule-of-values line so it can be billed
    const [{ n }] = await db.select({ n: max(s.sovLines.lineNo) }).from(s.sovLines).where(eq(s.sovLines.projectId, co.projectId));
    await db.insert(s.sovLines).values({ projectId: co.projectId, lineNo: (n ?? 0) + 1, description: `CO #${co.number}: ${co.title}`, scheduledValueCents: co.contractAmountCents, changeOrderNumber: co.number });
  }
  revalidatePath("/", "layout");
}

// ---------- Forecast (estimate to complete) ----------
export async function saveForecast(form: FormData) {
  const projectId = str(form, "projectId"), costCodeId = str(form, "costCodeId"), raw = str(form, "etc");
  if (raw === "") {
    await db.delete(s.forecasts).where(and(eq(s.forecasts.projectId, projectId), eq(s.forecasts.costCodeId, costCodeId)));
  } else {
    await db.insert(s.forecasts).values({ projectId, costCodeId, etcCents: toCents(raw), updatedAt: nowIso() })
      .onConflictDoUpdate({ target: [s.forecasts.projectId, s.forecasts.costCodeId], set: { etcCents: toCents(raw), updatedAt: nowIso() } });
  }
  revalidatePath(`/projects/${projectId}`);
}

// ---------- Progress billing ----------
export async function createProgressBill(form: FormData) {
  const projectId = str(form, "projectId");
  const periodEnd = str(form, "periodEnd");
  const sov = await db.select().from(s.sovLines).where(eq(s.sovLines.projectId, projectId));
  const lines = sov.map((l) => ({ sovLineId: l.id, thisPeriodCents: toCents(str(form, `line_${l.id}`)) })).filter((l) => l.thisPeriodCents !== 0);
  if (!lines.length) return;
  const [{ n }] = await db.select({ n: max(s.progressBills.number) }).from(s.progressBills).where(eq(s.progressBills.projectId, projectId));
  const [bill] = await db.insert(s.progressBills).values({ projectId, number: (n ?? 0) + 1, periodEnd, status: "DRAFT" }).returning();
  await db.insert(s.progressBillLines).values(lines.map((l) => ({ ...l, progressBillId: bill.id })));
  redirect(`/projects/${projectId}?tab=billing`);
}

export async function postProgressBill(form: FormData) {
  const id = str(form, "id");
  const [bill] = await db.update(s.progressBills).set({ status: "POSTED" }).where(eq(s.progressBills.id, id)).returning();
  const p = await db.query.projects.findFirst({ where: eq(s.projects.id, bill.projectId) });
  await log(p!.companyId, "Invoice", `Progress bill #${bill.number} for ${p!.number} → QBO Invoice (net of holdback; holdback to 'Holdbacks receivable')`);
  revalidatePath("/", "layout");
}

export async function deleteProgressBill(form: FormData) {
  await db.delete(s.progressBills).where(and(eq(s.progressBills.id, str(form, "id")), eq(s.progressBills.status, "DRAFT")));
  revalidatePath("/", "layout");
}

// ---------- Time ----------
export async function addTimeEntry(form: FormData) {
  const emp = await db.query.employees.findFirst({ where: eq(s.employees.id, str(form, "employeeId")) });
  if (!emp) return;
  const hrs = parseFloat(str(form, "hours"));
  if (!(hrs > 0 && hrs <= 24)) return;
  await db.insert(s.timeEntries).values({
    employeeId: emp.id, projectId: str(form, "projectId"), costCodeId: str(form, "costCodeId"), date: str(form, "date"),
    hoursX100: Math.round(hrs * 100), payRateCents: emp.payRateCents, burdenBp: emp.burdenBp, billRateCents: emp.billRateCents,
    notes: str(form, "notes") || null,
  });
  revalidatePath("/", "layout");
}

export async function approveTime(form: FormData) {
  const ids = form.getAll("ids").map(String);
  if (!ids.length) return;
  await db.update(s.timeEntries).set({ status: "APPROVED" }).where(inArray(s.timeEntries.id, ids));
  const c = await db.query.companies.findFirst();
  await log(c!.id, "TimeActivity", `${ids.length} approved time entr${ids.length === 1 ? "y" : "ies"} → QBO TimeActivity`);
  revalidatePath("/", "layout");
}

// ---------- Cost codes ----------
export async function addCostCode(form: FormData) {
  const c = await db.query.companies.findFirst();
  const code = str(form, "code"), name = str(form, "name");
  if (!code || !name) return;
  await db.insert(s.costCodes).values({ companyId: c!.id, code, name, costType: str(form, "costType") || "OTHER" }).onConflictDoNothing();
  revalidatePath("/cost-codes");
}

// ---------- WIP close ----------
export async function closeWipPeriod(form: FormData) {
  const periodEnd = str(form, "periodEnd");
  const { company, projects } = await loadPortfolio(["ACTIVE"]);
  for (const p of projects) {
    const e = p.econ;
    const row = {
      projectId: p.project.id, periodEnd, contractCents: e.revisedContract, eacCents: e.eac, costToDateCents: e.costToDate,
      pctCompleteBp: e.pctCompleteBp, earnedCents: e.earnedRevenue, billedCents: e.billedToDate, overUnderCents: e.overUnder,
      lossProvisionCents: e.lossProvision, createdAt: nowIso(),
    };
    await db.insert(s.wipSnapshots).values(row).onConflictDoUpdate({ target: [s.wipSnapshots.projectId, s.wipSnapshots.periodEnd], set: row });
  }
  await log(company.id, "JournalEntry", `WIP entry for ${periodEnd} (reversing on day 1 of next period)`);
  revalidatePath("/wip");
}
