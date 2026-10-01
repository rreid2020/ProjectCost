// Guided mode: the ProjectCost workflow from first setup through each month-end, as steps with checklists that tick
// themselves from the company's data. Pure: facts in, steps out (facts are gathered in guide-facts.ts).

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
  imported: boolean;
  lastImportOk: boolean;
  daysSinceImport: number | null;
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
export type GuideStepDef = {
  key: string;
  group: "Set up" | "Projects" | "Monthly cycle" | "Outputs";
  title: string;
  optional?: boolean;
  monthly?: boolean; // resets every month
  confirmable?: string; // label for a "mark done" confirmation when the data can't tell
  href: string;
  openLabel: string;
  why: string;
  how: string[]; // **bold** marks UI names
  checks: (f: GuideFacts) => GuideCheck[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const GUIDE_STEPS: GuideStepDef[] = [
  {
    key: "company", group: "Set up", title: "Company profile", href: "/settings", openLabel: "Open settings",
    why: "Region and province drive how sales tax is treated on purchases (recoverable in Canada, a cost in the US) and the defaults for holdback and tax on new contracts.",
    how: ["**In ProjectCost:** open **QuickBooks & settings**.", "In **Company**, check the country, province, fiscal year-end, holdback % and sales tax %, then **Save**.", "If you started with sample data, click **Remove sample data** before importing your own books."],
    checks: (f) => [
      { label: "Province or state is set", done: f.provinceSet, action: f.provinceSet ? undefined : { label: "Set it", href: "/settings" } },
      { label: "No sample data in this workspace", done: !f.sampleData, detail: f.sampleData ? "Sample projects are loaded" : undefined, action: f.sampleData ? { label: "Remove", href: "/settings" } : undefined },
    ],
  },
  {
    key: "connect", group: "Set up", title: "Connect QuickBooks", href: "/settings", openLabel: "Open settings",
    why: "ProjectCost reads your projects, costs, time and invoices from your own QuickBooks Online file. Nothing is written back.",
    how: ["**In ProjectCost:** open **QuickBooks & settings** and click **Connect to QuickBooks**.", "Sign in to Intuit and choose the company to connect.", "Back in ProjectCost, click **Test connection** to confirm."],
    checks: (f) => [
      { label: "QuickBooks is connected", done: f.qboConnected, detail: !f.qboConfigured ? "The connection isn't available yet: ask your administrator" : undefined },
      { label: "Connection tested", done: f.connectionOk },
    ],
  },
  {
    key: "team", group: "Set up", title: "Invite your team", optional: true, href: "/team", openLabel: "Open team",
    why: "Project managers update forecasts and change orders; admins handle settings, billing, cost codes and the month-end close.",
    how: ["**In ProjectCost:** open **Team** and invite people by email.", "Make your controller or bookkeeper an **Admin**; project managers can be **Members**."],
    checks: (f) => [{ label: "At least one other person in the workspace", done: (f.memberCount ?? 0) > 1 }],
  },
  {
    key: "import", group: "Set up", title: "First import from QuickBooks", href: "/settings", openLabel: "Open import",
    why: "Brings in customers, jobs, vendors, employees, items as cost codes, and 24 months of costs, time and invoices. You can run it again at any time; it updates in place.",
    how: ["**In ProjectCost:** on **QuickBooks & settings**, find **Import from QuickBooks**.", "Choose how you track jobs in QuickBooks: **sub-customers or Projects**, or **each customer is a job**.", "Click **Start import** and review the summary."],
    checks: (f) => [
      { label: "Chose how jobs are tracked in QuickBooks", done: f.projectModeChosen },
      { label: "Import finished", done: f.imported && f.lastImportOk, detail: f.imported && !f.lastImportOk ? "The last run failed: see the sync log" : undefined },
    ],
  },
  {
    key: "accounts", group: "Set up", title: "Project-cost accounts", href: "/accounts", openLabel: "Open accounts",
    why: "Tells ProjectCost which GL accounts carry project costs even when a line has no customer, and where capital and build-for-sale entries post.",
    how: [
      "**In QuickBooks:** if you'll have capital or build-for-sale projects, create the accounts they need (**Chart of accounts → New**): construction in progress, inventory work in process and finished goods, cost of goods sold for units sold, and labour capitalized.",
      "**In ProjectCost:** click **Sync now** on **QuickBooks & settings** so new accounts come in.",
      "Open **Accounts**, tick every account that holds project costs (cost of goods sold, construction in progress, inventory work in process), choose the entry accounts at the top, and **Save**.",
    ],
    checks: (f) => [
      { label: "Chart of accounts loaded", done: f.glAccounts > 0 },
      { label: "Project-cost accounts reviewed and saved", done: f.accountsReviewed },
      ...(f.balanceSheetProjects ? [{ label: "Entry accounts chosen for capital / build-for-sale", done: f.entryAccountsMapped, detail: f.entryAccountsMapped ? undefined : "Create them in QuickBooks first if they don't exist, then sync" }] : []),
    ],
  },
  {
    key: "costcodes", group: "Set up", title: "Cost codes", href: "/cost-codes", openLabel: "Open cost codes", confirmable: "Cost types reviewed",
    why: "Budgets, actuals and forecasts are tracked by cost code. QuickBooks products and services come in as codes, with a cost type guessed from the name.",
    how: [
      "Codes come from QuickBooks **products and services** each time you sync. To add one QuickBooks also uses, add it there and **Sync now**.",
      "**In ProjectCost:** open **Cost codes** and check each code's **cost type** (labour, material, subcontract, equipment, other); fix any that were guessed wrong.",
      "**In ProjectCost:** add budget-only codes with **Add cost code**. They're for budgeting and coding here; they don't exist in QuickBooks.",
    ],
    checks: (f) => [
      { label: "Cost codes exist", done: f.costCodes > 0, detail: f.costCodes ? plural(f.costCodes, "code") : undefined },
      { label: "At least one labour code", done: f.labourCodes > 0 },
    ],
  },
  {
    key: "employees", group: "Set up", title: "Employees and labour rates", optional: true, href: "/employees", openLabel: "Open employees",
    why: "Labour cost is hours × pay rate × (1 + burden). QuickBooks doesn't carry these rates for job costing, so time costs $0 until they're set.",
    how: [
      "**In QuickBooks:** add each person who works on projects (**Payroll → Employees → Add employee**). Display name and billing rate are enough; payroll setup isn't needed. Subcontractors aren't employees: their cost comes in on their bills.",
      "**In ProjectCost:** click **Sync now** on **QuickBooks & settings** to bring them in. Employees can't be added in ProjectCost.",
      "**In ProjectCost:** open **Employees** and enter each person's **trade**, **pay rate**, **burden %** (CPP, EI, WSIB, EHT, benefits) and **bill rate**, then **Save**. Time already imported at $0 picks up the rate.",
    ],
    checks: (f) => [
      { label: "Employees synced from QuickBooks", done: f.activeEmployees > 0, detail: f.activeEmployees ? plural(f.activeEmployees, "active employee") : "None yet: add them in QuickBooks, then sync", action: f.activeEmployees ? undefined : { label: "Sync now", href: "/settings" } },
      { label: "Every active employee has a pay rate", done: f.activeEmployees > 0 && f.employeesWithoutRate === 0, detail: f.employeesWithoutRate ? `${plural(f.employeesWithoutRate, "employee")} without one` : undefined },
      { label: "Burden set", done: f.activeEmployees > 0 && f.employeesWithoutBurden === 0, detail: f.employeesWithoutBurden ? `${plural(f.employeesWithoutBurden, "employee")} at 0%` : undefined },
    ],
  },
  {
    key: "projects", group: "Projects", title: "Set up projects", href: "/projects", openLabel: "Open projects",
    why: "Imported projects arrive without a contract value or budget, so % complete and profit aren't meaningful yet. Capital and build-for-sale projects need to know where their costs come from.",
    how: [
      "Customer contracts come from QuickBooks customers (or sub-customer jobs) on each sync. **In QuickBooks:** add the customer or job, then **Sync now**. A contract can also be created here with **New project**.",
      "**In ProjectCost:** open **Projects**; for each active contract open **Setup** and enter the **contract value**, then enter the original budget by cost code on the **Budget** tab.",
      "**In ProjectCost:** for capital or build-for-sale work, click **New project**, choose the type, then on **Setup** link the QuickBooks **class, location or account** its costs are coded to.",
    ],
    checks: (f) => [
      { label: "Active projects exist", done: f.activeProjects > 0, detail: f.activeProjects ? plural(f.activeProjects, "active project") : undefined },
      { label: "Every active contract has a contract value", done: f.activeContracts > 0 && f.contractsWithoutValue === 0, detail: f.contractsWithoutValue ? `${plural(f.contractsWithoutValue, "contract")} at $0` : undefined },
      { label: "Every active project has a budget", done: f.activeProjects > 0 && f.projectsWithoutBudget === 0, detail: f.projectsWithoutBudget ? `${plural(f.projectsWithoutBudget, "project")} without one` : undefined },
      ...(f.balanceSheetProjects ? [{ label: "Capital / build-for-sale projects are linked to QuickBooks", done: f.internalWithoutLinks === 0, detail: f.internalWithoutLinks ? `${f.internalWithoutLinks} not linked` : undefined }] : []),
    ],
  },
  {
    key: "overhead", group: "Projects", title: "Overhead rate", optional: true, href: "/overhead", openLabel: "Open overhead", confirmable: "Pool accounts reviewed",
    why: "Shows profit after overhead on each contract, using a rate built from your QuickBooks Profit and Loss. A management view only: it never changes WIP.",
    how: ["**In ProjectCost:** open **Overhead**. The pool comes from your QuickBooks Profit and Loss on each sync.", "Choose the **base**: % of labour cost, per labour hour, or % of direct cost.", "Untick accounts that aren't overhead (e.g. interest), or enter your own rate, then **Save**."],
    checks: (f) => [
      { label: "Profit and Loss loaded", done: f.overheadPoolLoaded },
      { label: "A rate is available", done: f.overheadRateSet },
    ],
  },
  {
    key: "sync", group: "Monthly cycle", title: "Sync from QuickBooks", monthly: true, href: "/settings", openLabel: "Open import",
    why: "Brings in the month's bills, expenses, time and invoices, and refreshes the overhead pool. Coding you've done in ProjectCost is kept.",
    how: ["**In QuickBooks:** finish entering the month's bills, expenses, time and invoices.", "**In ProjectCost:** on **QuickBooks & settings**, click **Sync now**."],
    checks: (f) => [{ label: "Synced in the last 7 days", done: f.daysSinceImport != null && f.daysSinceImport <= 7, detail: f.daysSinceImport != null ? `Last sync ${f.daysSinceImport === 0 ? "today" : `${plural(f.daysSinceImport, "day")} ago`}` : "Never synced" }],
  },
  {
    key: "coding", group: "Monthly cycle", title: "Code unassigned costs", monthly: true, href: "/costs", openLabel: "Open unassigned costs",
    why: "Costs without a project or cost code don't reach any job's budget. Leaving them uncoded makes jobs look better than they are.",
    how: [
      "**In ProjectCost:** open **Unassigned costs**; for each line pick the **project** and **cost code**, then **Assign**. The QuickBooks customer or class is shown for context.",
      "Better at the source: when the bill or expense line in QuickBooks has the customer (or class) and a product/service, it codes itself on the next sync.",
    ],
    checks: (f) => [{ label: "Nothing waiting to be coded", done: f.unassignedCosts === 0, detail: f.unassignedCosts ? `${plural(f.unassignedCosts, "line")} waiting` : undefined }],
  },
  {
    key: "time", group: "Monthly cycle", title: "Approve timesheets", monthly: true, href: "/time", openLabel: "Open timesheets",
    why: "Only approved time becomes job cost, at burdened rates.",
    how: [
      "Time entered in QuickBooks (**+ New → Single time activity**, with the customer and **Hours** service) arrives already approved when you sync.",
      "**In ProjectCost:** time logged on **Timesheets → Log time** waits for approval: review it and click **Approve selected**.",
    ],
    checks: (f) => [{ label: "No time waiting for approval", done: f.pendingTime === 0, detail: f.pendingTime ? `${plural(f.pendingTime, "entry", "entries")} waiting` : undefined }],
  },
  {
    key: "changes", group: "Monthly cycle", title: "Change orders", monthly: true, href: "/projects", openLabel: "Open projects", confirmable: "New changes logged",
    why: "Approved change orders move the contract value, cost budget and billing schedule together. Pending ones show what's at risk.",
    how: ["**In ProjectCost:** change orders live here only; QuickBooks has no change orders. On each project's **Change orders** tab, log new changes and **Approve** or **Reject** pending ones."],
    checks: (f) => [{ label: "No change orders left pending", done: f.pendingChangeOrders === 0, detail: f.pendingChangeOrders ? `${plural(f.pendingChangeOrders, "pending change order")}` : undefined }],
  },
  {
    key: "forecast", group: "Monthly cycle", title: "Update estimates to complete", monthly: true, href: "/projects", openLabel: "Open projects", confirmable: "Estimates reviewed with the project managers",
    why: "Percentage of completion is cost to date ÷ estimated total cost. A stale estimate to complete misstates earned revenue, over/under billings and fade.",
    how: ["**In ProjectCost:** for each active contract, open the **Budget** tab.", "Enter the **Est. to complete** for any cost code where the remaining budget isn't right; leave blank to use the remaining budget."],
    checks: (f) => [{ label: "Estimates updated this month", done: f.contractsWithBudget > 0 && f.contractsForecastThisMonth >= f.contractsWithBudget, detail: `${f.contractsForecastThisMonth} of ${plural(f.contractsWithBudget, "budgeted contract")} updated in ${f.periodLabel}` }],
  },
  {
    key: "billing", group: "Monthly cycle", title: "Progress billing", monthly: true, href: "/projects", openLabel: "Open projects", confirmable: "This month's billing is done",
    why: "Bills against the schedule of values, with holdback retained and tax on the net amount.",
    how: [
      "**In ProjectCost:** on each contract's **Progress billing** tab, enter this period's amounts, create the bill, review it, and **Post**.",
      "**In QuickBooks:** ProjectCost doesn't create invoices in QuickBooks yet: create the matching invoice there.",
      "**In ProjectCost:** on the posted bill, enter that **QuickBooks invoice #** so the invoice isn't counted twice when it syncs. Or bill only in QuickBooks and skip this step: synced invoices count toward billed to date on their own.",
    ],
    checks: (f) => [{ label: "No draft bills left", done: f.draftBills === 0, detail: f.draftBills ? `${plural(f.draftBills, "draft")}` : undefined }],
  },
  {
    key: "close", group: "Monthly cycle", title: "Close the month", monthly: true, href: "/wip", openLabel: "Open WIP & month-end",
    confirmable: "Entries booked in QuickBooks",
    why: "Freezes the WIP schedule for the period and gives you the entries to book: the WIP adjustment, labour burden, and capital / build-for-sale entries.",
    how: [
      "**In ProjectCost:** open **WIP & month-end** and review the schedule and the drafted entries.",
      "**In QuickBooks:** book each entry as a journal entry (**+ New → Journal entry**) with the memo shown. The **[ProjectCost]** tag stops it being imported twice.",
      "**In ProjectCost:** click **Save WIP snapshot** for the period.",
    ],
    checks: (f) => [{ label: `WIP snapshot saved for ${f.periodLabel}`, done: f.wipSnapshotSaved }],
  },
  {
    key: "review", group: "Outputs", title: "Review and share", monthly: true, href: "/dashboard", openLabel: "Open dashboard", confirmable: "Reviewed and shared",
    why: "The dashboard flags projects that need attention; the WIP schedule is in surety format for your bank, bonding company and auditor.",
    how: ["**In ProjectCost:** review the **Dashboard** for fade, projected losses and underbilling.", "Share the **WIP schedule** and profit after overhead with the owners, and file the snapshot with your month-end."],
    checks: () => [],
  },
];

export type Mark = { stepKey: string; period: string; status: "DONE" | "SKIPPED" };
export type GuideStep = Omit<GuideStepDef, "checks"> & {
  number: number;
  checks: GuideCheck[];
  status: "todo" | "partial" | "done" | "skipped";
  marked: Mark["status"] | null;
  period: string;
  doneCount: number;
  totalCount: number;
};

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
    return { ...def, number: i + 1, checks, status, marked, period, doneCount, totalCount };
  });
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return { steps, done, total: steps.length };
}
