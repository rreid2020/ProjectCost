import "server-only";
// The four reports: WIP schedule, journal entries, job cost by project, and cost & time detail.
// Each builds a Report (src/lib/report-model.ts) that the Reports page shows and /api/reports downloads.
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Company } from "./tenant";
import { loadPortfolio } from "./queries";
import { burdenJournal, labourCost, wipJournal } from "./engine";
import { projectEntries, type AccountMap } from "./project-accounting";
import { fmtDate, PROJECT_TYPE_LABEL } from "./format";
import type { Report, Row, Sheet } from "./report-model";

export const REPORTS = [
  { key: "wip", label: "WIP schedule", blurb: "Percentage-of-completion schedule in surety / bank layout: current, or a saved month." },
  { key: "journal", label: "Journal entries", blurb: "The month's WIP adjustment, labour burden, and capital / build-for-sale entries, ready to book." },
  { key: "jobcost", label: "Job cost by project", blurb: "Budget, cost to date, estimate to complete and variance, by project and by cost code." },
  { key: "detail", label: "Cost & time detail", blurb: "Every cost line and time entry for a date range, with its project, cost code and source." },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];
export const isReportKey = (k: string): k is ReportKey => REPORTS.some((r) => r.key === k);

export type ReportParams = { period?: string; month?: string; project?: string; status?: string; from?: string; to?: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthEnd = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
const stamp = () => `Prepared ${new Date().toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}`;
const file = (company: Company, name: string) => `${company.name.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "")}-${name}`;

/** What the filters can offer: saved WIP periods and projects. */
export async function reportOptions(companyId: string) {
  const [snaps, projects] = await Promise.all([
    db.selectDistinct({ periodEnd: s.wipSnapshots.periodEnd }).from(s.wipSnapshots).where(eq(s.wipSnapshots.companyId, companyId)).orderBy(desc(s.wipSnapshots.periodEnd)),
    db.select({ id: s.projects.id, number: s.projects.number, name: s.projects.name, status: s.projects.status }).from(s.projects).where(eq(s.projects.companyId, companyId)).orderBy(asc(s.projects.number)),
  ]);
  return { periods: snaps.map((x) => x.periodEnd), projects };
}

/** Fills in defaults so the page, the filters and the download all use the same values. */
export function normalizeParams(kind: ReportKey, p: ReportParams): ReportParams {
  const month = /^\d{4}-\d{2}$/.test(p.month ?? "") ? p.month! : thisMonth();
  switch (kind) {
    case "wip": return { period: p.period && ISO.test(p.period) ? p.period : "current" };
    case "journal": return { month };
    case "jobcost": return { project: p.project || "", status: p.status === "all" ? "all" : "active" };
    case "detail": {
      const to = p.to && ISO.test(p.to) ? p.to : today();
      const from = p.from && ISO.test(p.from) ? p.from : `${to.slice(0, 7)}-01`;
      return { from, to, project: p.project || "" };
    }
  }
}

export async function buildReport(kind: ReportKey, company: Company, params: ReportParams): Promise<Report> {
  const p = normalizeParams(kind, params);
  switch (kind) {
    case "wip": return wipReport(company, p.period!);
    case "journal": return journalReport(company, p.month!);
    case "jobcost": return jobCostReport(company, p.project!, p.status as "active" | "all");
    case "detail": return detailReport(company, p.from!, p.to!, p.project!);
  }
}

// ---------- WIP schedule ----------
const WIP_COLS: Sheet["columns"] = [
  { key: "number", label: "Project #", kind: "text", width: 12 }, { key: "name", label: "Project", kind: "text", width: 30 },
  { key: "contract", label: "Contract", kind: "money", total: true }, { key: "eac", label: "Est. total cost", kind: "money", total: true },
  { key: "profit", label: "Est. gross profit", kind: "money", total: true }, { key: "cost", label: "Cost to date", kind: "money", total: true },
  { key: "pct", label: "% complete", kind: "pct" }, { key: "earned", label: "Earned revenue", kind: "money", total: true },
  { key: "billed", label: "Billed to date", kind: "money", total: true }, { key: "under", label: "Underbillings", kind: "money", total: true },
  { key: "over", label: "Overbillings", kind: "money", total: true }, { key: "loss", label: "Loss provision", kind: "money", total: true },
  { key: "backlog", label: "Backlog", kind: "money", total: true },
];
const wipRow = (number: string, name: string, v: { contract: number; eac: number; cost: number; pct: number; earned: number; billed: number; overUnder: number; loss: number }): Row => ({
  number, name, contract: v.contract, eac: v.eac, profit: v.contract - v.eac, cost: v.cost, pct: v.pct, earned: v.earned, billed: v.billed,
  under: v.overUnder < 0 ? -v.overUnder : null, over: v.overUnder > 0 ? v.overUnder : null, loss: v.loss || null, backlog: v.contract - v.earned,
});

async function wipReport(company: Company, period: string): Promise<Report> {
  let rows: Row[];
  let subtitle: string;
  if (period === "current") {
    const projects = await loadPortfolio(company.id, ["ACTIVE"], ["CONTRACT"]);
    rows = projects.map(({ project: pr, econ: e }) => wipRow(pr.number, pr.name, {
      contract: e.revisedContract, eac: e.eac, cost: e.costToDate, pct: e.pctCompleteBp, earned: e.earnedRevenue, billed: e.billedToDate, overUnder: e.overUnder, loss: e.lossProvision,
    }));
    subtitle = `Current (not saved) · cost-to-cost percentage of completion · active customer contracts · ${stamp()}`;
  } else {
    const snaps = await db.select({ x: s.wipSnapshots, number: s.projects.number, name: s.projects.name }).from(s.wipSnapshots)
      .innerJoin(s.projects, and(eq(s.projects.id, s.wipSnapshots.projectId), eq(s.projects.companyId, s.wipSnapshots.companyId)))
      .where(and(eq(s.wipSnapshots.companyId, company.id), eq(s.wipSnapshots.periodEnd, period))).orderBy(asc(s.projects.number));
    rows = snaps.map(({ x, number, name }) => wipRow(number, name, {
      contract: x.contractCents, eac: x.eacCents, cost: x.costToDateCents, pct: x.pctCompleteBp, earned: x.earnedCents, billed: x.billedCents, overUnder: x.overUnderCents, loss: x.lossProvisionCents,
    }));
    subtitle = `Period ending ${fmtDate(period)} (saved snapshot) · cost-to-cost percentage of completion · ${stamp()}`;
  }
  return {
    key: "wip", title: "Work-in-progress schedule", subtitle, company: company.name,
    fileName: file(company, `WIP-${period === "current" ? today() : period}`),
    sheets: [{ name: "WIP schedule", columns: WIP_COLS, rows, emptyText: "No active customer contracts." }],
  };
}

// ---------- Journal entries ----------
async function journalReport(company: Company, month: string): Promise<Report> {
  const start = `${month}-01`, end = monthEnd(month);
  const isCurrent = month === thisMonth();
  const [snap, portfolio, contracts, accounts] = await Promise.all([
    db.select().from(s.wipSnapshots).where(and(eq(s.wipSnapshots.companyId, company.id), eq(s.wipSnapshots.periodEnd, end))),
    loadPortfolio(company.id, ["ACTIVE", "COMPLETE"], ["CAPITAL", "INVENTORY"]),
    isCurrent ? loadPortfolio(company.id, ["ACTIVE"], ["CONTRACT"]) : Promise.resolve([]),
    db.select({ qboId: s.glAccounts.qboId, fullName: s.glAccounts.fullName }).from(s.glAccounts).where(eq(s.glAccounts.companyId, company.id)),
  ]);
  const name = new Map(accounts.map((a) => [a.qboId, a.fullName]));
  const entries: { title: string; date: string; memo: string; lines: { account: string | null; debit: number; credit: number; memo?: string | null }[]; named: boolean }[] = [];

  // WIP adjustment: from the saved snapshot for this month-end, else (current month) from today's schedule
  const wipItems = snap.length
    ? snap.map((x) => ({ projectNumber: x.projectId, overUnder: x.overUnderCents, lossProvision: x.lossProvisionCents }))
    : contracts.map((p) => ({ projectNumber: p.project.number, overUnder: p.econ.overUnder, lossProvision: p.econ.lossProvision }));
  const wip = wipJournal(wipItems);
  if (wip.length) entries.push({ title: `WIP adjusting entry${snap.length ? "" : " (from the current schedule)"}, auto-reverses on the 1st`, date: end, memo: `[ProjectCost] WIP ${end}`, lines: wip, named: true });
  if (isCurrent) {
    const burden = burdenJournal(contracts.reduce((a, p) => a + p.labour.burden, 0));
    if (burden.length) entries.push({ title: "Labour burden applied to jobs (to date)", date: end, memo: `[ProjectCost] Labour burden ${end}`, lines: burden, named: true });
  }
  const acct: AccountMap = { cip: company.cipAccountId, wipInventory: company.wipInventoryAccountId, finishedGoods: company.finishedGoodsAccountId, cogs: company.cogsAccountId, labourCredit: company.labourCreditAccountId };
  for (const p of portfolio) for (const e of projectEntries({
    id: p.project.id, number: p.project.number, name: p.project.name, projectType: p.project.projectType as "CAPITAL" | "INVENTORY",
    unitsPlanned: p.project.unitsPlanned, inServiceDate: p.project.inServiceDate, assetAccountId: p.project.assetAccountId,
    costs: p.datedCosts, labour: p.datedLabour, events: p.events,
  }, acct, start, end)) entries.push({ title: `${p.project.number} ${e.title}`, date: e.date, memo: e.memo, lines: e.lines, named: false });

  const rows: Row[] = entries.flatMap((e, i) => e.lines.map((l) => ({
    entry: i + 1, date: e.date, title: e.title,
    account: e.named ? l.account ?? "" : l.account ? name.get(l.account) ?? `QuickBooks account ${l.account}` : "NOT MAPPED: choose it on Accounts",
    lineMemo: l.memo ?? "", debit: l.debit || null, credit: l.credit || null, memo: e.memo,
  })));
  const notes = [
    !snap.length && !isCurrent ? "No WIP snapshot was saved for this month, so the WIP adjusting entry isn't included." : "",
    "Book each entry with its memo: the [ProjectCost] tag stops the next import counting it again.",
  ].filter(Boolean).join(" ");
  return {
    key: "journal", title: "Journal entries", subtitle: `${fmtDate(start)} – ${fmtDate(end)} · drafts to book in your accounting system · ${stamp()}`,
    company: company.name, fileName: file(company, `Journal-entries-${month}`),
    sheets: [{
      name: "Journal entries", note: notes, emptyText: "No entries for this month.",
      columns: [
        { key: "entry", label: "Entry", kind: "number", width: 7 }, { key: "date", label: "Date", kind: "date" }, { key: "title", label: "Entry", kind: "text", width: 40 },
        { key: "account", label: "Account", kind: "text", width: 40 }, { key: "lineMemo", label: "Line memo", kind: "text", width: 24 },
        { key: "debit", label: "Debit", kind: "money", total: true }, { key: "credit", label: "Credit", kind: "money", total: true }, { key: "memo", label: "Memo", kind: "text", width: 36 },
      ],
      rows,
    }],
  };
}

// ---------- Job cost ----------
async function jobCostReport(company: Company, projectId: string, status: "active" | "all"): Promise<Report> {
  let projects = await loadPortfolio(company.id, status === "all" ? ["BID", "ACTIVE", "COMPLETE"] : ["ACTIVE"]);
  if (projectId) projects = projects.filter((p) => p.project.id === projectId);
  const summary: Row[] = projects.map(({ project: pr, econ: e }) => {
    const contract = pr.projectType === "CONTRACT";
    return {
      number: pr.number, name: pr.name, type: PROJECT_TYPE_LABEL[pr.projectType] ?? pr.projectType, status: pr.status,
      contract: contract ? e.revisedContract : null, budget: e.revisedBudget, cost: e.costToDate, etc: e.etc, eac: e.eac,
      variance: e.revisedBudget - e.eac, profit: contract ? e.projectedProfit : null, pct: contract ? e.pctCompleteBp : null,
    };
  });
  const byCode: Row[] = projects.flatMap(({ project: pr, econ: e }) => e.rows.map((r) => ({
    number: pr.number, name: pr.name, code: r.code, codeName: r.name, costType: r.costType,
    original: r.originalBudget, changes: r.approvedChanges, budget: r.revisedBudget, actual: r.actual, etc: r.etc, eac: r.eac, variance: r.variance, pct: r.pctSpentBp,
  })));
  const one = projectId && projects[0];
  return {
    key: "jobcost", title: "Job cost report",
    subtitle: `${one ? `${one.project.number} ${one.project.name}` : status === "all" ? "All projects" : "Active projects"} · cost to date includes burdened labour · ${stamp()}`,
    company: company.name, fileName: file(company, `Job-cost-${one ? one.project.number : status}-${today()}`),
    sheets: [
      {
        name: "Summary", emptyText: "No projects match.",
        columns: [
          { key: "number", label: "Project #", kind: "text", width: 12 }, { key: "name", label: "Project", kind: "text", width: 30 },
          { key: "type", label: "Type", kind: "text", width: 18 }, { key: "status", label: "Status", kind: "text", width: 10 },
          { key: "contract", label: "Contract", kind: "money", total: true }, { key: "budget", label: "Revised budget", kind: "money", total: true },
          { key: "cost", label: "Cost to date", kind: "money", total: true }, { key: "etc", label: "Est. to complete", kind: "money", total: true },
          { key: "eac", label: "Est. at completion", kind: "money", total: true }, { key: "variance", label: "Variance (budget − EAC)", kind: "money", total: true },
          { key: "profit", label: "Projected profit", kind: "money", total: true }, { key: "pct", label: "% complete", kind: "pct" },
        ],
        rows: summary,
      },
      {
        name: "By cost code", emptyText: "No budget or costs yet.",
        columns: [
          { key: "number", label: "Project #", kind: "text", width: 12 }, { key: "name", label: "Project", kind: "text", width: 26 },
          { key: "code", label: "Cost code", kind: "text", width: 12 }, { key: "codeName", label: "Description", kind: "text", width: 26 }, { key: "costType", label: "Type", kind: "text", width: 11 },
          { key: "original", label: "Original budget", kind: "money", total: true }, { key: "changes", label: "Approved changes", kind: "money", total: true },
          { key: "budget", label: "Revised budget", kind: "money", total: true }, { key: "actual", label: "Cost to date", kind: "money", total: true },
          { key: "etc", label: "Est. to complete", kind: "money", total: true }, { key: "eac", label: "Est. at completion", kind: "money", total: true },
          { key: "variance", label: "Variance", kind: "money", total: true }, { key: "pct", label: "% spent", kind: "pct" },
        ],
        rows: byCode,
      },
    ],
  };
}

// ---------- Cost & time detail ----------
async function detailReport(company: Company, from: string, to: string, projectId: string): Promise<Report> {
  const c = company.id;
  const ct = s.costTransactions, te = s.timeEntries;
  const [costs, time, accounts, batches] = await Promise.all([
    db.query.costTransactions.findMany({
      where: and(eq(ct.companyId, c), gte(ct.date, from), lte(ct.date, to), projectId ? eq(ct.projectId, projectId) : undefined),
      with: { project: true, costCode: true, vendor: true }, orderBy: [asc(ct.date), asc(ct.docNumber)],
    }),
    db.query.timeEntries.findMany({
      where: and(eq(te.companyId, c), gte(te.date, from), lte(te.date, to), projectId ? eq(te.projectId, projectId) : undefined),
      with: { project: true, costCode: true, employee: true }, orderBy: [asc(te.date)],
    }),
    db.select({ qboId: s.glAccounts.qboId, fullName: s.glAccounts.fullName }).from(s.glAccounts).where(eq(s.glAccounts.companyId, c)),
    db.select({ id: s.importBatches.id, fileName: s.importBatches.fileName }).from(s.importBatches).where(eq(s.importBatches.companyId, c)),
  ]);
  const acctName = new Map(accounts.map((a) => [a.qboId, a.fullName]));
  const fileName = new Map(batches.map((b) => [b.id, b.fileName]));
  const SOURCE: Record<string, string> = { BILL: "Bill", CREDIT: "Vendor credit", JE: "Journal entry", CHECK: "Cheque", EXPENSE: "Expense", MANUAL: "Manual" };
  const source = (x: { qboTxnType: string | null; qboTxnId: string | null; importBatchId: string | null }) =>
    x.importBatchId ? `Spreadsheet: ${fileName.get(x.importBatchId) ?? "import"}` : x.qboTxnType && x.qboTxnId ? `QuickBooks ${x.qboTxnType} ${x.qboTxnId}` : "Entered in ProjectCost";
  const one = projectId ? (costs.find((x) => x.project)?.project ?? time.find((x) => x.project)?.project) : null;

  return {
    key: "detail", title: "Cost & time detail",
    subtitle: `${fmtDate(from)} – ${fmtDate(to)} · ${projectId ? (one ? `${one.number} ${one.name}` : "selected project") : "all projects, including unassigned"} · ${stamp()}`,
    company: company.name, fileName: file(company, `Cost-and-time-${from}-to-${to}`),
    sheets: [
      {
        name: "Costs", emptyText: "No cost lines in this range.",
        columns: [
          { key: "date", label: "Date", kind: "date" }, { key: "type", label: "Type", kind: "text", width: 13 }, { key: "doc", label: "Doc #", kind: "text", width: 14 },
          { key: "vendor", label: "Vendor", kind: "text", width: 24 }, { key: "description", label: "Description", kind: "text", width: 34 },
          { key: "project", label: "Project", kind: "text", width: 26 }, { key: "code", label: "Cost code", kind: "text", width: 12 },
          { key: "account", label: "Account", kind: "text", width: 28 }, { key: "sourceSaid", label: "Source said", kind: "text", width: 20 },
          { key: "amount", label: "Amount", kind: "money", total: true }, { key: "tax", label: "Recoverable tax", kind: "money", total: true },
          { key: "source", label: "Source", kind: "text", width: 26 },
        ],
        rows: costs.map((x) => ({
          date: x.date, type: SOURCE[x.source] ?? x.source, doc: x.docNumber ?? "", vendor: x.vendor?.name ?? "", description: x.description ?? "",
          project: x.project ? `${x.project.number} ${x.project.name}` : "Unassigned", code: x.costCode?.code ?? "",
          account: x.qboAccountId ? acctName.get(x.qboAccountId) ?? x.qboAccountId : "", sourceSaid: x.qboCustomerName ?? "",
          amount: x.amountCents, tax: x.taxCents || null, source: source(x),
        })),
      },
      {
        name: "Time", emptyText: "No time entries in this range.",
        columns: [
          { key: "date", label: "Date", kind: "date" }, { key: "employee", label: "Employee", kind: "text", width: 22 },
          { key: "project", label: "Project", kind: "text", width: 26 }, { key: "code", label: "Cost code", kind: "text", width: 12 },
          { key: "hours", label: "Hours", kind: "hours", total: true }, { key: "rate", label: "Pay rate", kind: "money" },
          { key: "wages", label: "Wages", kind: "money", total: true }, { key: "burden", label: "Burden", kind: "money", total: true },
          { key: "cost", label: "Labour cost", kind: "money", total: true }, { key: "status", label: "Status", kind: "text", width: 14 },
          { key: "notes", label: "Notes", kind: "text", width: 28 }, { key: "source", label: "Source", kind: "text", width: 22 },
        ],
        rows: time.map((t) => {
          const lc = labourCost(t.hoursX100, t.payRateCents, t.burdenBp);
          return {
            date: t.date, employee: t.employee?.name ?? "", project: t.project ? `${t.project.number} ${t.project.name}` : "Unassigned", code: t.costCode?.code ?? "",
            hours: t.hoursX100, rate: t.payRateCents, wages: lc.wages, burden: lc.burden, cost: lc.total,
            status: t.status === "NON_PROJECT" ? "Not project time" : t.status === "SUBMITTED" ? "Awaiting approval" : "Approved", notes: t.notes ?? "",
            source: t.importBatchId ? `Spreadsheet: ${fileName.get(t.importBatchId) ?? "import"}` : t.qboTimeActivityId ? `QuickBooks time ${t.qboTimeActivityId}` : "Entered in ProjectCost",
          };
        }),
      },
    ],
  };
}
