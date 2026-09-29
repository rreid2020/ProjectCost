import { describe, it, expect, vi, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { db, migrateDb, schema as s } from "@/db";
import { overheadRate, projectOverhead, projectEconomics, type CodeInput } from "@/lib/engine";
import { overheadPeriod, parseProfitAndLoss, importOverheadPool, companyOverhead, describeRate } from "@/lib/overhead";

const code = (o: Partial<CodeInput>): CodeInput => ({ costCodeId: "x", code: "01", name: "x", costType: "MATERIAL", originalBudget: 0, approvedChanges: 0, actual: 0, ...o });

describe("overhead maths", () => {
  it("computes a rate per base", () => {
    expect(overheadRate(50_000_00, 100_000_00, "labour_cost")).toBe(5000); // 50.00%
    expect(overheadRate(38_500_00, 1000_00, "labour_hours")).toBe(3850); // $38.50 per hour (hours x100)
    expect(overheadRate(10_000_00, 0, "direct_cost")).toBeNull();
    expect(describeRate(5000, "labour_cost")).toBe("50.0% of labour cost");
    expect(describeRate(3850, "labour_hours")).toBe("$38.50 per labour hour");
  });

  it("applies it to a project to date and at completion, without touching job cost", () => {
    const e = projectEconomics({
      originalContract: 200_000_00, approvedChangeOrderRevenue: 0, billedToDate: 0, holdbackBp: 1000,
      codes: [code({ costCodeId: "l", costType: "LABOUR", originalBudget: 60_000_00, actual: 30_000_00 }), code({ costCodeId: "m", originalBudget: 100_000_00, actual: 50_000_00 })],
    });
    const labour = { wages: 25_000_00, burden: 5_000_00, approvedHours: 600_00 };
    const byCost = projectOverhead(e, labour, 5000, "labour_cost");
    expect(byCost).toMatchObject({ baseToDate: 30_000_00, baseAtCompletion: 60_000_00, toDate: 15_000_00, atCompletion: 30_000_00 });
    expect(byCost.profitAfterOverhead).toBe(e.projectedProfit - 30_000_00); // 40,000 - 30,000
    expect(byCost.marginAfterBp).toBe(500);
    const byHours = projectOverhead(e, labour, 3850, "labour_hours");
    expect(byHours).toMatchObject({ baseToDate: 600_00, baseAtCompletion: 1200_00, toDate: 23_100_00, atCompletion: 46_200_00 });
    const byDirect = projectOverhead(e, labour, 1000, "direct_cost");
    expect(byDirect).toMatchObject({ baseToDate: 80_000_00, baseAtCompletion: 160_000_00, atCompletion: 16_000_00 });
    expect(e.eac).toBe(160_000_00); // unchanged
  });

  it("uses the last 12 complete months", () => {
    const p = overheadPeriod(new Date("2026-09-29T12:00:00Z"));
    expect(p).toMatchObject({ start: "2025-09-01", end: "2026-08-31" });
    expect(p.months).toHaveLength(12);
    expect(p.months[0]).toBe("2025-09");
    expect(p.months[11]).toBe("2026-08");
  });
});

// shaped like the CA sandbox's ProfitAndLoss (summarize_column_by=Month)
const col = (title: string, start: string) => ({ ColTitle: title, ColType: "Money", MetaData: [{ Name: "StartDate", Value: start }] });
const data = (id: string, name: string, ...vals: string[]) => ({ ColData: [{ value: name, id }, ...vals.map((value) => ({ value })), { value: "total" }] });
const PNL = {
  Columns: { Column: [{ ColTitle: "", ColType: "Account" }, col("Jul. 2026", "2026-07-01"), col("Aug. 2026", "2026-08-01"), { ColTitle: "Total", ColType: "Money" }] },
  Rows: { Row: [
    { group: "Income", Header: { ColData: [{ value: "INCOME" }] }, Rows: { Row: [data("65", "Sales", "1000.00", "2000.00")] }, Summary: { ColData: [{ value: "Total Income" }] } },
    { group: "COGS", Header: { ColData: [{ value: "COST OF GOODS SOLD" }] }, Rows: { Row: [data("44", "Cost of sales", "500.00", "")] } },
    { group: "Expenses", Header: { ColData: [{ value: "EXPENSES" }] }, Rows: { Row: [
      data("64", "Rent Expense", "1250.00", "1250.00"),
      data("91", "Janitorial Expense", "200.00", ""),
      // parent account with a sub-account: header/summary must not double count
      { Header: { ColData: [{ value: "Utilities", id: "80" }] }, Rows: { Row: [data("82", "Utilities - Electric & Gas", "156.94", "165.84")] }, Summary: { ColData: [{ value: "Total Utilities" }, { value: "156.94" }, { value: "165.84" }] } },
    ] }, Summary: { ColData: [{ value: "Total Expenses" }] } },
    { group: "OtherExpenses", Header: { ColData: [{ value: "OTHER EXPENSES" }] }, Rows: { Row: [data("89", "Interest expense", "95.00", "95.00")] } },
  ] },
};

describe("Profit and Loss parsing", () => {
  it("takes expense and other-expense accounts by month, and nothing else", () => {
    const { accounts, amounts } = parseProfitAndLoss(PNL);
    expect(accounts.map((a) => `${a.qboAccountId}:${a.section}`).sort()).toEqual(["64:Expenses", "82:Expenses", "89:OtherExpenses", "91:Expenses"]);
    const sum = (id: string) => amounts.filter((a) => a.qboAccountId === id).reduce((x, a) => x + a.amountCents, 0);
    expect(sum("64")).toBe(2500_00);
    expect(sum("82")).toBe(322_78);
    expect(amounts.find((a) => a.qboAccountId === "91")).toMatchObject({ month: "2026-07", amountCents: 200_00 });
    expect(amounts.some((a) => a.qboAccountId === "80")).toBe(false);
  });
});

describe("company overhead", () => {
  const NOW = new Date("2026-09-29T12:00:00Z");
  let companyId: string;
  beforeAll(async () => {
    await migrateDb();
    const [c] = await db.insert(s.companies).values({ name: "OH", clerkOrgId: "org_OH" }).returning();
    companyId = c.id;
    await importOverheadPool({ companyId, report: async () => PNL, now: NOW });
    // one project with labour and a job cost that posted to Janitorial (an overhead account)
    const [cust] = await db.insert(s.customers).values({ companyId, name: "C" }).returning();
    const [p] = await db.insert(s.projects).values({ companyId, customerId: cust.id, number: "1", name: "P", originalContractCents: 0 }).returning();
    const [cc] = await db.insert(s.costCodes).values({ companyId, code: "L", name: "Labour", costType: "LABOUR" }).returning();
    const [emp] = await db.insert(s.employees).values({ companyId, name: "E", trade: "T", payRateCents: 4000, burdenBp: 2500, billRateCents: 9000 }).returning();
    await db.insert(s.timeEntries).values({ companyId, employeeId: emp.id, projectId: p.id, costCodeId: cc.id, date: "2026-08-10", hoursX100: 100_00, payRateCents: 4000, burdenBp: 2500, billRateCents: 9000, status: "APPROVED" });
    await db.insert(s.timeEntries).values({ companyId, employeeId: emp.id, projectId: p.id, costCodeId: cc.id, date: "2026-09-10", hoursX100: 50_00, payRateCents: 4000, burdenBp: 2500, billRateCents: 9000, status: "APPROVED" }); // outside period
    await db.insert(s.costTransactions).values({ companyId, projectId: p.id, costCodeId: cc.id, date: "2026-07-15", source: "BILL", description: "on-site cleaning", amountCents: 50_00, qboAccountId: "91" });
  });

  it("builds the pool from included accounts less job costs, over the base for the same months", async () => {
    const company = (await db.query.companies.findFirst({ where: eq(s.companies.id, companyId) }))!;
    const oh = await companyOverhead(company, NOW);
    const janitorial = oh.accounts.find((a) => a.qboAccountId === "91")!;
    expect(janitorial).toMatchObject({ total: 200_00, jobCosts: 50_00, net: 150_00, included: true });
    expect(oh.accounts.find((a) => a.qboAccountId === "89")!.included).toBe(false); // other expense: out by default
    expect(oh.pool).toBe(2500_00 + 150_00 + 322_78);
    expect(oh.bases.labourCostTotal).toBe(5000_00); // 100 h x $40 x 1.25, August only
    expect(oh.bases.labourHours).toBe(100_00);
    expect(oh.calculatedRate).toBe(Math.round((oh.pool / 5000_00) * 10_000));
  });

  it("keeps account choices when the pool is refreshed, and honours a manual rate", async () => {
    await db.update(s.overheadAccounts).set({ included: false }).where(and(eq(s.overheadAccounts.companyId, companyId), eq(s.overheadAccounts.qboAccountId, "64")));
    await importOverheadPool({ companyId, report: async () => PNL, now: NOW });
    await db.update(s.companies).set({ overheadRateMode: "manual", overheadManualRate: 4500 }).where(eq(s.companies.id, companyId));
    const company = (await db.query.companies.findFirst({ where: eq(s.companies.id, companyId) }))!;
    const oh = await companyOverhead(company, NOW);
    expect(oh.accounts.find((a) => a.qboAccountId === "64")!.included).toBe(false);
    expect(oh.pool).toBe(150_00 + 322_78);
    expect(oh.rate).toBe(4500);
    expect((await db.select().from(s.overheadMonths).where(eq(s.overheadMonths.companyId, companyId))).length).toBe(7); // 7 non-zero account-months; no duplicates after refresh
  });
});
