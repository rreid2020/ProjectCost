// Guided mode: the ProjectCost workflow from first setup through each month-end, as steps with checklists that tick
// themselves from the company's data. Pure: facts in, steps out (facts are gathered in guide-facts.ts).
// Instructions adapt to where the company's data comes from: QuickBooks, spreadsheets, or both.

export type GuideFacts = {
  period: string; // YYYY-MM, the month being closed
  periodLabel: string;
  provinceSet: boolean;
  sampleData: boolean;
  qboConfigured: boolean;
  qboConnected: boolean;
  connectionOk: boolean;
  memberCount: number | null; // null when it couldn't be read
  projectModeChosen: boolean;
  imported: boolean; // QuickBooks import has run
  lastImportOk: boolean;
  daysSinceImport: number | null; // QuickBooks
  sheetImports: number; // committed spreadsheet imports, any kind
  sheetCostImports: number; // committed cost / time spreadsheet imports
  daysSinceSheetCosts: number | null;
  glAccounts: number;
  accountsReviewed: boolean;
  entryAccountsMapped: boolean;
  costCodes: number;
  labourCodes: number;
  activeEmployees: number;
  employeesWithoutRate: number;
  employeesWithoutBurden: number;
  activeProjects: number;
  activeContracts: number;
  contractsWithoutValue: number;
  projectsWithoutBudget: number;
  balanceSheetProjects: number; // active capital / build-for-sale
  internalWithoutLinks: number;
  overheadPoolLoaded: boolean;
  overheadRateSet: boolean;
  unassignedCosts: number;
  pendingTime: number;
  pendingChangeOrders: number;
  contractsForecastThisMonth: number;
  contractsWithBudget: number;
  draftBills: number;
  wipSnapshotSaved: boolean;
};

export type GuideCheck = { label: string; done: boolean; detail?: string; action?: { label: string; href: string } };
type Text = string | ((f: GuideFacts) => string);
export type GuideStepDef = {
  key: string;
  group: "Set up" | "Projects" | "Monthly cycle" | "Outputs";
  title: Text;
  optional?: boolean;
  monthly?: boolean; // resets every month
  confirmable?: string; // label for a "mark done" confirmation when the data can't tell
  href: string | ((f: GuideFacts) => string);
  openLabel: Text;
  why: Text;
  how: (f: GuideFacts) => string[]; // **bold** marks UI names
  checks: (f: GuideFacts) => GuideCheck[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const QB = "**In QuickBooks:**", PC = "**In ProjectCost:**", SH = "**From a spreadsheet:**";
/** Which paths to describe: QuickBooks when connected; spreadsheets when used, or when nothing is connected yet. */
const via = (f: GuideFacts) => ({ qbo: f.qboConnected, sheets: f.sheetImports > 0 || !f.qboConnected });
const ago = (d: number | null) => (d == null ? "never" : d === 0 ? "today" : `${plural(d, "day")} ago`);

export const GUIDE_STEPS: GuideStepDef[] = [
  {
    key: "company", group: "Set up", title: "Company profile", href: "/settings", openLabel: "Open settings",
    why: "Region and province drive how sales tax is treated on purchases (recoverable in Canada, a cost in the US) and the defaults for holdback and tax on new contracts.",
    how: () => [`${PC} open **Settings**.`, "In **Company**, check the country, province, fiscal year-end, holdback % and sales tax %, then **Save**.", "If you started with sample data, click **Remove sample data** before bringing in your own."],
    checks: (f) => [
      { label: "Province or state is set", done: f.provinceSet, action: f.provinceSet ? undefined : { label: "Set it", href: "/settings" } },
      { label: "No sample data in this workspace", done: !f.sampleData, detail: f.sampleData ? "Sample projects are loaded" : undefined, action: f.sampleData ? { label: "Remove", href: "/settings" } : undefined },
    ],
  },
  {
    key: "connect", group: "Set up", title: "Connect your data", href: (f) => (f.qboConnected || f.sheetImports === 0 ? "/settings" : "/imports"), openLabel: "Open data sources",
    why: "ProjectCost works from your accounting data: connect QuickBooks Online, import spreadsheets (exports from Sage, Xero, a field time app, or your own workbook), or both. Nothing is written back.",
    how: () => [
      `**If you use QuickBooks Online:** on **Settings**, click **Connect to QuickBooks**, sign in to Intuit, choose the company, then **Test connection**.`,
      `**If you use spreadsheets:** open **Import data**. Download a template or upload your own export; you'll confirm how the columns match before anything is saved.`,
      "You can use both: for example QuickBooks for costs and a spreadsheet for budgets or field time.",
    ],
    checks: (f) => [{
      label: "A data source is set up", done: f.qboConnected || f.sheetImports > 0,
      detail: f.qboConnected ? `QuickBooks connected${f.connectionOk ? "" : " (not yet tested)"}${f.sheetImports ? ` · ${plural(f.sheetImports, "spreadsheet import")}` : ""}` : f.sheetImports ? plural(f.sheetImports, "spreadsheet import") : !f.qboConfigured ? "QuickBooks isn't available yet; spreadsheets work now" : undefined,
    }],
  },
  {
    key: "team", group: "Set up", title: "Invite your team", optional: true, href: "/team", openLabel: "Open team",
    why: "Project managers update forecasts and change orders; admins handle settings, imports, billing, cost codes and the month-end close.",
    how: () => [`${PC} open **Team** and invite people by email.`, "Make your controller or bookkeeper an **Admin**; project managers can be **Members**."],
    checks: (f) => [{ label: "At least one other person in the workspace", done: (f.memberCount ?? 0) > 1 }],
  },
  {
    key: "import", group: "Set up", title: "Bring in projects and costs", href: (f) => (f.qboConnected ? "/settings" : "/imports"), openLabel: "Open import",
    why: "Projects, costs, time and billing need to be in ProjectCost before anything can be measured. Re-running an import updates in place; it doesn't duplicate.",
    how: (f) => [
      ...(via(f).qbo ? [
        `${PC} create each project on **Projects** → **New project** (customer contract, capital project or build for sale). Projects aren't made from QuickBooks unless you choose that option at import.`,
        `**From QuickBooks:** on **Settings**, under **Import from QuickBooks**, click **Start import** (or **Sync now**). Costs and time come in; lines not linked to a project wait in **Unassigned costs** for you to assign. (Optional: have existing QuickBooks jobs or customers become projects too.)`,
      ] : []),
      ...(via(f).sheets ? [
        `${SH} on **Import data**, import in this order: **Projects** → **Cost codes** → **Budgets** → **Employees** → **Cost transactions** and **Time** → **Invoices billed**.`,
        "Each upload shows a preview with any problems by row; costs whose project or code doesn't match go to **Unassigned costs** instead of being lost.",
      ] : []),
    ],
    checks: (f) => [
      {
        label: "At least one active project", done: f.activeProjects > 0,
        detail: f.activeProjects ? plural(f.activeProjects, "active project") : "Create your projects in ProjectCost",
        action: f.activeProjects ? undefined : { label: "New project", href: "/projects/new" },
      },
      {
        label: "Costs brought in", done: (f.imported && f.lastImportOk) || f.sheetCostImports > 0,
        detail: f.imported && !f.lastImportOk ? "The last QuickBooks import failed: see the sync log" : undefined,
        action: (f.imported && f.lastImportOk) || f.sheetCostImports > 0 ? undefined : { label: f.qboConnected ? "Import" : "Import data", href: f.qboConnected ? "/settings" : "/imports" },
      },
    ],
  },
  {
    key: "accounts", group: "Set up", title: "Project-cost accounts", href: "/accounts", openLabel: "Open accounts",
    why: "Tells ProjectCost which GL accounts carry project costs even when a line has no project, and where capital and build-for-sale entries post.",
    how: (f) => [
      ...(via(f).qbo ? [`${QB} if you'll have capital or build-for-sale projects, create the accounts they need (**Chart of accounts → New**): construction in progress, inventory work in process and finished goods, cost of goods sold for units sold, and labour capitalized. Then **Sync now** on **Settings**.`] : []),
      ...(via(f).sheets ? [`${SH} import your **Chart of accounts** on **Import data** (code, name, type).`] : []),
      `${PC} open **Accounts**, tick every account that holds project costs (cost of goods sold, construction in progress, inventory work in process), choose the entry accounts at the top, and **Save**.`,
    ],
    checks: (f) => [
      { label: "Chart of accounts loaded", done: f.glAccounts > 0 },
      { label: "Project-cost accounts reviewed and saved", done: f.accountsReviewed },
      ...(f.balanceSheetProjects ? [{ label: "Entry accounts chosen for capital / build-for-sale", done: f.entryAccountsMapped, detail: f.entryAccountsMapped ? undefined : "Add them to your chart of accounts first if they don't exist" }] : []),
    ],
  },
  {
    key: "costcodes", group: "Set up", title: "Cost codes", href: "/cost-codes", openLabel: "Open cost codes", confirmable: "Cost types reviewed",
    why: "Budgets, actuals and forecasts are tracked by cost code. The cost type (labour, material, subcontract, equipment, other) drives the reports.",
    how: (f) => [
      ...(via(f).qbo ? ["**From QuickBooks:** products and services come in as codes on each sync, with a cost type guessed from the name."] : []),
      ...(via(f).sheets ? [`${SH} import **Cost codes** on **Import data**, or let a **Budgets** import add them as it goes.`] : []),
      `${PC} open **Cost codes**, check each code's **cost type** and fix any that are wrong; add others with **Add cost code**.`,
    ],
    checks: (f) => [
      { label: "Cost codes exist", done: f.costCodes > 0, detail: f.costCodes ? plural(f.costCodes, "code") : undefined },
      { label: "At least one labour code", done: f.labourCodes > 0 },
    ],
  },
  {
    key: "employees", group: "Set up", title: "Employees and labour rates", optional: true, href: "/employees", openLabel: "Open employees",
    why: "Labour cost is hours × pay rate × (1 + burden). Accounting systems don't carry these rates for job costing, so time costs $0 until they're set.",
    how: (f) => [
      ...(via(f).qbo ? [`${QB} add each person who works on projects (**Payroll → Employees → Add employee**; display name and billing rate are enough), then **Sync now** on **Settings**.`] : []),
      ...(via(f).sheets ? [`${SH} import **Employees & rates** on **Import data** (name, trade, pay rate, burden %, bill rate), or let a **Time** import add people as it goes.`] : []),
      `${PC} on **Employees**, enter each person's **trade**, **pay rate**, **burden %** (CPP, EI, WSIB, EHT, benefits) and **bill rate**, then **Save**. Time already imported at $0 picks up the rate.`,
      "Subcontractors aren't employees: their cost comes in on their bills.",
    ],
    checks: (f) => [
      {
        label: "Employees in ProjectCost", done: f.activeEmployees > 0,
        detail: f.activeEmployees ? plural(f.activeEmployees, "active employee") : f.qboConnected ? "None yet: add them in QuickBooks and sync, or import a spreadsheet" : "None yet: import a spreadsheet",
        action: f.activeEmployees ? undefined : { label: f.qboConnected ? "Sync now" : "Import", href: f.qboConnected ? "/settings" : "/imports" },
      },
      { label: "Every active employee has a pay rate", done: f.activeEmployees > 0 && f.employeesWithoutRate === 0, detail: f.employeesWithoutRate ? `${plural(f.employeesWithoutRate, "employee")} without one` : undefined },
      { label: "Burden set", done: f.activeEmployees > 0 && f.employeesWithoutBurden === 0, detail: f.employeesWithoutBurden ? `${plural(f.employeesWithoutBurden, "employee")} at 0%` : undefined },
    ],
  },
  {
    key: "projects", group: "Projects", title: "Set up projects", href: "/projects", openLabel: "Open projects",
    why: "Projects need a contract value and a budget before % complete and profit mean anything. Capital and build-for-sale projects need to know where their costs come from.",
    how: (f) => [
      ...(via(f).qbo ? ["**From QuickBooks:** customer contracts come from customers or sub-customer jobs on each sync."] : []),
      ...(via(f).sheets ? [`${SH} a **Projects** import can carry contract value, dates, holdback and tax; a **Budgets** import fills the budget by cost code.`] : []),
      `${PC} or set it by hand: on each project's **Setup** tab enter the **contract value**; on **Budget**, the original budget by cost code. **New project** creates capital or build-for-sale work.`,
      ...(via(f).qbo ? ["For capital or build-for-sale projects tracked in QuickBooks by class, location or account, link it on the project's **Setup** tab."] : []),
      ...(via(f).sheets ? ["Spreadsheet rows find their project by **project number**, so keep numbers the same in every file."] : []),
    ],
    checks: (f) => [
      { label: "Active projects exist", done: f.activeProjects > 0, detail: f.activeProjects ? plural(f.activeProjects, "active project") : undefined },
      { label: "Every active contract has a contract value", done: f.activeContracts > 0 && f.contractsWithoutValue === 0, detail: f.contractsWithoutValue ? `${plural(f.contractsWithoutValue, "contract")} at $0` : undefined },
      { label: "Every active project has a budget", done: f.activeProjects > 0 && f.projectsWithoutBudget === 0, detail: f.projectsWithoutBudget ? `${plural(f.projectsWithoutBudget, "project")} without one` : undefined },
      ...(f.balanceSheetProjects && f.qboConnected ? [{ label: "Capital / build-for-sale projects are linked to QuickBooks", done: f.internalWithoutLinks === 0, detail: f.internalWithoutLinks ? `${f.internalWithoutLinks} not linked (fine if their costs come from spreadsheets)` : undefined }] : []),
    ],
  },
  {
    key: "overhead", group: "Projects", title: "Overhead rate", optional: true, href: "/overhead", openLabel: "Open overhead", confirmable: "Pool accounts reviewed",
    why: "Shows profit after overhead on each contract, using a rate built from your Profit and Loss. A management view only: it never changes WIP.",
    how: (f) => [
      ...(via(f).qbo ? ["**From QuickBooks:** the Profit and Loss for the last 12 months comes in on each sync."] : []),
      ...(via(f).sheets ? [`${SH} import **Profit & Loss by month** on **Import data** (expense accounts; one column per month is fine).`] : []),
      `${PC} on **Overhead**, choose the **base** (% of labour cost, per labour hour, or % of direct cost), untick accounts that aren't overhead, or enter your own rate, then **Save**.`,
    ],
    checks: (f) => [
      { label: "Profit and Loss loaded", done: f.overheadPoolLoaded },
      { label: "A rate is available", done: f.overheadRateSet },
    ],
  },
  {
    key: "sync", group: "Monthly cycle", title: "Bring in the month's costs", monthly: true, href: (f) => (f.qboConnected ? "/settings" : "/imports"), openLabel: (f) => (f.qboConnected ? "Open settings" : "Open import"),
    why: "Brings in the month's bills, expenses, time and invoices. Coding you've done in ProjectCost is kept.",
    how: (f) => [
      ...(via(f).qbo ? [`${QB} finish entering the month's bills, expenses, time and invoices, then click **Sync now** on **Settings**.`] : []),
      ...(via(f).sheets ? [`${SH} export the month's costs and time from your system and upload them on **Import data**. Re-uploading lines you already imported updates them instead of adding duplicates.`] : []),
    ],
    checks: (f) => [{
      label: "Costs brought in within the last 7 days",
      done: (f.daysSinceImport != null && f.daysSinceImport <= 7) || (f.daysSinceSheetCosts != null && f.daysSinceSheetCosts <= 7),
      detail: [f.qboConnected ? `QuickBooks sync ${ago(f.daysSinceImport)}` : null, f.sheetCostImports || !f.qboConnected ? `spreadsheet costs ${ago(f.daysSinceSheetCosts)}` : null].filter(Boolean).join(" · "),
    }],
  },
  {
    key: "coding", group: "Monthly cycle", title: "Code unassigned costs", monthly: true, href: "/costs", openLabel: "Open unassigned costs",
    why: "Costs without a project or cost code don't reach any job's budget. Leaving them uncoded makes jobs look better than they are.",
    how: (f) => [
      `${PC} open **Unassigned costs**; for each line pick the **project** and **cost code**, then **Assign**. What the source said (customer, class or project) is shown for context.`,
      ...(via(f).qbo ? ["Better at the source: a QuickBooks line with the customer (or class) and a product/service codes itself on the next sync."] : []),
      ...(via(f).sheets ? ["Better at the source: spreadsheet rows with a valid project number and cost code are coded on import."] : []),
    ],
    checks: (f) => [{ label: "Nothing waiting to be coded", done: f.unassignedCosts === 0, detail: f.unassignedCosts ? `${plural(f.unassignedCosts, "line")} waiting` : undefined }],
  },
  {
    key: "time", group: "Monthly cycle", title: "Approve timesheets", monthly: true, href: "/time", openLabel: "Open timesheets",
    why: "Only approved time becomes job cost, at burdened rates.",
    how: (f) => [
      ...(via(f).qbo ? ["Time entered in QuickBooks arrives already approved when you sync."] : []),
      ...(via(f).sheets ? ["Time imported from a spreadsheet (e.g. QuickBooks Time, ClockShark or Procore exports) arrives already approved."] : []),
      `${PC} time logged on **Timesheets → Log time** waits for approval: review it and click **Approve selected**.`,
    ],
    checks: (f) => [{ label: "No time waiting for approval", done: f.pendingTime === 0, detail: f.pendingTime ? `${plural(f.pendingTime, "entry", "entries")} waiting` : undefined }],
  },
  {
    key: "changes", group: "Monthly cycle", title: "Change orders", monthly: true, href: "/projects", openLabel: "Open projects", confirmable: "New changes logged",
    why: "Approved change orders move the contract value, cost budget and billing schedule together. Pending ones show what's at risk.",
    how: (f) => [
      `${PC} on each project's **Change orders** tab, log new changes and **Approve** or **Reject** pending ones.`,
      ...(via(f).sheets ? [`${SH} or import a **Change orders** log on **Import data**; approved ones become billable automatically.`] : []),
    ],
    checks: (f) => [{ label: "No change orders left pending", done: f.pendingChangeOrders === 0, detail: f.pendingChangeOrders ? `${plural(f.pendingChangeOrders, "pending change order")}` : undefined }],
  },
  {
    key: "forecast", group: "Monthly cycle", title: "Update estimates to complete", monthly: true, href: "/projects", openLabel: "Open projects", confirmable: "Estimates reviewed with the project managers",
    why: "Percentage of completion is cost to date ÷ estimated total cost. A stale estimate to complete misstates earned revenue, over/under billings and fade.",
    how: () => [`${PC} for each active contract, open the **Budget** tab.`, "Enter the **Est. to complete** for any cost code where the remaining budget isn't right; leave blank to use the remaining budget."],
    checks: (f) => [{ label: "Estimates updated this month", done: f.contractsWithBudget > 0 && f.contractsForecastThisMonth >= f.contractsWithBudget, detail: `${f.contractsForecastThisMonth} of ${plural(f.contractsWithBudget, "budgeted contract")} updated in ${f.periodLabel}` }],
  },
  {
    key: "billing", group: "Monthly cycle", title: "Progress billing", monthly: true, href: "/projects", openLabel: "Open projects", confirmable: "This month's billing is done",
    why: "Bills against the schedule of values, with holdback retained and tax on the net amount.",
    how: (f) => [
      `${PC} on each contract's **Progress billing** tab, enter this period's amounts, create the bill, review it, and **Post**.`,
      "Then create the invoice in your accounting system (ProjectCost doesn't send it there yet) and enter its number on the posted bill, so a synced or imported copy isn't counted twice.",
      ...(via(f).sheets ? [`${SH} if you bill outside ProjectCost, import **Invoices billed** instead; they count toward billed to date.`] : []),
    ],
    checks: (f) => [{ label: "No draft bills left", done: f.draftBills === 0, detail: f.draftBills ? `${plural(f.draftBills, "draft")}` : undefined }],
  },
  {
    key: "close", group: "Monthly cycle", title: "Close the month", monthly: true, href: "/wip", openLabel: "Open WIP & month-end",
    confirmable: "Entries booked in the general ledger",
    why: "Freezes the WIP schedule for the period and gives you the entries to book: the WIP adjustment, labour burden, and capital / build-for-sale entries.",
    how: (f) => [
      `${PC} open **WIP & month-end** and review the schedule and the drafted entries.`,
      f.qboConnected
        ? `${QB} book each entry as a journal entry (**+ New → Journal entry**) with the memo shown. The **[ProjectCost]** tag stops it being imported twice.`
        : "Book each entry as a journal entry in your accounting system, with the memo shown.",
      `${PC} click **Save WIP snapshot** for the period.`,
    ],
    checks: (f) => [{ label: `WIP snapshot saved for ${f.periodLabel}`, done: f.wipSnapshotSaved }],
  },
  {
    key: "review", group: "Outputs", title: "Review and share", monthly: true, href: "/dashboard", openLabel: "Open dashboard", confirmable: "Reviewed and shared",
    why: "The dashboard flags projects that need attention; the WIP schedule is in surety format for your bank, bonding company and auditor.",
    how: () => [`${PC} review the **Dashboard** for fade, projected losses and underbilling.`, "Share the **WIP schedule** and profit after overhead with the owners, and file the snapshot with your month-end."],
    checks: () => [],
  },
];

export type Mark = { stepKey: string; period: string; status: "DONE" | "SKIPPED" };
export type GuideStep = Omit<GuideStepDef, "checks" | "how" | "title" | "href" | "openLabel" | "why"> & {
  title: string; href: string; openLabel: string; why: string; how: string[];
  number: number;
  checks: GuideCheck[];
  status: "todo" | "partial" | "done" | "skipped";
  marked: Mark["status"] | null;
  period: string;
  doneCount: number;
  totalCount: number;
};

const text = (t: Text | ((f: GuideFacts) => string), f: GuideFacts) => (typeof t === "function" ? t(f) : t);

/** Steps with their checklists and status. A step is done when every check passes or someone marked it done; optional and monthly steps can be skipped. */
export function buildGuide(f: GuideFacts, marks: Mark[]): { steps: GuideStep[]; done: number; total: number } {
  const steps = GUIDE_STEPS.map((def, i): GuideStep => {
    const period = def.monthly ? f.period : "setup";
    const marked = marks.find((m) => m.stepKey === def.key && m.period === period)?.status ?? null;
    const checks = def.checks(f);
    const doneCount = checks.filter((c) => c.done).length + (def.confirmable && marked === "DONE" ? 1 : 0);
    const totalCount = checks.length + (def.confirmable ? 1 : 0);
    const allChecks = checks.every((c) => c.done);
    const status: GuideStep["status"] =
      marked === "SKIPPED" ? "skipped"
      : (allChecks && (!def.confirmable || marked === "DONE")) || (marked === "DONE" && !def.confirmable) ? "done"
      : doneCount > 0 ? "partial" : "todo";
    return {
      key: def.key, group: def.group, optional: def.optional, monthly: def.monthly, confirmable: def.confirmable,
      title: text(def.title, f), href: text(def.href, f), openLabel: text(def.openLabel, f), why: text(def.why, f), how: def.how(f),
      number: i + 1, checks, status, marked, period, doneCount, totalCount,
    };
  });
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return { steps, done, total: steps.length };
}
