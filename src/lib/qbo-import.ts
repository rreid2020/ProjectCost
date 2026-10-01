// QuickBooks Online -> ProjectCost import. Re-runnable: every row is keyed by its QuickBooks id, so a
// second run updates in place, and rows whose QuickBooks record disappeared (inside the window) are removed.
//
// What comes in:
//   Customer (top level)          -> customer
//   Customer that is a project    -> project   ("jobs" mode: sub-customers / QBO Projects; "customers" mode: any customer with activity)
//   Vendor, Employee              -> vendor, employee
//   Item (not Category)           -> cost code
//   Bill / Purchase / VendorCredit lines tagged to a customer, or posted to Cost of Goods Sold -> cost lines
//   TimeActivity (employees, tagged to a project) -> approved time
//   Invoice / CreditMemo for a project -> billed to date
//   Accepted estimates            -> starting contract value for new projects
// Overhead (expense lines with no customer and not COGS) is skipped.
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";

export type QboRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Runs a QuickBooks query for one entity and returns every matching record (all pages). */
export type QboQuery = (entity: string, where?: string) => Promise<QboRecord[]>;

export type ImportSummary = {
  customers: number; projects: number; newProjects: number; vendors: number; employees: number; costCodes: number;
  costLines: number; needsCoding: number; overheadSkipped: number; timeEntries: number; timeSkipped: number;
  invoices: number; removed: number;
};

const MONTHS_BACK = 24;
export const importWindowStart = (now = new Date()) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS_BACK, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
};

const cents = (n: unknown) => Math.round(Number(n ?? 0) * 100);
const chunk = <T,>(a: T[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export function guessCostType(item: QboRecord): string {
  const n = `${item.Name ?? ""} ${item.Description ?? ""}`.toLowerCase();
  if (/labou?r|\bhours?\b|wage|crew|install/.test(n)) return "LABOUR";
  if (/sub-?contract|\bsubs?\b/.test(n)) return "SUB";
  if (/equipment|rental|crane|\blift\b|excavat/.test(n)) return "EQUIPMENT";
  if (item.Type === "Inventory" || item.Type === "NonInventory" || /material|suppl|lumber|pipe|fixture|fitting/.test(n)) return "MATERIAL";
  return "OTHER";
}

/** "0969 Ocean View Road" -> number 0969; otherwise QB-<id>. Numbers are unique per company. */
export function projectIdentity(c: QboRecord, taken: Set<string>) {
  const m = /^\s*([A-Z]{0,4}-?\d[\w.-]*)\s*[-–:]?\s+(\S.*)$/i.exec(c.DisplayName ?? "");
  let number = m ? m[1] : `QB-${c.Id}`;
  const name = m ? m[2] : c.DisplayName ?? `Customer ${c.Id}`;
  if (taken.has(number)) number = `${number}-${c.Id}`;
  taken.add(number);
  return { number, name };
}

/** Builds a QboQuery on top of a raw fetch of /query (pages of 1000). */
export function pagedQuery(fetchQuery: (q: string) => Promise<QboRecord>): QboQuery {
  return async (entity, where) => {
    const out: QboRecord[] = [];
    for (let start = 1; ; start += 1000) {
      const r = await fetchQuery(`select * from ${entity}${where ? ` where ${where}` : ""} startposition ${start} maxresults 1000`);
      const page: QboRecord[] = r.QueryResponse?.[entity] ?? [];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  };
}

/** Wraps an async function so at most `n` calls run at once. */
export function limited<A extends unknown[], R>(n: number, fn: (...args: A) => Promise<R>) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (...args: A): Promise<R> => {
    if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try { return await fn(...args); } finally { active--; waiting.shift()?.(); }
  };
}

export async function runImport({ companyId, query, now = new Date() }: { companyId: string; query: QboQuery; now?: Date }): Promise<ImportSummary> {
  const company = await db.query.companies.findFirst({ where: eq(s.companies.id, companyId) });
  if (!company) throw new Error("Company not found.");
  if (company.sampleDataLoadedAt) throw new Error("Remove the sample data before importing from QuickBooks.");
  const mode = company.qboProjectMode;
  if (mode !== "jobs" && mode !== "customers") throw new Error("Choose how projects are set up in QuickBooks first.");
  const since = importWindowStart(now);
  const inWindow = `TxnDate >= '${since}'`;
  const allActive = "Active IN (true, false)";

  // ---------- 1. read everything from QuickBooks (no writes yet) ----------
  // At most 4 queries at a time: QuickBooks allows about 10 concurrent requests per company file.
  const q = limited(4, query);
  const [accounts, items, qCustomers, qVendors, qEmployees, bills, purchases, vendorCredits, times, invoices, creditMemos, estimates, classes, departments, journals] = await Promise.all([
    q("Account", allActive), q("Item", allActive), q("Customer", allActive), q("Vendor", allActive), q("Employee", allActive),
    q("Bill", inWindow), q("Purchase", inWindow), q("VendorCredit", inWindow), q("TimeActivity", inWindow),
    q("Invoice", inWindow), q("CreditMemo", inWindow), q("Estimate"),
    q("Class", allActive), q("Department", allActive), q("JournalEntry", inWindow),
  ]);

  // Project links (customer / class / location / account) and which GL accounts count as project cost
  const [links, glRows] = await Promise.all([
    db.select().from(s.projectQboLinks).where(eq(s.projectQboLinks.companyId, companyId)),
    db.select().from(s.glAccounts).where(eq(s.glAccounts.companyId, companyId)),
  ]);
  const linked = new Map(links.map((l) => [`${l.kind}|${l.qboId}`, l.projectId]));
  const costFlag = new Map(glRows.map((g) => [g.qboId, g.isProjectCost]));

  const accountType = new Map(accounts.map((a) => [String(a.Id), String(a.AccountType)]));
  const itemById = new Map(items.map((i) => [String(i.Id), i]));
  const custById = new Map(qCustomers.map((c) => [String(c.Id), c]));
  const rootOf = (c: QboRecord): QboRecord => {
    for (let cur = c, depth = 0; depth < 10; depth++) {
      const parent = cur.ParentRef?.value && custById.get(String(cur.ParentRef.value));
      if (!parent) return cur;
      cur = parent;
    }
    return c;
  };

  // Accounts whose lines are project cost even without a customer: the company's choice, else Cost of Goods Sold.
  const isProjectCostAccount = (id: string) => costFlag.get(id) ?? accountType.get(id) === "Cost of Goods Sold";
  const EXPENSE_TYPES = new Set(["Expense", "Other Expense", "Cost of Goods Sold"]);

  type Ref = { value: string; name?: string } | undefined;
  type Line = {
    txn: QboRecord; type: "Bill" | "Purchase" | "VendorCredit" | "JournalEntry"; line: QboRecord; detail: QboRecord;
    customer: Ref; classRef: Ref; deptRef: Ref; account: string; sign: number;
  };
  const costLines: Line[] = [];
  for (const [type, txns] of [["Bill", bills], ["Purchase", purchases], ["VendorCredit", vendorCredits]] as const)
    for (const txn of txns) for (const line of txn.Line ?? []) {
      const detail = line.AccountBasedExpenseLineDetail ?? line.ItemBasedExpenseLineDetail;
      if (!detail) continue;
      costLines.push({
        txn, type, line, detail, customer: detail.CustomerRef, classRef: detail.ClassRef ?? txn.ClassRef, deptRef: txn.DepartmentRef,
        account: String(detail.AccountRef?.value ?? itemById.get(String(detail.ItemRef?.value))?.ExpenseAccountRef?.value ?? ""),
        sign: type === "VendorCredit" || (type === "Purchase" && txn.Credit === true) ? -1 : 1,
      });
    }
  for (const txn of journals) {
    if (String(txn.PrivateNote ?? "").includes("[ProjectCost]")) continue; // entries drafted by ProjectCost: already counted
    for (const line of txn.Line ?? []) {
      const detail = line.JournalEntryLineDetail;
      if (!detail) continue;
      costLines.push({
        txn, type: "JournalEntry", line, detail, customer: detail.Entity?.Type === "Customer" ? detail.Entity.EntityRef : undefined,
        classRef: detail.ClassRef, deptRef: detail.DepartmentRef, account: String(detail.AccountRef?.value ?? ""),
        sign: detail.PostingType === "Credit" ? -1 : 1,
      });
    }
  }
  const lineAccount = (l: Line) => l.account;
  // Which project a line (or time entry) belongs to: customer, then class, then location, then account.
  let projectIdByQbo = new Map<string, string>();
  const resolve = (customer: Ref, classRef: Ref, deptRef: Ref, account?: string): string | null =>
    (customer?.value && (projectIdByQbo.get(String(customer.value)) ?? linked.get(`customer|${customer.value}`))) ||
    (classRef?.value && linked.get(`class|${classRef.value}`)) ||
    (deptRef?.value && linked.get(`department|${deptRef.value}`)) ||
    (account && linked.get(`account|${account}`)) || null;
  const isJobCost = (l: Line) => {
    if (isProjectCostAccount(l.account)) return true;
    // journal lines only count on expense-type accounts (never receivables, income, etc.)
    if (l.type === "JournalEntry" && !EXPENSE_TYPES.has(accountType.get(l.account) ?? "")) return false;
    return Boolean(l.customer?.value) || Boolean(resolve(undefined, l.classRef, l.deptRef, l.account));
  };

  // Which QuickBooks customers are projects
  const isJobRecord = (c: QboRecord) => c.Job === true || c.IsProject === true;
  const active = (txnCustomer: unknown) => (txnCustomer ? [String(txnCustomer)] : []);
  const referenced = new Set<string>([
    ...costLines.filter((l) => l.type !== "JournalEntry" || EXPENSE_TYPES.has(accountType.get(l.account) ?? "")).flatMap((l) => active(l.customer?.value)),
    ...times.flatMap((t) => active(t.CustomerRef?.value)),
    ...invoices.flatMap((i) => active(i.CustomerRef?.value)),
    ...creditMemos.flatMap((i) => active(i.CustomerRef?.value)),
    ...estimates.flatMap((e) => active(e.CustomerRef?.value)),
  ]);
  const projectCustomers = qCustomers.filter((c) => (mode === "jobs" ? isJobRecord(c) : referenced.has(String(c.Id))));

  // Accepted estimates seed the contract value of projects created by this import
  const contractFromEstimates = new Map<string, number>();
  for (const e of estimates) if (["Accepted", "Closed", "Converted"].includes(e.TxnStatus)) {
    const k = String(e.CustomerRef?.value);
    contractFromEstimates.set(k, (contractFromEstimates.get(k) ?? 0) + cents((e.TotalAmt ?? 0) - (e.TxnTaxDetail?.TotalTax ?? 0)) * Number(e.ExchangeRate ?? 1));
  }

  const summary: ImportSummary = { customers: 0, projects: 0, newProjects: 0, vendors: 0, employees: 0, costCodes: 0, costLines: 0, needsCoding: 0, overheadSkipped: 0, timeEntries: 0, timeSkipped: 0, invoices: 0, removed: 0 };
  const nowIso = now.toISOString();

  // ---------- 2. write, all or nothing ----------
  await db.transaction(async (tx) => {
    const c = companyId;

    // Customers: every top-level QuickBooks customer
    const tops = qCustomers.filter((q) => !q.ParentRef?.value);
    for (const part of chunk(tops)) if (part.length)
      await tx.insert(s.customers).values(part.map((q) => ({ companyId: c, qboId: String(q.Id), name: String(q.DisplayName) })))
        .onConflictDoUpdate({ target: [s.customers.companyId, s.customers.qboId], set: { name: sql`excluded.name` } });
    const custRows = await tx.select().from(s.customers).where(and(eq(s.customers.companyId, c), isNotNull(s.customers.qboId)));
    const customerIdByQbo = new Map(custRows.map((r) => [r.qboId!, r.id]));
    summary.customers = tops.length;

    // Projects
    const existingProjects = await tx.select().from(s.projects).where(eq(s.projects.companyId, c));
    const byQbo = new Map(existingProjects.filter((p) => p.qboProjectId).map((p) => [p.qboProjectId!, p]));
    const taken = new Set(existingProjects.map((p) => p.number));
    for (const q of projectCustomers) {
      const customerId = customerIdByQbo.get(String(rootOf(q).Id))!;
      const existing = byQbo.get(String(q.Id));
      if (existing) {
        await tx.update(s.projects).set({ customerId, ...(q.Active === false ? { status: "COMPLETE" } : {}) })
          .where(eq(s.projects.id, existing.id));
      } else {
        const { number, name } = projectIdentity(q, taken);
        await tx.insert(s.projects).values({
          companyId: c, customerId, number, name, qboProjectId: String(q.Id), status: q.Active === false ? "COMPLETE" : "ACTIVE",
          originalContractCents: Math.round(contractFromEstimates.get(String(q.Id)) ?? 0),
          holdbackBp: company.defaultHoldbackBp, taxBp: company.defaultTaxBp,
        });
        summary.newProjects++;
      }
    }
    summary.projects = projectCustomers.length;
    const projRows = await tx.select({ id: s.projects.id, qbo: s.projects.qboProjectId }).from(s.projects).where(and(eq(s.projects.companyId, c), isNotNull(s.projects.qboProjectId)));
    projectIdByQbo = new Map(projRows.map((r) => [r.qbo!, r.id]));

    // Chart of accounts (keeps each account's project-cost choice) and classes / locations for linking
    for (const part of chunk(accounts)) if (part.length)
      await tx.insert(s.glAccounts).values(part.map((a) => ({
        companyId: c, qboId: String(a.Id), name: String(a.Name), fullName: String(a.FullyQualifiedName ?? a.Name),
        accountType: String(a.AccountType), accountSubType: a.AccountSubType ? String(a.AccountSubType) : null, active: a.Active !== false,
      }))).onConflictDoUpdate({ target: [s.glAccounts.companyId, s.glAccounts.qboId], set: {
        name: sql`excluded.name`, fullName: sql`excluded.full_name`, accountType: sql`excluded.account_type`,
        accountSubType: sql`excluded.account_sub_type`, active: sql`excluded.active`,
      } });
    const tags = [...classes.map((x) => ({ kind: "class", x })), ...departments.map((x) => ({ kind: "department", x }))];
    for (const part of chunk(tags)) if (part.length)
      await tx.insert(s.qboTags).values(part.map(({ kind, x }) => ({ companyId: c, kind, qboId: String(x.Id), name: String(x.FullyQualifiedName ?? x.Name), active: x.Active !== false })))
        .onConflictDoUpdate({ target: [s.qboTags.companyId, s.qboTags.kind, s.qboTags.qboId], set: { name: sql`excluded.name`, active: sql`excluded.active` } });

    // Vendors
    for (const part of chunk(qVendors)) if (part.length)
      await tx.insert(s.vendors).values(part.map((v) => ({ companyId: c, qboId: String(v.Id), name: String(v.DisplayName) })))
        .onConflictDoUpdate({ target: [s.vendors.companyId, s.vendors.qboId], set: { name: sql`excluded.name` } });
    const vendorRows = await tx.select({ id: s.vendors.id, qbo: s.vendors.qboId }).from(s.vendors).where(and(eq(s.vendors.companyId, c), isNotNull(s.vendors.qboId)));
    const vendorIdByQbo = new Map(vendorRows.map((r) => [r.qbo!, r.id]));
    summary.vendors = qVendors.length;

    // Employees (rates are set in ProjectCost; QuickBooks' cost/bill rates only seed new rows)
    for (const part of chunk(qEmployees)) if (part.length)
      await tx.insert(s.employees).values(part.map((e) => ({
        companyId: c, qboId: String(e.Id), name: String(e.DisplayName), trade: "Employee", // QuickBooks has no job title (its Title field is Mr./Ms.); set the trade in ProjectCost
        payRateCents: cents(e.CostRate), burdenBp: 0, billRateCents: cents(e.BillRate), active: e.Active !== false,
      }))).onConflictDoUpdate({ target: [s.employees.companyId, s.employees.qboId], set: { name: sql`excluded.name`, active: sql`excluded.active` } });
    const empRows = await tx.select().from(s.employees).where(and(eq(s.employees.companyId, c), isNotNull(s.employees.qboId)));
    const empByQbo = new Map(empRows.map((r) => [r.qboId!, r]));
    summary.employees = qEmployees.length;

    // Cost codes from items. An existing unlinked code with the same code is linked rather than duplicated.
    const codeRows0 = await tx.select().from(s.costCodes).where(eq(s.costCodes.companyId, c));
    const codeTaken = new Map(codeRows0.map((r) => [r.code, r]));
    for (const it of items.filter((i) => i.Type !== "Category")) {
      const qboItemId = String(it.Id);
      if (codeRows0.some((r) => r.qboItemId === qboItemId)) {
        await tx.update(s.costCodes).set({ name: String(it.Name), active: it.Active !== false })
          .where(and(eq(s.costCodes.companyId, c), eq(s.costCodes.qboItemId, qboItemId)));
        continue;
      }
      let code = String(it.Sku || it.Name).slice(0, 40);
      const clash = codeTaken.get(code);
      if (clash && !clash.qboItemId) {
        await tx.update(s.costCodes).set({ qboItemId }).where(eq(s.costCodes.id, clash.id));
        continue;
      }
      if (clash) code = `${code} (${qboItemId})`;
      const [row] = await tx.insert(s.costCodes).values({ companyId: c, code, name: String(it.Name), costType: guessCostType(it), qboItemId, active: it.Active !== false }).returning();
      codeTaken.set(code, row);
    }
    const codeRows = await tx.select().from(s.costCodes).where(eq(s.costCodes.companyId, c));
    const codeIdByItem = new Map(codeRows.filter((r) => r.qboItemId).map((r) => [r.qboItemId!, r.id]));
    summary.costCodes = codeIdByItem.size;
    const uncodedLabour = async () => {
      const found = codeRows.find((r) => r.code === "LAB-UNCODED");
      if (found) return found.id;
      const [row] = await tx.insert(s.costCodes).values({ companyId: c, code: "LAB-UNCODED", name: "Labour — no service item in QuickBooks", costType: "LABOUR" }).returning();
      codeRows.push(row);
      return row.id;
    };

    // Cost lines
    const seenCost = new Set<string>();
    const costValues: (typeof s.costTransactions.$inferInsert)[] = [];
    const lineCountByTxn = new Map<QboRecord, number>();
    for (const l of costLines) lineCountByTxn.set(l.txn, (lineCountByTxn.get(l.txn) ?? 0) + Math.abs(Number(l.line.Amount ?? 0)));
    for (const l of costLines) {
      if (!isJobCost(l)) { summary.overheadSkipped++; continue; }
      const { txn, type, line, detail, sign } = l;
      const rate = Number(txn.ExchangeRate ?? 1);
      const net = Number(line.Amount ?? 0);
      // Sales tax on the transaction, allocated to lines by amount. Recoverable in Canada (ITC, not job cost); a cost in the US.
      const txnBase = lineCountByTxn.get(txn) || 1;
      const tax = type === "JournalEntry" ? 0 : Number(txn.TxnTaxDetail?.TotalTax ?? 0) * (Math.abs(net) / txnBase);
      const recoverable = company.region === "CA";
      const projectId = resolve(l.customer, l.classRef, l.deptRef, l.account);
      const costCodeId = detail.ItemRef?.value ? codeIdByItem.get(String(detail.ItemRef.value)) ?? null : null;
      const vendorRef = txn.VendorRef?.value ?? (txn.EntityRef?.type === "Vendor" ? txn.EntityRef.value : null) ?? (detail.Entity?.Type === "Vendor" ? detail.Entity.EntityRef?.value : null);
      const source = type === "Bill" ? "BILL" : type === "VendorCredit" ? "CREDIT" : type === "JournalEntry" ? "JE" : txn.PaymentType === "Check" ? "CHECK" : "EXPENSE";
      const key = `${type}|${txn.Id}|${line.Id}`;
      seenCost.add(key);
      costValues.push({
        companyId: c, qboTxnType: type, qboTxnId: String(txn.Id), qboLineId: String(line.Id), date: String(txn.TxnDate), source,
        docNumber: txn.DocNumber ? String(txn.DocNumber) : `${type} ${txn.Id}`,
        description: String(line.Description || detail.ItemRef?.name || detail.AccountRef?.name || type),
        amountCents: sign * Math.round(cents(net + (recoverable ? 0 : tax)) * rate),
        taxCents: recoverable ? sign * Math.round(cents(tax) * rate) : 0,
        vendorId: vendorRef ? vendorIdByQbo.get(String(vendorRef)) ?? null : null,
        projectId, costCodeId,
        qboCustomerName: l.customer?.name ? String(l.customer.name) : l.classRef?.name ? `Class: ${l.classRef.name}` : l.deptRef?.name ? `Location: ${l.deptRef.name}` : null,
        qboCurrency: txn.CurrencyRef?.value ? String(txn.CurrencyRef.value) : null, qboLineAmountCents: sign * cents(net), qboExchangeRate: String(rate),
        qboAccountId: lineAccount(l) || null,
        assignedAt: projectId && costCodeId ? String(txn.TxnDate) : null,
      });
      if (!projectId || !costCodeId) summary.needsCoding++;
    }
    const ct = s.costTransactions;
    for (const part of chunk(costValues)) if (part.length)
      await tx.insert(ct).values(part).onConflictDoUpdate({
        target: [ct.companyId, ct.qboTxnType, ct.qboTxnId, ct.qboLineId],
        set: {
          date: sql`excluded.date`, source: sql`excluded.source`, docNumber: sql`excluded.doc_number`, description: sql`excluded.description`,
          amountCents: sql`excluded.amount_cents`, taxCents: sql`excluded.tax_cents`, vendorId: sql`excluded.vendor_id`, qboCustomerName: sql`excluded.qbo_customer_name`,
          qboCurrency: sql`excluded.qbo_currency`, qboLineAmountCents: sql`excluded.qbo_line_amount_cents`, qboExchangeRate: sql`excluded.qbo_exchange_rate`,
          qboAccountId: sql`excluded.qbo_account_id`,
          // QuickBooks wins when it has a value; otherwise keep what was coded in ProjectCost
          projectId: sql`coalesce(excluded.project_id, ${ct.projectId})`,
          costCodeId: sql`coalesce(excluded.cost_code_id, ${ct.costCodeId})`,
          assignedAt: sql`coalesce(${ct.assignedAt}, excluded.assigned_at)`,
        },
      });
    summary.costLines = costValues.length;

    // Time (employees only; vendor time arrives on bills)
    const seenTime = new Set<string>();
    const timeValues: (typeof s.timeEntries.$inferInsert)[] = [];
    for (const t of times) {
      const emp = t.EmployeeRef?.value ? empByQbo.get(String(t.EmployeeRef.value)) : undefined;
      const projectId = resolve(t.CustomerRef, t.ClassRef, t.DepartmentRef) ?? undefined;
      let hours = Number(t.Hours ?? 0) + Number(t.Minutes ?? 0) / 60;
      if (!hours && t.StartTime && t.EndTime) hours = (Date.parse(t.EndTime) - Date.parse(t.StartTime)) / 3_600_000 - Number(t.BreakHours ?? 0) - Number(t.BreakMinutes ?? 0) / 60;
      if (!emp || !projectId || !(hours > 0)) { summary.timeSkipped++; continue; }
      const costCodeId = (t.ItemRef?.value && codeIdByItem.get(String(t.ItemRef.value))) || (await uncodedLabour());
      seenTime.add(String(t.Id));
      timeValues.push({
        companyId: c, qboTimeActivityId: String(t.Id), employeeId: emp.id, projectId, costCodeId, date: String(t.TxnDate),
        hoursX100: Math.round(hours * 100), payRateCents: emp.payRateCents, burdenBp: emp.burdenBp,
        billRateCents: t.HourlyRate != null ? cents(t.HourlyRate) : emp.billRateCents, status: "APPROVED", notes: t.Description ? String(t.Description) : null,
      });
    }
    const te = s.timeEntries;
    for (const part of chunk(timeValues)) if (part.length)
      await tx.insert(te).values(part).onConflictDoUpdate({
        target: [te.companyId, te.qboTimeActivityId],
        set: {
          employeeId: sql`excluded.employee_id`, projectId: sql`excluded.project_id`, costCodeId: sql`excluded.cost_code_id`, date: sql`excluded.date`,
          hoursX100: sql`excluded.hours_x100`, notes: sql`excluded.notes`, billRateCents: sql`excluded.bill_rate_cents`,
          // keep the rate captured earlier unless none was known then
          payRateCents: sql`case when ${te.payRateCents} = 0 then excluded.pay_rate_cents else ${te.payRateCents} end`,
          burdenBp: sql`case when ${te.payRateCents} = 0 then excluded.burden_bp else ${te.burdenBp} end`,
        },
      });
    summary.timeEntries = timeValues.length;

    // Invoices and credit memos billed in QuickBooks, for projects only
    const ownInvoices = new Set((await tx.select({ id: s.progressBills.qboInvoiceId }).from(s.progressBills)
      .where(and(eq(s.progressBills.companyId, c), isNotNull(s.progressBills.qboInvoiceId)))).map((r) => r.id!));
    const seenInv = new Set<string>();
    const invValues: (typeof s.qboInvoices.$inferInsert)[] = [];
    for (const [type, list] of [["Invoice", invoices], ["CreditMemo", creditMemos]] as const) for (const inv of list) {
      const projectId = resolve(inv.CustomerRef, undefined, undefined) ?? undefined;
      if (!projectId || (type === "Invoice" && ownInvoices.has(String(inv.Id)))) continue;
      seenInv.add(`${type}|${inv.Id}`);
      const rate = Number(inv.ExchangeRate ?? 1), sign = type === "CreditMemo" ? -1 : 1;
      const total = cents(inv.TotalAmt), tax = cents(inv.TxnTaxDetail?.TotalTax);
      invValues.push({
        companyId: c, projectId, qboTxnType: type, qboTxnId: String(inv.Id), docNumber: inv.DocNumber ? String(inv.DocNumber) : null, date: String(inv.TxnDate),
        amountCents: sign * Math.round((total - tax) * rate), totalCents: sign * total, taxCents: sign * tax,
        currency: inv.CurrencyRef?.value ? String(inv.CurrencyRef.value) : null, exchangeRate: String(rate),
      });
    }
    const qi = s.qboInvoices;
    for (const part of chunk(invValues)) if (part.length)
      await tx.insert(qi).values(part).onConflictDoUpdate({
        target: [qi.companyId, qi.qboTxnType, qi.qboTxnId],
        set: {
          projectId: sql`excluded.project_id`, docNumber: sql`excluded.doc_number`, date: sql`excluded.date`, amountCents: sql`excluded.amount_cents`,
          totalCents: sql`excluded.total_cents`, taxCents: sql`excluded.tax_cents`, currency: sql`excluded.currency`, exchangeRate: sql`excluded.exchange_rate`,
        },
      });
    summary.invoices = invValues.length;

    // Remove rows (inside the window) whose QuickBooks record is gone or no longer job cost
    const staleCost = (await tx.select({ id: ct.id, k: sql<string>`${ct.qboTxnType} || '|' || ${ct.qboTxnId} || '|' || ${ct.qboLineId}` }).from(ct)
      .where(and(eq(ct.companyId, c), isNotNull(ct.qboTxnType), gte(ct.date, since)))).filter((r) => !seenCost.has(r.k)).map((r) => r.id);
    const staleTime = (await tx.select({ id: te.id, q: te.qboTimeActivityId }).from(te)
      .where(and(eq(te.companyId, c), isNotNull(te.qboTimeActivityId), gte(te.date, since)))).filter((r) => !seenTime.has(r.q!)).map((r) => r.id);
    const staleInv = (await tx.select({ id: qi.id, k: sql<string>`${qi.qboTxnType} || '|' || ${qi.qboTxnId}` }).from(qi)
      .where(and(eq(qi.companyId, c), gte(qi.date, since)))).filter((r) => !seenInv.has(r.k)).map((r) => r.id);
    for (const ids of chunk(staleCost)) if (ids.length) await tx.delete(ct).where(and(eq(ct.companyId, c), inArray(ct.id, ids)));
    for (const ids of chunk(staleTime)) if (ids.length) await tx.delete(te).where(and(eq(te.companyId, c), inArray(te.id, ids)));
    for (const ids of chunk(staleInv)) if (ids.length) await tx.delete(qi).where(and(eq(qi.companyId, c), inArray(qi.id, ids)));
    summary.removed = staleCost.length + staleTime.length + staleInv.length;

    await tx.update(s.companies).set({ qboLastImportAt: nowIso }).where(eq(s.companies.id, c));
  });

  return summary;
}
