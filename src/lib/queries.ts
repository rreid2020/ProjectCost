import "server-only";
import { db, schema as s } from "@/db";
import { and, eq, isNull, asc, desc, inArray } from "drizzle-orm";
import { labourCost, projectEconomics, healthFlags, type CodeInput, type CostType } from "./engine";

export async function getCompany() {
  const c = await db.query.companies.findFirst();
  if (!c) throw new Error("No company found — run `npm run seed`.");
  return c;
}

export async function getCostCodes(companyId: string) {
  return db.select().from(s.costCodes).where(eq(s.costCodes.companyId, companyId)).orderBy(asc(s.costCodes.code));
}

/** Loads everything the engine needs for one project and returns economics + detail. */
export async function loadProject(projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(s.projects.id, projectId),
    with: { customer: true },
  });
  if (!project) return null;

  const [codes, budget, cos, costs, time, fc, sov, bills] = await Promise.all([
    getCostCodes(project.companyId),
    db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId)),
    db.query.changeOrders.findMany({
      where: eq(s.changeOrders.projectId, projectId),
      with: { lines: { with: { costCode: true } } },
      orderBy: asc(s.changeOrders.number),
    }),
    db.query.costTransactions.findMany({
      where: eq(s.costTransactions.projectId, projectId),
      with: { vendor: true, costCode: true },
      orderBy: desc(s.costTransactions.date),
    }),
    db.query.timeEntries.findMany({
      where: eq(s.timeEntries.projectId, projectId),
      with: { employee: true, costCode: true },
      orderBy: desc(s.timeEntries.date),
    }),
    db.select().from(s.forecasts).where(eq(s.forecasts.projectId, projectId)),
    db.select().from(s.sovLines).where(eq(s.sovLines.projectId, projectId)).orderBy(asc(s.sovLines.lineNo)),
    db.query.progressBills.findMany({
      where: eq(s.progressBills.projectId, projectId),
      with: { lines: true },
      orderBy: asc(s.progressBills.number),
    }),
  ]);

  const approvedCos = cos.filter((c) => c.status === "APPROVED");
  const byCode = new Map<string, CodeInput>();
  const ensure = (costCodeId: string) => {
    let row = byCode.get(costCodeId);
    if (!row) {
      const cc = codes.find((c) => c.id === costCodeId)!;
      row = { costCodeId, code: cc.code, name: cc.name, costType: cc.costType as CostType, originalBudget: 0, approvedChanges: 0, actual: 0, etcOverride: null };
      byCode.set(costCodeId, row);
    }
    return row;
  };
  for (const b of budget) ensure(b.costCodeId).originalBudget += b.originalCents;
  for (const co of approvedCos) for (const l of co.lines) ensure(l.costCodeId).approvedChanges += l.costCents;
  for (const c of costs) if (c.costCodeId) ensure(c.costCodeId).actual += c.amountCents;

  let wages = 0, burden = 0, approvedHours = 0, pendingHours = 0, billableTm = 0;
  for (const t of time) {
    if (t.status !== "APPROVED") { pendingHours += t.hoursX100; continue; }
    const lc = labourCost(t.hoursX100, t.payRateCents, t.burdenBp);
    ensure(t.costCodeId).actual += lc.total;
    wages += lc.wages; burden += lc.burden; approvedHours += t.hoursX100;
    billableTm += Math.round((t.hoursX100 * t.billRateCents) / 100);
  }
  for (const f of fc) ensure(f.costCodeId).etcOverride = f.etcCents;

  const postedBills = bills.filter((b) => b.status === "POSTED");
  const billedToDate = postedBills.flatMap((b) => b.lines).reduce((a, l) => a + l.thisPeriodCents, 0);

  const econ = projectEconomics({
    originalContract: project.originalContractCents,
    approvedChangeOrderRevenue: approvedCos.reduce((a, c) => a + c.contractAmountCents, 0),
    codes: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    billedToDate,
    holdbackBp: project.holdbackBp,
  });

  return {
    project, codes, changeOrders: cos, costs, time, sov, bills, econ,
    flags: healthFlags(econ),
    labour: { wages, burden, approvedHours, pendingHours, billableTm },
    pendingCoRevenue: cos.filter((c) => c.status === "PENDING").reduce((a, c) => a + c.contractAmountCents, 0),
  };
}

export type LoadedProject = NonNullable<Awaited<ReturnType<typeof loadProject>>>;

export async function loadPortfolio(statuses: string[] = ["ACTIVE"]) {
  const company = await getCompany();
  const list = await db.select({ id: s.projects.id }).from(s.projects)
    .where(and(eq(s.projects.companyId, company.id), inArray(s.projects.status, statuses)))
    .orderBy(asc(s.projects.number));
  const loaded = await Promise.all(list.map((p) => loadProject(p.id)));
  return { company, projects: loaded.filter(Boolean) as LoadedProject[] };
}

export async function unassignedCosts(companyId: string) {
  return db.query.costTransactions.findMany({
    where: and(eq(s.costTransactions.companyId, companyId), isNull(s.costTransactions.projectId)),
    with: { vendor: true },
    orderBy: desc(s.costTransactions.date),
  });
}
