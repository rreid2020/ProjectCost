# ProjectCost — job costing for QuickBooks Online

Multi-tenant SaaS job costing for contractors. Milestone 1: the core costing engine and the **Construction & trades** module, with sample data
(a fictional Ontario mechanical subcontractor, Northline Mechanical Ltd.). The QuickBooks connection comes in milestone 2.

## How it's put together (multi-tenant SaaS)

- **Tenant = company = Clerk organization.** A user signs up, creates (or is invited to) an organization, and onboarding
  creates the matching `company` row with a 14-day free trial. People can belong to several companies and switch in the sidebar.
- **Isolation.** Every tenant-owned table has `company_id`, and references between tenant rows are composite foreign keys
  (`(company_id, project_id) → project(company_id, id)`), so the database refuses cross-company links. All pages and server
  actions get the company from `getTenant()` / `requireWrite()` / `requireAdmin()` in `src/lib/tenant.ts` and filter by it.
  `tests/tenancy.test.ts` runs the real server actions as company A against company B's IDs.
- **Roles.** Clerk `org:admin` manages company settings, billing, the cost-code library and the month-end WIP close; `org:member` does the day-to-day work.
- **Billing.** Stripe Checkout per company, customer portal for plan changes/cancellation, webhook at `/api/stripe/webhook`.
  Plans live in `src/lib/plans.ts`. A company whose trial ended or whose subscription lapsed is sent to `/billing`.
- **Database.** Postgres. Production uses Neon; local dev and tests use PGlite (Postgres compiled to WASM, stored in `./data/pglite`), so nothing to install.

## Run it on your computer (Windows)

You need **Node.js 20 or newer** and **Clerk development keys** (free):

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com). Under **Organizations**, turn organizations on and turn
   **personal accounts off** (every user must belong to a company).
2. Copy `.env.example` to `.env.local` and paste the two keys from **API keys** into `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
3. Then:

```powershell
npm install
npm run db:migrate   # creates the local database in data\pglite
npm run dev
```

Open http://localhost:3000, sign up, create a company and tick **Start with sample data** to get the demo projects.
Or double-click `Start ProjectCost.bat`, which does all of this.

- `npm test` runs the engine, billing-rule and tenant-isolation tests.
- `npm run db:reset-local` wipes the local database (stop `npm run dev` first).
- After changing `src/db/schema.ts`, run `npm run db:generate` to write a new migration.

Stripe is optional locally: without keys the app runs on the free trial and the Billing page says Stripe isn't configured.
To test payments, put test-mode keys in `.env.local` and forward webhooks with the Stripe CLI:
`stripe listen --forward-to localhost:3000/api/stripe/webhook` (it prints the `STRIPE_WEBHOOK_SECRET` to use).

## Deploy (Vercel + Neon)

1. **Neon:** create a project and copy the **pooled** connection string.
2. **Clerk:** create a production instance for your domain (organizations on, personal accounts off). Add a webhook endpoint
   `https://<your-domain>/api/clerk/webhook` for `organization.updated` and `organization.deleted`.
3. **Stripe:** create a product with a recurring price per plan (Starter, Pro). Turn on the **customer portal** (Settings → Billing → Customer portal)
   and allow plan switching between those prices. Add a webhook endpoint `https://<your-domain>/api/stripe/webhook` for
   `checkout.session.completed` and `customer.subscription.created/updated/deleted/paused/resumed`.
4. **Vercel:** import the repo and set the environment variables from `.env.example` (`DATABASE_URL`, Clerk keys, `CLERK_WEBHOOK_SIGNING_SECRET`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `APP_URL`). `vercel.json` runs the database
   migrations before each build.

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
| QuickBooks & settings | Connect/disconnect QuickBooks, company defaults, sync log |

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
src/db/schema.ts         data model (Drizzle ORM, Postgres; PGlite locally)
src/db/demo.ts           sample company data (loaded from onboarding)
src/lib/tenant.ts        resolves the signed-in user's company; used by every page and action
src/lib/plans.ts         plans, trial length, subscription access rules
src/lib/stripe.ts        Stripe client + subscription sync
src/lib/engine.ts        costing engine: roll-ups, WIP, billing, journal entries
src/lib/queries.ts       loads a project from the DB and runs the engine
src/app/(app)/           signed-in app pages          src/app/(marketing)/  public landing page
src/app/onboarding/      company setup                src/app/api/          Stripe + Clerk webhooks
src/app/*actions.ts      server actions
scripts/                 migrate + local reset
drizzle/                 SQL migrations (regenerate with `npm run db:generate` after schema changes)
```

## Spreadsheet imports

**Import data** (admins) loads CSV or Excel (.xlsx) files, alongside QuickBooks or instead of it. Ten kinds: projects, budgets, cost codes,
cost transactions, time, employees & rates, invoices billed, change orders, chart of accounts, and Profit & Loss by month (overhead pool).

1. Upload: the sheet and header row are found automatically (title rows above the headers are fine).
2. Match columns: fields are matched by name, including Sage 50/300, Xero, QuickBooks Time / TSheets, ClockShark and Procore exports;
   the mapping a company confirms is remembered for its next upload. Each kind has a downloadable CSV template.
3. Preview: every row is checked with the same rules as the import; problems are listed by row. Import is all or nothing, or skip the problem rows.

Rows find their project by **project number**, cost codes by code, vendors and employees by name (new ones are added). Costs whose project or code
doesn't match go to **Unassigned costs**. Cost, time and invoice rows get a stable key (your ID column, or a fingerprint of the row), so
re-importing the same lines updates them instead of duplicating, and coding done in ProjectCost is kept. Imports of costs, time, budgets,
invoices and change orders can be undone (removes the rows that import created). Code: `src/lib/imports/`.

## Project types

- **Customer contract**: revenue, change orders, progress billing with holdback, cost-to-cost % complete, the WIP schedule and over/under billings.
- **Capital project**: no customer or revenue. Cost accumulates in construction in progress and is capitalized to a fixed-asset account on the in-service date.
- **Build for sale**: any number of units. Completing units moves their share of work in process to finished goods; selling moves finished goods to COGS at average cost.

Projects find their QuickBooks costs through links: customer, class, location or GL account (matched in that order). The **Accounts** page sets which
GL accounts count as project cost (COGS by default) and where capital/inventory entries post. **WIP & month-end** drafts the month's entries (reclass
incl. burdened labour, capitalization, units completed, units sold) with a `[ProjectCost]` memo so the next import doesn't count them twice.
Only customer contracts appear on the WIP schedule.

## QuickBooks Online connection

Each company connects its own QuickBooks file from **QuickBooks & settings → Connect to QuickBooks** (admins only).
Tokens are stored per company, encrypted with AES-256-GCM (`QBO_TOKEN_KEY`), refreshed automatically, and revoked at Intuit on disconnect.
One QuickBooks file can be connected to only one ProjectCost workspace.

Set it up (sandbox first):

1. At developer.intuit.com, open your app → **Keys & credentials → Development**.
2. Under **Redirect URIs**, add `http://localhost:3000/api/qbo/callback` (and later `https://<your-domain>/api/qbo/callback` under Production).
3. Put the Client ID and Client Secret into `.env.local` as `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` (never into `.env.example`, chat, or git).
   `QBO_TOKEN_KEY` must also be set (see `.env.example`). Restart `npm run dev`.
4. In ProjectCost, click **Connect to QuickBooks**, sign in to Intuit, and choose your **sandbox company**.

For production: use the Production keys, set `QBO_ENVIRONMENT=production`, and use a different `QBO_TOKEN_KEY` than dev.
Intuit's app review expects the official "Connect to QuickBooks" button artwork and a disconnect link, both of which should be in place before you submit.

### Importing

**QuickBooks & settings → Import from QuickBooks** (admins). The first run asks how jobs are tracked in QuickBooks:

- **Sub-customers / QuickBooks Projects:** each job under a customer becomes a project; costs tagged to the parent customer go to Unassigned costs.
- **Each customer is a job:** every customer with costs, time, invoices or estimates in the window becomes a project.

What comes in (last 24 months of transactions): customers, projects, vendors, employees, products & services as cost codes (type guessed, editable),
bill / expense / cheque / vendor-credit lines tagged to a customer or posted to Cost of Goods Sold, employee time on projects, and invoices and
credit memos (pre-tax) as billed to date. Accepted estimates seed the contract value of new projects. Foreign-currency transactions are converted
at QuickBooks' exchange rate. In Canada, sales tax on purchases is kept out of job cost (ITC); in the US it's added to cost. Overhead lines with no
customer are skipped. Nothing is written to QuickBooks.

Re-running ("Sync now") updates in place: nothing is duplicated, coding done in ProjectCost is kept unless QuickBooks has its own value, and
records deleted in QuickBooks (within the window) are removed. After the first import, set **employee pay rates** (Employees), each project's
**contract and budget** (project → Setup / Budget), and code anything in **Unassigned costs**.

Not yet: write-back to QuickBooks, webhooks/scheduled sync, journal-entry lines, a schedule-of-values editor for imported projects, and running
very large imports in the background (they currently run inside the request, up to 5 minutes).

Note: Intuit only opens the QBO **Projects API** to App Partner Program **Silver tier or higher**. Until then, QBO sub-customers (jobs) are treated as projects.
