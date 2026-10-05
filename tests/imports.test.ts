import { describe, it, expect, vi, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

import { db, migrateDb, schema as s } from "@/db";
import * as V from "@/lib/imports/values";
import { parseUpload } from "@/lib/imports/parse";
import { autoMap, detectHeaderRow, mappingProblems } from "@/lib/imports/mapping";
import { importKind, IMPORT_KINDS } from "@/lib/imports/kinds";
import { analyze, commitImport, extractRecords, undoBatch } from "@/lib/imports/engine";
import { loadProject } from "@/lib/queries";

const enc = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const K = (k: string) => importKind(k)!;

describe("reading values", () => {
  it("reads dates in the formats exports use", () => {
    expect(V.parseDate("2026-09-22", "DMY")).toBe("2026-09-22");
    expect(V.parseDate("22/09/2026", "MDY")).toBe("2026-09-22"); // 22 can only be a day
    expect(V.parseDate("03/04/2026", "DMY")).toBe("2026-04-03");
    expect(V.parseDate("03/04/2026", "MDY")).toBe("2026-03-04");
    expect(V.parseDate("22-Sep-2026", "DMY")).toBe("2026-09-22");
    expect(V.parseDate("Sep 22, 2026", "DMY")).toBe("2026-09-22");
    expect(V.parseDate("46287", "DMY")).toBe("2026-09-22"); // Excel serial
    expect(() => V.parseDate("31/02/2026", "DMY")).toThrow();
    expect(V.parseDate("", "DMY")).toBeNull();
  });
  it("reads money, percentages and hours", () => {
    expect(V.parseMoney("$1,234.56")).toBe(123456);
    expect(V.parseMoney("(1,234.56)")).toBe(-123456);
    expect(V.parseMoney("1,234.56-")).toBe(-123456);
    expect(V.parseMoney("-$50")).toBe(-5000);
    expect(V.parseMoney("200.00 CR")).toBe(-20000);
    expect(() => V.parseMoney("abc")).toThrow();
    expect(V.parsePercent("30.5%")).toBe(3050);
    expect(V.parsePercent("30.5")).toBe(3050);
    expect(V.parsePercent("0.305")).toBe(3050);
    expect(V.parseHours("7:30")).toBe(750);
    expect(V.parseHours("7h 30m")).toBe(750);
    expect(V.parseHours("8")).toBe(800);
    expect(V.parseMonth("Sep. 2025")).toBe("2025-09");
    expect(V.parseMonth("2026-01")).toBe("2026-01");
  });
});

describe("reading files", () => {
  it("parses CSV with a byte-order mark and finds the header below title rows", async () => {
    const [sheet] = await parseUpload(enc("﻿Account Transactions\nSandbox Co\n\nDate,Description,Debit,Credit,Account Code\n2026-09-01,Copper,100.00,,5100\n"), "gl.csv");
    expect(sheet.rows[0][0]).toBe("Account Transactions");
    expect(detectHeaderRow(sheet.rows, K("costs"))).toBe(2);
  });
  it("parses Excel: picks every visible sheet, reads dates, numbers and formulas", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Hours");
    ws.addRow(["Employee", "Date", "Job", "Regular"]);
    ws.addRow(["Marco Silva", new Date(Date.UTC(2026, 8, 22)), "2401", 7.5]);
    ws.addRow(["Priya Nair", new Date(Date.UTC(2026, 8, 22)), "2401", { formula: "4+4", result: 8 }]);
    wb.addWorksheet("Notes").addRow(["ignore me"]);
    const buf = await wb.xlsx.writeBuffer();
    const sheets = await parseUpload(buf as ArrayBuffer, "time.xlsx");
    expect(sheets.map((x) => x.name)).toEqual(["Hours", "Notes"]);
    expect(sheets[0].rows[1]).toEqual(["Marco Silva", "2026-09-22", "2401", "7.5"]);
    expect(sheets[0].rows[2][3]).toBe("8");
  });
  it("refuses old .xls files with a clear message", async () => {
    await expect(parseUpload(enc("x"), "old.xls")).rejects.toThrow(/xlsx or CSV/);
  });
});

describe("matching columns from other systems", () => {
  const mapped = (headers: string[], kind: string) => Object.fromEntries(Object.entries(autoMap(headers, K(kind))).map(([k, i]) => [k, headers[i]]));
  it("Xero bills export", () => {
    expect(mapped(["ContactName", "InvoiceNumber", "InvoiceDate", "Description", "LineAmount", "AccountCode", "TaxAmount", "TrackingOption1"], "costs"))
      .toMatchObject({ vendor: "ContactName", reference: "InvoiceNumber", date: "InvoiceDate", description: "Description", amount: "LineAmount", account: "AccountCode", tax: "TaxAmount", project: "TrackingOption1" });
  });
  it("QuickBooks Time (TSheets) and ClockShark timesheets", () => {
    expect(mapped(["fname", "lname", "local_date", "hours", "jobcode", "service item", "notes"], "time"))
      .toMatchObject({ firstName: "fname", lastName: "lname", date: "local_date", hours: "hours", project: "jobcode", code: "service item", notes: "notes" });
    expect(mapped(["Employee", "Date", "Job", "Task", "Regular", "Overtime"], "time"))
      .toMatchObject({ employee: "Employee", date: "Date", project: "Job", code: "Task", hours: "Regular", overtime: "Overtime" });
  });
  it("Sage 300 GL detail with debit and credit columns", () => {
    const m = mapped(["Posting Date", "Account Number", "Description", "Reference", "Debit", "Credit", "Job", "Phase"], "costs");
    expect(m).toMatchObject({ date: "Posting Date", account: "Account Number", debit: "Debit", credit: "Credit", project: "Job", code: "Phase", reference: "Reference" });
    expect(mappingProblems(K("costs"), autoMap(["Posting Date", "Debit", "Credit"], K("costs")), [])).toEqual([]);
  });
  it("maps every template's own headers back to all of its fields", () => {
    for (const kind of IMPORT_KINDS) {
      const m = autoMap(kind.fields.map((f) => f.label), kind);
      expect(Object.keys(m).sort(), kind.key).toEqual(kind.fields.map((f) => f.key).sort());
    }
  });

  it("uses a company's saved mapping first", () => {
    expect(mapped(["Work Day", "Who", "Hrs", "Site"], "time")).not.toHaveProperty("employee");
    const saved = { date: "Work Day", employee: "Who", hours: "Hrs", project: "Site" };
    const m = autoMap(["Work Day", "Who", "Hrs", "Site"], K("time"), saved);
    expect(m).toEqual({ date: 0, employee: 1, hours: 2, project: 3 });
  });
});

// ---------- end to end ----------
async function run(companyId: string, kind: string, csv: string, opts: { skipErrors?: boolean; order?: V.DateOrder } = {}) {
  const [sheet] = await parseUpload(enc(csv), `${kind}.csv`);
  const header = detectHeaderRow(sheet.rows, K(kind));
  const mapping = autoMap(sheet.rows[header], K(kind));
  const records = extractRecords(sheet.rows, header, mapping, K(kind));
  return commitImport({ companyId, userId: "u1", kind, fileName: `${kind}.csv`, sheetName: null, records, order: opts.order ?? "DMY", skipErrors: opts.skipErrors ?? false });
}
async function preview(companyId: string, kind: string, csv: string) {
  const [sheet] = await parseUpload(enc(csv), `${kind}.csv`);
  const header = detectHeaderRow(sheet.rows, K(kind));
  return analyze(db, companyId, kind, extractRecords(sheet.rows, header, autoMap(sheet.rows[header], K(kind)), K(kind)), "DMY");
}

describe("importing spreadsheets", () => {
  let c: string, other: string;
  beforeAll(async () => {
    await migrateDb();
    [{ id: c }] = await db.insert(s.companies).values({ name: "Sheets", clerkOrgId: "org_sheets", region: "CA" }).returning();
    [{ id: other }] = await db.insert(s.companies).values({ name: "Other", clerkOrgId: "org_other" }).returning();
  });
  const project = (n: string) => db.query.projects.findFirst({ where: and(eq(s.projects.companyId, c), eq(s.projects.number, n)) });
  const costs = () => db.select().from(s.costTransactions).where(eq(s.costTransactions.companyId, c));

  it("projects: creates, updates, and requires a customer for contracts", async () => {
    const r = await run(c, "projects", "Job Number,Job Name,Type,Customer,Contract Value,Start Date,Holdback %\n2401,Riverside MOB,Contract,Beacon Construction,\"2,450,000\",12/01/2026,10\nCAP-1,Shop expansion,Capital,,,,\n");
    expect(r).toMatchObject({ created: 2, updated: 0 });
    expect(await project("2401")).toMatchObject({ projectType: "CONTRACT", originalContractCents: 245_000_000, startDate: "2026-01-12", holdbackBp: 1000 });
    expect((await project("CAP-1"))!.projectType).toBe("CAPITAL");
    const again = await run(c, "projects", "Job Number,Job Name,Contract Value\n2401,Riverside MOB,\"2,500,000\"\n");
    expect(again).toMatchObject({ created: 0, updated: 1 });
    expect((await project("2401"))!.originalContractCents).toBe(250_000_000);
    const bad = await preview(c, "projects", "Job Number,Job Name\nX-1,No customer\n");
    expect(bad.rows[0].errors.join()).toMatch(/Customer is required/);
  });

  it("budgets: adds unknown codes when named, and replaces amounts on re-import", async () => {
    const csv = "Job,Cost Code,Code Description,Cost Type,Budget\n2401,22-100,Plumbing labour,Labour,260000\n2401,22-200,Plumbing materials,Material,\"241,000\"\n2401,22-200,Plumbing materials,Material,1000\n";
    expect(await run(c, "budgets", csv)).toMatchObject({ created: 2 });
    const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.companyId, c));
    expect(lines.map((l) => l.originalCents).sort()).toEqual([24_200_000, 26_000_000]); // duplicate rows summed
    expect(await run(c, "budgets", csv.replace("260000", "270000"))).toMatchObject({ created: 0, updated: 2 });
    const missing = await preview(c, "budgets", "Job,Cost Code,Budget\n9999,22-100,5\n2401,99-999,5\n");
    expect(missing.rows.map((r) => r.errors.join())).toEqual([expect.stringMatching(/Project "9999" not found/), expect.stringMatching(/add a cost code name/i)]);
  });

  it("costs: codes what matches, queues the rest, keeps tax out of cost in Canada, and re-imports without duplicates", async () => {
    const csv = "Date,Vendor,Reference,Description,Job,Phase,Amount,GST/HST,Type\n" +
      "15/09/2026,Wolseley,W-1,Copper fittings,2401,22-200,\"1,000.00\",130.00,Bill\n" +
      "16/09/2026,Home Depot,HD-2,Consumables,,,50.00,6.50,Expense\n" +
      "17/09/2026,Wolseley,W-3,Return,2401,22-200,(100.00),(13.00),Vendor credit\n" +
      "17/09/2026,Mystery,M-1,Unknown job,7777,22-200,25.00,,Bill\n";
    const r = await run(c, "costs", csv);
    expect(r).toMatchObject({ created: 4, updated: 0, toCode: 2 });
    const rows = await costs();
    const byRef = (ref: string) => rows.find((x) => x.docNumber === ref)!;
    const p = (await project("2401"))!;
    expect(byRef("W-1")).toMatchObject({ projectId: p.id, amountCents: 100_000, taxCents: 13_000, source: "BILL", sourceRow: 2 });
    expect(byRef("W-3")).toMatchObject({ amountCents: -10_000, source: "CREDIT" });
    expect(byRef("M-1")).toMatchObject({ projectId: null, qboCustomerName: "7777" });
    expect(await run(c, "costs", csv)).toMatchObject({ created: 0, updated: 4 });
    expect(await costs()).toHaveLength(4);
    // coding done in ProjectCost survives a re-import of a line with no project
    const hd = (await costs()).find((x) => x.docNumber === "HD-2")!;
    const code = (await db.query.costCodes.findFirst({ where: and(eq(s.costCodes.companyId, c), eq(s.costCodes.code, "22-200")) }))!;
    await db.update(s.costTransactions).set({ projectId: p.id, costCodeId: code.id }).where(eq(s.costTransactions.id, hd.id));
    await run(c, "costs", csv);
    expect((await costs()).find((x) => x.id === hd.id)).toMatchObject({ projectId: p.id, costCodeId: code.id });
    const loaded = (await loadProject(c, p.id))!;
    expect(loaded.econ.costToDate).toBe(100_000 - 10_000 + 5_000);
  });

  it("time: adds new employees at $0, uses a placeholder code, and picks up rates from an employee import", async () => {
    const r = await run(c, "time", "fname,lname,local_date,hours,jobcode,service item,notes\nMarco,Silva,2026-09-22,8,2401,22-100,rough-in\nPriya,Nair,2026-09-22,7:30,2401,,\n");
    expect(r).toMatchObject({ created: 2 });
    const time = await db.select().from(s.timeEntries).where(eq(s.timeEntries.companyId, c));
    expect(time.map((t) => t.hoursX100).sort()).toEqual([750, 800]);
    expect(time.every((t) => t.payRateCents === 0 && t.status === "APPROVED")).toBe(true);
    expect(await db.query.costCodes.findFirst({ where: and(eq(s.costCodes.companyId, c), eq(s.costCodes.code, "LAB-UNCODED")) })).toBeTruthy();
    expect(await run(c, "employees", "Name,Trade,Pay Rate,Burden %,Bill Rate\nMarco Silva,Foreman,48.50,30.5,110\n")).toMatchObject({ updated: 1 });
    const marco = (await db.select().from(s.timeEntries).where(eq(s.timeEntries.companyId, c))).find((t) => t.hoursX100 === 800)!;
    expect(marco).toMatchObject({ payRateCents: 4850, burdenBp: 3050 });
    const bad = await preview(c, "time", "Employee,Date,Job,Hours\nSofia Haddad,2026-09-22,NOPE,4\n");
    expect(bad.rows[0].errors.join()).toMatch(/Project "NOPE" not found/);
  });

  it("invoices, change orders (approved -> billable), accounts and a P&L with a column per month", async () => {
    await run(c, "invoices", "Invoice Date,Job,Invoice Number,Subtotal,Total,Tax,Type\n31/08/2026,2401,1042,\"185,000.00\",,,Invoice\n15/09/2026,2401,CN-1,500.00,,,Credit note\n");
    const p = (await project("2401"))!;
    expect((await loadProject(c, p.id))!.billedInQbo).toBe(18_500_000 - 50_000);
    await run(c, "changeorders", "Job,CO #,Title,Status,Amount,Cost Code,Cost\n2401,3,Med gas outlets,Approved,18200,22-100,6500\n2401,3,Med gas outlets,Approved,,22-200,7000\n");
    const loaded = (await loadProject(c, p.id))!;
    expect(loaded.changeOrders[0]).toMatchObject({ number: 3, status: "APPROVED", contractAmountCents: 1_820_000 });
    expect(loaded.changeOrders[0].lines).toHaveLength(2);
    expect(loaded.sov.some((l) => l.changeOrderNumber === 3)).toBe(true);
    await run(c, "accounts", "*Code,*Name,*Type\n5100,Job materials,Direct Costs\n6100,Rent,Overheads\n");
    expect((await db.query.glAccounts.findFirst({ where: and(eq(s.glAccounts.companyId, c), eq(s.glAccounts.qboId, "f:5100")) }))!.accountType).toBe("Cost of Goods Sold");
    await run(c, "pnl", "Profit and Loss\n\nAccount,Jul 2026,Aug 2026,Total\nRent,1250,1250,2500\nInterest expense,95,95,190\n");
    const months = await db.select().from(s.overheadMonths).where(eq(s.overheadMonths.companyId, c));
    expect(months).toHaveLength(4);
    expect(months.find((m) => m.month === "2026-08" && m.qboAccountId === "f:6100")?.amountCents).toBe(125_000); // matched to the imported Rent account
  });

  it("undo removes only what an import created", async () => {
    const before = (await db.select().from(s.changeOrders).where(eq(s.changeOrders.companyId, c))).length;
    const r = await run(c, "changeorders", "Job,CO #,Title,Status,Amount\n2401,3,Med gas outlets (revised),Approved,19000\n2401,4,Extra shutoffs,Pending,2500\n");
    expect(r).toMatchObject({ created: 1, updated: 1 });
    await undoBatch(c, r.batchId);
    const cos = await db.select().from(s.changeOrders).where(eq(s.changeOrders.companyId, c));
    expect(cos).toHaveLength(before); // CO 4 gone; CO 3 (created earlier) stays
    await expect(undoBatch(c, r.batchId)).rejects.toThrow(/already undone/);
    const projects = (await db.select().from(s.importBatches).where(and(eq(s.importBatches.companyId, c), eq(s.importBatches.kind, "projects"))))[0];
    await expect(undoBatch(c, projects.id)).rejects.toThrow(/can't be undone/);
  });

  it("never reaches another company's records", async () => {
    const r = await preview(other, "costs", "Date,Job,Amount\n2026-09-01,2401,10\n");
    expect(r.rows[0].resolved.projectId).toBeNull(); // company Sheets' project 2401 isn't visible
    const batch = (await db.select().from(s.importBatches).where(eq(s.importBatches.companyId, c)))[0];
    await expect(undoBatch(other, batch.id)).rejects.toThrow(/not found/);
    expect(await db.select().from(s.costTransactions).where(eq(s.costTransactions.companyId, other))).toHaveLength(0);
  });

  it("refuses rows with problems unless told to skip them", async () => {
    const csv = "Date,Job,Amount\nnot a date,2401,10\n2026-09-02,2401,20\n";
    await expect(run(c, "costs", csv)).rejects.toThrow(/1 row\(s\) have problems/);
    expect(await run(c, "costs", csv, { skipErrors: true })).toMatchObject({ created: 1, skipped: 1 });
  });
});
