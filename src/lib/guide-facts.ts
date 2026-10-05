import "server-only";
import { cache } from "react";
import { clerkClient } from "@clerk/nextjs/server";
import { and, count, countDistinct, eq, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Company } from "./tenant";
import { buildGuide, type GuideFacts, type Mark } from "./guide";
import { qboConfigured } from "./qbo";
import { companyOverhead } from "./overhead";

// Month being worked on: the current calendar month (matches the WIP page's period).
function currentPeriod(now: Date) {
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const label = now.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  return { period, start: `${period}-01`, end, label };
}

const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

/** Everything the guide needs, in cheap count queries run in parallel. Memoized per request. */
export const guideFor = cache(async (company: Company, orgId: string, now = new Date()) => {
  const c = company.id;
  const { period, start, end, label } = currentPeriod(now);
  const P = s.projects;
  const activeProject = and(eq(P.companyId, c), eq(P.status, "ACTIVE"));

  const members = (async () => {
    try { return (await (await clerkClient()).organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 1 })).totalCount; }
    catch { return null; }
  })();

  const [
    marks, lastRun, connectionOk, glAccounts, accountsReviewed, costCodes, labourCodes,
    activeEmployees, employeesWithoutRate, employeesWithoutBurden,
    activeProjects, activeContracts, contractsWithoutValue, projectsWithBudget, balanceSheetProjects, linkedInternal,
    overheadAccounts, unassignedCosts, pendingTime, pendingChangeOrders, contractsForecastThisMonth, contractsWithBudget, draftBills, wipSnapshot, memberCount,
  ] = await Promise.all([
    db.select({ stepKey: s.guideMarks.stepKey, period: s.guideMarks.period, status: s.guideMarks.status }).from(s.guideMarks).where(eq(s.guideMarks.companyId, c)),
    db.query.qboImportRuns.findFirst({ where: eq(s.qboImportRuns.companyId, c), orderBy: (r, { desc }) => desc(r.startedAt) }),
    one(db.select({ n: count() }).from(s.syncLogs).where(and(eq(s.syncLogs.companyId, c), eq(s.syncLogs.entity, "Connection"), eq(s.syncLogs.status, "OK")))),
    one(db.select({ n: count() }).from(s.glAccounts).where(eq(s.glAccounts.companyId, c))),
    one(db.select({ n: count() }).from(s.glAccounts).where(and(eq(s.glAccounts.companyId, c), isNotNull(s.glAccounts.isProjectCost)))),
    one(db.select({ n: count() }).from(s.costCodes).where(and(eq(s.costCodes.companyId, c), eq(s.costCodes.active, true)))),
    one(db.select({ n: count() }).from(s.costCodes).where(and(eq(s.costCodes.companyId, c), eq(s.costCodes.active, true), eq(s.costCodes.costType, "LABOUR")))),
    one(db.select({ n: count() }).from(s.employees).where(and(eq(s.employees.companyId, c), eq(s.employees.active, true)))),
    one(db.select({ n: count() }).from(s.employees).where(and(eq(s.employees.companyId, c), eq(s.employees.active, true), eq(s.employees.payRateCents, 0)))),
    one(db.select({ n: count() }).from(s.employees).where(and(eq(s.employees.companyId, c), eq(s.employees.active, true), eq(s.employees.burdenBp, 0)))),
    one(db.select({ n: count() }).from(P).where(activeProject)),
    one(db.select({ n: count() }).from(P).where(and(activeProject, eq(P.projectType, "CONTRACT")))),
    one(db.select({ n: count() }).from(P).where(and(activeProject, eq(P.projectType, "CONTRACT"), eq(P.originalContractCents, 0)))),
    one(db.select({ n: countDistinct(s.budgetLines.projectId) }).from(s.budgetLines).innerJoin(P, eq(P.id, s.budgetLines.projectId)).where(and(eq(s.budgetLines.companyId, c), eq(P.status, "ACTIVE")))),
    one(db.select({ n: count() }).from(P).where(and(activeProject, inArray(P.projectType, ["CAPITAL", "INVENTORY"])))),
    one(db.select({ n: countDistinct(P.id) }).from(P).leftJoin(s.projectQboLinks, eq(s.projectQboLinks.projectId, P.id))
      .where(and(activeProject, inArray(P.projectType, ["CAPITAL", "INVENTORY"]), or(isNotNull(s.projectQboLinks.id), isNotNull(P.qboProjectId))))),
    one(db.select({ n: count() }).from(s.overheadAccounts).where(eq(s.overheadAccounts.companyId, c))),
    one(db.select({ n: count() }).from(s.costTransactions).where(and(eq(s.costTransactions.companyId, c), or(isNull(s.costTransactions.projectId), isNull(s.costTransactions.costCodeId))))),
    one(db.select({ n: count() }).from(s.timeEntries).where(and(eq(s.timeEntries.companyId, c), eq(s.timeEntries.status, "SUBMITTED")))),
    one(db.select({ n: count() }).from(s.changeOrders).innerJoin(P, eq(P.id, s.changeOrders.projectId)).where(and(eq(s.changeOrders.companyId, c), eq(s.changeOrders.status, "PENDING"), eq(P.status, "ACTIVE")))),
    one(db.select({ n: countDistinct(s.forecasts.projectId) }).from(s.forecasts).innerJoin(P, eq(P.id, s.forecasts.projectId))
      .where(and(eq(s.forecasts.companyId, c), gte(s.forecasts.updatedAt, start), eq(P.status, "ACTIVE"), eq(P.projectType, "CONTRACT")))),
    one(db.select({ n: countDistinct(s.budgetLines.projectId) }).from(s.budgetLines).innerJoin(P, eq(P.id, s.budgetLines.projectId))
      .where(and(eq(s.budgetLines.companyId, c), eq(P.status, "ACTIVE"), eq(P.projectType, "CONTRACT")))),
    one(db.select({ n: count() }).from(s.progressBills).where(and(eq(s.progressBills.companyId, c), eq(s.progressBills.status, "DRAFT")))),
    one(db.select({ n: count() }).from(s.wipSnapshots).where(and(eq(s.wipSnapshots.companyId, c), eq(s.wipSnapshots.periodEnd, end)))),
    members,
  ]);
  const sheetBatches = await db.select({ kind: s.importBatches.kind, createdAt: s.importBatches.createdAt }).from(s.importBatches)
    .where(and(eq(s.importBatches.companyId, c), eq(s.importBatches.status, "COMMITTED")));
  const sheetCosts = sheetBatches.filter((b) => b.kind === "costs" || b.kind === "time");
  const lastSheetCost = sheetCosts.reduce<string | null>((a, b) => (a && a > b.createdAt ? a : b.createdAt), null);
  const overhead = await companyOverhead(company, now);

  const daysSinceImport = company.qboLastImportAt ? Math.floor((now.getTime() - new Date(company.qboLastImportAt).getTime()) / 86_400_000) : null;
  const facts: GuideFacts = {
    period, periodLabel: label,
    provinceSet: Boolean(company.province), sampleData: Boolean(company.sampleDataLoadedAt),
    qboConfigured: qboConfigured(), qboConnected: Boolean(company.qboRealmId), connectionOk: Boolean(company.qboRealmId) && connectionOk > 0,
    memberCount,
    projectModeChosen: Boolean(company.qboProjectMode), imported: Boolean(company.qboLastImportAt), lastImportOk: lastRun?.status !== "ERROR", daysSinceImport,
    sheetImports: sheetBatches.length, sheetCostImports: sheetCosts.length,
    daysSinceSheetCosts: lastSheetCost ? Math.floor((now.getTime() - new Date(lastSheetCost).getTime()) / 86_400_000) : null,
    glAccounts, accountsReviewed: accountsReviewed > 0,
    entryAccountsMapped: Boolean(company.cipAccountId || company.wipInventoryAccountId) && Boolean(company.labourCreditAccountId),
    costCodes, labourCodes, activeEmployees, employeesWithoutRate, employeesWithoutBurden,
    activeProjects, activeContracts, contractsWithoutValue, projectsWithoutBudget: Math.max(activeProjects - projectsWithBudget, 0),
    balanceSheetProjects, internalWithoutLinks: Math.max(balanceSheetProjects - linkedInternal, 0),
    overheadPoolLoaded: overheadAccounts > 0,
    overheadRateSet: overhead.rate != null,
    unassignedCosts, pendingTime, pendingChangeOrders, contractsForecastThisMonth, contractsWithBudget, draftBills, wipSnapshotSaved: wipSnapshot > 0,
  };
  return buildGuide(facts, marks as Mark[]);
});
