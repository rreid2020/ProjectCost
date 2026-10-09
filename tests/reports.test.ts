import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import ExcelJS from "exceljs";
import { db, migrateDb, schema as s } from "@/db";
import { loadDemoData } from "@/db/demo";
import { loadPortfolio } from "@/lib/queries";
import { buildReport, normalizeParams } from "@/lib/reports";
import { toCsv, toXlsx, totalOf } from "@/lib/report-model";

let company: typeof s.companies.$inferSelect;

beforeAll(async () => {
  await migrateDb();
  [company] = await db.insert(s.companies).values({ name: "Reports Co", clerkOrgId: "org_reports" }).returning();
  await loadDemoData(db, company.id);
});

describe("reports", () => {
  it("fills in defaults", () => {
    expect(normalizeParams("wip", { period: "nonsense" })).toEqual({ period: "current" });
    expect(normalizeParams("detail", { to: "2026-03-15" })).toEqual({ from: "2026-03-01", to: "2026-03-15", project: "" });
    expect(normalizeParams("jobcost", { status: "weird" })).toEqual({ project: "", status: "active" });
  });

  it("WIP schedule matches the engine", async () => {
    const report = await buildReport("wip", company, {});
    const contracts = await loadPortfolio(company.id, ["ACTIVE"], ["CONTRACT"]);
    const sheet = report.sheets[0];
    expect(sheet.rows).toHaveLength(contracts.length);
    expect(totalOf(sheet, "earned")).toBe(contracts.reduce((a, p) => a + p.econ.earnedRevenue, 0));
    expect(totalOf(sheet, "under") - totalOf(sheet, "over")).toBe(-contracts.reduce((a, p) => a + p.econ.overUnder, 0));
  });

  it("journal entries balance and download as CSV", async () => {
    const report = await buildReport("journal", company, {});
    const sheet = report.sheets[0];
    expect(sheet.rows.length).toBeGreaterThan(0);
    expect(totalOf(sheet, "debit")).toBe(totalOf(sheet, "credit"));
    const csv = toCsv(sheet);
    expect(csv.startsWith("﻿Entry,Date,Entry,Account")).toBe(true);
  });

  it("job cost by code adds up to each project's cost to date", async () => {
    const report = await buildReport("jobcost", company, { status: "all" });
    const [summary, byCode] = report.sheets;
    expect(summary.rows.length).toBeGreaterThan(0);
    expect(totalOf(byCode, "actual")).toBe(totalOf(summary, "cost"));
  });

  it("detail lists costs and time in the range, and one project when asked", async () => {
    const all = await buildReport("detail", company, { from: "2000-01-01", to: "2100-01-01" });
    const [costs, time] = all.sheets;
    expect(costs.rows.length).toBeGreaterThan(0);
    expect(time.rows.length).toBeGreaterThan(0);
    const pid = (await loadPortfolio(company.id))[0].project.id;
    const one = await buildReport("detail", company, { from: "2000-01-01", to: "2100-01-01", project: pid });
    expect(one.sheets[0].rows.length).toBeLessThan(costs.rows.length);
  });

  it("writes Excel with dollar values and SUM totals", async () => {
    const report = await buildReport("jobcost", company, { status: "all" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(report)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "By cost code"]);
    const ws = wb.getWorksheet("Summary")!;
    const header = 5; // company, title, subtitle, blank, header
    expect(ws.getRow(header).getCell(7).value).toBe("Cost to date");
    expect(ws.getRow(header + 1).getCell(7).value).toBe((report.sheets[0].rows[0].cost as number) / 100);
    const totals = ws.getRow(header + report.sheets[0].rows.length + 1);
    expect(totals.getCell(1).value).toBe("Total");
    expect((totals.getCell(7).value as { formula: string }).formula).toMatch(/^SUM\(G6:G\d+\)$/);
  });
});
