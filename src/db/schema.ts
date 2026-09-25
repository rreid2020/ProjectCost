// ProjectCost data model.
// Conventions: money = integer cents, percentages = basis points (1% = 100 bp),
// hours = hundredths (7.5h = 750), dates = ISO 'YYYY-MM-DD' text.
// Local dev runs on SQLite (libsql). Production target is Postgres (drizzle pg-core port is 1:1).
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

export const companies = sqliteTable("company", {
  id: id(),
  name: text("name").notNull(),
  region: text("region").notNull().default("CA"), // CA | US
  province: text("province"), // ON, BC, TX...
  fiscalYearEndMonth: integer("fiscal_year_end_month").notNull().default(12),
  closedThrough: text("closed_through"), // never write to QBO on/before this date
  qboRealmId: text("qbo_realm_id"),
  qboConnectedAt: text("qbo_connected_at"),
  defaultHoldbackBp: integer("default_holdback_bp").notNull().default(1000),
  defaultTaxBp: integer("default_tax_bp").notNull().default(1300),
});

export const costCodes = sqliteTable(
  "cost_code",
  {
    id: id(),
    companyId: text("company_id").notNull().references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    costType: text("cost_type").notNull(), // LABOUR | MATERIAL | SUB | EQUIPMENT | OTHER
    qboItemId: text("qbo_item_id"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [uniqueIndex("cost_code_company_code").on(t.companyId, t.code)],
);

export const customers = sqliteTable("customer", {
  id: id(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  qboId: text("qbo_id"),
});

export const vendors = sqliteTable("vendor", {
  id: id(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  qboId: text("qbo_id"),
});

export const employees = sqliteTable("employee", {
  id: id(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  trade: text("trade").notNull(),
  payRateCents: integer("pay_rate_cents").notNull(),
  burdenBp: integer("burden_bp").notNull(), // CPP/EI/WSIB/EHT/benefits as % of wages
  billRateCents: integer("bill_rate_cents").notNull(),
  qboId: text("qbo_id"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const projects = sqliteTable(
  "project",
  {
    id: id(),
    companyId: text("company_id").notNull().references(() => companies.id),
    customerId: text("customer_id").notNull().references(() => customers.id),
    number: text("number").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ACTIVE"), // BID | ACTIVE | COMPLETE
    contractType: text("contract_type").notNull().default("FIXED"), // FIXED | TM | COST_PLUS
    originalContractCents: integer("original_contract_cents").notNull(),
    holdbackBp: integer("holdback_bp").notNull().default(1000),
    taxBp: integer("tax_bp").notNull().default(1300),
    projectManager: text("project_manager"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    qboProjectId: text("qbo_project_id"),
  },
  (t) => [uniqueIndex("project_company_number").on(t.companyId, t.number)],
);

export const budgetLines = sqliteTable(
  "budget_line",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    costCodeId: text("cost_code_id").notNull().references(() => costCodes.id),
    originalCents: integer("original_cents").notNull(),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("budget_project_code").on(t.projectId, t.costCodeId)],
);

export const changeOrders = sqliteTable(
  "change_order",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
    contractAmountCents: integer("contract_amount_cents").notNull(),
    dateIssued: text("date_issued").notNull(),
    dateApproved: text("date_approved"),
  },
  (t) => [uniqueIndex("co_project_number").on(t.projectId, t.number)],
);

export const changeOrderLines = sqliteTable("change_order_line", {
  id: id(),
  changeOrderId: text("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  costCodeId: text("cost_code_id").notNull().references(() => costCodes.id),
  costCents: integer("cost_cents").notNull(),
});

export const forecasts = sqliteTable(
  "forecast",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    costCodeId: text("cost_code_id").notNull().references(() => costCodes.id),
    etcCents: integer("etc_cents").notNull(), // estimate to complete; overrides remaining budget
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("forecast_project_code").on(t.projectId, t.costCodeId)],
);

// Mirror of QBO cost lines (Bill, Purchase, Check, JournalEntry).
// projectId/costCodeId null => Unassigned Costs queue.
export const costTransactions = sqliteTable("cost_transaction", {
  id: id(),
  companyId: text("company_id").notNull().references(() => companies.id),
  projectId: text("project_id").references(() => projects.id),
  costCodeId: text("cost_code_id").references(() => costCodes.id),
  vendorId: text("vendor_id").references(() => vendors.id),
  date: text("date").notNull(),
  source: text("source").notNull(), // BILL | EXPENSE | CHECK | JE
  docNumber: text("doc_number"),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(), // pre-tax job cost
  taxCents: integer("tax_cents").notNull().default(0), // recoverable ITC (CA) — not job cost
  qboTxnId: text("qbo_txn_id"),
  qboLineId: text("qbo_line_id"),
  assignedAt: text("assigned_at"),
  pendingPush: integer("pending_push", { mode: "boolean" }).notNull().default(false),
});

export const timeEntries = sqliteTable("time_entry", {
  id: id(),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  costCodeId: text("cost_code_id").notNull().references(() => costCodes.id),
  date: text("date").notNull(),
  hoursX100: integer("hours_x100").notNull(),
  payRateCents: integer("pay_rate_cents").notNull(), // captured at entry (effective-dated)
  burdenBp: integer("burden_bp").notNull(),
  billRateCents: integer("bill_rate_cents").notNull(),
  status: text("status").notNull().default("SUBMITTED"), // SUBMITTED | APPROVED
  notes: text("notes"),
  qboTimeActivityId: text("qbo_time_activity_id"),
});

export const sovLines = sqliteTable("sov_line", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  description: text("description").notNull(),
  scheduledValueCents: integer("scheduled_value_cents").notNull(),
  changeOrderNumber: integer("change_order_number"),
});

export const progressBills = sqliteTable(
  "progress_bill",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    periodEnd: text("period_end").notNull(),
    status: text("status").notNull().default("DRAFT"), // DRAFT | POSTED
    qboInvoiceId: text("qbo_invoice_id"),
  },
  (t) => [uniqueIndex("pb_project_number").on(t.projectId, t.number)],
);

export const progressBillLines = sqliteTable("progress_bill_line", {
  id: id(),
  progressBillId: text("progress_bill_id").notNull().references(() => progressBills.id, { onDelete: "cascade" }),
  sovLineId: text("sov_line_id").notNull().references(() => sovLines.id, { onDelete: "cascade" }),
  thisPeriodCents: integer("this_period_cents").notNull(),
});

export const wipSnapshots = sqliteTable(
  "wip_snapshot",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    periodEnd: text("period_end").notNull(),
    contractCents: integer("contract_cents").notNull(),
    eacCents: integer("eac_cents").notNull(),
    costToDateCents: integer("cost_to_date_cents").notNull(),
    pctCompleteBp: integer("pct_complete_bp").notNull(),
    earnedCents: integer("earned_cents").notNull(),
    billedCents: integer("billed_cents").notNull(),
    overUnderCents: integer("over_under_cents").notNull(), // + overbilled (liability), − underbilled (asset)
    lossProvisionCents: integer("loss_provision_cents").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("wip_project_period").on(t.projectId, t.periodEnd)],
);

export const syncLogs = sqliteTable("sync_log", {
  id: id(),
  companyId: text("company_id").notNull().references(() => companies.id),
  entity: text("entity").notNull(),
  qboId: text("qbo_id"),
  direction: text("direction").notNull(), // PULL | PUSH
  status: text("status").notNull(), // OK | ERROR | SKIPPED | QUEUED
  message: text("message"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
});

// ---- relations (for db.query.* with nested reads) ----
export const projectRelations = relations(projects, ({ one, many }) => ({
  customer: one(customers, { fields: [projects.customerId], references: [customers.id] }),
  budgetLines: many(budgetLines),
  changeOrders: many(changeOrders),
  costs: many(costTransactions),
  timeEntries: many(timeEntries),
  forecasts: many(forecasts),
  sovLines: many(sovLines),
  progressBills: many(progressBills),
}));
export const budgetLineRelations = relations(budgetLines, ({ one }) => ({
  project: one(projects, { fields: [budgetLines.projectId], references: [projects.id] }),
  costCode: one(costCodes, { fields: [budgetLines.costCodeId], references: [costCodes.id] }),
}));
export const changeOrderRelations = relations(changeOrders, ({ one, many }) => ({
  project: one(projects, { fields: [changeOrders.projectId], references: [projects.id] }),
  lines: many(changeOrderLines),
}));
export const changeOrderLineRelations = relations(changeOrderLines, ({ one }) => ({
  changeOrder: one(changeOrders, { fields: [changeOrderLines.changeOrderId], references: [changeOrders.id] }),
  costCode: one(costCodes, { fields: [changeOrderLines.costCodeId], references: [costCodes.id] }),
}));
export const forecastRelations = relations(forecasts, ({ one }) => ({
  project: one(projects, { fields: [forecasts.projectId], references: [projects.id] }),
}));
export const costTxnRelations = relations(costTransactions, ({ one }) => ({
  project: one(projects, { fields: [costTransactions.projectId], references: [projects.id] }),
  costCode: one(costCodes, { fields: [costTransactions.costCodeId], references: [costCodes.id] }),
  vendor: one(vendors, { fields: [costTransactions.vendorId], references: [vendors.id] }),
}));
export const timeEntryRelations = relations(timeEntries, ({ one }) => ({
  employee: one(employees, { fields: [timeEntries.employeeId], references: [employees.id] }),
  project: one(projects, { fields: [timeEntries.projectId], references: [projects.id] }),
  costCode: one(costCodes, { fields: [timeEntries.costCodeId], references: [costCodes.id] }),
}));
export const sovLineRelations = relations(sovLines, ({ one, many }) => ({
  project: one(projects, { fields: [sovLines.projectId], references: [projects.id] }),
  billLines: many(progressBillLines),
}));
export const progressBillRelations = relations(progressBills, ({ one, many }) => ({
  project: one(projects, { fields: [progressBills.projectId], references: [projects.id] }),
  lines: many(progressBillLines),
}));
export const progressBillLineRelations = relations(progressBillLines, ({ one }) => ({
  progressBill: one(progressBills, { fields: [progressBillLines.progressBillId], references: [progressBills.id] }),
  sovLine: one(sovLines, { fields: [progressBillLines.sovLineId], references: [sovLines.id] }),
}));
export const customerRelations = relations(customers, ({ many }) => ({ projects: many(projects) }));
