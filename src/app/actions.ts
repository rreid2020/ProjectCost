"use server";
// Every action resolves the caller's company via requireWrite()/requireAdmin() and scopes every read and
// write to it. IDs from the form are never trusted on their own: updates filter by company_id, and inserts
// that reference other rows are also checked by the composite (company_id, *_id) foreign keys.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema as s } from "@/db";
import { and, eq, max, inArray } from "drizzle-orm";
import { toCents } from "@/lib/format";
import { loadPortfolio } from "@/lib/queries";
import { requireAdmin, requireWrite, type Tenant } from "@/lib/tenant";

const nowIso = () => new Date().toISOString();
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function log(t: Tenant, entity: string, message: string, status = "QUEUED") {
  await db.insert(s.syncLogs).values({ companyId: t.company.id, userId: t.userId, entity, direction: "PUSH", status, message, createdAt: nowIso() });
}

/** Throws unless the project belongs to the caller's company. */
async function ownProject(companyId: string, projectId: string) {
  const p = await db.query.projects.findFirst({ where: and(eq(s.projects.id, projectId), eq(s.projects.companyId, companyId)) });
  if (!p) throw new Error("Project not found.");
  return p;
}

// ---------- Unassigned costs ----------
export async function assignCost(form: FormData) {
  const t = await requireWrite();
  const id = str(form, "id"), projectId = str(form, "projectId"), costCodeId = str(form, "costCodeId");
  if (!projectId || !costCodeId) return;
  const [txn] = await db.update(s.costTransactions)
    .set({ projectId, costCodeId, assignedAt: nowIso(), pendingPush: true })
    .where(and(eq(s.costTransactions.id, id), eq(s.costTransactions.companyId, t.company.id))).returning();
  if (!txn) return;
  // When QBO is connected, the sync worker writes ProjectRef + Class back to the QBO line.
  await log(t, "Bill line", `Assign ${txn.docNumber ?? txn.id} to project/cost code (writes ProjectRef on QBO line)`);
  revalidatePath("/", "layout");
}

// ---------- Change orders ----------
export async function createChangeOrder(form: FormData) {
  const t = await requireWrite();
  const project = await ownProject(t.company.id, str(form, "projectId"));
  const [{ n }] = await db.select({ n: max(s.changeOrders.number) }).from(s.changeOrders).where(eq(s.changeOrders.projectId, project.id));
  const [co] = await db.insert(s.changeOrders).values({
    companyId: t.company.id, projectId: project.id, number: (n ?? 0) + 1, title: str(form, "title") || "Untitled change",
    contractAmountCents: toCents(str(form, "contractAmount")), dateIssued: new Date().toISOString().slice(0, 10),
  }).returning();
  const lines = [0, 1, 2].map((i) => ({ costCodeId: str(form, `code${i}`), costCents: toCents(str(form, `cost${i}`)) })).filter((l) => l.costCodeId && l.costCents);
  if (lines.length) await db.insert(s.changeOrderLines).values(lines.map((l) => ({ ...l, companyId: t.company.id, changeOrderId: co.id })));
  revalidatePath(`/projects/${project.id}`);
}

export async function setChangeOrderStatus(form: FormData) {
  const t = await requireWrite();
  const id = str(form, "id"), status = str(form, "status");
  if (status !== "APPROVED" && status !== "REJECTED") return;
  // Only pending COs change status, so a double-submit can't add a second SOV line.
  const [co] = await db.update(s.changeOrders).set({ status, dateApproved: status === "APPROVED" ? new Date().toISOString().slice(0, 10) : null })
    .where(and(eq(s.changeOrders.id, id), eq(s.changeOrders.companyId, t.company.id), eq(s.changeOrders.status, "PENDING"))).returning();
  if (!co) return;
  if (status === "APPROVED") {
    // approved CO becomes its own schedule-of-values line so it can be billed
    const [{ n }] = await db.select({ n: max(s.sovLines.lineNo) }).from(s.sovLines).where(eq(s.sovLines.projectId, co.projectId));
    await db.insert(s.sovLines).values({ companyId: t.company.id, projectId: co.projectId, lineNo: (n ?? 0) + 1, description: `CO #${co.number}: ${co.title}`, scheduledValueCents: co.contractAmountCents, changeOrderNumber: co.number });
  }
  revalidatePath("/", "layout");
}

// ---------- Forecast (estimate to complete) ----------
export async function saveForecast(form: FormData) {
  const t = await requireWrite();
  const project = await ownProject(t.company.id, str(form, "projectId"));
  const costCodeId = str(form, "costCodeId"), raw = str(form, "etc");
  if (raw === "") {
    await db.delete(s.forecasts).where(and(eq(s.forecasts.companyId, t.company.id), eq(s.forecasts.projectId, project.id), eq(s.forecasts.costCodeId, costCodeId)));
  } else {
    await db.insert(s.forecasts).values({ companyId: t.company.id, projectId: project.id, costCodeId, etcCents: toCents(raw), updatedAt: nowIso() })
      .onConflictDoUpdate({ target: [s.forecasts.projectId, s.forecasts.costCodeId], set: { etcCents: toCents(raw), updatedAt: nowIso() } });
  }
  revalidatePath(`/projects/${project.id}`);
}

// ---------- Progress billing ----------
export async function createProgressBill(form: FormData) {
  const t = await requireWrite();
  const project = await ownProject(t.company.id, str(form, "projectId"));
  const periodEnd = str(form, "periodEnd");
  const sov = await db.select().from(s.sovLines).where(and(eq(s.sovLines.projectId, project.id), eq(s.sovLines.companyId, t.company.id)));
  const lines = sov.map((l) => ({ sovLineId: l.id, thisPeriodCents: toCents(str(form, `line_${l.id}`)) })).filter((l) => l.thisPeriodCents !== 0);
  if (!lines.length) return;
  const [{ n }] = await db.select({ n: max(s.progressBills.number) }).from(s.progressBills).where(eq(s.progressBills.projectId, project.id));
  const [bill] = await db.insert(s.progressBills).values({ companyId: t.company.id, projectId: project.id, number: (n ?? 0) + 1, periodEnd, status: "DRAFT" }).returning();
  await db.insert(s.progressBillLines).values(lines.map((l) => ({ ...l, companyId: t.company.id, progressBillId: bill.id })));
  redirect(`/projects/${project.id}?tab=billing`);
}

export async function postProgressBill(form: FormData) {
  const t = await requireWrite();
  const [bill] = await db.update(s.progressBills).set({ status: "POSTED" })
    .where(and(eq(s.progressBills.id, str(form, "id")), eq(s.progressBills.companyId, t.company.id), eq(s.progressBills.status, "DRAFT"))).returning();
  if (!bill) return;
  const p = await ownProject(t.company.id, bill.projectId);
  await log(t, "Invoice", `Progress bill #${bill.number} for ${p.number} → QBO Invoice (net of holdback; holdback to 'Holdbacks receivable')`);
  revalidatePath("/", "layout");
}

export async function deleteProgressBill(form: FormData) {
  const t = await requireWrite();
  await db.delete(s.progressBills).where(and(eq(s.progressBills.id, str(form, "id")), eq(s.progressBills.companyId, t.company.id), eq(s.progressBills.status, "DRAFT")));
  revalidatePath("/", "layout");
}

// ---------- Time ----------
export async function addTimeEntry(form: FormData) {
  const t = await requireWrite();
  const emp = await db.query.employees.findFirst({ where: and(eq(s.employees.id, str(form, "employeeId")), eq(s.employees.companyId, t.company.id)) });
  if (!emp) return;
  const hrs = parseFloat(str(form, "hours"));
  if (!(hrs > 0 && hrs <= 24)) return;
  const project = await ownProject(t.company.id, str(form, "projectId"));
  await db.insert(s.timeEntries).values({
    companyId: t.company.id, employeeId: emp.id, projectId: project.id, costCodeId: str(form, "costCodeId"), date: str(form, "date"),
    hoursX100: Math.round(hrs * 100), payRateCents: emp.payRateCents, burdenBp: emp.burdenBp, billRateCents: emp.billRateCents,
    notes: str(form, "notes") || null,
  });
  revalidatePath("/", "layout");
}

export async function approveTime(form: FormData) {
  const t = await requireWrite();
  const ids = form.getAll("ids").map(String);
  if (!ids.length) return;
  const rows = await db.update(s.timeEntries).set({ status: "APPROVED" })
    .where(and(inArray(s.timeEntries.id, ids), eq(s.timeEntries.companyId, t.company.id), eq(s.timeEntries.status, "SUBMITTED")))
    .returning({ id: s.timeEntries.id });
  if (rows.length) await log(t, "TimeActivity", `${rows.length} approved time entr${rows.length === 1 ? "y" : "ies"} → QBO TimeActivity`);
  revalidatePath("/", "layout");
}

// ---------- Cost codes ----------
export async function addCostCode(form: FormData) {
  const t = await requireAdmin();
  const code = str(form, "code"), name = str(form, "name");
  if (!code || !name) return;
  const costType = ["LABOUR", "MATERIAL", "SUB", "EQUIPMENT", "OTHER"].includes(str(form, "costType")) ? str(form, "costType") : "OTHER";
  await db.insert(s.costCodes).values({ companyId: t.company.id, code, name, costType }).onConflictDoNothing();
  revalidatePath("/cost-codes");
}

// ---------- WIP close ----------
export async function closeWipPeriod(form: FormData) {
  const t = await requireAdmin();
  const periodEnd = str(form, "periodEnd");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return;
  const projects = await loadPortfolio(t.company.id, ["ACTIVE"], ["CONTRACT"]);
  for (const p of projects) {
    const e = p.econ;
    const row = {
      companyId: t.company.id, projectId: p.project.id, periodEnd, contractCents: e.revisedContract, eacCents: e.eac, costToDateCents: e.costToDate,
      pctCompleteBp: e.pctCompleteBp, earnedCents: e.earnedRevenue, billedCents: e.billedToDate, overUnderCents: e.overUnder,
      lossProvisionCents: e.lossProvision, createdAt: nowIso(),
    };
    await db.insert(s.wipSnapshots).values(row).onConflictDoUpdate({ target: [s.wipSnapshots.projectId, s.wipSnapshots.periodEnd], set: row });
  }
  await log(t, "JournalEntry", `WIP entry for ${periodEnd} (reversing on day 1 of next period)`);
  revalidatePath("/wip");
}

// ---------- Sample data ----------
/**
 * Clears the demo data from a workspace that loaded it at onboarding: projects and everything under them,
 * costs, time, customers, vendors, employees and cost codes. Company settings, team, billing and the
 * QuickBooks connection stay. Only offered while sample_data_loaded_at is set.
 */
export async function removeSampleData(form: FormData) {
  const t = await requireAdmin({ allowInactive: true });
  if (!t.company.sampleDataLoadedAt || form.get("confirm") !== "on") return;
  const c = t.company.id;
  await db.transaction(async (tx) => {
    // children before parents; every delete is scoped to this company
    for (const table of [
      s.progressBillLines, s.progressBills, s.sovLines, s.wipSnapshots, s.forecasts, s.changeOrderLines, s.changeOrders,
      s.budgetLines, s.costTransactions, s.timeEntries, s.projects, s.employees, s.vendors, s.customers, s.costCodes,
    ]) await tx.delete(table).where(eq(table.companyId, c));
    await tx.update(s.companies).set({ sampleDataLoadedAt: null, closedThrough: null }).where(eq(s.companies.id, c));
    await tx.insert(s.syncLogs).values({ companyId: c, userId: t.userId, entity: "System", direction: "PUSH", status: "OK", message: "Sample data removed", createdAt: nowIso() });
  });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// ---------- Budget ----------
/** Sets a project's original budget for one cost code; blank or 0 removes the line. */
export async function saveBudgetLine(form: FormData) {
  const t = await requireWrite();
  const project = await ownProject(t.company.id, str(form, "projectId"));
  const costCodeId = str(form, "costCodeId"), raw = str(form, "amount");
  if (!costCodeId) return;
  const amount = toCents(raw);
  if (!amount) {
    await db.delete(s.budgetLines).where(and(eq(s.budgetLines.companyId, t.company.id), eq(s.budgetLines.projectId, project.id), eq(s.budgetLines.costCodeId, costCodeId)));
  } else {
    await db.insert(s.budgetLines).values({ companyId: t.company.id, projectId: project.id, costCodeId, originalCents: amount })
      .onConflictDoUpdate({ target: [s.budgetLines.projectId, s.budgetLines.costCodeId], set: { originalCents: amount } });
  }
  revalidatePath(`/projects/${project.id}`);
}

// ---------- Project setup ----------
const PROJECT_STATUSES = ["BID", "ACTIVE", "COMPLETE"], CONTRACT_TYPES = ["FIXED", "TM", "COST_PLUS"], PROJECT_TYPES = ["CONTRACT", "CAPITAL", "INVENTORY"];

/** A QuickBooks GL account id, if it belongs to this company's chart of accounts. */
async function ownAccount(companyId: string, qboId: string) {
  if (!qboId) return null;
  const a = await db.query.glAccounts.findFirst({ where: and(eq(s.glAccounts.companyId, companyId), eq(s.glAccounts.qboId, qboId)) });
  return a?.qboId ?? null;
}
const isoDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const pctBp = (v: string, fallback: number) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : fallback; };

export async function updateProject(form: FormData) {
  const t = await requireWrite();
  const p = await ownProject(t.company.id, str(form, "projectId"));
  const number = str(form, "number").slice(0, 40) || p.number;
  const clash = await db.query.projects.findFirst({ where: and(eq(s.projects.companyId, t.company.id), eq(s.projects.number, number)) });
  if (clash && clash.id !== p.id) throw new Error(`Project number ${number} is already used.`);
  const projectType = PROJECT_TYPES.includes(str(form, "projectType")) ? str(form, "projectType") : p.projectType;
  const customerId = str(form, "customerId") || null;
  if (projectType === "CONTRACT" && !customerId) throw new Error("A customer contract needs a customer.");
  const units = parseInt(str(form, "unitsPlanned"), 10);
  await db.update(s.projects).set({
    number, projectType, customerId, // composite FK rejects another company's customer
    unitsPlanned: Number.isFinite(units) && units > 0 ? units : p.unitsPlanned,
    inServiceDate: isoDate(str(form, "inServiceDate")),
    assetAccountId: (await ownAccount(t.company.id, str(form, "assetAccountId"))) ?? null,
    name: str(form, "name").slice(0, 200) || p.name,
    status: PROJECT_STATUSES.includes(str(form, "status")) ? str(form, "status") : p.status,
    contractType: CONTRACT_TYPES.includes(str(form, "contractType")) ? str(form, "contractType") : p.contractType,
    originalContractCents: toCents(str(form, "contract")),
    holdbackBp: pctBp(str(form, "holdbackPct"), p.holdbackBp),
    taxBp: pctBp(str(form, "taxPct"), p.taxBp),
    projectManager: str(form, "projectManager").slice(0, 120) || null,
    startDate: isoDate(str(form, "startDate")),
    endDate: isoDate(str(form, "endDate")),
  }).where(and(eq(s.projects.id, p.id), eq(s.projects.companyId, t.company.id)));
  revalidatePath("/", "layout");
  redirect(`/projects/${p.id}?tab=setup&saved=1`);
}

// ---------- Employees ----------
/** Sets pay/burden/bill rates. Time entries that were imported without a pay rate pick up the new rate. */
export async function updateEmployee(form: FormData) {
  const t = await requireAdmin();
  const emp = await db.query.employees.findFirst({ where: and(eq(s.employees.id, str(form, "id")), eq(s.employees.companyId, t.company.id)) });
  if (!emp) return;
  const payRateCents = toCents(str(form, "payRate")), billRateCents = toCents(str(form, "billRate")), burdenBp = pctBp(str(form, "burdenPct"), emp.burdenBp);
  await db.update(s.employees).set({ payRateCents, billRateCents, burdenBp, trade: str(form, "trade").slice(0, 80) || emp.trade })
    .where(and(eq(s.employees.id, emp.id), eq(s.employees.companyId, t.company.id)));
  if (payRateCents > 0)
    await db.update(s.timeEntries).set({ payRateCents, burdenBp })
      .where(and(eq(s.timeEntries.companyId, t.company.id), eq(s.timeEntries.employeeId, emp.id), eq(s.timeEntries.payRateCents, 0)));
  revalidatePath("/", "layout");
}

// ---------- Cost code edits ----------
export async function updateCostCode(form: FormData) {
  const t = await requireAdmin();
  const costType = str(form, "costType");
  if (!["LABOUR", "MATERIAL", "SUB", "EQUIPMENT", "OTHER"].includes(costType)) return;
  await db.update(s.costCodes).set({ costType }).where(and(eq(s.costCodes.id, str(form, "id")), eq(s.costCodes.companyId, t.company.id)));
  revalidatePath("/", "layout");
}

// ---------- Overhead ----------
/** Base, rate mode (calculated from QuickBooks or entered), and which P&L accounts make up the pool. */
export async function saveOverheadSettings(form: FormData) {
  const t = await requireAdmin();
  const basis = ["labour_cost", "labour_hours", "direct_cost"].includes(str(form, "basis")) ? str(form, "basis") : t.company.overheadBasis;
  const mode = str(form, "mode") === "manual" ? "manual" : "calculated";
  const raw = parseFloat(str(form, "manualRate"));
  // % of base -> basis points; $ per hour -> cents
  const manual = Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  if (mode === "manual" && manual == null) throw new Error("Enter the overhead rate.");
  await db.update(s.companies).set({ overheadBasis: basis, overheadRateMode: mode, overheadManualRate: mode === "manual" ? manual : t.company.overheadManualRate })
    .where(eq(s.companies.id, t.company.id));
  const listed = form.getAll("account").map(String), included = new Set(form.getAll("include").map(String));
  for (const qboAccountId of listed)
    await db.update(s.overheadAccounts).set({ included: included.has(qboAccountId) })
      .where(and(eq(s.overheadAccounts.companyId, t.company.id), eq(s.overheadAccounts.qboAccountId, qboAccountId)));
  revalidatePath("/", "layout");
  redirect("/overhead?saved=1");
}

// ---------- New project ----------
export async function createProject(form: FormData) {
  const t = await requireWrite();
  const projectType = PROJECT_TYPES.includes(str(form, "projectType")) ? str(form, "projectType") : "CONTRACT";
  const number = str(form, "number").slice(0, 40), name = str(form, "name").slice(0, 200);
  if (!number || !name) throw new Error("Project number and name are required.");
  const customerId = str(form, "customerId") || null;
  if (projectType === "CONTRACT" && !customerId) throw new Error("A customer contract needs a customer.");
  const clash = await db.query.projects.findFirst({ where: and(eq(s.projects.companyId, t.company.id), eq(s.projects.number, number)) });
  if (clash) throw new Error(`Project number ${number} is already used.`);
  const units = parseInt(str(form, "unitsPlanned"), 10);
  const [p] = await db.insert(s.projects).values({
    companyId: t.company.id, projectType, number, name, customerId,
    status: "ACTIVE", originalContractCents: projectType === "CONTRACT" ? toCents(str(form, "contract")) : 0,
    holdbackBp: t.company.defaultHoldbackBp, taxBp: t.company.defaultTaxBp,
    unitsPlanned: Number.isFinite(units) && units > 0 ? units : 1, startDate: isoDate(str(form, "startDate")),
  }).returning();
  revalidatePath("/", "layout");
  redirect(`/projects/${p.id}?tab=setup`);
}

// ---------- QuickBooks links (customer / class / location / account -> project) ----------
const LINK_KINDS = ["customer", "class", "department", "account"];

export async function addProjectLink(form: FormData) {
  const t = await requireWrite();
  const p = await ownProject(t.company.id, str(form, "projectId"));
  const kind = str(form, "kind"), qboId = str(form, "qboId");
  if (!LINK_KINDS.includes(kind) || !qboId) return;
  const c = t.company.id;
  // the QuickBooks entity must be one of this company's
  const name =
    kind === "customer" ? (await db.query.customers.findFirst({ where: and(eq(s.customers.companyId, c), eq(s.customers.qboId, qboId)) }))?.name
    : kind === "account" ? (await db.query.glAccounts.findFirst({ where: and(eq(s.glAccounts.companyId, c), eq(s.glAccounts.qboId, qboId)) }))?.fullName
    : (await db.query.qboTags.findFirst({ where: and(eq(s.qboTags.companyId, c), eq(s.qboTags.kind, kind), eq(s.qboTags.qboId, qboId)) }))?.name;
  if (!name) throw new Error("That QuickBooks record wasn't found. Sync from QuickBooks first.");
  const taken = await db.query.projectQboLinks.findFirst({ where: and(eq(s.projectQboLinks.companyId, c), eq(s.projectQboLinks.kind, kind), eq(s.projectQboLinks.qboId, qboId)) });
  if (taken && taken.projectId !== p.id) {
    const other = await db.query.projects.findFirst({ where: and(eq(s.projects.companyId, c), eq(s.projects.id, taken.projectId)) });
    throw new Error(`${name} already feeds project ${other?.number ?? ""}. Unlink it there first.`);
  }
  if (!taken) await db.insert(s.projectQboLinks).values({ companyId: c, projectId: p.id, kind, qboId, qboName: name });
  revalidatePath(`/projects/${p.id}`);
}

export async function removeProjectLink(form: FormData) {
  const t = await requireWrite();
  await db.delete(s.projectQboLinks).where(and(eq(s.projectQboLinks.id, str(form, "id")), eq(s.projectQboLinks.companyId, t.company.id)));
  revalidatePath("/", "layout");
}

// ---------- Units (build for sale) ----------
export async function addUnitEvent(form: FormData) {
  const t = await requireWrite();
  const p = await ownProject(t.company.id, str(form, "projectId"));
  if (p.projectType !== "INVENTORY") return;
  const kind = str(form, "kind") === "SOLD" ? "SOLD" : "COMPLETED";
  const units = parseInt(str(form, "units"), 10), date = isoDate(str(form, "date"));
  if (!(units > 0) || !date) throw new Error("Enter a date and a whole number of units.");
  const sale = str(form, "saleAmount");
  await db.insert(s.projectUnitEvents).values({
    companyId: t.company.id, projectId: p.id, kind, date, units, saleAmountCents: kind === "SOLD" && sale ? toCents(sale) : null,
    notes: str(form, "notes").slice(0, 200) || null, createdAt: nowIso(),
  });
  revalidatePath(`/projects/${p.id}`);
}

export async function deleteUnitEvent(form: FormData) {
  const t = await requireWrite();
  await db.delete(s.projectUnitEvents).where(and(eq(s.projectUnitEvents.id, str(form, "id")), eq(s.projectUnitEvents.companyId, t.company.id)));
  revalidatePath("/", "layout");
}

// ---------- Accounts (entries and project-cost accounts) ----------
export async function saveAccountSettings(form: FormData) {
  const t = await requireAdmin();
  const c = t.company.id;
  await db.update(s.companies).set({
    cipAccountId: await ownAccount(c, str(form, "cipAccountId")),
    wipInventoryAccountId: await ownAccount(c, str(form, "wipInventoryAccountId")),
    finishedGoodsAccountId: await ownAccount(c, str(form, "finishedGoodsAccountId")),
    cogsAccountId: await ownAccount(c, str(form, "cogsAccountId")),
    labourCreditAccountId: await ownAccount(c, str(form, "labourCreditAccountId")),
  }).where(eq(s.companies.id, c));
  const listed = form.getAll("account").map(String), checked = new Set(form.getAll("projectCost").map(String));
  for (const qboId of listed)
    await db.update(s.glAccounts).set({ isProjectCost: checked.has(qboId) }).where(and(eq(s.glAccounts.companyId, c), eq(s.glAccounts.qboId, qboId)));
  revalidatePath("/", "layout");
  redirect("/accounts?saved=1");
}
