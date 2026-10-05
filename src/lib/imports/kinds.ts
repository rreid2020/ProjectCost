// What can be imported from a spreadsheet, the fields each kind has, and the column names each field recognizes
// (generic templates, Sage 50 / Sage 300, Xero, QuickBooks Time / TSheets, ClockShark, Procore).

export type FieldType = "text" | "date" | "month" | "money" | "percent" | "hours" | "int" | "yesno" | "costType" | "projectType" | "accountType" | "status";
export type Field = { key: string; label: string; type: FieldType; required?: boolean; aliases: string[]; help?: string };
export type ImportKind = {
  key: string;
  label: string;
  group: "Projects" | "Costs & time" | "Billing & accounts";
  description: string;
  fields: Field[];
  /** At least one field of each group must be mapped (e.g. amount, or debit/credit). */
  oneOf?: string[][];
  /** Undo removes the rows the batch created. Master data (projects, codes, employees, accounts, P&L) isn't undone. */
  undoable: boolean;
  matchNote: string;
  example: Record<string, string>[];
};

const PROJECT_ALIASES = ["project", "project number", "project no", "project #", "project id", "project code", "job", "job number", "job no", "job #", "job id", "jobcode", "job code", "project/job", "customer:job", "tracking option", "tracking option 1", "trackingoption1", "trackingoption", "tracking category 1"];
const CODE_ALIASES = ["cost code", "costcode", "cost code number", "code", "phase", "phase code", "task", "activity", "cost category", "category", "item", "product/service", "service item", "trackingoption2", "tracking option 2"];
const DATE_ALIASES = ["date", "transaction date", "txn date", "invoice date", "invoicedate", "posting date", "document date", "entry date", "local_date", "work date", "day"];

export const IMPORT_KINDS: ImportKind[] = [
  {
    key: "projects", label: "Projects", group: "Projects", undoable: false,
    description: "Project list: number, name, type, customer, contract value, dates, holdback and tax. Updates projects that already exist.",
    matchNote: "Matched by project number. New numbers create projects; existing ones are updated with the columns you provide.",
    fields: [
      { key: "number", label: "Project number", type: "text", required: true, aliases: ["project number", "project no", "project #", "project id", "project code", "job", "job number", "job no", "job #", "job id", "jobcode", "number", "project"] },
      { key: "name", label: "Project name", type: "text", required: true, aliases: ["project name", "job name", "name", "title", "description", "job description"] },
      { key: "type", label: "Type", type: "projectType", aliases: ["type", "project type", "kind"], help: "Contract, capital, or build for sale. Blank = contract." },
      { key: "customer", label: "Customer", type: "text", aliases: ["customer", "customer name", "client", "client name", "owner", "contact", "contactname"], help: "Required for customer contracts. New names are added." },
      { key: "status", label: "Status", type: "status", aliases: ["status", "job status", "project status"] },
      { key: "contract", label: "Contract value", type: "money", aliases: ["contract", "contract value", "contract amount", "original contract", "contract sum", "contract price", "revenue", "budgeted revenue"] },
      { key: "start", label: "Start date", type: "date", aliases: ["start", "start date", "begin date", "date started"] },
      { key: "end", label: "End date", type: "date", aliases: ["end", "end date", "completion date", "finish", "finish date", "estimated completion"] },
      { key: "pm", label: "Project manager", type: "text", aliases: ["project manager", "pm", "manager", "supervisor"] },
      { key: "holdback", label: "Holdback %", type: "percent", aliases: ["holdback", "holdback %", "holdback percent", "retainage", "retainage %", "retention", "retention %"] },
      { key: "tax", label: "Sales tax %", type: "percent", aliases: ["tax", "tax %", "sales tax", "sales tax %", "tax rate"] },
      { key: "units", label: "Units (build for sale)", type: "int", aliases: ["units", "units planned", "number of units", "qty", "quantity"] },
    ],
    example: [
      { number: "2401", name: "Riverside Medical Office", type: "Contract", customer: "Beacon Construction", status: "Active", contract: "2450000", start: "2026-01-12", end: "2026-12-18", pm: "Dana Kowalski", holdback: "10", tax: "13", units: "" },
      { number: "CAP-1", name: "Shop expansion", type: "Capital", customer: "", status: "Active", contract: "", start: "2026-04-01", end: "2026-11-30", pm: "", holdback: "", tax: "", units: "" },
      { number: "SPEC-12", name: "Spec home, Lot 12", type: "Build for sale", customer: "", status: "Active", contract: "", start: "2026-03-01", end: "", pm: "", holdback: "", tax: "", units: "1" },
    ],
  },
  {
    key: "budgets", label: "Budgets", group: "Projects", undoable: true,
    description: "Original budget by project and cost code. Replaces the budget for each project and code in the file.",
    matchNote: "Matched by project number and cost code. Unknown codes are added when a code name is given.",
    fields: [
      { key: "project", label: "Project number", type: "text", required: true, aliases: PROJECT_ALIASES },
      { key: "code", label: "Cost code", type: "text", required: true, aliases: CODE_ALIASES },
      { key: "codeName", label: "Cost code name", type: "text", aliases: ["cost code name", "code name", "code description", "phase description", "task name", "description"] },
      { key: "costType", label: "Cost type", type: "costType", aliases: ["cost type", "type", "cost category type", "category type"] },
      { key: "amount", label: "Budget amount", type: "money", required: true, aliases: ["budget", "budget amount", "original budget", "amount", "estimate", "estimated cost", "estimated amount", "cost budget", "budgeted cost", "revised budget"] },
    ],
    example: [
      { project: "2401", code: "22-100", codeName: "Plumbing labour", costType: "Labour", amount: "260000" },
      { project: "2401", code: "22-200", codeName: "Plumbing materials", costType: "Material", amount: "241000" },
    ],
  },
  {
    key: "costcodes", label: "Cost codes", group: "Projects", undoable: false,
    description: "Your cost-code library: code, name and cost type.",
    matchNote: "Matched by code. Existing codes are updated.",
    fields: [
      { key: "code", label: "Code", type: "text", required: true, aliases: ["code", "cost code", "costcode", "phase", "phase code", "task code", "activity code", "number"] },
      { key: "name", label: "Name", type: "text", required: true, aliases: ["name", "description", "cost code name", "code name", "phase description", "title"] },
      { key: "costType", label: "Cost type", type: "costType", aliases: ["cost type", "type", "category", "cost category"] },
      { key: "active", label: "Active", type: "yesno", aliases: ["active", "status", "inactive?"] },
    ],
    example: [{ code: "23-100", name: "HVAC labour", costType: "Labour", active: "Yes" }, { code: "23-300", name: "Sheet metal (sub)", costType: "Subcontract", active: "Yes" }],
  },
  {
    key: "costs", label: "Cost transactions", group: "Costs & time", undoable: true,
    description: "Bills, expenses, cheques and journal lines from any accounting system. Lines without a known project or cost code go to Unassigned costs.",
    matchNote: "Re-importing the same lines updates them instead of adding duplicates (by the ID column if you have one, otherwise by the line's contents).",
    oneOf: [["amount", "debit", "credit"]],
    fields: [
      { key: "date", label: "Date", type: "date", required: true, aliases: DATE_ALIASES },
      { key: "amount", label: "Amount (before tax)", type: "money", aliases: ["amount", "net", "net amount", "line amount", "lineamount", "subtotal", "cost", "extended amount", "extended cost", "total cost", "amount cad", "amount (cad)", "value"] },
      { key: "debit", label: "Debit", type: "money", aliases: ["debit", "debits", "dr", "debit amount"] },
      { key: "credit", label: "Credit", type: "money", aliases: ["credit", "credits", "cr", "credit amount"] },
      { key: "tax", label: "Sales tax", type: "money", aliases: ["tax", "tax amount", "taxamount", "gst", "hst", "gst/hst", "gst hst", "vat", "sales tax"] },
      { key: "project", label: "Project", type: "text", aliases: PROJECT_ALIASES },
      { key: "code", label: "Cost code", type: "text", aliases: CODE_ALIASES },
      { key: "vendor", label: "Vendor", type: "text", aliases: ["vendor", "vendor name", "supplier", "supplier name", "payee", "contact", "contactname", "contact name", "name"] },
      { key: "description", label: "Description", type: "text", aliases: ["description", "memo", "comment", "comments", "details", "line description", "particulars"] },
      { key: "reference", label: "Reference / document #", type: "text", aliases: ["reference", "ref", "doc number", "document number", "document no", "invoice number", "invoicenumber", "invoice #", "bill number", "bill #", "cheque number", "check number", "num", "no", "number"] },
      { key: "sourceType", label: "Transaction type", type: "text", aliases: ["type", "transaction type", "source type", "txn type", "source", "source code", "journal"] },
      { key: "account", label: "GL account", type: "text", aliases: ["account", "account code", "accountcode", "gl account", "account number", "account name", "account no", "acct"] },
      { key: "externalId", label: "Line ID (optional)", type: "text", aliases: ["id", "line id", "transaction id", "unique id", "external id", "entry id"], help: "A unique ID per line from your system makes re-imports exact." },
    ],
    example: [
      { date: "2026-09-12", amount: "18940.00", debit: "", credit: "", tax: "2462.20", project: "2401", code: "23-200", vendor: "Engineered Air", description: "Make-up air unit MAU-1", reference: "EA-55120", sourceType: "Bill", account: "5100", externalId: "" },
      { date: "2026-09-15", amount: "612.40", debit: "", credit: "", tax: "79.61", project: "", code: "", vendor: "Home Depot Pro", description: "Consumables", reference: "HD-8812", sourceType: "Expense", account: "5100", externalId: "" },
    ],
  },
  {
    key: "time", label: "Time", group: "Costs & time", undoable: true,
    description: "Hours by employee, project and cost code, e.g. from QuickBooks Time, ClockShark or Procore. Imported as approved; labour cost uses each employee's rates.",
    matchNote: "Employees are matched by name (new names are added; set their rates on Employees). Re-importing updates entries instead of duplicating them.",
    oneOf: [["employee", "firstName"]],
    fields: [
      { key: "date", label: "Date", type: "date", required: true, aliases: DATE_ALIASES },
      { key: "employee", label: "Employee", type: "text", aliases: ["employee", "employee name", "worker", "name", "full name", "staff", "user", "username", "team member"] },
      { key: "firstName", label: "First name", type: "text", aliases: ["fname", "first name", "firstname", "first", "given name"] },
      { key: "lastName", label: "Last name", type: "text", aliases: ["lname", "last name", "lastname", "last", "surname", "family name"] },
      { key: "hours", label: "Hours", type: "hours", required: true, aliases: ["hours", "total hours", "duration", "regular", "regular hours", "reg hours", "reg", "qty", "quantity", "time"] },
      { key: "overtime", label: "Overtime hours", type: "hours", aliases: ["overtime", "ot", "overtime hours", "ot hours", "double time"] },
      { key: "project", label: "Project", type: "text", required: true, aliases: [...PROJECT_ALIASES, "customer", "project name", "job name"] },
      { key: "code", label: "Cost code", type: "text", aliases: CODE_ALIASES },
      { key: "notes", label: "Notes", type: "text", aliases: ["notes", "note", "description", "comments", "comment", "memo"] },
      { key: "payRate", label: "Pay rate (optional)", type: "money", aliases: ["pay rate", "wage", "hourly wage", "cost rate"], help: "Overrides the employee's rate for this entry." },
      { key: "externalId", label: "Entry ID (optional)", type: "text", aliases: ["id", "timesheet id", "entry id", "time id", "timecard id"] },
    ],
    example: [{ date: "2026-09-22", employee: "Marco Silva", firstName: "", lastName: "", hours: "8", overtime: "", project: "2401", code: "22-100", notes: "Level 3 rough-in", payRate: "", externalId: "" }],
  },
  {
    key: "employees", label: "Employees & rates", group: "Costs & time", undoable: false,
    description: "Employees with trade, pay rate, burden and bill rate. Time already imported at $0 picks up the new rate.",
    matchNote: "Matched by name. New names are added; existing employees get the columns you provide.",
    oneOf: [["name", "firstName"]],
    fields: [
      { key: "name", label: "Name", type: "text", aliases: ["name", "employee", "employee name", "full name", "worker", "display name"] },
      { key: "firstName", label: "First name", type: "text", aliases: ["first name", "firstname", "fname", "given name"] },
      { key: "lastName", label: "Last name", type: "text", aliases: ["last name", "lastname", "lname", "surname"] },
      { key: "trade", label: "Trade", type: "text", aliases: ["trade", "job title", "position", "role", "classification", "occupation"] },
      { key: "payRate", label: "Pay rate /h", type: "money", aliases: ["pay rate", "wage", "hourly wage", "cost rate", "rate", "hourly rate"] },
      { key: "burden", label: "Burden %", type: "percent", aliases: ["burden", "burden %", "burden rate", "labour burden", "labor burden", "payroll burden"] },
      { key: "billRate", label: "Bill rate /h", type: "money", aliases: ["bill rate", "billing rate", "charge rate", "billable rate", "charge out rate"] },
      { key: "active", label: "Active", type: "yesno", aliases: ["active", "status"] },
    ],
    example: [{ name: "Marco Silva", firstName: "", lastName: "", trade: "Foreman, plumbing", payRate: "48.50", burden: "30.5", billRate: "110", active: "Yes" }],
  },
  {
    key: "invoices", label: "Invoices billed", group: "Billing & accounts", undoable: true,
    description: "Invoices and credit notes raised outside ProjectCost. They count toward each project's billed to date.",
    matchNote: "Matched by invoice number; re-importing updates the invoice.",
    oneOf: [["amount", "total"]],
    fields: [
      { key: "date", label: "Date", type: "date", required: true, aliases: DATE_ALIASES },
      { key: "project", label: "Project", type: "text", required: true, aliases: [...PROJECT_ALIASES, "customer"] },
      { key: "invoiceNumber", label: "Invoice number", type: "text", aliases: ["invoice number", "invoicenumber", "invoice #", "invoice no", "number", "doc number", "document number", "reference", "ref"] },
      { key: "amount", label: "Amount before tax", type: "money", aliases: ["amount", "subtotal", "net", "net amount", "amount before tax", "total excluding tax", "pre-tax", "line amount"] },
      { key: "total", label: "Total incl. tax", type: "money", aliases: ["total", "gross", "total amount", "amount including tax", "total including tax", "invoice total"] },
      { key: "tax", label: "Tax", type: "money", aliases: ["tax", "tax amount", "taxtotal", "gst", "hst", "gst/hst", "vat"] },
      { key: "type", label: "Type", type: "text", aliases: ["type", "document type", "invoice type", "transaction type"], help: "Rows containing \"credit\" are credit notes." },
    ],
    example: [{ date: "2026-08-31", project: "2401", invoiceNumber: "1042", amount: "185000", total: "", tax: "", type: "Invoice" }],
  },
  {
    key: "changeorders", label: "Change orders", group: "Billing & accounts", undoable: true,
    description: "Change orders with their contract amount and, optionally, cost by code (one row per cost code).",
    matchNote: "Matched by project and change-order number. Approved change orders get a schedule-of-values line, as when approved in ProjectCost.",
    fields: [
      { key: "project", label: "Project number", type: "text", required: true, aliases: PROJECT_ALIASES },
      { key: "number", label: "CO number", type: "int", aliases: ["change order", "change order number", "co", "co number", "co #", "co no", "number", "pco", "cor"] },
      { key: "title", label: "Title", type: "text", required: true, aliases: ["title", "description", "name", "change order title", "scope"] },
      { key: "status", label: "Status", type: "status", aliases: ["status", "approval status", "state"] },
      { key: "amount", label: "Contract amount", type: "money", aliases: ["amount", "contract amount", "revenue", "value", "price", "change amount", "co amount"] },
      { key: "date", label: "Date issued", type: "date", aliases: ["date", "date issued", "issued", "submitted", "created"] },
      { key: "code", label: "Cost code", type: "text", aliases: CODE_ALIASES },
      { key: "cost", label: "Cost", type: "money", aliases: ["cost", "cost amount", "budget", "cost budget", "estimated cost"] },
    ],
    example: [{ project: "2401", number: "3", title: "Medical gas outlets relocation", status: "Pending", amount: "18200", date: "2026-09-10", code: "22-100", cost: "6500" }],
  },
  {
    key: "accounts", label: "Chart of accounts", group: "Billing & accounts", undoable: false,
    description: "GL accounts with their type, so costs can be matched to accounts and entries can name them.",
    matchNote: "Matched by account code (or name). Existing accounts are updated.",
    fields: [
      { key: "code", label: "Account code", type: "text", aliases: ["account code", "code", "number", "account number", "account no", "acct", "*code", "acct no"] },
      { key: "name", label: "Account name", type: "text", required: true, aliases: ["account name", "name", "account", "description", "*name"] },
      { key: "type", label: "Account type", type: "accountType", required: true, aliases: ["type", "account type", "class", "category", "report code", "*type", "account class", "group"] },
      { key: "projectCost", label: "Project cost (Y/N)", type: "yesno", aliases: ["project cost", "job cost", "project-cost", "jobcost"] },
    ],
    example: [{ code: "5100", name: "Job materials", type: "Cost of goods sold", projectCost: "Yes" }, { code: "1560", name: "Construction in progress", type: "Fixed asset", projectCost: "Yes" }],
  },
  {
    key: "pnl", label: "Profit & Loss by month", group: "Billing & accounts", undoable: false,
    description: "Expense accounts by month for the overhead pool. Either one row per account with a column per month, or one row per account and month.",
    matchNote: "Replaces the months in the file for each account. Only expense accounts belong here.",
    fields: [
      { key: "account", label: "Account", type: "text", required: true, aliases: ["account", "account name", "account code", "gl account", "description", "name"] },
      { key: "month", label: "Month (one row per month)", type: "month", aliases: ["month", "period", "fiscal period", "date"] },
      { key: "amount", label: "Amount (one row per month)", type: "money", aliases: ["amount", "net", "balance", "total", "actual", "net change"] },
      { key: "section", label: "Section", type: "text", aliases: ["section", "type", "account type", "category", "group"], help: "\"Other expense\" rows start outside the pool." },
    ],
    example: [{ account: "Rent", month: "2026-08", amount: "1250", section: "Expenses" }, { account: "Insurance", month: "2026-08", amount: "750", section: "Expenses" }],
  },
];

export const importKind = (key: string) => IMPORT_KINDS.find((k) => k.key === key);
