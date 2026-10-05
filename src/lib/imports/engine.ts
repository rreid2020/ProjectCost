// Checking and applying spreadsheet rows. analyze() runs for the preview and again, inside the import transaction,
// for the commit, so what you see is what gets imported. Every read and write is scoped to one company.
import { createHash } from "node:crypto";
import { and, eq, inArray, max, sql } from "drizzle-orm";
import { db, schema as s, type DB } from "@/db";
import { importKind, type Field, type ImportKind } from "./kinds";
import { monthColumns, type Mapping } from "./mapping";
import * as V from "./values";

type Q = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
type Value = string | number | boolean | null;
export type RawRecord = { row: number; values: Record<string, string> };
export type AnalyzedRow = { row: number; data: Record<string, Value>; errors: string[]; notes: string[]; resolved: Record<string, string | null> };
export type Analysis = { kind: ImportKind; rows: AnalyzedRow[]; valid: number; invalid: number };
export type CommitResult = { batchId: string; created: number; updated: number; skipped: number; toCode: number };

const PROJECT_STATUS = { bid: "BID", quot: "BID", tender: "BID", estimat: "BID", active: "ACTIVE", open: "ACTIVE", progress: "ACTIVE", wip: "ACTIVE", complete: "COMPLETE", closed: "COMPLETE", finish: "COMPLETE", done: "COMPLETE" };
const CO_STATUS = { approv: "APPROVED", execut: "APPROVED", accept: "APPROVED", sign: "APPROVED", reject: "REJECTED", void: "REJECTED", declin: "REJECTED", cancel: "REJECTED", pend: "PENDING", submit: "PENDING", open: "PENDING", draft: "PENDING", review: "PENDING" };
const lc = (v: Value | undefined) => (v == null ? "" : String(v).trim().toLowerCase());
const chunk = <T,>(a: T[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// ---------- rows out of a sheet ----------
export function extractRecords(rows: string[][], headerRow: number, mapping: Mapping, kind: ImportKind): RawRecord[] {
  const headers = rows[headerRow] ?? [];
  const data = rows.slice(headerRow + 1);
  const wide = kind.key === "pnl" && (mapping.month == null || mapping.amount == null) ? monthColumns(headers, mapping) : [];
  const out: RawRecord[] = [];
  data.forEach((r, i) => {
    const base = Object.fromEntries(Object.entries(mapping).map(([k, col]) => [k, r[col] ?? ""]));
    const rowNo = headerRow + i + 2; // 1-based spreadsheet row
    if (wide.length) for (const m of wide) { if (!V.isBlank(r[m.index])) out.push({ row: rowNo, values: { ...base, month: m.month, amount: r[m.index] } }); }
    else out.push({ row: rowNo, values: base });
  });
  return out;
}

function convert(field: Field, raw: string, order: V.DateOrder): Value {
  switch (field.type) {
    case "text": return V.isBlank(raw) ? null : raw.trim();
    case "date": return V.parseDate(raw, order);
    case "month": { const m = V.parseMonth(raw) ?? (V.isBlank(raw) ? null : V.parseDate(raw, order)?.slice(0, 7) ?? null); return m; }
    case "money": return V.parseMoney(raw);
    case "percent": return V.parsePercent(raw);
    case "hours": return V.parseHours(raw);
    case "int": return V.parseInteger(raw);
    case "yesno": return V.parseYesNo(raw);
    case "costType": return V.parseCostType(raw);
    case "projectType": return V.parseProjectType(raw);
    case "accountType": { const t = V.parseAccountType(raw); if (!t && !V.isBlank(raw)) throw new Error(`"${raw}" isn't an account type ProjectCost recognizes`); return t; }
    case "status": return V.isBlank(raw) ? null : raw.trim();
  }
}

// ---------- lookups (company-scoped) ----------
async function lookups(q: Q, companyId: string) {
  const [projects, codes, employees, vendors, accounts, customers] = await Promise.all([
    q.select({ id: s.projects.id, number: s.projects.number, name: s.projects.name, customerId: s.projects.customerId }).from(s.projects).where(eq(s.projects.companyId, companyId)),
    q.select({ id: s.costCodes.id, code: s.costCodes.code, name: s.costCodes.name }).from(s.costCodes).where(eq(s.costCodes.companyId, companyId)),
    q.select({ id: s.employees.id, name: s.employees.name, payRateCents: s.employees.payRateCents, burdenBp: s.employees.burdenBp, billRateCents: s.employees.billRateCents }).from(s.employees).where(eq(s.employees.companyId, companyId)),
    q.select({ id: s.vendors.id, name: s.vendors.name }).from(s.vendors).where(eq(s.vendors.companyId, companyId)),
    q.select({ qboId: s.glAccounts.qboId, name: s.glAccounts.name, fullName: s.glAccounts.fullName }).from(s.glAccounts).where(eq(s.glAccounts.companyId, companyId)),
    q.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(eq(s.customers.companyId, companyId)),
  ]);
  const byKey = <T,>(list: T[], ...keys: ((x: T) => string | null)[]) => {
    const m = new Map<string, T>();
    for (const x of list) for (const k of keys) { const v = k(x); if (v && !m.has(v.trim().toLowerCase())) m.set(v.trim().toLowerCase(), x); }
    return m;
  };
  return {
    project: byKey(projects, (p) => p.number, (p) => p.name),
    code: byKey(codes, (c) => c.code, (c) => c.name),
    employee: byKey(employees, (e) => e.name),
    vendor: byKey(vendors, (v) => v.name),
    account: byKey(accounts, (a) => a.qboId, (a) => a.qboId.replace(/^f:/, ""), (a) => a.name, (a) => a.fullName),
    customer: byKey(customers, (c) => c.name),
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

// ---------- analyze ----------
export async function analyze(q: Q, companyId: string, kindKey: string, records: RawRecord[], order: V.DateOrder): Promise<Analysis> {
  const kind = importKind(kindKey);
  if (!kind) throw new Error("Unknown import type.");
  const L = await lookups(q, companyId);
  const rows: AnalyzedRow[] = records
    .filter((r) => Object.values(r.values).some((v) => !V.isBlank(v)))
    .map((r) => {
      const errors: string[] = [], notes: string[] = [], data: Record<string, Value> = {};
      for (const f of kind.fields) {
        if (!(f.key in r.values)) continue;
        try { data[f.key] = convert(f, r.values[f.key], order); } catch (e) { errors.push(`${f.label}: ${e instanceof Error ? e.message : String(e)}`); data[f.key] = null; }
      }
      for (const f of kind.fields) if (f.required && data[f.key] == null && !errors.some((e) => e.startsWith(f.label))) errors.push(`${f.label} is empty`);
      for (const group of kind.oneOf ?? []) if (group.every((k) => data[k] == null)) errors.push(`Needs ${group.map((k) => kind.fields.find((f) => f.key === k)!.label).join(" or ")}`);
      const row: AnalyzedRow = { row: r.row, data, errors, notes, resolved: {} };
      if (!errors.length) checkRow(kind.key, row, L);
      return row;
    });
  const valid = rows.filter((r) => !r.errors.length).length;
  return { kind, rows, valid, invalid: rows.length - valid };
}

/** Kind-specific checks and lookups. Errors stop a row; notes explain what will happen to it. */
function checkRow(kind: string, r: AnalyzedRow, L: Lookups) {
  const d = r.data, project = lc(d.project), code = lc(d.code);
  const p = project ? L.project.get(project) : undefined;
  const cc = code ? L.code.get(code) : undefined;
  const fullName = () => String(d.name ?? d.employee ?? [d.firstName, d.lastName].filter(Boolean).join(" ")).trim();
  switch (kind) {
    case "projects": {
      const existing = L.project.get(lc(d.number));
      const type = (d.type as string) ?? "CONTRACT";
      if (type === "CONTRACT" && !d.customer && !(existing && existing.customerId)) r.errors.push("Customer is required for a customer contract");
      try { if (d.status != null) d.status = V.parseStatus(String(d.status), ["BID", "ACTIVE", "COMPLETE"], PROJECT_STATUS); } catch (e) { r.errors.push(String((e as Error).message)); }
      r.notes.push(existing ? "Updates the existing project" : "New project");
      break;
    }
    case "budgets":
      if (!p) r.errors.push(`Project "${d.project}" not found. Import projects first`);
      if (!cc && !d.codeName) r.errors.push(`Cost code "${d.code}" not found. Add a cost code name column to create it`);
      if (!cc && d.codeName) r.notes.push(`Adds cost code ${d.code}`);
      r.resolved = { projectId: p?.id ?? null, costCodeId: cc?.id ?? null };
      break;
    case "costcodes":
      r.notes.push(L.code.get(lc(d.code)) ? "Updates the code" : "New code");
      break;
    case "costs": {
      const amount = (d.amount as number | null) ?? ((d.debit as number | null) ?? 0) - ((d.credit as number | null) ?? 0);
      if (!amount) r.errors.push("Amount is zero");
      d.amountTotal = amount;
      if (project && !p) r.notes.push(`Project "${d.project}" not found: goes to Unassigned costs`);
      else if (!project) r.notes.push("No project: goes to Unassigned costs");
      if (code && !cc) r.notes.push(`Cost code "${d.code}" not found: needs coding`);
      const acct = d.account ? L.account.get(lc(d.account)) : undefined;
      if (d.account && !acct) r.notes.push(`Account "${d.account}" isn't in the chart of accounts`);
      r.resolved = { projectId: p?.id ?? null, costCodeId: cc?.id ?? null, vendorId: d.vendor ? L.vendor.get(lc(d.vendor))?.id ?? null : null, account: acct?.qboId ?? null };
      break;
    }
    case "time": {
      const name = fullName();
      if (!name) r.errors.push("Employee is empty");
      const hours = ((d.hours as number | null) ?? 0) + ((d.overtime as number | null) ?? 0);
      if (!(hours > 0)) r.errors.push("Hours must be more than zero");
      d.totalHours = hours;
      if (!p) r.errors.push(`Project "${d.project}" not found`);
      if (code && !cc) r.notes.push(`Cost code "${d.code}" not found: uses "Labour, no code"`);
      const e = L.employee.get(name.toLowerCase());
      if (name && !e) r.notes.push(`Adds employee ${name}: set their rates on Employees`);
      d.employeeName = name;
      r.resolved = { projectId: p?.id ?? null, costCodeId: cc?.id ?? null, employeeId: e?.id ?? null };
      break;
    }
    case "employees": {
      const name = fullName();
      if (!name) r.errors.push("Name is empty");
      d.fullName = name;
      r.notes.push(L.employee.get(name.toLowerCase()) ? "Updates the employee" : "New employee");
      break;
    }
    case "invoices": {
      if (!p) r.errors.push(`Project "${d.project}" not found`);
      const pre = (d.amount as number | null) ?? ((d.total as number) - ((d.tax as number | null) ?? 0));
      const credit = lc(d.type).includes("credit");
      d.preTax = credit ? -Math.abs(pre) : pre;
      if (!pre) r.errors.push("Amount is zero");
      r.resolved = { projectId: p?.id ?? null };
      break;
    }
    case "changeorders":
      if (!p) r.errors.push(`Project "${d.project}" not found`);
      if (code && !cc) r.errors.push(`Cost code "${d.code}" not found`);
      try { d.status = d.status != null ? V.parseStatus(String(d.status), ["PENDING", "APPROVED", "REJECTED"], CO_STATUS) : "PENDING"; } catch (e) { r.errors.push(String((e as Error).message)); }
      r.resolved = { projectId: p?.id ?? null, costCodeId: cc?.id ?? null };
      break;
    case "accounts":
      if (!d.code && !d.name) r.errors.push("Needs an account code or name");
      break;
    case "pnl": {
      if (d.month == null) r.errors.push("Month is empty or unreadable");
      if (d.amount == null) r.errors.push("Amount is empty");
      const sec = lc(d.section);
      if (/income|revenue|sales|cost of|cogs|asset|liabilit|equity/.test(sec)) r.errors.push(`"${d.section}" rows aren't expenses; leave them out`);
      d.sectionKey = /other/.test(sec) ? "OtherExpenses" : "Expenses";
      const acct = L.account.get(lc(d.account));
      r.resolved = { accountId: acct?.qboId ?? null };
      break;
    }
  }
}

// ---------- commit ----------
const keyOf = (prefix: string, explicit: Value | undefined, parts: Value[], seen: Map<string, number>) => {
  if (explicit != null && String(explicit).trim()) return `${prefix}:id:${String(explicit).trim()}`;
  const base = createHash("sha1").update(JSON.stringify(parts.map((p) => (p == null ? "" : String(p).trim().toLowerCase())))).digest("hex").slice(0, 20);
  const n = (seen.get(base) ?? 0) + 1; // identical lines in one file stay separate
  seen.set(base, n);
  return `${prefix}:${base}:${n}`;
};

export async function commitImport(opts: {
  companyId: string; userId: string; kind: string; fileName: string; sheetName: string | null; records: RawRecord[]; order: V.DateOrder; skipErrors: boolean;
}): Promise<CommitResult> {
  const company = await db.query.companies.findFirst({ where: eq(s.companies.id, opts.companyId) });
  if (!company) throw new Error("Company not found.");
  if (company.sampleDataLoadedAt) throw new Error("Remove the sample data before importing your own.");
  return db.transaction(async (tx) => {
    const a = await analyze(tx, opts.companyId, opts.kind, opts.records, opts.order);
    if (a.invalid && !opts.skipErrors) throw new Error(`${a.invalid} row(s) have problems. Fix them or choose to skip them.`);
    const rows = a.rows.filter((r) => !r.errors.length);
    if (!rows.length) throw new Error("There are no rows to import.");
    const [batch] = await tx.insert(s.importBatches).values({
      companyId: opts.companyId, userId: opts.userId, kind: opts.kind, fileName: opts.fileName, sheetName: opts.sheetName, status: "COMMITTED", createdAt: new Date().toISOString(),
    }).returning();
    const ctx = { tx, c: opts.companyId, batchId: batch.id, region: company.region, holdbackBp: company.defaultHoldbackBp, taxBp: company.defaultTaxBp };
    const r = await APPLY[opts.kind](ctx, rows);
    await tx.update(s.importBatches).set({ created: r.created, updated: r.updated, skipped: a.invalid, toCode: r.toCode ?? 0 }).where(eq(s.importBatches.id, batch.id));
    await tx.insert(s.syncLogs).values({
      companyId: opts.companyId, userId: opts.userId, entity: "Spreadsheet", direction: "PULL", status: "OK", createdAt: new Date().toISOString(),
      message: `${a.kind.label} from ${opts.fileName}: ${r.created} added, ${r.updated} updated${a.invalid ? `, ${a.invalid} skipped` : ""}${r.toCode ? `, ${r.toCode} to code` : ""}`,
    });
    return { batchId: batch.id, created: r.created, updated: r.updated, skipped: a.invalid, toCode: r.toCode ?? 0 };
  });
}

type Ctx = { tx: Q; c: string; batchId: string; region: string; holdbackBp: number; taxBp: number };
type Applied = { created: number; updated: number; toCode?: number };

async function ensureVendor(ctx: Ctx, cache: Map<string, string>, name: string) {
  const k = name.trim().toLowerCase();
  if (cache.has(k)) return cache.get(k)!;
  const [v] = await ctx.tx.insert(s.vendors).values({ companyId: ctx.c, name: name.trim() }).returning();
  cache.set(k, v.id);
  return v.id;
}
async function ensureEmployee(ctx: Ctx, cache: Map<string, { id: string; payRateCents: number; burdenBp: number; billRateCents: number }>, name: string) {
  const k = name.toLowerCase();
  if (cache.has(k)) return cache.get(k)!;
  const [e] = await ctx.tx.insert(s.employees).values({ companyId: ctx.c, name, trade: "Employee", payRateCents: 0, burdenBp: 0, billRateCents: 0 }).returning();
  cache.set(k, e);
  return e;
}
async function existingRefs(ctx: Ctx, table: typeof s.costTransactions | typeof s.timeEntries, refs: string[]) {
  const found = new Set<string>();
  for (const part of chunk(refs)) if (part.length)
    for (const r of await ctx.tx.select({ ref: table.externalRef }).from(table).where(and(eq(table.companyId, ctx.c), inArray(table.externalRef, part)))) found.add(r.ref!);
  return found;
}

const APPLY: Record<string, (ctx: Ctx, rows: AnalyzedRow[]) => Promise<Applied>> = {
  async projects(ctx, rows) {
    const L = await lookups(ctx.tx, ctx.c);
    let created = 0, updated = 0;
    for (const { data: d } of rows) {
      let customerId: string | null | undefined;
      if (d.customer) {
        customerId = L.customer.get(lc(d.customer))?.id;
        if (!customerId) { const [cu] = await ctx.tx.insert(s.customers).values({ companyId: ctx.c, name: String(d.customer) }).returning(); customerId = cu.id; L.customer.set(lc(d.customer), cu); }
      }
      const set = {
        ...(d.name != null && { name: String(d.name) }), ...(d.type != null && { projectType: String(d.type) }), ...(customerId && { customerId }),
        ...(d.status != null && { status: String(d.status) }), ...(d.contract != null && { originalContractCents: d.contract as number }),
        ...(d.start != null && { startDate: String(d.start) }), ...(d.end != null && { endDate: String(d.end) }), ...(d.pm != null && { projectManager: String(d.pm) }),
        ...(d.holdback != null && { holdbackBp: d.holdback as number }), ...(d.tax != null && { taxBp: d.tax as number }), ...(d.units != null && (d.units as number) > 0 && { unitsPlanned: d.units as number }),
      };
      const existing = L.project.get(lc(d.number));
      if (existing && lc(existing.number) === lc(d.number)) {
        await ctx.tx.update(s.projects).set(set).where(and(eq(s.projects.id, existing.id), eq(s.projects.companyId, ctx.c)));
        updated++;
      } else {
        const [p] = await ctx.tx.insert(s.projects).values({
          companyId: ctx.c, number: String(d.number), name: String(d.name), projectType: "CONTRACT", status: "ACTIVE", originalContractCents: 0,
          holdbackBp: ctx.holdbackBp, taxBp: ctx.taxBp, ...set,
        }).returning();
        L.project.set(lc(d.number), p);
        created++;
      }
    }
    return { created, updated };
  },

  async budgets(ctx, rows) {
    const L = await lookups(ctx.tx, ctx.c);
    const totals = new Map<string, { projectId: string; costCodeId: string; amount: number }>();
    for (const { data: d, resolved } of rows) {
      let costCodeId = resolved.costCodeId ?? L.code.get(lc(d.code))?.id;
      if (!costCodeId) {
        const [cc] = await ctx.tx.insert(s.costCodes).values({ companyId: ctx.c, code: String(d.code), name: String(d.codeName), costType: (d.costType as string) ?? "OTHER" }).returning();
        costCodeId = cc.id; L.code.set(lc(d.code), cc);
      }
      const k = `${resolved.projectId}|${costCodeId}`;
      const cur = totals.get(k);
      if (cur) cur.amount += d.amount as number; else totals.set(k, { projectId: resolved.projectId!, costCodeId, amount: d.amount as number });
    }
    let created = 0, updated = 0;
    for (const t of totals.values()) {
      const exists = await ctx.tx.query.budgetLines.findFirst({ where: and(eq(s.budgetLines.companyId, ctx.c), eq(s.budgetLines.projectId, t.projectId), eq(s.budgetLines.costCodeId, t.costCodeId)) });
      await ctx.tx.insert(s.budgetLines).values({ companyId: ctx.c, projectId: t.projectId, costCodeId: t.costCodeId, originalCents: t.amount, importBatchId: ctx.batchId })
        .onConflictDoUpdate({ target: [s.budgetLines.projectId, s.budgetLines.costCodeId], set: { originalCents: t.amount } }); // keeps the batch that created it
      if (exists) updated++; else created++;
    }
    return { created, updated };
  },

  async costcodes(ctx, rows) {
    let created = 0, updated = 0;
    const L = await lookups(ctx.tx, ctx.c);
    for (const { data: d } of rows) {
      const existing = L.code.get(lc(d.code));
      const set = { name: String(d.name), ...(d.costType != null && { costType: String(d.costType) }), ...(d.active != null && { active: d.active as boolean }) };
      if (existing && lc(existing.code) === lc(d.code)) { await ctx.tx.update(s.costCodes).set(set).where(and(eq(s.costCodes.id, existing.id), eq(s.costCodes.companyId, ctx.c))); updated++; }
      else { const [cc] = await ctx.tx.insert(s.costCodes).values({ companyId: ctx.c, code: String(d.code), costType: "OTHER", ...set }).returning(); L.code.set(lc(d.code), cc); created++; }
    }
    return { created, updated };
  },

  async costs(ctx, rows) {
    const L = await lookups(ctx.tx, ctx.c);
    const vendors = new Map([...L.vendor].map(([k, v]) => [k, v.id]));
    const seen = new Map<string, number>();
    const values: (typeof s.costTransactions.$inferInsert)[] = [];
    let toCode = 0;
    for (const { row, data: d, resolved } of rows) {
      const tax = (d.tax as number | null) ?? 0;
      const net = d.amountTotal as number;
      const recoverable = ctx.region !== "US"; // Canadian sales tax on purchases is an input tax credit, not cost
      const ref = keyOf("cost", d.externalId, [d.date, net, d.project, d.code, d.vendor, d.reference, d.description, d.account], seen);
      const type = lc(d.sourceType);
      const source = /credit/.test(type) ? "CREDIT" : /journal|je|gj/.test(type) ? "JE" : /cheque|check|chq/.test(type) ? "CHECK" : /expense|purchase|card/.test(type) ? "EXPENSE" : /bill|invoice|ap|payable/.test(type) ? "BILL" : "IMPORT";
      values.push({
        companyId: ctx.c, date: String(d.date), source, docNumber: d.reference != null ? String(d.reference) : null,
        description: String(d.description ?? d.vendor ?? "Imported cost"),
        amountCents: recoverable ? net : net + tax, taxCents: recoverable ? tax : 0,
        projectId: resolved.projectId, costCodeId: resolved.costCodeId,
        vendorId: d.vendor ? await ensureVendor(ctx, vendors, String(d.vendor)) : null,
        qboAccountId: resolved.account, qboCustomerName: resolved.projectId ? null : d.project != null ? String(d.project) : null,
        assignedAt: resolved.projectId && resolved.costCodeId ? String(d.date) : null,
        importBatchId: ctx.batchId, externalRef: ref, sourceRow: row,
      });
      if (!resolved.projectId || !resolved.costCodeId) toCode++;
    }
    const before = await existingRefs(ctx, s.costTransactions, values.map((v) => v.externalRef!));
    const ct = s.costTransactions;
    for (const part of chunk(values)) await ctx.tx.insert(ct).values(part).onConflictDoUpdate({
      target: [ct.companyId, ct.externalRef],
      set: {
        date: sql`excluded.date`, source: sql`excluded.source`, docNumber: sql`excluded.doc_number`, description: sql`excluded.description`,
        amountCents: sql`excluded.amount_cents`, taxCents: sql`excluded.tax_cents`, vendorId: sql`excluded.vendor_id`, qboAccountId: sql`excluded.qbo_account_id`,
        qboCustomerName: sql`excluded.qbo_customer_name`, sourceRow: sql`excluded.source_row`, // import_batch_id stays with the import that created the row
        // the file wins when it names a project/code; otherwise keep coding done in ProjectCost
        projectId: sql`coalesce(excluded.project_id, ${ct.projectId})`, costCodeId: sql`coalesce(excluded.cost_code_id, ${ct.costCodeId})`,
        assignedAt: sql`coalesce(${ct.assignedAt}, excluded.assigned_at)`,
      },
    });
    return { created: values.length - before.size, updated: before.size, toCode };
  },

  async time(ctx, rows) {
    const L = await lookups(ctx.tx, ctx.c);
    const emps = new Map([...L.employee].map(([k, e]) => [k, e]));
    let uncoded = L.code.get("lab-uncoded")?.id;
    const seen = new Map<string, number>();
    const values: (typeof s.timeEntries.$inferInsert)[] = [];
    for (const { data: d, resolved } of rows) {
      const e = await ensureEmployee(ctx, emps, String(d.employeeName));
      if (!resolved.costCodeId && !uncoded) {
        const [cc] = await ctx.tx.insert(s.costCodes).values({ companyId: ctx.c, code: "LAB-UNCODED", name: "Labour, no code", costType: "LABOUR" }).returning();
        uncoded = cc.id;
      }
      values.push({
        companyId: ctx.c, employeeId: e.id, projectId: resolved.projectId!, costCodeId: resolved.costCodeId ?? uncoded!, date: String(d.date), hoursX100: d.totalHours as number,
        payRateCents: (d.payRate as number | null) ?? e.payRateCents, burdenBp: e.burdenBp, billRateCents: e.billRateCents, status: "APPROVED",
        notes: d.notes != null ? String(d.notes) : null, importBatchId: ctx.batchId,
        externalRef: keyOf("time", d.externalId, [d.date, d.employeeName, d.totalHours, d.project, d.code, d.notes], seen),
      });
    }
    const before = await existingRefs(ctx, s.timeEntries, values.map((v) => v.externalRef!));
    const te = s.timeEntries;
    for (const part of chunk(values)) await ctx.tx.insert(te).values(part).onConflictDoUpdate({
      target: [te.companyId, te.externalRef],
      set: {
        employeeId: sql`excluded.employee_id`, projectId: sql`excluded.project_id`, costCodeId: sql`excluded.cost_code_id`, date: sql`excluded.date`,
        hoursX100: sql`excluded.hours_x100`, notes: sql`excluded.notes`,
        payRateCents: sql`case when ${te.payRateCents} = 0 then excluded.pay_rate_cents else ${te.payRateCents} end`,
        burdenBp: sql`case when ${te.payRateCents} = 0 then excluded.burden_bp else ${te.burdenBp} end`,
      },
    });
    return { created: values.length - before.size, updated: before.size };
  },

  async employees(ctx, rows) {
    const L = await lookups(ctx.tx, ctx.c);
    let created = 0, updated = 0;
    for (const { data: d } of rows) {
      const name = String(d.fullName);
      const set = {
        ...(d.trade != null && { trade: String(d.trade) }), ...(d.payRate != null && { payRateCents: d.payRate as number }),
        ...(d.burden != null && { burdenBp: d.burden as number }), ...(d.billRate != null && { billRateCents: d.billRate as number }), ...(d.active != null && { active: d.active as boolean }),
      };
      let e = L.employee.get(name.toLowerCase());
      if (e) { if (Object.keys(set).length) await ctx.tx.update(s.employees).set(set).where(and(eq(s.employees.id, e.id), eq(s.employees.companyId, ctx.c))); updated++; }
      else { [e] = await ctx.tx.insert(s.employees).values({ companyId: ctx.c, name, trade: "Employee", payRateCents: 0, burdenBp: 0, billRateCents: 0, ...set }).returning(); L.employee.set(name.toLowerCase(), e); created++; }
      const pay = (d.payRate as number | null) ?? null;
      if (pay && pay > 0) // time imported before a rate was known picks it up, as on the Employees page
        await ctx.tx.update(s.timeEntries).set({ payRateCents: pay, burdenBp: (d.burden as number | null) ?? e.burdenBp })
          .where(and(eq(s.timeEntries.companyId, ctx.c), eq(s.timeEntries.employeeId, e.id), eq(s.timeEntries.payRateCents, 0)));
    }
    return { created, updated };
  },

  async invoices(ctx, rows) {
    const seen = new Map<string, number>();
    let created = 0, updated = 0;
    for (const { data: d, resolved } of rows) {
      const key = keyOf("inv", d.invoiceNumber, [d.date, d.project, d.preTax], seen);
      const exists = await ctx.tx.query.qboInvoices.findFirst({ where: and(eq(s.qboInvoices.companyId, ctx.c), eq(s.qboInvoices.qboTxnType, "File"), eq(s.qboInvoices.qboTxnId, key)) });
      const values = {
        companyId: ctx.c, projectId: resolved.projectId!, qboTxnType: "File", qboTxnId: key, docNumber: d.invoiceNumber != null ? String(d.invoiceNumber) : null,
        date: String(d.date), amountCents: d.preTax as number, totalCents: (d.total as number | null) ?? null, taxCents: (d.tax as number | null) ?? null, importBatchId: ctx.batchId,
      };
      await ctx.tx.insert(s.qboInvoices).values(values).onConflictDoUpdate({
        target: [s.qboInvoices.companyId, s.qboInvoices.qboTxnType, s.qboInvoices.qboTxnId],
        set: { projectId: values.projectId, docNumber: values.docNumber, date: values.date, amountCents: values.amountCents, totalCents: values.totalCents, taxCents: values.taxCents },
      });
      if (exists) updated++; else created++;
    }
    return { created, updated };
  },

  async changeorders(ctx, rows) {
    // group rows into change orders: project + number (or title when there's no number)
    const groups = new Map<string, AnalyzedRow[]>();
    for (const r of rows) { const k = `${r.resolved.projectId}|${r.data.number ?? `t:${lc(r.data.title)}`}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
    let created = 0, updated = 0;
    for (const group of groups.values()) {
      const d = group[0].data, projectId = group[0].resolved.projectId!;
      let co = d.number != null
        ? await ctx.tx.query.changeOrders.findFirst({ where: and(eq(s.changeOrders.companyId, ctx.c), eq(s.changeOrders.projectId, projectId), eq(s.changeOrders.number, d.number as number)) })
        : await ctx.tx.query.changeOrders.findFirst({ where: and(eq(s.changeOrders.companyId, ctx.c), eq(s.changeOrders.projectId, projectId), sql`lower(${s.changeOrders.title}) = ${lc(d.title)}`) });
      const amount = (group.find((r) => r.data.amount != null)?.data.amount as number | undefined) ?? 0;
      const status = String(d.status), issued = (d.date as string | null) ?? new Date().toISOString().slice(0, 10);
      const set = { title: String(d.title), status, contractAmountCents: amount, dateIssued: issued, dateApproved: status === "APPROVED" ? (co?.dateApproved ?? issued) : null };
      if (co) { await ctx.tx.update(s.changeOrders).set(set).where(and(eq(s.changeOrders.id, co.id), eq(s.changeOrders.companyId, ctx.c))); updated++; }
      else {
        const [{ n }] = await ctx.tx.select({ n: max(s.changeOrders.number) }).from(s.changeOrders).where(and(eq(s.changeOrders.companyId, ctx.c), eq(s.changeOrders.projectId, projectId)));
        [co] = await ctx.tx.insert(s.changeOrders).values({ companyId: ctx.c, projectId, number: (d.number as number | null) ?? (n ?? 0) + 1, ...set, importBatchId: ctx.batchId }).returning();
        created++;
      }
      await ctx.tx.delete(s.changeOrderLines).where(and(eq(s.changeOrderLines.companyId, ctx.c), eq(s.changeOrderLines.changeOrderId, co.id)));
      const lines = group.filter((r) => r.resolved.costCodeId && r.data.cost != null).map((r) => ({ companyId: ctx.c, changeOrderId: co!.id, costCodeId: r.resolved.costCodeId!, costCents: r.data.cost as number }));
      if (lines.length) await ctx.tx.insert(s.changeOrderLines).values(lines);
      if (status === "APPROVED") { // approved changes become billable, as when approved in ProjectCost
        const has = await ctx.tx.query.sovLines.findFirst({ where: and(eq(s.sovLines.companyId, ctx.c), eq(s.sovLines.projectId, projectId), eq(s.sovLines.changeOrderNumber, co.number)) });
        if (!has) {
          const [{ n }] = await ctx.tx.select({ n: max(s.sovLines.lineNo) }).from(s.sovLines).where(and(eq(s.sovLines.companyId, ctx.c), eq(s.sovLines.projectId, projectId)));
          await ctx.tx.insert(s.sovLines).values({ companyId: ctx.c, projectId, lineNo: (n ?? 0) + 1, description: `CO #${co.number}: ${co.title}`, scheduledValueCents: amount, changeOrderNumber: co.number });
        }
      }
    }
    return { created, updated };
  },

  async accounts(ctx, rows) {
    let created = 0, updated = 0;
    const L = await lookups(ctx.tx, ctx.c);
    for (const { data: d } of rows) {
      const existing = L.account.get(lc(d.code ?? d.name));
      const qboId = existing?.qboId ?? `f:${String(d.code ?? d.name).trim()}`;
      const name = String(d.name ?? d.code);
      const values = { companyId: ctx.c, qboId, name, fullName: d.code && d.name ? `${d.code} ${d.name}` : name, accountType: String(d.type), ...(d.projectCost != null && { isProjectCost: d.projectCost as boolean }) };
      await ctx.tx.insert(s.glAccounts).values(values).onConflictDoUpdate({
        target: [s.glAccounts.companyId, s.glAccounts.qboId],
        set: { name: values.name, fullName: values.fullName, accountType: values.accountType, ...(d.projectCost != null && { isProjectCost: d.projectCost as boolean }) },
      });
      if (existing) updated++; else created++;
    }
    return { created, updated };
  },

  async pnl(ctx, rows) {
    const accounts = new Map<string, { id: string; name: string; section: string }>();
    const amounts = new Map<string, number>(); // accountId|month -> cents (summed)
    for (const { data: d, resolved } of rows) {
      const id = resolved.accountId ?? `f:${String(d.account).trim()}`;
      accounts.set(id, { id, name: String(d.account), section: String(d.sectionKey) });
      const k = `${id}|${d.month}`;
      amounts.set(k, (amounts.get(k) ?? 0) + (d.amount as number));
    }
    let created = 0, updated = 0;
    for (const a of accounts.values()) {
      const exists = await ctx.tx.query.overheadAccounts.findFirst({ where: and(eq(s.overheadAccounts.companyId, ctx.c), eq(s.overheadAccounts.qboAccountId, a.id)) });
      await ctx.tx.insert(s.overheadAccounts).values({ companyId: ctx.c, qboAccountId: a.id, name: a.name, section: a.section })
        .onConflictDoUpdate({ target: [s.overheadAccounts.companyId, s.overheadAccounts.qboAccountId], set: { name: a.name, section: a.section } });
      if (exists) updated++; else created++;
    }
    const months = [...new Set([...amounts.keys()].map((k) => k.split("|")[1]))];
    for (const id of accounts.keys())
      await ctx.tx.delete(s.overheadMonths).where(and(eq(s.overheadMonths.companyId, ctx.c), eq(s.overheadMonths.qboAccountId, id), inArray(s.overheadMonths.month, months)));
    const vals = [...amounts].filter(([, v]) => v).map(([k, v]) => ({ companyId: ctx.c, qboAccountId: k.split("|")[0], month: k.split("|")[1], amountCents: v }));
    for (const part of chunk(vals)) if (part.length) await ctx.tx.insert(s.overheadMonths).values(part);
    return { created, updated };
  },
};

/** Removes the rows an undoable batch created. Rows it only updated (they existed before) are left alone. */
export async function undoBatch(companyId: string, batchId: string) {
  const batch = await db.query.importBatches.findFirst({ where: and(eq(s.importBatches.id, batchId), eq(s.importBatches.companyId, companyId)) });
  if (!batch) throw new Error("Import not found.");
  if (batch.status !== "COMMITTED") throw new Error("That import was already undone.");
  if (!importKind(batch.kind)?.undoable) throw new Error("This kind of import can't be undone; change the records directly or import a corrected file.");
  await db.transaction(async (tx) => {
    const own = (t: typeof s.costTransactions | typeof s.timeEntries | typeof s.qboInvoices | typeof s.budgetLines | typeof s.changeOrders) => and(eq(t.companyId, companyId), eq(t.importBatchId, batchId));
    await tx.delete(s.costTransactions).where(own(s.costTransactions));
    await tx.delete(s.timeEntries).where(own(s.timeEntries));
    await tx.delete(s.qboInvoices).where(own(s.qboInvoices));
    await tx.delete(s.budgetLines).where(own(s.budgetLines));
    await tx.delete(s.changeOrders).where(own(s.changeOrders));
    await tx.update(s.importBatches).set({ status: "UNDONE", undoneAt: new Date().toISOString() }).where(eq(s.importBatches.id, batchId));
  });
}
