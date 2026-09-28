// ProjectCost data model (Postgres).
// Conventions: money = integer cents, percentages = basis points (1% = 100 bp),
// hours = hundredths (7.5h = 750), dates = ISO 'YYYY-MM-DD' text.
//
// Multi-tenancy: a company is a tenant (one Clerk organization). Every tenant-owned row carries
// company_id, and references between tenant rows are composite foreign keys on
// (company_id, <parent>_id) -> parent(company_id, id). The database therefore rejects any row that
// points at another company's project, cost code, employee, etc., even if app code is wrong.
import { pgTable, text, integer, bigint, boolean, uniqueIndex, unique, foreignKey, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const cents = (name: string) => bigint(name, { mode: "number" }); // bigint: contracts can exceed int4's $21.4M in cents
const companyId = () => text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" });

export const companies = pgTable("company", {
  id: id(),
  clerkOrgId: text("clerk_org_id").unique(), // null only for rows created outside the app (e.g. tests)
  name: text("name").notNull(),
  region: text("region").notNull().default("CA"), // CA | US
  province: text("province"), // ON, BC, TX...
  fiscalYearEndMonth: integer("fiscal_year_end_month").notNull().default(12),
  closedThrough: text("closed_through"), // never write to QBO on/before this date
  qboRealmId: text("qbo_realm_id"),
  qboConnectedAt: text("qbo_connected_at"),
  qboCompanyName: text("qbo_company_name"), // CompanyInfo.CompanyName at connect time
  defaultHoldbackBp: integer("default_holdback_bp").notNull().default(1000),
  defaultTaxBp: integer("default_tax_bp").notNull().default(1300),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  deletedAt: text("deleted_at"), // set when the Clerk organization is deleted
  // billing (Stripe)
  trialEndsAt: text("trial_ends_at"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  plan: text("plan"), // key in src/lib/plans.ts
  subscriptionStatus: text("subscription_status"), // Stripe status: trialing | active | past_due | canceled | unpaid ...
  currentPeriodEnd: text("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
}, (t) => [
  // One QuickBooks file can feed only one live company, so two workspaces never sync the same books.
  uniqueIndex("company_qbo_realm_live").on(t.qboRealmId).where(sql`${t.deletedAt} is null`),
]);

// QuickBooks Online OAuth tokens, one row per connected company. Tokens are AES-256-GCM encrypted
// with QBO_TOKEN_KEY (src/lib/crypto.ts); only src/lib/qbo.ts reads them.
export const qboConnections = pgTable("qbo_connection", {
  companyId: text("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  realmId: text("realm_id").notNull(),
  environment: text("environment").notNull(), // sandbox | production
  accessTokenEnc: text("access_token_enc").notNull(),
  accessTokenExpiresAt: text("access_token_expires_at").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  refreshTokenExpiresAt: text("refresh_token_expires_at").notNull(),
  connectedByUserId: text("connected_by_user_id").notNull(),
  connectedAt: text("connected_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const costCodes = pgTable(
  "cost_code",
  {
    id: id(),
    companyId: companyId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    costType: text("cost_type").notNull(), // LABOUR | MATERIAL | SUB | EQUIPMENT | OTHER
    qboItemId: text("qbo_item_id"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("cost_code_company_code").on(t.companyId, t.code), unique("cost_code_tenant").on(t.companyId, t.id)],
);

export const customers = pgTable(
  "customer",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    qboId: text("qbo_id"),
  },
  (t) => [unique("customer_tenant").on(t.companyId, t.id)],
);

export const vendors = pgTable(
  "vendor",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    qboId: text("qbo_id"),
  },
  (t) => [unique("vendor_tenant").on(t.companyId, t.id)],
);

export const employees = pgTable(
  "employee",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    trade: text("trade").notNull(),
    payRateCents: integer("pay_rate_cents").notNull(),
    burdenBp: integer("burden_bp").notNull(), // CPP/EI/WSIB/EHT/benefits as % of wages
    billRateCents: integer("bill_rate_cents").notNull(),
    qboId: text("qbo_id"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [unique("employee_tenant").on(t.companyId, t.id)],
);

export const projects = pgTable(
  "project",
  {
    id: id(),
    companyId: companyId(),
    customerId: text("customer_id").notNull(),
    number: text("number").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ACTIVE"), // BID | ACTIVE | COMPLETE
    contractType: text("contract_type").notNull().default("FIXED"), // FIXED | TM | COST_PLUS
    originalContractCents: cents("original_contract_cents").notNull(),
    holdbackBp: integer("holdback_bp").notNull().default(1000),
    taxBp: integer("tax_bp").notNull().default(1300),
    projectManager: text("project_manager"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    qboProjectId: text("qbo_project_id"),
  },
  (t) => [
    uniqueIndex("project_company_number").on(t.companyId, t.number),
    unique("project_tenant").on(t.companyId, t.id),
    foreignKey({ name: "project_customer_fk", columns: [t.companyId, t.customerId], foreignColumns: [customers.companyId, customers.id] }),
  ],
);

// FK helpers for child tables: (company_id, x_id) -> parent(company_id, id)
const toProject = (table: string, company: AnyPgColumn, project: AnyPgColumn) =>
  foreignKey({ name: `${table}_project_fk`, columns: [company, project], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade");
const toCostCode = (table: string, company: AnyPgColumn, costCode: AnyPgColumn) =>
  foreignKey({ name: `${table}_cost_code_fk`, columns: [company, costCode], foreignColumns: [costCodes.companyId, costCodes.id] });

export const budgetLines = pgTable(
  "budget_line",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    costCodeId: text("cost_code_id").notNull(),
    originalCents: cents("original_cents").notNull(),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("budget_project_code").on(t.projectId, t.costCodeId), toProject("budget_line", t.companyId, t.projectId), toCostCode("budget_line", t.companyId, t.costCodeId)],
);

export const changeOrders = pgTable(
  "change_order",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
    contractAmountCents: cents("contract_amount_cents").notNull(),
    dateIssued: text("date_issued").notNull(),
    dateApproved: text("date_approved"),
  },
  (t) => [uniqueIndex("co_project_number").on(t.projectId, t.number), unique("change_order_tenant").on(t.companyId, t.id), toProject("change_order", t.companyId, t.projectId)],
);

export const changeOrderLines = pgTable(
  "change_order_line",
  {
    id: id(),
    companyId: companyId(),
    changeOrderId: text("change_order_id").notNull(),
    costCodeId: text("cost_code_id").notNull(),
    costCents: cents("cost_cents").notNull(),
  },
  (t) => [
    foreignKey({ name: "change_order_line_co_fk", columns: [t.companyId, t.changeOrderId], foreignColumns: [changeOrders.companyId, changeOrders.id] }).onDelete("cascade"),
    toCostCode("change_order_line", t.companyId, t.costCodeId),
  ],
);

export const forecasts = pgTable(
  "forecast",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    costCodeId: text("cost_code_id").notNull(),
    etcCents: cents("etc_cents").notNull(), // estimate to complete; overrides remaining budget
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("forecast_project_code").on(t.projectId, t.costCodeId), toProject("forecast", t.companyId, t.projectId), toCostCode("forecast", t.companyId, t.costCodeId)],
);

// Mirror of QBO cost lines (Bill, Purchase, Check, JournalEntry).
// projectId/costCodeId null => Unassigned Costs queue. (Composite FKs skip rows where a column is null.)
export const costTransactions = pgTable(
  "cost_transaction",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id"),
    costCodeId: text("cost_code_id"),
    vendorId: text("vendor_id"),
    date: text("date").notNull(),
    source: text("source").notNull(), // BILL | EXPENSE | CHECK | JE
    docNumber: text("doc_number"),
    description: text("description").notNull(),
    amountCents: cents("amount_cents").notNull(), // pre-tax job cost
    taxCents: cents("tax_cents").notNull().default(0), // recoverable ITC (CA) — not job cost
    qboTxnId: text("qbo_txn_id"),
    qboLineId: text("qbo_line_id"),
    assignedAt: text("assigned_at"),
    pendingPush: boolean("pending_push").notNull().default(false),
  },
  (t) => [
    toProject("cost_transaction", t.companyId, t.projectId),
    toCostCode("cost_transaction", t.companyId, t.costCodeId),
    foreignKey({ name: "cost_transaction_vendor_fk", columns: [t.companyId, t.vendorId], foreignColumns: [vendors.companyId, vendors.id] }),
    index("cost_transaction_company_project").on(t.companyId, t.projectId),
  ],
);

export const timeEntries = pgTable(
  "time_entry",
  {
    id: id(),
    companyId: companyId(),
    employeeId: text("employee_id").notNull(),
    projectId: text("project_id").notNull(),
    costCodeId: text("cost_code_id").notNull(),
    date: text("date").notNull(),
    hoursX100: integer("hours_x100").notNull(),
    payRateCents: integer("pay_rate_cents").notNull(), // captured at entry (effective-dated)
    burdenBp: integer("burden_bp").notNull(),
    billRateCents: integer("bill_rate_cents").notNull(),
    status: text("status").notNull().default("SUBMITTED"), // SUBMITTED | APPROVED
    notes: text("notes"),
    qboTimeActivityId: text("qbo_time_activity_id"),
  },
  (t) => [
    foreignKey({ name: "time_entry_employee_fk", columns: [t.companyId, t.employeeId], foreignColumns: [employees.companyId, employees.id] }),
    toProject("time_entry", t.companyId, t.projectId),
    toCostCode("time_entry", t.companyId, t.costCodeId),
    index("time_entry_company_status").on(t.companyId, t.status),
    index("time_entry_project").on(t.projectId),
  ],
);

export const sovLines = pgTable(
  "sov_line",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    lineNo: integer("line_no").notNull(),
    description: text("description").notNull(),
    scheduledValueCents: cents("scheduled_value_cents").notNull(),
    changeOrderNumber: integer("change_order_number"),
  },
  (t) => [unique("sov_line_tenant").on(t.companyId, t.id), toProject("sov_line", t.companyId, t.projectId)],
);

export const progressBills = pgTable(
  "progress_bill",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    periodEnd: text("period_end").notNull(),
    status: text("status").notNull().default("DRAFT"), // DRAFT | POSTED
    qboInvoiceId: text("qbo_invoice_id"),
  },
  (t) => [uniqueIndex("pb_project_number").on(t.projectId, t.number), unique("progress_bill_tenant").on(t.companyId, t.id), toProject("progress_bill", t.companyId, t.projectId)],
);

export const progressBillLines = pgTable(
  "progress_bill_line",
  {
    id: id(),
    companyId: companyId(),
    progressBillId: text("progress_bill_id").notNull(),
    sovLineId: text("sov_line_id").notNull(),
    thisPeriodCents: cents("this_period_cents").notNull(),
  },
  (t) => [
    foreignKey({ name: "progress_bill_line_bill_fk", columns: [t.companyId, t.progressBillId], foreignColumns: [progressBills.companyId, progressBills.id] }).onDelete("cascade"),
    foreignKey({ name: "progress_bill_line_sov_fk", columns: [t.companyId, t.sovLineId], foreignColumns: [sovLines.companyId, sovLines.id] }).onDelete("cascade"),
  ],
);

export const wipSnapshots = pgTable(
  "wip_snapshot",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    periodEnd: text("period_end").notNull(),
    contractCents: cents("contract_cents").notNull(),
    eacCents: cents("eac_cents").notNull(),
    costToDateCents: cents("cost_to_date_cents").notNull(),
    pctCompleteBp: integer("pct_complete_bp").notNull(),
    earnedCents: cents("earned_cents").notNull(),
    billedCents: cents("billed_cents").notNull(),
    overUnderCents: cents("over_under_cents").notNull(), // + overbilled (liability), − underbilled (asset)
    lossProvisionCents: cents("loss_provision_cents").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("wip_project_period").on(t.projectId, t.periodEnd), toProject("wip_snapshot", t.companyId, t.projectId)],
);

export const syncLogs = pgTable(
  "sync_log",
  {
    id: id(),
    companyId: companyId(),
    entity: text("entity").notNull(),
    qboId: text("qbo_id"),
    direction: text("direction").notNull(), // PULL | PUSH
    status: text("status").notNull(), // OK | ERROR | SKIPPED | QUEUED
    message: text("message"),
    requestId: text("request_id"),
    userId: text("user_id"), // Clerk user who triggered it
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("sync_log_company_created").on(t.companyId, t.createdAt)],
);

// Stripe webhook idempotency: each event id is processed once.
export const stripeEvents = pgTable("stripe_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: text("received_at").notNull(),
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
