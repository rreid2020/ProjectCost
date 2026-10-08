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
  qboProjectMode: text("qbo_project_mode"), // projects from QuickBooks customers: "none" (default; projects are made in ProjectCost) | "jobs" (sub-customers/Projects) | "customers"
  qboLastImportAt: text("qbo_last_import_at"),
  // overhead (management view only: never changes job cost, WIP or QuickBooks)
  overheadBasis: text("overhead_basis").notNull().default("labour_cost"), // labour_cost | labour_hours | direct_cost
  overheadRateMode: text("overhead_rate_mode").notNull().default("calculated"), // calculated | manual
  overheadManualRate: integer("overhead_manual_rate"), // bp of base (labour_cost, direct_cost) or cents per hour (labour_hours)
  // GL accounts (QuickBooks account ids) used for capital and build-for-sale project entries
  cipAccountId: text("cip_account_id"), // Construction in progress (asset)
  wipInventoryAccountId: text("wip_inventory_account_id"), // Inventory: work in process (asset)
  finishedGoodsAccountId: text("finished_goods_account_id"), // Inventory: finished goods (asset)
  cogsAccountId: text("cogs_account_id"), // Cost of goods sold, for units sold
  labourCreditAccountId: text("labour_credit_account_id"), // credited when labour is capitalized or put into inventory
  defaultHoldbackBp: integer("default_holdback_bp").notNull().default(1000),
  defaultTaxBp: integer("default_tax_bp").notNull().default(1300),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  sampleDataLoadedAt: text("sample_data_loaded_at"), // set while the workspace holds the demo data
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
  (t) => [
    uniqueIndex("cost_code_company_code").on(t.companyId, t.code),
    unique("cost_code_tenant").on(t.companyId, t.id),
    uniqueIndex("cost_code_company_qbo").on(t.companyId, t.qboItemId),
  ],
);

export const customers = pgTable(
  "customer",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    qboId: text("qbo_id"),
  },
  (t) => [unique("customer_tenant").on(t.companyId, t.id), uniqueIndex("customer_company_qbo").on(t.companyId, t.qboId)],
);

export const vendors = pgTable(
  "vendor",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    qboId: text("qbo_id"),
  },
  (t) => [unique("vendor_tenant").on(t.companyId, t.id), uniqueIndex("vendor_company_qbo").on(t.companyId, t.qboId)],
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
  (t) => [unique("employee_tenant").on(t.companyId, t.id), uniqueIndex("employee_company_qbo").on(t.companyId, t.qboId)],
);

export const projects = pgTable(
  "project",
  {
    id: id(),
    companyId: companyId(),
    customerId: text("customer_id"), // required for CONTRACT; optional for CAPITAL / INVENTORY
    projectType: text("project_type").notNull().default("CONTRACT"), // CONTRACT | CAPITAL | INVENTORY
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
    unitsPlanned: integer("units_planned").notNull().default(1), // INVENTORY: units this project produces (editable)
    inServiceDate: text("in_service_date"), // CAPITAL: date capitalized to the fixed asset
    assetAccountId: text("asset_account_id"), // CAPITAL: fixed-asset account it's capitalized to
  },
  (t) => [
    uniqueIndex("project_company_number").on(t.companyId, t.number),
    uniqueIndex("project_company_qbo").on(t.companyId, t.qboProjectId),
    unique("project_tenant").on(t.companyId, t.id),
    foreignKey({ name: "project_customer_fk", columns: [t.companyId, t.customerId], foreignColumns: [customers.companyId, customers.id] }),
  ],
);

// How QuickBooks transactions find this project, beyond qbo_project_id: any customer, class, location or GL account.
// One QuickBooks entity feeds at most one project.
export const projectQboLinks = pgTable(
  "project_qbo_link",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(), // customer | class | department | account
    qboId: text("qbo_id").notNull(),
    qboName: text("qbo_name"),
  },
  (t) => [
    uniqueIndex("project_qbo_link_company_kind_qbo").on(t.companyId, t.kind, t.qboId),
    foreignKey({ name: "project_qbo_link_project_fk", columns: [t.companyId, t.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  ],
);

// Units completed and sold on build-for-sale projects. Drives WIP -> finished goods -> COGS.
export const projectUnitEvents = pgTable(
  "project_unit_event",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(), // COMPLETED | SOLD
    date: text("date").notNull(),
    units: integer("units").notNull(),
    saleAmountCents: cents("sale_amount_cents"), // SOLD: optional, for margin per unit
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("project_unit_event_project").on(t.projectId),
    foreignKey({ name: "project_unit_event_project_fk", columns: [t.companyId, t.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  ],
);

// Chart of accounts from QuickBooks. isProjectCost: lines posted here are project costs even without a customer
// (null = default: Cost of Goods Sold accounts yes, others no).
export const glAccounts = pgTable(
  "gl_account",
  {
    id: id(),
    companyId: companyId(),
    qboId: text("qbo_id").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    accountType: text("account_type").notNull(),
    accountSubType: text("account_sub_type"),
    active: boolean("active").notNull().default(true),
    isProjectCost: boolean("is_project_cost"),
  },
  (t) => [uniqueIndex("gl_account_company_qbo").on(t.companyId, t.qboId)],
);

// QuickBooks classes and locations (Department in the API), for linking to projects.
export const qboTags = pgTable(
  "qbo_tag",
  {
    id: id(),
    companyId: companyId(),
    kind: text("kind").notNull(), // class | department
    qboId: text("qbo_id").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("qbo_tag_company_kind_qbo").on(t.companyId, t.kind, t.qboId)],
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
    importBatchId: text("import_batch_id"),
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
    importBatchId: text("import_batch_id"),
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
    qboTxnType: text("qbo_txn_type"), // Bill | Purchase | VendorCredit | JournalEntry
    qboTxnId: text("qbo_txn_id"),
    qboLineId: text("qbo_line_id"),
    qboCustomerName: text("qbo_customer_name"), // the QBO customer/job the line was tagged to, shown when it needs coding
    // for tracing back to QuickBooks: the line as QuickBooks shows it (transaction currency) and the rate used
    qboCurrency: text("qbo_currency"),
    qboLineAmountCents: cents("qbo_line_amount_cents"),
    qboExchangeRate: text("qbo_exchange_rate"),
    qboAccountId: text("qbo_account_id"), // GL account the line posted to (for netting job costs out of the overhead pool)
    importBatchId: text("import_batch_id"), // spreadsheet batch that created it (null for QuickBooks / manual)
    externalRef: text("external_ref"), // spreadsheet row key, for updating in place on re-import
    sourceRow: integer("source_row"), // row number in the spreadsheet, for tracing
    assignedAt: text("assigned_at"),
    pendingPush: boolean("pending_push").notNull().default(false),
  },
  (t) => [
    toProject("cost_transaction", t.companyId, t.projectId),
    toCostCode("cost_transaction", t.companyId, t.costCodeId),
    foreignKey({ name: "cost_transaction_vendor_fk", columns: [t.companyId, t.vendorId], foreignColumns: [vendors.companyId, vendors.id] }),
    index("cost_transaction_company_project").on(t.companyId, t.projectId),
    uniqueIndex("cost_transaction_company_qbo").on(t.companyId, t.qboTxnType, t.qboTxnId, t.qboLineId),
    uniqueIndex("cost_transaction_company_ext").on(t.companyId, t.externalRef),
  ],
);

export const timeEntries = pgTable(
  "time_entry",
  {
    id: id(),
    companyId: companyId(),
    employeeId: text("employee_id").notNull(),
    projectId: text("project_id"), // null: QuickBooks time with no project yet; assigned on Unassigned costs
    costCodeId: text("cost_code_id").notNull(),
    date: text("date").notNull(),
    hoursX100: integer("hours_x100").notNull(),
    payRateCents: integer("pay_rate_cents").notNull(), // captured at entry (effective-dated)
    burdenBp: integer("burden_bp").notNull(),
    billRateCents: integer("bill_rate_cents").notNull(),
    status: text("status").notNull().default("SUBMITTED"), // SUBMITTED | APPROVED | NON_PROJECT (unassigned time marked as not project work)
    notes: text("notes"),
    qboTimeActivityId: text("qbo_time_activity_id"),
    qboCustomerName: text("qbo_customer_name"), // what QuickBooks said (customer / class / location), shown when assigning
    importBatchId: text("import_batch_id"),
    externalRef: text("external_ref"),
  },
  (t) => [
    foreignKey({ name: "time_entry_employee_fk", columns: [t.companyId, t.employeeId], foreignColumns: [employees.companyId, employees.id] }),
    toProject("time_entry", t.companyId, t.projectId),
    toCostCode("time_entry", t.companyId, t.costCodeId),
    index("time_entry_company_status").on(t.companyId, t.status),
    index("time_entry_project").on(t.projectId),
    uniqueIndex("time_entry_company_qbo").on(t.companyId, t.qboTimeActivityId),
    uniqueIndex("time_entry_company_ext").on(t.companyId, t.externalRef),
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

// Invoices and credit memos billed in QuickBooks (outside ProjectCost's progress billing). Count toward billed-to-date.
export const qboInvoices = pgTable(
  "qbo_invoice",
  {
    id: id(),
    companyId: companyId(),
    projectId: text("project_id").notNull(),
    qboTxnType: text("qbo_txn_type").notNull(), // Invoice | CreditMemo (QuickBooks) | File (spreadsheet; qbo_txn_id holds the row key)
    qboTxnId: text("qbo_txn_id").notNull(),
    docNumber: text("doc_number"),
    date: text("date").notNull(),
    amountCents: cents("amount_cents").notNull(), // pre-tax, home currency; negative for credit memos
    // as QuickBooks shows it (transaction currency), for tracing
    totalCents: cents("total_cents"),
    taxCents: cents("tax_cents"),
    currency: text("currency"),
    exchangeRate: text("exchange_rate"),
    importBatchId: text("import_batch_id"),
  },
  (t) => [uniqueIndex("qbo_invoice_company_txn").on(t.companyId, t.qboTxnType, t.qboTxnId), toProject("qbo_invoice", t.companyId, t.projectId)],
);

// ---------- Spreadsheet imports ----------
// A parsed upload waiting for its column mapping to be confirmed. Deleted once imported (or after a day).
export const importUploads = pgTable("import_upload", {
  id: id(),
  companyId: companyId(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(), // see src/lib/imports/kinds.ts
  fileName: text("file_name").notNull(),
  sheets: text("sheets").notNull(), // JSON: { name, rows: string[][] }[]
  sheetIndex: integer("sheet_index").notNull().default(0),
  headerRow: integer("header_row").notNull().default(0),
  mapping: text("mapping"), // JSON: { [fieldKey]: columnIndex }
  createdAt: text("created_at").notNull(),
});

// One committed spreadsheet import. Undo removes the transactional rows it created.
export const importBatches = pgTable(
  "import_batch",
  {
    id: id(),
    companyId: companyId(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    sheetName: text("sheet_name"),
    status: text("status").notNull(), // COMMITTED | UNDONE
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    toCode: integer("to_code").notNull().default(0), // rows that landed in Unassigned costs
    createdAt: text("created_at").notNull(),
    undoneAt: text("undone_at"),
  },
  (t) => [index("import_batch_company_created").on(t.companyId, t.createdAt)],
);

// The column mapping a company last used for each kind, by header name, reused on the next upload.
export const importMappings = pgTable(
  "import_mapping",
  {
    id: id(),
    companyId: companyId(),
    kind: text("kind").notNull(),
    mapping: text("mapping").notNull(), // JSON: { [fieldKey]: headerName }
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("import_mapping_company_kind").on(t.companyId, t.kind)],
);

// Overhead pool: expense accounts from QuickBooks' Profit and Loss, and their monthly amounts.
export const overheadAccounts = pgTable(
  "overhead_account",
  {
    id: id(),
    companyId: companyId(),
    qboAccountId: text("qbo_account_id").notNull(),
    name: text("name").notNull(),
    section: text("section").notNull(), // Expenses | OtherExpenses (as in the P&L)
    included: boolean("included"), // null = default (Expenses in, OtherExpenses out)
  },
  (t) => [uniqueIndex("overhead_account_company_qbo").on(t.companyId, t.qboAccountId)],
);

export const overheadMonths = pgTable(
  "overhead_month",
  {
    id: id(),
    companyId: companyId(),
    qboAccountId: text("qbo_account_id").notNull(),
    month: text("month").notNull(), // YYYY-MM
    amountCents: cents("amount_cents").notNull(),
  },
  (t) => [uniqueIndex("overhead_month_company_account_month").on(t.companyId, t.qboAccountId, t.month)],
);

// One row per QuickBooks import run: progress, outcome and counts for the settings page.
export const qboImportRuns = pgTable(
  "qbo_import_run",
  {
    id: id(),
    companyId: companyId(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(), // RUNNING | OK | ERROR
    since: text("since").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    summary: text("summary"), // JSON counts
    error: text("error"),
  },
  (t) => [index("qbo_import_run_company_started").on(t.companyId, t.startedAt)],
);

// Guided mode: steps a company marked done or skipped. period = "setup" for one-time steps, "YYYY-MM" for monthly ones.
export const guideMarks = pgTable(
  "guide_mark",
  {
    id: id(),
    companyId: companyId(),
    stepKey: text("step_key").notNull(),
    period: text("period").notNull(),
    status: text("status").notNull(), // DONE | SKIPPED
    userId: text("user_id").notNull(),
    at: text("at").notNull(),
  },
  (t) => [uniqueIndex("guide_mark_company_step_period").on(t.companyId, t.stepKey, t.period)],
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
  qboInvoices: many(qboInvoices),
  qboLinks: many(projectQboLinks),
  unitEvents: many(projectUnitEvents),
}));
export const projectQboLinkRelations = relations(projectQboLinks, ({ one }) => ({
  project: one(projects, { fields: [projectQboLinks.projectId], references: [projects.id] }),
}));
export const projectUnitEventRelations = relations(projectUnitEvents, ({ one }) => ({
  project: one(projects, { fields: [projectUnitEvents.projectId], references: [projects.id] }),
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
export const qboInvoiceRelations = relations(qboInvoices, ({ one }) => ({
  project: one(projects, { fields: [qboInvoices.projectId], references: [projects.id] }),
}));
