import "server-only";
import { db, schema as s } from "@/db";
import { and, eq, isNull, asc, desc, inArray, count, or } from "drizzle-orm";
import { labourCost, projectEconomics, healthFlags, type CodeInput, type CostType } from "./engine";
import { inventoryFlow, capitalFlow, type DatedCost, type UnitEvent } from "./project-accounting";

export const UNCODED = "uncoded";

export async function getCostCodes(companyId: string) {
  return db.select().from(s.costCodes).where(eq(s.costCodes.companyId, companyId)).orderBy(asc(s.costCodes.code));
}

/** Loads everything the engine needs for one of this company's projects; null if it isn't theirs. */
export async function loadProject(companyId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(s.projects.id, projectId), eq(s.projects.companyId, companyId)),
    with: { customer: true },
  });
  if (!project) return null;

  const [codes, budget, cos, costs, time, fc, sov, bills, qboInvoices, links, unitEvents] = await Promise.all([
    getCostCodes(companyId),
    db.select().from(s.budgetLines).where(and(eq(s.budgetLines.projectId, projectId), eq(s.budgetLines.companyId, companyId))),
    db.query.changeOrders.findMany({
      where: and(eq(s.changeOrders.projectId, projectId), eq(s.changeOrders.companyId, companyId)),
      with: { lines: { with: { costCode: true } } },
      orderBy: asc(s.changeOrders.number),
    }),
    db.query.costTransactions.findMany({
      where: and(eq(s.costTransactions.projectId, projectId), eq(s.costTransactions.companyId, companyId)),
      with: { vendor: true, costCode: true },
      orderBy: desc(s.costTransactions.date),
    }),
    db.query.timeEntries.findMany({
      where: and(eq(s.timeEntries.projectId, projectId), eq(s.timeEntries.companyId, companyId)),
      with: { employee: true, costCode: true },
      orderBy: desc(s.timeEntries.date),
    }),
    db.select().from(s.forecasts).where(and(eq(s.forecasts.projectId, projectId), eq(s.forecasts.companyId, companyId))),
    db.select().from(s.sovLines).where(and(eq(s.sovLines.projectId, projectId), eq(s.sovLines.companyId, companyId))).orderBy(asc(s.sovLines.lineNo)),
    db.query.progressBills.findMany({
      where: and(eq(s.progressBills.projectId, projectId), eq(s.progressBills.companyId, companyId)),
      with: { lines: true },
      orderBy: asc(s.progressBills.number),
    }),
    db.select().from(s.qboInvoices).where(and(eq(s.qboInvoices.projectId, projectId), eq(s.qboInvoices.companyId, companyId))).orderBy(desc(s.qboInvoices.date)),
    db.select().from(s.projectQboLinks).where(and(eq(s.projectQboLinks.projectId, projectId), eq(s.projectQboLinks.companyId, companyId))),
    db.select().from(s.projectUnitEvents).where(and(eq(s.projectUnitEvents.projectId, projectId), eq(s.projectUnitEvents.companyId, companyId))).orderBy(asc(s.projectUnitEvents.date)),
  ]);

  const approvedCos = cos.filter((c) => c.status === "APPROVED");
  const byCode = new Map<string, CodeInput>();
  const ensure = (costCodeId: string) => {
    let row = byCode.get(costCodeId);
    if (!row) {
      const cc = codes.find((c) => c.id === costCodeId) ?? { code: "—", name: "Needs a cost code", costType: "OTHER" };
      row = { costCodeId, code: cc.code, name: cc.name, costType: cc.costType as CostType, originalBudget: 0, approvedChanges: 0, actual: 0, etcOverride: null };
      byCode.set(costCodeId, row);
    }
    return row;
  };
  for (const b of budget) ensure(b.costCodeId).originalBudget += b.originalCents;
  for (const co of approvedCos) for (const l of co.lines) ensure(l.costCodeId).approvedChanges += l.costCents;
  // costs on this project that still need a cost code count toward cost to date under a placeholder row
  for (const c of costs) ensure(c.costCodeId ?? UNCODED).actual += c.amountCents;

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
  const billedInQbo = qboInvoices.reduce((a, i) => a + i.amountCents, 0); // invoices raised in QuickBooks, pre-tax
  const billedToDate = postedBills.flatMap((b) => b.lines).reduce((a, l) => a + l.thisPeriodCents, 0) + billedInQbo;

  const econ = projectEconomics({
    originalContract: project.originalContractCents,
    approvedChangeOrderRevenue: approvedCos.reduce((a, c) => a + c.contractAmountCents, 0),
    codes: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    billedToDate,
    holdbackBp: project.holdbackBp,
  });

  // Balance-sheet view for capital and build-for-sale projects
  const datedCosts: DatedCost[] = costs.map((c) => ({ date: c.date, amount: c.amountCents, account: c.qboAccountId }));
  const datedLabour = time.filter((t) => t.status === "APPROVED").map((t) => ({ date: t.date, amount: labourCost(t.hoursX100, t.payRateCents, t.burdenBp).total }));
  const allDated: DatedCost[] = [...datedCosts, ...datedLabour.map((l) => ({ ...l, account: null }))];
  const events: UnitEvent[] = unitEvents.map((e) => ({ id: e.id, kind: e.kind as UnitEvent["kind"], date: e.date, units: e.units, saleAmountCents: e.saleAmountCents }));
  const inventory = project.projectType === "INVENTORY" ? inventoryFlow(allDated, project.unitsPlanned, events) : null;
  const capital = project.projectType === "CAPITAL" ? capitalFlow(allDated, project.inServiceDate) : null;

  return {
    project, codes, changeOrders: cos, costs, time, sov, bills, qboInvoices, billedInQbo, econ,
    links, unitEvents, inventory, capital, datedCosts, datedLabour, events,
    budgetLines: budget,
    // revenue-based flags (loss, fade, underbilling) only apply to customer contracts
    flags: project.projectType === "CONTRACT" ? healthFlags(econ) : [
      ...(econ.revisedBudget > 0 && econ.eac > econ.revisedBudget ? [{ level: "red" as const, text: "Forecast over budget" }] : []),
      ...healthFlags(econ).filter((f) => f.text.includes("over budget")),
      ...(inventory?.warnings.length || capital?.warnings.length ? [{ level: "amber" as const, text: "Check units / in-service date" }] : []),
    ],
    labour: { wages, burden, approvedHours, pendingHours, billableTm },
    pendingCoRevenue: cos.filter((c) => c.status === "PENDING").reduce((a, c) => a + c.contractAmountCents, 0),
  };
}

export type LoadedProject = NonNullable<Awaited<ReturnType<typeof loadProject>>>;

export async function loadPortfolio(companyId: string, statuses: string[] = ["ACTIVE"], types: string[] = ["CONTRACT", "CAPITAL", "INVENTORY"]) {
  const list = await db.select({ id: s.projects.id }).from(s.projects)
    .where(and(eq(s.projects.companyId, companyId), inArray(s.projects.status, statuses), inArray(s.projects.projectType, types)))
    .orderBy(asc(s.projects.number));
  const loaded = await Promise.all(list.map((p) => loadProject(companyId, p.id)));
  return loaded.filter(Boolean) as LoadedProject[];
}

export async function unassignedCosts(companyId: string) {
  return db.query.costTransactions.findMany({
    // needs coding: no project, or a project but no cost code
    where: and(eq(s.costTransactions.companyId, companyId), or(isNull(s.costTransactions.projectId), isNull(s.costTransactions.costCodeId))),
    with: { vendor: true, project: true },
    orderBy: desc(s.costTransactions.date),
  });
}

export async function activeProjects(companyId: string) {
  return db.select().from(s.projects).where(and(eq(s.projects.companyId, companyId), eq(s.projects.status, "ACTIVE"))).orderBy(asc(s.projects.number));
}

export async function pendingTimeCount(companyId: string) {
  const [r] = await db.select({ n: count() }).from(s.timeEntries).where(and(eq(s.timeEntries.companyId, companyId), eq(s.timeEntries.status, "SUBMITTED")));
  return r.n;
}

export async function unassignedCount(companyId: string) {
  const [r] = await db.select({ n: count() }).from(s.costTransactions)
    .where(and(eq(s.costTransactions.companyId, companyId), or(isNull(s.costTransactions.projectId), isNull(s.costTransactions.costCodeId))));
  return r.n;
}
