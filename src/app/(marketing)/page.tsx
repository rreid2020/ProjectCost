import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { PLANS, TRIAL_DAYS, type PlanKey } from "@/lib/plans";

// Landing page, patterned on axiomft.ca/resources/aro-recalculation: the problem (where QuickBooks Projects falls
// short), then how ProjectCost answers each point, what it does not do, how it works, and questions.
const DEMO_URL = "https://axiomft.ca/book-consultation";
const serif = "font-[Georgia,'Times_New_Roman',serif]";
const navy = "text-[#00204A]";

const PROBLEMS: { title: string; body: string }[] = [
  { title: "A project has to be a customer", body: "QuickBooks Projects sit under a customer. A capital project you build for your own use, or homes and units you build to sell, have no customer, so their costs land in general ledger accounts with nothing tracking them as a project." },
  { title: "Actuals, but no budget by cost code or forecast", body: "You can see what was spent. What the job should cost by cost code, revised by approved change orders, and what it will cost at completion aren't there, so margin fade shows up after the job is done." },
  { title: "Change orders live in email", body: "There's no change-order log that moves the contract value, the cost budget and the billing schedule together when a change is approved. Pending changes aren't visible at all." },
  { title: "No percentage-of-completion or WIP schedule", body: "Earned revenue, over and under billings and loss provisions are rebuilt in a spreadsheet every month-end, from exports, for the bank, the bonding company and the auditor." },
  { title: "Holdback handled with workarounds", body: "Progress billing against a schedule of values, with holdback retained and sales tax on the amount net of holdback, takes extra items, manual math and a separate receivable to track." },
  { title: "Labour reaches the job without its burden", body: "CPP, EI, WSIB, EHT and benefits are real job costs, but they rarely make it onto the job. Labour looks cheaper than it is and every margin is overstated." },
  { title: "Untagged costs quietly drop off the job", body: "A bill entered without the right customer or project never appears in project reports, and nothing tells you it's missing." },
  { title: "Capital and inventory entries are booked by hand", body: "Moving costs into construction in progress, capitalizing on the in-service date, moving work in process to finished goods and relieving cost of goods sold on sale all happen in spreadsheets and manual journal entries." },
  { title: "Job profit stops at gross margin", body: "Rent, office salaries, trucks and insurance aren't in any job's profit, so the jobs that look profitable aren't always the ones that pay for the business." },
];

const SOLUTIONS: { label: string; title: string; body: string }[] = [
  { label: "Projects without customers", title: "Three kinds of project, linked however you work", body: "Customer contracts, capital projects and builds for sale. Link each one to a QuickBooks customer, class, location or GL account, whichever your books already use." },
  { label: "No budget or forecast", title: "Budget, forecast and fade by cost code", body: "Original budget plus approved change orders, actuals from QuickBooks, and your estimate to complete. Fade and overruns are flagged while there's still time to act." },
  { label: "Change orders in email", title: "A change-order log that moves the numbers", body: "Pending, approved and rejected changes in one place. Approving a change revises the contract, the cost budget and the schedule of values together." },
  { label: "No WIP schedule", title: "A surety-format WIP schedule, every month", body: "Cost-to-cost % complete, earned revenue, over and under billings and loss provisions, with the reversing entry drafted and each month's schedule saved as a snapshot." },
  { label: "Holdback workarounds", title: "Progress billing with holdback built in", body: "Schedule of values, previously billed, this period, holdback retained and tax on the net amount, with holdback receivable tracked on every job." },
  { label: "Labour without burden", title: "Burdened labour on every hour", body: "Hours × pay rate × (1 + burden), captured when the time is approved, with the burden entry drafted so the job carries the real cost." },
  { label: "Untagged costs", title: "Nothing falls through", body: "Lines on your project-cost accounts that don't match a project land in an Unassigned costs queue until someone codes them, with the QuickBooks customer or class shown for context." },
  { label: "Manual capital & inventory entries", title: "Entries drafted, balanced and tagged", body: "Reclass to construction in progress or work in process, including labour. Capitalization in the in-service month. Units completed to finished goods and units sold to cost of goods sold, for any number of units." },
  { label: "Profit stops at gross", title: "Profit after overhead", body: "An overhead rate built from your QuickBooks Profit and Loss, applied on labour cost, labour hours or direct cost, your choice. A management view that never touches the WIP schedule." },
];

const NOT_DO: { title: string; body: string }[] = [
  { title: "It doesn't replace QuickBooks.", body: "QuickBooks stays your general ledger. ProjectCost reads from it and drafts the entries for you to book there." },
  { title: "It isn't payroll or a time clock.", body: "Hours come from QuickBooks time or are entered in ProjectCost; pay rates and burden are set per employee." },
  { title: "It doesn't judge your estimates.", body: "Budgets, estimates to complete and contract values are management's. It applies them consistently and shows the consequences." },
  { title: "It isn't an estimating or scheduling tool.", body: "It starts when the budget exists and follows the money from there." },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Connect QuickBooks", body: "Sign in with Intuit and pick your company. Each ProjectCost workspace connects its own QuickBooks file; tokens are encrypted." },
  { title: "Import", body: "Customers, jobs, vendors, employees, products and services as cost codes, and 24 months of bills, expenses, cheques, journal entries, time and invoices. Re-running updates in place." },
  { title: "Set up your projects", body: "Contract value and budget by cost code. Create capital and build-for-sale projects and link their class, location or account." },
  { title: "Code what's left", body: "Work through the Unassigned costs queue. Anything you code is kept on the next sync." },
  { title: "Close the month", body: "Review the WIP schedule, book the drafted entries, save the snapshot. Every figure drills down to the QuickBooks transaction behind it." },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Do I need QuickBooks Projects turned on?", a: "No. Projects can come from customers, sub-customers, QuickBooks Projects, classes, locations or GL accounts, or any mix of them." },
  { q: "Does it write to QuickBooks?", a: "Not yet. It reads your books and drafts journal entries with a [ProjectCost] memo for you to book. The memo stops the next import from counting them twice. Write-back is on the roadmap." },
  { q: "Which QuickBooks Online plans does it work with?", a: "QuickBooks Online in Canada and the US. Class and location tracking need Plus or Advanced." },
  { q: "How is sales tax handled?", a: "In Canada, recoverable GST/HST on purchases (input tax credits) is kept out of job cost. In the US, sales tax paid is part of the cost." },
  { q: "Can I trace a number back to QuickBooks?", a: "Yes. Cost to date, billed to date and each cost-code actual open the lines behind them, each with a link to the transaction in QuickBooks. Foreign-currency lines show the original amount and exchange rate." },
  { q: "What accounting basis does the WIP schedule use?", a: "Percentage of completion on a cost-to-cost basis, with projected losses recognized in full as soon as they're known, consistent with ASPE 3400 and IFRS 15." },
  { q: "Is my data separate from other companies'?", a: "Yes. Every record belongs to one company and the database itself refuses links between companies. QuickBooks tokens are encrypted." },
  { q: "Who built it?", a: "Axiom Financial & Technology: accountants who build the tools we wish our clients had." },
];

function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return <p className={`text-xs font-bold uppercase tracking-[0.12em] ${light ? "text-[#7FC7CF]" : "text-[#0E7C86]"}`}>{children}</p>;
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-[#12202F]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="leading-tight">
            <span className={`${serif} text-xl font-semibold ${navy}`}>ProjectCost</span>
            <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#0E7C86]">by Axiom</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <a href="#pricing" className="hidden px-3 py-1.5 text-slate-600 hover:text-slate-900 sm:inline">Pricing</a>
            <Show when="signed-out" fallback={<Link href="/dashboard" className="rounded-md bg-[#0E7C86] px-4 py-2 font-semibold text-white hover:bg-[#0b6870]">Open app</Link>}>
              <Link href="/sign-in" className="px-3 py-1.5 text-slate-600 hover:text-slate-900">Sign in</Link>
              <Link href="/sign-up" className="rounded-md bg-[#0E7C86] px-4 py-2 font-semibold text-white hover:bg-[#0b6870]">Start free trial</Link>
            </Show>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-[#00204A] text-[#DBE6F2]">
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
          <Eyebrow light>Job costing · Capital projects · Build for sale · QuickBooks Online</Eyebrow>
          <h1 className={`${serif} mt-3 text-4xl font-semibold text-white md:text-5xl`}>ProjectCost</h1>
          <p className="mt-5 max-w-2xl text-lg">
            The project layer QuickBooks Online is missing. <strong className="text-white">Budgets, change orders, progress billing, WIP and month-end entries</strong> for
            customer contracts, capital projects and builds for sale, built from the books you already keep.
          </p>
          <p className="mt-4 text-lg">It doesn&apos;t replace QuickBooks. It finishes the job.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className="rounded-md border-2 border-white bg-white px-5 py-2.5 font-semibold text-[#00204A] hover:bg-slate-100">Start your {TRIAL_DAYS}-day free trial</Link>
            <a href={DEMO_URL} className="rounded-md border-2 border-white/55 px-5 py-2.5 font-semibold text-white hover:border-white">Book a demo</a>
          </div>
          <p className="mt-8 text-sm text-[#DBE6F2]/90">{TRIAL_DAYS}-day free trial · QuickBooks Online, Canada &amp; US · Contracts, capital &amp; inventory projects · Every number traced to QuickBooks</p>
        </div>
      </section>

      {/* Facts strip */}
      <section className="border-b border-slate-200 bg-[#F6F8FB]">
        <dl className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 py-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Cost", `Free for ${TRIAL_DAYS} days, then a monthly plan per company. No card to start.`],
            ["Works with", "QuickBooks Online (Plus or Advanced for classes and locations), Canada and US."],
            ["Built for", "Contractors and trades, home builders and fabricators, organizations with capital projects, and their accountants."],
            ["Output", "Surety-format WIP schedule, draft journal entries, and profit after overhead by project."],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md border border-slate-200 bg-white p-4">
              <dt className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-[#0E7C86]">{k}</dt>
              <dd className="mt-1 text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* The problem */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <Eyebrow>The problem</Eyebrow>
        <h2 className={`${serif} mt-2 max-w-3xl text-3xl font-semibold ${navy}`}>QuickBooks knows what you spent. It doesn&apos;t know where the project stands.</h2>
        <div className="mt-4 max-w-3xl space-y-4 text-[1.0625rem] leading-relaxed">
          <p>QuickBooks Projects groups income and expenses under a customer. That&apos;s a ledger view: what was invoiced and what was paid out. Running projects takes more than that. You need to know what each job should cost, what it will cost, how much revenue it has earned, and whether billing is ahead or behind.</p>
          <p>And not every project has a customer. The warehouse addition you build for yourself and the units you build to sell carry real costs too. In practice, these are the gaps.</p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="rounded-md border border-[#D9E1EA] border-t-[3px] border-t-[#8A5A00] bg-white p-5">
              <h3 className="text-[1.075rem] font-semibold text-[#8A5A00]">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it solves */}
      <section className="bg-[#F6F8FB]">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <Eyebrow>How ProjectCost solves it</Eyebrow>
          <h2 className={`${serif} mt-2 max-w-3xl text-3xl font-semibold ${navy}`}>QuickBooks stays the ledger. ProjectCost adds the project accounting on top.</h2>
          <p className="mt-4 max-w-3xl text-[1.0625rem] leading-relaxed">
            Every gap above has the same root: the books record transactions, not projects. ProjectCost reads those transactions, assigns them to projects the way your
            books are already organized, and does the project accounting: budgets, forecasts, earned revenue, billing and the month-end entries.
          </p>
          <div className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {SOLUTIONS.map((s) => (
              <div key={s.title} className="border-l-[3px] border-[#0E7C86] pl-4">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-500">{s.label}</p>
                <h3 className={`mt-1 text-[1.075rem] font-semibold ${navy}`}>{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-md border border-[#D9E1EA] bg-white p-6">
            <h3 className={`${serif} text-xl font-semibold ${navy}`}>What ProjectCost does not do</h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {NOT_DO.map((n) => (
                <div key={n.title}><dt className="font-semibold">{n.title}</dt><dd className="mt-1 text-sm leading-relaxed text-slate-600">{n.body}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <Eyebrow>How it works</Eyebrow>
        <h2 className={`${serif} mt-2 text-3xl font-semibold ${navy}`}>Five steps, one afternoon.</h2>
        <p className="mt-4 max-w-3xl text-[1.0625rem] leading-relaxed">It needs two things: your QuickBooks file, and the budgets you already have for your projects. Everything else is import, calculation and review.</p>
        <ol className="mt-8 grid gap-4 md:grid-cols-5">
          {STEPS.map((st, i) => (
            <li key={st.title} className="rounded-md border border-slate-200 p-4">
              <span className={`${serif} text-2xl font-semibold text-[#0E7C86]`}>{i + 1}</span>
              <h3 className={`mt-1 font-semibold ${navy}`}>{st.title}</h3>
              <p className="mt-2 text-sm leading-relaxed">{st.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 rounded-md bg-[#F6F8FB] p-5">
          <h3 className={`font-semibold ${navy}`}>A reasonable first run</h3>
          <ul className="mt-2 grid gap-2 text-sm leading-relaxed sm:grid-cols-3">
            <li><strong>Start with your three largest active jobs.</strong> They carry most of the margin risk, and their budgets usually exist already.</li>
            <li><strong>Run it at your last month-end.</strong> Compare the WIP schedule with the one you built by hand. Differences are worth understanding either way.</li>
            <li><strong>Clear Unassigned costs first.</strong> Costs that aren&apos;t on the right job are the most common reason a job looks better than it is.</li>
          </ul>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-slate-200 bg-[#F6F8FB]">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className={`${serif} mt-2 text-3xl font-semibold ${navy}`}>Every plan starts with a {TRIAL_DAYS}-day free trial.</h2>
          <p className="mt-2 text-sm text-slate-600">Billed per company. Cancel any time from the billing page.</p>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {(Object.keys(PLANS) as PlanKey[]).map((k) => (
              <div key={k} className="rounded-md border border-[#D9E1EA] bg-white p-6">
                <h3 className={`${serif} text-xl font-semibold ${navy}`}>{PLANS[k].name}</h3>
                <p className="mt-1 text-sm text-slate-600">{PLANS[k].blurb}</p>
                <ul className="mt-4 grid gap-1.5 text-sm">{PLANS[k].features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
                <Link href="/sign-up" className="mt-6 block rounded-md bg-[#0E7C86] px-4 py-2 text-center font-semibold text-white hover:bg-[#0b6870]">Start free trial</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16">
        <Eyebrow>Questions</Eyebrow>
        <h2 className={`${serif} mt-2 text-3xl font-semibold ${navy}`}>Frequently asked questions</h2>
        <div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className={`cursor-pointer list-none font-semibold ${navy} flex items-center justify-between gap-4`}>
                {f.q}<span className="text-[#0E7C86] transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-[#00204A] text-[#DBE6F2]">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className={`${serif} text-3xl font-semibold text-white`}>See where your projects really stand.</h2>
          <p className="mt-3 max-w-2xl">Connect your QuickBooks file and run your first WIP schedule free, or walk through it with us on sample data before you touch your own books.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/sign-up" className="rounded-md border-2 border-white bg-white px-5 py-2.5 font-semibold text-[#00204A] hover:bg-slate-100">Start your free trial</Link>
            <a href={DEMO_URL} className="rounded-md border-2 border-white/55 px-5 py-2.5 font-semibold text-white hover:border-white">Book a demo</a>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs leading-relaxed text-slate-500">
        <p>ProjectCost supports the preparation and review of project cost, WIP and month-end reporting. It does not constitute an audit, a review engagement, or assurance
          on your financial statements, and it does not replace professional judgment about the estimates behind your projects.</p>
        <p className="mt-3">© {new Date().getFullYear()} Axiom Financial &amp; Technology · QuickBooks is a trademark of Intuit Inc. ProjectCost is not affiliated with or endorsed by Intuit.</p>
      </footer>
    </div>
  );
}
