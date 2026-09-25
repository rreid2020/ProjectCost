import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { PLANS, TRIAL_DAYS, type PlanKey } from "@/lib/plans";

const FEATURES = [
  ["Budget vs. actual by cost code", "Original budget plus approved change orders, actuals from QuickBooks, and PM estimates to complete. See fade before it hits the P&L."],
  ["Progress billing with holdback", "Schedule of values, this-period billing, holdback and HST on the net amount, posted to QuickBooks as an invoice."],
  ["WIP schedule in surety format", "Cost-to-cost percent complete, over/under billings and loss provisions, with the reversing journal entry drafted for you."],
  ["Burdened labour", "Approved timesheets become job cost at pay rate plus burden, and flow back to QuickBooks as time activity."],
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <span className="text-lg font-semibold tracking-tight text-brand-900">ProjectCost</span>
        <nav className="flex items-center gap-2 text-sm">
          <a href="#pricing" className="px-3 py-1.5 text-slate-600 hover:text-slate-900">Pricing</a>
          <Show when="signed-out" fallback={<Link href="/dashboard" className="btn">Open app</Link>}>
            <Link href="/sign-in" className="px-3 py-1.5 text-slate-600 hover:text-slate-900">Sign in</Link>
            <Link href="/sign-up" className="btn">Start free trial</Link>
          </Show>
        </nav>
      </header>

      <section className="bg-brand-900">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-5xl">Job costing that sits on top of QuickBooks Online.</h1>
          <p className="mt-5 max-w-2xl text-lg text-brand-100">Budgets, change orders, progress billing and month-end WIP for trades and construction contractors, without leaving the books you already keep.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className="btn px-5 py-2.5 text-base">Start your {TRIAL_DAYS}-day free trial</Link>
            <span className="self-center text-sm text-brand-100/80">No card required.</span>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 md:grid-cols-2">
        {FEATURES.map(([title, body]) => (
          <div key={title} className="rounded-lg border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-900">{title}</h2>
            <p className="mt-2 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      <section id="pricing" className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Pricing</h2>
          <p className="mt-2 text-sm text-slate-600">Every plan starts with a {TRIAL_DAYS}-day free trial. Billed per company.</p>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {(Object.keys(PLANS) as PlanKey[]).map((k) => (
              <div key={k} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">{PLANS[k].name}</h3>
                <p className="mt-1 text-sm text-slate-600">{PLANS[k].blurb}</p>
                <ul className="mt-4 grid gap-1.5 text-sm text-slate-700">{PLANS[k].features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
                <Link href="/sign-up" className="btn mt-6 w-full justify-center">Start free trial</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-500">© {new Date().getFullYear()} ProjectCost</footer>
    </div>
  );
}
