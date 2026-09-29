// Overhead pool and rate. The pool is QuickBooks' Profit and Loss (accrual) for the last 12 complete months,
// using the accounts the company includes (default: the Expenses section). Job costs that posted to those
// accounts are netted out, since they're already on projects. The rate divides the pool by the company's
// base (labour cost, labour hours or direct cost) over the same months.
import { and, eq, gte, lte, isNotNull, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { labourCost, overheadRate, type OverheadBasis } from "./engine";

export type QboRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type ReportFetch = (path: string) => Promise<QboRecord>;

const pad = (n: number) => String(n).padStart(2, "0");
/** The last 12 complete calendar months before `now`. */
export function overheadPeriod(now = new Date()) {
  const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day of previous month
  const startMonth = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - 11, 1));
  const months: string[] = [];
  for (let d = new Date(startMonth); d <= endMonth; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
    months.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  return { start: startMonth.toISOString().slice(0, 10), end: endMonth.toISOString().slice(0, 10), months };
}

export const defaultIncluded = (section: string) => section === "Expenses";

/** Accounts and monthly amounts from a ProfitAndLoss report summarized by month (Expenses and Other Expenses only). */
export function parseProfitAndLoss(report: QboRecord) {
  const monthByCol = new Map<number, string>();
  (report.Columns?.Column ?? []).forEach((c: QboRecord, i: number) => {
    const start = c.MetaData?.find((m: QboRecord) => m.Name === "StartDate")?.Value;
    if (c.ColType === "Money" && start && c.ColTitle !== "Total") monthByCol.set(i, String(start).slice(0, 7));
  });
  const accounts = new Map<string, { qboAccountId: string; name: string; section: string }>();
  const amounts: { qboAccountId: string; month: string; amountCents: number }[] = [];
  const walk = (rows: QboRecord[] | undefined, section: string | null) => {
    for (const row of rows ?? []) {
      const sec = section ?? (row.group ? String(row.group) : null);
      const data = row.ColData; // account rows only; section headers and "Total …" summaries would double count
      if (data && (sec === "Expenses" || sec === "OtherExpenses") && data[0]?.id) {
        const id = String(data[0].id);
        accounts.set(id, { qboAccountId: id, name: String(data[0].value), section: sec });
        for (const [i, month] of monthByCol) {
          const v = Math.round(parseFloat(data[i]?.value || "0") * 100);
          if (v) amounts.push({ qboAccountId: id, month, amountCents: v });
        }
      }
      if (row.Rows) walk(row.Rows.Row, sec);
    }
  };
  walk(report.Rows?.Row, null);
  return { accounts: [...accounts.values()], amounts };
}

/** Refreshes the stored pool for the current 12-month period. Keeps each account's included/excluded choice. */
export async function importOverheadPool({ companyId, report, now = new Date() }: { companyId: string; report: ReportFetch; now?: Date }) {
  const period = overheadPeriod(now);
  const pnl = await report(`reports/ProfitAndLoss?start_date=${period.start}&end_date=${period.end}&summarize_column_by=Month&accounting_method=Accrual`);
  const { accounts, amounts } = parseProfitAndLoss(pnl);
  await db.transaction(async (tx) => {
    for (const a of accounts)
      await tx.insert(s.overheadAccounts).values({ companyId, ...a })
        .onConflictDoUpdate({ target: [s.overheadAccounts.companyId, s.overheadAccounts.qboAccountId], set: { name: a.name, section: a.section } });
    await tx.delete(s.overheadMonths).where(and(eq(s.overheadMonths.companyId, companyId), inArray(s.overheadMonths.month, period.months)));
    if (amounts.length) await tx.insert(s.overheadMonths).values(amounts.map((a) => ({ companyId, ...a })));
  });
  return { accounts: accounts.length, period };
}

export type CompanyOverhead = Awaited<ReturnType<typeof companyOverhead>>;

/** Everything behind a company's overhead rate, for the Overhead page and for applying it to projects. */
export async function companyOverhead(company: typeof s.companies.$inferSelect, now = new Date()) {
  const period = overheadPeriod(now);
  const basis = company.overheadBasis as OverheadBasis;
  const c = company.id;
  const [accts, months, jobLines, time] = await Promise.all([
    db.select().from(s.overheadAccounts).where(eq(s.overheadAccounts.companyId, c)),
    db.select().from(s.overheadMonths).where(and(eq(s.overheadMonths.companyId, c), inArray(s.overheadMonths.month, period.months))),
    db.select({ amount: s.costTransactions.amountCents, account: s.costTransactions.qboAccountId }).from(s.costTransactions)
      .where(and(eq(s.costTransactions.companyId, c), isNotNull(s.costTransactions.projectId), gte(s.costTransactions.date, period.start), lte(s.costTransactions.date, period.end))),
    db.select({ h: s.timeEntries.hoursX100, pay: s.timeEntries.payRateCents, burden: s.timeEntries.burdenBp }).from(s.timeEntries)
      .where(and(eq(s.timeEntries.companyId, c), eq(s.timeEntries.status, "APPROVED"), gte(s.timeEntries.date, period.start), lte(s.timeEntries.date, period.end))),
  ]);

  const jobCostByAccount = new Map<string, number>();
  for (const l of jobLines) if (l.account) jobCostByAccount.set(l.account, (jobCostByAccount.get(l.account) ?? 0) + l.amount);

  const accounts = accts.map((a) => {
    const byMonth = Object.fromEntries(period.months.map((m) => [m, 0]));
    for (const m of months) if (m.qboAccountId === a.qboAccountId) byMonth[m.month] += m.amountCents;
    const total = Object.values(byMonth).reduce((x, y) => x + y, 0);
    const jobCosts = jobCostByAccount.get(a.qboAccountId) ?? 0;
    return { ...a, included: a.included ?? defaultIncluded(a.section), byMonth, total, jobCosts, net: total - jobCosts };
  }).sort((x, y) => (x.section === y.section ? x.name.localeCompare(y.name) : x.section === "Expenses" ? -1 : 1));

  const pool = accounts.filter((a) => a.included).reduce((x, a) => x + a.net, 0);
  const labourCostTotal = time.reduce((x, t) => x + labourCost(t.h, t.pay, t.burden).total, 0);
  const labourHours = time.reduce((x, t) => x + t.h, 0);
  const directCost = jobLines.reduce((x, l) => x + l.amount, 0) + labourCostTotal;
  const base = basis === "labour_cost" ? labourCostTotal : basis === "labour_hours" ? labourHours : directCost;
  const calculatedRate = overheadRate(pool, base, basis);
  const rate = company.overheadRateMode === "manual" ? company.overheadManualRate : calculatedRate;
  return { period, basis, mode: company.overheadRateMode, accounts, pool, base, bases: { labourCostTotal, labourHours, directCost }, calculatedRate, rate: rate ?? null, hasData: accts.length > 0 };
}

/** "45.0% of labour cost" / "$38.50 per labour hour" */
export function describeRate(rate: number | null, basis: string) {
  if (rate == null) return "not set";
  if (basis === "labour_hours") return `$${(rate / 100).toFixed(2)} per labour hour`;
  return `${(rate / 100).toFixed(1)}% of ${basis === "labour_cost" ? "labour cost" : "direct cost"}`;
}
