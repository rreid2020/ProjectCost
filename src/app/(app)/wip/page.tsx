import Link from "next/link";
import { db, schema as s } from "@/db";
import { desc, eq } from "drizzle-orm";
import { loadPortfolio } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, M, Stat, ProjectCell } from "@/components/ui";
import { money, pct, fmtDate } from "@/lib/format";
import { wipJournal, burdenJournal, isBalanced } from "@/lib/engine";
import { closeWipPeriod } from "@/app/actions";
import { ProjectEntries } from "./ProjectEntries";

// a file download from a route handler, so a plain <a> rather than <Link>
const WIP_XLSX = "/api/reports/wip";

export default async function Wip({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { company, isAdmin } = await getTenant();
  const projects = await loadPortfolio(company.id, ["ACTIVE"], ["CONTRACT"]); // WIP schedule = customer contracts only
  const { month: m } = await searchParams;
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const snaps = await db.select({ periodEnd: s.wipSnapshots.periodEnd, createdAt: s.wipSnapshots.createdAt }).from(s.wipSnapshots).where(eq(s.wipSnapshots.companyId, company.id)).orderBy(desc(s.wipSnapshots.periodEnd));
  const periods = [...new Map(snaps.map((x) => [x.periodEnd, x])).values()];
  const month = /^\d{4}-\d{2}$/.test(m ?? "") ? m! : periodEnd.slice(0, 7);

  const rows = projects.map((p) => ({ p: p.project, e: p.econ }));
  const sum = (f: (e: (typeof rows)[number]["e"]) => number) => rows.reduce((a, r) => a + f(r.e), 0);
  const je = wipJournal(rows.map((r) => ({ projectNumber: r.p.number, overUnder: r.e.overUnder, lossProvision: r.e.lossProvision })));
  const burden = projects.reduce((a, p) => a + p.labour.burden, 0);
  const bje = burdenJournal(burden);
  const under = -rows.filter((r) => r.e.overUnder < 0).reduce((a, r) => a + r.e.overUnder, 0);
  const over = rows.filter((r) => r.e.overUnder > 0).reduce((a, r) => a + r.e.overUnder, 0);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="WIP schedule & month-end" subtitle={`Percentage-of-completion (cost-to-cost) · period ending ${fmtDate(periodEnd)} · books closed through ${fmtDate(company.closedThrough)}`}
        actions={
          isAdmin ? (
            <form action={closeWipPeriod} className="flex items-center gap-2">
              <input type="hidden" name="periodEnd" value={periodEnd} />
              <button className="btn">Save WIP snapshot for {fmtDate(periodEnd)}</button>
            </form>
          ) : <span className="text-xs text-slate-500">An admin saves the month-end snapshot.</span>
        } />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Earned revenue to date" value={money(sum((e) => e.earnedRevenue))} />
        <Stat label="Billed to date" value={money(sum((e) => e.billedToDate))} />
        <Stat label="Underbillings (asset)" value={money(under)} tone="warn" />
        <Stat label="Overbillings (liability)" value={money(over)} />
      </div>

      <Card title="Work-in-progress schedule" className="mt-5" action={<span className="flex items-center gap-3 text-xs text-slate-500">Surety / bank format <a href={WIP_XLSX} className="font-medium text-brand-600 hover:underline">Download Excel</a><Link href="/reports?r=journal" className="font-medium text-brand-600 hover:underline">Journal entries</Link></span>}>
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead><tr>
              <th>Project</th><th className="num">Contract</th><th className="num">Est. total cost</th><th className="num">Est. gross profit</th><th className="num">Cost to date</th>
              <th className="num">% complete</th><th className="num">Earned revenue</th><th className="num">Billed to date</th><th className="num">Under-billings</th><th className="num">Over-billings</th><th className="num">Loss provision</th><th className="num">Backlog</th>
            </tr></thead>
            <tbody>{rows.map(({ p, e }) => (
              <tr key={p.id}>
                <td><ProjectCell id={p.id} number={p.number} name={p.name} /></td>
                <td className="num"><M v={e.revisedContract} /></td>
                <td className="num"><M v={e.eac} /></td>
                <td className="num"><M v={e.projectedProfit} signTone="profit" /></td>
                <td className="num"><Link href={`/projects/${p.id}?tab=costs`} className="hover:underline"><M v={e.costToDate} /></Link></td>
                <td className="num">{pct(e.pctCompleteBp)}</td>
                <td className="num"><M v={e.earnedRevenue} /></td>
                <td className="num"><Link href={`/projects/${p.id}?tab=billing`} className="hover:underline"><M v={e.billedToDate} /></Link></td>
                <td className="num">{e.overUnder < 0 ? <M v={-e.overUnder} /> : "—"}</td>
                <td className="num">{e.overUnder > 0 ? <M v={e.overUnder} /> : "—"}</td>
                <td className="num">{e.lossProvision ? <span className="text-red-700">{money(e.lossProvision)}</span> : "—"}</td>
                <td className="num"><M v={e.backlog} /></td>
              </tr>
            ))}</tbody>
            <tfoot><tr>
              <td>Total</td>
              <td className="num"><M v={sum((e) => e.revisedContract)} /></td><td className="num"><M v={sum((e) => e.eac)} /></td><td className="num"><M v={sum((e) => e.projectedProfit)} /></td>
              <td className="num"><M v={sum((e) => e.costToDate)} /></td><td></td><td className="num"><M v={sum((e) => e.earnedRevenue)} /></td><td className="num"><M v={sum((e) => e.billedToDate)} /></td>
              <td className="num"><M v={under} /></td><td className="num"><M v={over} /></td><td className="num"><M v={sum((e) => e.lossProvision)} /></td><td className="num"><M v={sum((e) => e.backlog)} /></td>
            </tr></tfoot>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {[{ title: "WIP adjusting entry (auto-reverses on the 1st)", lines: je }, { title: "Labour burden applied to jobs (to date)", lines: bje }].map((j) => (
          <Card key={j.title} title={j.title} action={<span className={`text-xs ${isBalanced(j.lines) ? "text-emerald-700" : "text-red-700"}`}>{isBalanced(j.lines) ? "Balanced" : "Out of balance"}</span>}>
            <table className="grid-table">
              <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>{j.lines.map((l, i) => (
                <tr key={i}><td className={l.credit ? "pl-8" : ""}>{l.account}</td><td className="num">{l.debit ? money(l.debit, { cents: true }) : ""}</td><td className="num">{l.credit ? money(l.credit, { cents: true }) : ""}</td></tr>
              ))}</tbody>
            </table>
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Book this in QuickBooks as a journal entry (+ New → Journal entry). ProjectCost doesn&apos;t post it for you yet.</p>
          </Card>
        ))}
      </div>

      <Card title="Saved WIP snapshots" className="mt-5">
        {periods.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">No periods saved yet. Saving freezes this schedule for the auditor and surety file.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{periods.map((x) => <li key={x.periodEnd} className="px-4 py-2">{fmtDate(x.periodEnd)} <span className="text-xs text-slate-500">saved {new Date(x.createdAt).toLocaleString("en-CA")}</span></li>)}</ul>
        )}
      </Card>

      <ProjectEntries company={company} month={month} />
    </div>
  );
}
