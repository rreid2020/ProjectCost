# ProjectCost — job costing for QuickBooks Online

Milestone 1: the core costing engine and the **Construction & trades** module, running on demo data
(a fictional Ontario mechanical subcontractor, Northline Mechanical Ltd.). The QuickBooks connection comes in milestone 2.

## Run it on your computer (Windows)

You need **Node.js 20 or newer**. Check with `node -v` in a terminal. If it's missing, install the LTS version from nodejs.org.

Open a terminal (PowerShell) in this folder, then run:

```powershell
npm install
copy .env.example .env.local
npm run seed      # creates data\projectcost.db with the demo company
npm run dev       # starts the app
```

Open http://localhost:3000.

- `npm run seed` resets the demo data at any time.
- `npm test` runs the engine tests (WIP, burden, holdback, loss provision, journal entries).

## What's in milestone 1

| Screen | What it does |
| --- | --- |
| Dashboard | Portfolio KPIs, over/under billings, backlog, projects that need attention (fade, loss, underbilling, overruns) |
| Projects → Budget vs. actual | Original + approved COs = revised budget; actuals; % spent; editable estimate to complete; EAC and variance by cost code and cost type; burdened labour |
| Projects → Change orders | Pending/approved/rejected log; approving updates contract, cost budget and adds a schedule-of-values line |
| Projects → Progress billing | Schedule of values, previously billed, this period, % and balance to finish; 10% holdback; HST on the amount net of holdback; draft → post |
| Projects → Costs / Labour | QBO cost lines (pre-tax, ITC excluded) and time entries with rate × (1 + burden) |
| Unassigned costs | QBO bills/expenses with no project → code them to a project + cost code (queued to write back to QBO) |
| Timesheets | Log time, approve in bulk; rates and burden are captured at entry |
| WIP & month-end | Surety-format WIP schedule (cost-to-cost), under/over billings, loss provision, reversing WIP JE, burden JE, saved period snapshots |
| Cost codes | Company cost-code library (CSI-style) |
| QuickBooks & settings | Connection status, company defaults, sync log |

## Accounting conventions (the choices built into the engine)

- **% complete = cost to date ÷ estimated cost at completion** (cost-to-cost), capped at 100%.
- **Projected losses are recognized in full right away.** The provision is `loss × (1 − % complete)`, on top of the loss already recognized through earned revenue.
- **Over/under billing = billed to date − earned revenue.** Positive is a liability; negative is an asset.
- **Tax on progress bills:** HST is charged on the gross amount less holdback. HST on the holdback isn't collectible until the holdback is released.
- **Labour cost** is approved hours × pay rate × (1 + burden %). Payroll wages sitting in QBO are *not* also counted as job cost; the burden JE moves the burden into job cost.
- **Money is stored as integer cents and percentages as basis points**, so there are no floating-point rounding errors.

Engine code: `src/lib/engine.ts` (pure functions). Tests: `tests/engine.test.ts`.

## Project layout

```
src/db/schema.ts         data model (Drizzle ORM; SQLite locally, Postgres in production)
src/lib/engine.ts        costing engine: roll-ups, WIP, billing, journal entries
src/lib/queries.ts       loads a project from the DB and runs the engine
src/app/                 Next.js pages + server actions (actions.ts)
scripts/seed.ts          demo data
drizzle/                 SQL migrations (regenerate with `npm run db:generate` after schema changes)
```

## Getting ready for milestone 2 (QuickBooks connection)

1. At developer.intuit.com, open your app → **Keys & credentials** (Development/sandbox).
2. Add the redirect URI `http://localhost:3000/api/qbo/callback`.
3. Put the Client ID and Client Secret into `.env.local`, **not** `.env.example`, and never paste them into chat or commit them.
4. Keep the sandbox company handy. Milestone 2 will import its customers, projects, bills, purchases and time, then write back cost codes, time, invoices and JEs.

Note: Intuit only opens the QBO **Projects API** to App Partner Program **Silver tier or higher**. Until then, milestone 2 treats QBO sub-customers (jobs) as projects.
