// QuickBooks import against fixtures shaped like the CA sandbox's records, into an in-memory Postgres.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { db, migrateDb, schema as s } from "@/db";
import { loadDemoData } from "@/db/demo";
import { loadProject } from "@/lib/queries";
import { runImport, projectIdentity, type QboQuery, type QboRecord } from "@/lib/qbo-import";

const NOW = new Date("2026-09-28T12:00:00Z");

function fixtures() {
  const item = (id: string, name: string, customer?: [string, string]) => ({ ItemRef: { value: id, name }, ...(customer ? { CustomerRef: { value: customer[0], name: customer[1] } } : {}) });
  const retreat: [string, string] = ["66", "Oxon - Retreat"];
  return {
    Account: [{ Id: "44", AccountType: "Cost of Goods Sold", Name: "Cost of sales" }, { Id: "91", AccountType: "Expense", Name: "Janitorial Expense" }],
    Item: [
      { Id: "13", Type: "Service", Name: "Misc", ExpenseAccountRef: { value: "44" } },
      { Id: "2", Type: "Service", Name: "Hours" },
      { Id: "21", Type: "Inventory", Sku: "NB-476", Name: "Name Badges", ExpenseAccountRef: { value: "44" } },
      { Id: "23", Type: "Category", Name: "Employee events" },
    ],
    Customer: [
      { Id: "2", DisplayName: "Oxon Insurance Agency", Job: false, Active: true },
      { Id: "66", DisplayName: "Oxon - Retreat", Job: true, ParentRef: { value: "2" }, Active: true },
      { Id: "70", DisplayName: "0969 Ocean View Road", Job: true, ParentRef: { value: "2" }, Active: false },
      { Id: "10", DisplayName: "Lew Plumbing", Job: false, Active: true },
      { Id: "99", DisplayName: "Idle Customer", Job: false, Active: true },
    ],
    Vendor: [{ Id: "35", DisplayName: "Jennifer Hargreaves" }],
    Employee: [{ Id: "55", DisplayName: "Pat Fitter", CostRate: 42, BillRate: 95 }],
    Bill: [
      // overhead: expense account, no customer
      { Id: "98", TxnDate: "2026-03-10", VendorRef: { value: "35" }, TxnTaxDetail: { TotalTax: 26 },
        Line: [{ Id: "1", Amount: 200, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "91", name: "Janitorial Expense" } } }] },
      { Id: "97", TxnDate: "2026-08-05", DocNumber: "B-97", VendorRef: { value: "35" }, TxnTaxDetail: { TotalTax: 45 },
        Line: [
          { Id: "1", Amount: 262.5, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: item("13", "Misc", retreat) },
          { Id: "2", Amount: 187.5, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: item("13", "Misc", ["10", "Lew Plumbing"]) },
        ] },
      // foreign currency, like the sandbox's HKD bills
      { Id: "20", TxnDate: "2026-08-05", VendorRef: { value: "35" }, CurrencyRef: { value: "HKD" }, ExchangeRate: 0.137365,
        Line: [{ Id: "1", Amount: 3715.26, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: item("21", "Name Badges", retreat) }] },
      // COGS with no customer: job cost that needs coding
      { Id: "96", TxnDate: "2026-08-06", VendorRef: { value: "35" },
        Line: [{ Id: "1", Amount: 50, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "44", name: "Cost of sales" } } }] },
    ] as QboRecord[],
    Purchase: [
      { Id: "44", TxnDate: "2026-06-01", PaymentType: "Check", DocNumber: "2076", EntityRef: { type: "Vendor", value: "35" },
        Line: [{ Id: "1", Amount: 1000, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: item("21", "Name Badges", retreat) }] },
      { Id: "45", TxnDate: "2026-06-02", PaymentType: "CreditCard", Credit: true,
        Line: [{ Id: "1", Amount: 100, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: item("13", "Misc", retreat) }] },
    ] as QboRecord[],
    VendorCredit: [] as QboRecord[],
    TimeActivity: [
      { Id: "7", TxnDate: "2026-09-01", NameOf: "Employee", EmployeeRef: { value: "55" }, CustomerRef: { value: "66" }, ItemRef: { value: "2" }, Hours: 7, Minutes: 30 },
      { Id: "8", TxnDate: "2026-09-02", NameOf: "Employee", EmployeeRef: { value: "55" }, Hours: 8 }, // no job: comes in unassigned
      { Id: "9", TxnDate: "2026-09-02", NameOf: "Vendor", VendorRef: { value: "35" }, CustomerRef: { value: "66" }, Hours: 4 }, // vendor time: skipped
    ],
    Invoice: [
      { Id: "126", TxnDate: "2026-07-01", DocNumber: "1037", CustomerRef: { value: "66" }, TotalAmt: 11300, TxnTaxDetail: { TotalTax: 1300 } },
      { Id: "130", TxnDate: "2026-07-02", CustomerRef: { value: "10" }, TotalAmt: 565, TxnTaxDetail: { TotalTax: 65 } },
    ],
    CreditMemo: [{ Id: "140", TxnDate: "2026-07-15", CustomerRef: { value: "66" }, TotalAmt: 113, TxnTaxDetail: { TotalTax: 13 } }],
    Estimate: [
      { Id: "5", CustomerRef: { value: "66" }, TxnStatus: "Accepted", TotalAmt: 56500, TxnTaxDetail: { TotalTax: 6500 } },
      { Id: "6", CustomerRef: { value: "66" }, TxnStatus: "Pending", TotalAmt: 1000 },
    ],
  };
}

const queryFor = (data: Record<string, QboRecord[]>): QboQuery => async (entity) => structuredClone(data[entity] ?? []);

async function newCompany(name: string, extra: Partial<typeof s.companies.$inferInsert> = {}) {
  const [c] = await db.insert(s.companies).values({ name, clerkOrgId: `org_${name}`, qboProjectMode: "jobs", ...extra }).returning();
  return c;
}
const rows = {
  projects: (c: string) => db.select().from(s.projects).where(eq(s.projects.companyId, c)),
  costs: (c: string) => db.select().from(s.costTransactions).where(eq(s.costTransactions.companyId, c)),
  time: (c: string) => db.select().from(s.timeEntries).where(eq(s.timeEntries.companyId, c)),
  codes: (c: string) => db.select().from(s.costCodes).where(eq(s.costCodes.companyId, c)),
};

beforeAll(async () => { await migrateDb(); });

describe("guards", () => {
  it("refuses a workspace that still has sample data", async () => {
    const sample = await newCompany("Sample");
    await loadDemoData(db, sample.id);
    await expect(runImport({ companyId: sample.id, query: queryFor(fixtures()), now: NOW })).rejects.toThrow("sample data");
  });
  it("by default creates no projects: costs come in unassigned, and an assignment made in ProjectCost survives a re-sync", async () => {
    for (const mode of [null, "none"]) {
      const c = (await newCompany(`NoProjects-${mode}`, { qboProjectMode: mode })).id;
      const summary = await runImport({ companyId: c, query: queryFor(fixtures()), now: NOW });
      expect(summary.projects).toBe(0);
      expect(await rows.projects(c)).toHaveLength(0);
      const costs = await rows.costs(c);
      expect(costs.length).toBeGreaterThan(0);
      expect(costs.every((x) => x.projectId === null)).toBe(true);
      expect(summary.needsCoding).toBe(costs.length);
      // the bookkeeper assigns one line in ProjectCost; the next sync keeps it
      const [p] = await db.insert(s.projects).values({ companyId: c, number: "P-1", name: "Made in ProjectCost", originalContractCents: 0 }).returning();
      await db.update(s.costTransactions).set({ projectId: p.id }).where(eq(s.costTransactions.id, costs[0].id));
      await runImport({ companyId: c, query: queryFor(fixtures()), now: NOW });
      expect((await rows.costs(c)).find((x) => x.id === costs[0].id)?.projectId).toBe(p.id);
    }
  });
  it("derives project numbers from job names", () => {
    const taken = new Set<string>(["QB-1"]);
    expect(projectIdentity({ Id: "70", DisplayName: "0969 Ocean View Road" }, taken)).toEqual({ number: "0969", name: "Ocean View Road" });
    expect(projectIdentity({ Id: "66", DisplayName: "Oxon - Retreat" }, taken)).toEqual({ number: "QB-66", name: "Oxon - Retreat" });
    expect(projectIdentity({ Id: "71", DisplayName: "0969 Ocean View Road" }, taken).number).toBe("0969-71");
  });
});

describe("jobs mode, Canadian company", () => {
  let c: string, summary: Awaited<ReturnType<typeof runImport>>;
  beforeAll(async () => {
    c = (await newCompany("Jobs")).id;
    summary = await runImport({ companyId: c, query: queryFor(fixtures()), now: NOW });
  });

  it("makes projects from sub-customers only, with numbers, status and contract from accepted estimates", async () => {
    const ps = await rows.projects(c);
    expect(ps.map((p) => p.qboProjectId).sort()).toEqual(["66", "70"]);
    const retreat = ps.find((p) => p.qboProjectId === "66")!, ocean = ps.find((p) => p.qboProjectId === "70")!;
    expect(retreat).toMatchObject({ number: "QB-66", name: "Oxon - Retreat", status: "ACTIVE", originalContractCents: 50_000_00 });
    expect(ocean).toMatchObject({ number: "0969", name: "Ocean View Road", status: "COMPLETE" });
    const cust = await db.query.customers.findFirst({ where: eq(s.customers.id, retreat.customerId!) });
    expect(cust!.name).toBe("Oxon Insurance Agency"); // root customer
    expect(summary).toMatchObject({ customers: 3, projects: 2, newProjects: 2, vendors: 1, employees: 1 });
  });

  it("turns items (not categories) into cost codes with a guessed type", async () => {
    const codes = await rows.codes(c);
    const byItem = Object.fromEntries(codes.filter((x) => x.qboItemId).map((x) => [x.qboItemId, x]));
    expect(Object.keys(byItem).sort()).toEqual(["13", "2", "21"]);
    expect(codes.filter((x) => !x.qboItemId).map((x) => x.code)).toEqual(["LAB-UNCODED"]); // for time with no service item
    expect(byItem["2"].costType).toBe("LABOUR");
    expect(byItem["21"]).toMatchObject({ code: "NB-476", costType: "MATERIAL" });
  });

  it("imports job-cost lines, skips overhead, allocates recoverable tax, and signs refunds", async () => {
    const costs = await rows.costs(c);
    expect(summary.overheadSkipped).toBe(1);
    expect(costs).toHaveLength(6);
    const key = (t: string, id: string, line = "1") => costs.find((x) => x.qboTxnType === t && x.qboTxnId === id && x.qboLineId === line)!;
    const retreat = (await rows.projects(c)).find((p) => p.qboProjectId === "66")!;
    expect(key("Bill", "97")).toMatchObject({ projectId: retreat.id, amountCents: 262_50, taxCents: 26_25, source: "BILL", docNumber: "B-97" });
    expect(key("Bill", "97", "2")).toMatchObject({ projectId: null, qboCustomerName: "Lew Plumbing", amountCents: 187_50, taxCents: 18_75 });
    expect(key("Bill", "96")).toMatchObject({ projectId: null, costCodeId: null, amountCents: 50_00 });
    expect(key("Purchase", "44")).toMatchObject({ source: "CHECK", amountCents: 1000_00 });
    expect(key("Purchase", "45")).toMatchObject({ source: "EXPENSE", amountCents: -100_00 });
    expect(summary.needsCoding).toBe(2);
  });

  it("keeps what QuickBooks shows, for tracing: original currency amount, rate, invoice total and tax", async () => {
    const hkd = (await rows.costs(c)).find((x) => x.qboTxnId === "20")!;
    expect(hkd).toMatchObject({ qboCurrency: "HKD", qboLineAmountCents: 3715_26, qboExchangeRate: "0.137365", amountCents: 510_35 });
    const inv = await db.query.qboInvoices.findFirst({ where: and(eq(s.qboInvoices.companyId, c), eq(s.qboInvoices.qboTxnId, "126")) });
    expect(inv).toMatchObject({ totalCents: 11_300_00, taxCents: 1_300_00, amountCents: 10_000_00 });
  });

  it("imports employee time as approved, at the employee's rate; time with no project waits unassigned", async () => {
    const time = await rows.time(c);
    expect(time).toHaveLength(2);
    const onJob = time.find((x) => x.qboTimeActivityId === "7")!;
    expect(onJob.projectId).not.toBeNull();
    expect(onJob).toMatchObject({ hoursX100: 750, payRateCents: 4200, billRateCents: 9500, status: "APPROVED" });
    expect(time.find((x) => x.qboTimeActivityId === "8")).toMatchObject({ projectId: null, hoursX100: 800, status: "APPROVED" });
    expect(summary.timeUnassigned).toBe(1);
    expect(summary.timeSkipped).toBe(1); // vendor time arrives on bills
  });

  it("counts QuickBooks invoices and credit memos (pre-tax) as billed to date", async () => {
    const retreat = (await rows.projects(c)).find((p) => p.qboProjectId === "66")!;
    const loaded = (await loadProject(c, retreat.id))!;
    expect(loaded.billedInQbo).toBe(10_000_00 - 100_00);
    expect(loaded.econ.billedToDate).toBe(9_900_00);
    expect(summary.invoices).toBe(2); // Lew Plumbing's invoice isn't for a project in jobs mode
  });

  it("is re-runnable: no duplicates, keeps coding done in ProjectCost, removes what QuickBooks deleted", async () => {
    const retreat = (await rows.projects(c)).find((p) => p.qboProjectId === "66")!;
    const misc = (await rows.codes(c)).find((x) => x.qboItemId === "13")!;
    const lew = (await rows.costs(c)).find((x) => x.qboCustomerName === "Lew Plumbing")!;
    await db.update(s.costTransactions).set({ projectId: retreat.id, costCodeId: misc.id, pendingPush: true }).where(eq(s.costTransactions.id, lew.id));
    await db.update(s.projects).set({ name: "Renamed in ProjectCost", originalContractCents: 1 }).where(eq(s.projects.id, retreat.id));

    const data = fixtures();
    data.Purchase = data.Purchase.filter((p) => p.Id !== "45"); // deleted in QuickBooks
    const second = await runImport({ companyId: c, query: queryFor(data), now: NOW });

    expect(await rows.projects(c)).toHaveLength(2);
    expect(await rows.codes(c)).toHaveLength(4);
    expect(await rows.time(c)).toHaveLength(2);
    const costs = await rows.costs(c);
    expect(costs).toHaveLength(5);
    expect(second.removed).toBe(1);
    expect(costs.find((x) => x.id === lew.id)).toMatchObject({ projectId: retreat.id, costCodeId: misc.id, pendingPush: true });
    expect(await db.query.projects.findFirst({ where: eq(s.projects.id, retreat.id) })).toMatchObject({ name: "Renamed in ProjectCost", originalContractCents: 1 });
  });
});

describe("unassigned QuickBooks time", () => {
  it("keeps a project and code assigned in ProjectCost, and time marked as not project work, across re-syncs", async () => {
    const c = (await newCompany("TimeSync", { qboProjectMode: "none" })).id;
    const data = fixtures();
    (data.TimeActivity as QboRecord[]).push({ Id: "10", TxnDate: "2026-09-03", NameOf: "Employee", EmployeeRef: { value: "55" }, Hours: 2, Description: "Shop cleanup" });
    await runImport({ companyId: c, query: queryFor(data), now: NOW });
    const [p] = await db.insert(s.projects).values({ companyId: c, number: "P-9", name: "Made in ProjectCost", originalContractCents: 0 }).returning();
    const labour = (await rows.codes(c)).find((x) => x.qboItemId === "2")!;
    const time = await rows.time(c);
    expect(time.every((x) => x.projectId === null)).toBe(true); // nothing is linked in "none" mode
    const t8 = time.find((x) => x.qboTimeActivityId === "8")!, t10 = time.find((x) => x.qboTimeActivityId === "10")!;
    await db.update(s.timeEntries).set({ projectId: p.id, costCodeId: labour.id }).where(eq(s.timeEntries.id, t8.id));
    await db.update(s.timeEntries).set({ status: "NON_PROJECT" }).where(eq(s.timeEntries.id, t10.id));

    await runImport({ companyId: c, query: queryFor(data), now: NOW });
    const after = await rows.time(c);
    expect(after.find((x) => x.id === t8.id)).toMatchObject({ projectId: p.id, costCodeId: labour.id, status: "APPROVED" });
    expect(after.find((x) => x.id === t10.id)).toMatchObject({ projectId: null, status: "NON_PROJECT" });
  });
});

describe("customers mode and US tax", () => {
  it("makes a project of every customer with activity, and adds non-recoverable tax to cost", async () => {
    const c = (await newCompany("Customers", { qboProjectMode: "customers", region: "US" })).id;
    await runImport({ companyId: c, query: queryFor(fixtures()), now: NOW });
    const ps = await rows.projects(c);
    expect(ps.map((p) => p.qboProjectId).sort()).toEqual(["10", "66"]);
    const lew = ps.find((p) => p.qboProjectId === "10")!;
    const line = (await rows.costs(c)).find((x) => x.qboTxnId === "97" && x.qboLineId === "2")!;
    expect(line).toMatchObject({ projectId: lew.id, amountCents: 187_50 + 18_75, taxCents: 0 });
  });
});

describe("tenant isolation", () => {
  it("never touches another company's rows", async () => {
    const other = await newCompany("Other", { qboProjectMode: null });
    await loadDemoData(db, other.id);
    await db.update(s.companies).set({ sampleDataLoadedAt: null }).where(eq(s.companies.id, other.id));
    const before = { p: (await rows.projects(other.id)).length, c: (await rows.costs(other.id)).length, t: (await rows.time(other.id)).length };
    const c = (await newCompany("Importer")).id;
    await runImport({ companyId: c, query: queryFor(fixtures()), now: NOW });
    await runImport({ companyId: c, query: queryFor({ ...fixtures(), Bill: [], Purchase: [], TimeActivity: [], Invoice: [], CreditMemo: [] }), now: NOW });
    expect({ p: (await rows.projects(other.id)).length, c: (await rows.costs(other.id)).length, t: (await rows.time(other.id)).length }).toEqual(before);
    expect((await db.select().from(s.costTransactions).where(and(eq(s.costTransactions.companyId, c)))).length).toBe(0);
  });
});

describe("internal projects linked by class, location or account; journal entries", () => {
  it("routes lines to linked projects and brings in the right journal lines", async () => {
    const co = await newCompany("Links");
    const c = co.id;
    const [cap] = await db.insert(s.projects).values({ companyId: c, projectType: "CAPITAL", number: "CAP-1", name: "Shop expansion", originalContractCents: 0 }).returning();
    const [inv] = await db.insert(s.projects).values({ companyId: c, projectType: "INVENTORY", number: "INV-1", name: "Spec home, Lot 12", originalContractCents: 0, unitsPlanned: 1 }).returning();
    await db.insert(s.projectQboLinks).values([
      { companyId: c, projectId: cap.id, kind: "class", qboId: "C-SHOP", qboName: "Shop expansion" },
      { companyId: c, projectId: cap.id, kind: "account", qboId: "300", qboName: "CIP:Shop" },
      { companyId: c, projectId: inv.id, kind: "department", qboId: "D-LOT12", qboName: "Lot 12" },
    ]);
    // account 310 (CIP, general) is flagged as project cost but not linked: unmatched lines there need coding
    await db.insert(s.glAccounts).values({ companyId: c, qboId: "310", name: "CIP general", fullName: "CIP general", accountType: "Other Current Asset", isProjectCost: true });

    const data = fixtures() as unknown as Record<string, QboRecord[]>;
    data.Account.push({ Id: "300", AccountType: "Fixed Asset", Name: "CIP:Shop" }, { Id: "310", AccountType: "Other Current Asset", Name: "CIP general" },
      { Id: "120", AccountType: "Accounts Receivable", Name: "AR" }, { Id: "60", AccountType: "Expense", Name: "Repairs" });
    data.Class = [{ Id: "C-SHOP", Name: "Shop expansion" }];
    data.Department = [{ Id: "D-LOT12", Name: "Lot 12" }];
    const acctLine = (id: string, amount: number, account: string, extra: QboRecord = {}) =>
      ({ Id: id, Amount: amount, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: account }, ...extra } });
    data.Bill.push(
      { Id: "501", TxnDate: "2026-09-01", VendorRef: { value: "35" }, Line: [acctLine("1", 800, "60", { ClassRef: { value: "C-SHOP", name: "Shop expansion" } })] }, // class -> CAP-1
      { Id: "502", TxnDate: "2026-09-02", VendorRef: { value: "35" }, DepartmentRef: { value: "D-LOT12", name: "Lot 12" }, Line: [acctLine("1", 1200, "60")] }, // location -> INV-1
      { Id: "503", TxnDate: "2026-09-03", VendorRef: { value: "35" }, Line: [acctLine("1", 5000, "300")] }, // its own CIP account -> CAP-1
      { Id: "504", TxnDate: "2026-09-04", VendorRef: { value: "35" }, Line: [acctLine("1", 700, "310")] }, // flagged account, no match -> needs coding
    );
    data.JournalEntry = [
      { Id: "900", TxnDate: "2026-09-05", Line: [
        { Id: "0", Amount: 300, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "60" }, ClassRef: { value: "C-SHOP" } } },
        { Id: "1", Amount: 300, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "120" }, Entity: { Type: "Customer", EntityRef: { value: "66" } } } },
      ] },
      { Id: "901", TxnDate: "2026-09-30", PrivateNote: "[ProjectCost] Reclass project costs · CAP-1", Line: [
        { Id: "0", Amount: 800, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "300" } } },
        { Id: "1", Amount: 800, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "60" }, ClassRef: { value: "C-SHOP" } } },
      ] },
    ];

    await runImport({ companyId: c, query: queryFor(data), now: NOW });
    const costs = await rows.costs(c);
    const on = (projectId: string) => costs.filter((x) => x.projectId === projectId).map((x) => `${x.qboTxnType}:${x.qboTxnId}:${x.amountCents}`).sort();
    expect(on(cap.id)).toEqual(["Bill:501:80000", "Bill:503:500000", "JournalEntry:900:30000"]);
    expect(on(inv.id)).toEqual(["Bill:502:120000"]);
    expect(costs.find((x) => x.qboTxnId === "504")).toMatchObject({ projectId: null, qboAccountId: "310" });
    expect(costs.some((x) => x.qboTxnId === "901")).toBe(false); // ProjectCost's own entry
    expect(costs.some((x) => x.qboTxnId === "900" && x.qboLineId === "1")).toBe(false); // receivables line with a customer: not a cost
    expect(await db.select().from(s.glAccounts).where(eq(s.glAccounts.companyId, c))).toHaveLength(6);
    expect(await db.select().from(s.qboTags).where(eq(s.qboTags.companyId, c))).toHaveLength(2);
    // re-running keeps the company's project-cost choice on account 310
    await runImport({ companyId: c, query: queryFor(data), now: NOW });
    expect((await db.query.glAccounts.findFirst({ where: and(eq(s.glAccounts.companyId, c), eq(s.glAccounts.qboId, "310")) }))!.isProjectCost).toBe(true);
  });
});

describe("progress bills also invoiced in QuickBooks", () => {
  it("counts the bill once when it is linked to the synced invoice's number", async () => {
    const c = (await newCompany("DoubleBill")).id;
    await runImport({ companyId: c, query: queryFor(fixtures()), now: NOW });
    const retreat = (await rows.projects(c)).find((p) => p.qboProjectId === "66")!;
    const [sov] = await db.insert(s.sovLines).values({ companyId: c, projectId: retreat.id, lineNo: 1, description: "Retreat", scheduledValueCents: 50_000_00 }).returning();
    const [bill] = await db.insert(s.progressBills).values({ companyId: c, projectId: retreat.id, number: 1, periodEnd: "2026-06-30", status: "POSTED" }).returning();
    await db.insert(s.progressBillLines).values({ companyId: c, progressBillId: bill.id, sovLineId: sov.id, thisPeriodCents: 10_000_00 });

    // not linked: the bill and QuickBooks invoice 1037 (same $10,000) both count, less the $100 credit memo
    expect((await loadProject(c, retreat.id))!.econ.billedToDate).toBe(10_000_00 + 10_000_00 - 100_00);
    // linked by the QuickBooks invoice number: counted once
    await db.update(s.progressBills).set({ qboInvoiceId: "1037" }).where(eq(s.progressBills.id, bill.id));
    const linked = (await loadProject(c, retreat.id))!;
    expect(linked.econ.billedToDate).toBe(10_000_00 - 100_00);
    expect(linked.qboInvoices.find((i) => i.docNumber === "1037")!.matchedBill).toBe(1);
  });
});
