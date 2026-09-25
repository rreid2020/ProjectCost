import Link from "next/link";
import { loadPortfolio, unassignedCosts, pendingTimeCount } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";
import { Card, Stat, Badge, Progress, M, PageHeader, ProjectCell } from "@/components/ui";
import { money, pct } from "@/lib/format";

export default async function Dashboard() {
  const { company } = await getTenant();
  const [projects, un, pendingTime] = await Promise.all([loadPortfolio(company.id), unassignedCosts(company.id), pendingTimeCount(company.id)]);
  const t = (f: (e: (typeof projects)[number]["econ"]) => number) => projects.reduce((a, p) => a + f(p.econ), 0);
  const contract = t((e) => e.revisedContract), eac = t((e) => e.eac);
  const under = -projects.filter((p) => p.econ.overUnder < 0).reduce((a, p) => a + p.econ.overUnder, 0);
  const over = projects.filter((p) => p.econ.overUnder > 0).reduce((a, p) => a + p.econ.overUnder, 0);
  const projProfit = contract - eac;
  const attention = projects.flatMap((p) => p.flags.map((f) => ({ ...f, p })));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Portfolio" subtitle={`${company.name} · ${projects.length} active projects · cost-to-cost % complete`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Contract value" value={money(contract)} sub="incl. approved change orders" />
        <Stat label="Cost to date" value={money(t((e) => e.costToDate))} sub={`EAC ${money(eac)}`} />
        <Stat label="Earned revenue" value={money(t((e) => e.earnedRevenue))} sub={`Billed ${money(t((e) => e.billedToDate))}`} />
        <Stat label="Projected gross profit" value={money(projProfit)} sub={contract ? pct(Math.round((projProfit / contract) * 10000)) : "—"} tone={projProfit < 0 ? "bad" : "good"} />
        <Stat label="Underbilled (asset)" value={money(under)} sub={`Overbilled ${money(over)}`} tone={under > over ? "warn" : undefined} />
        <Stat label="Backlog" value={money(t((e) => e.backlog))} sub={`Holdback rec. ${money(t((e) => e.holdbackReceivable))}`} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card title="Needs attention" className="lg:col-span-1">
          <ul className="divide-y divide-slate-100 text-sm">
            {attention.map((a, i) => (
              <li key={i} className="flex items-start gap-2 px-4 py-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.level === "red" ? "bg-red-500" : "bg-amber-400"}`} />
                <div><Link href={`/projects/${a.p.project.id}`} className="font-medium text-slate-800 hover:underline">{a.p.project.number}</Link> <span className="text-slate-600">{a.text}</span></div>
              </li>
            ))}
            {un.length > 0 && (
              <li className="flex items-start gap-2 px-4 py-2.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                <div><Link href="/costs" className="font-medium text-slate-800 hover:underline">{un.length} QBO costs</Link> <span className="text-slate-600">not coded to a project ({money(un.reduce((a, c) => a + c.amountCents, 0))})</span></div>
              </li>
            )}
            {pendingTime > 0 && (
              <li className="flex items-start gap-2 px-4 py-2.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                <div><Link href="/time" className="font-medium text-slate-800 hover:underline">{pendingTime} time entries</Link> <span className="text-slate-600">waiting for approval</span></div>
              </li>
            )}
          </ul>
        </Card>

        <Card title="Active projects" className="lg:col-span-2" action={<Link href="/projects" className="text-xs text-brand-600 hover:underline">All projects →</Link>}>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead><tr><th>Project</th><th>% complete</th><th className="num">Contract</th><th className="num">Proj. margin</th><th className="num">Fade</th><th className="num">Over / (under) billed</th></tr></thead>
              <tbody>
                {projects.map(({ project: p, econ: e }) => (
                  <tr key={p.id}>
                    <td><ProjectCell id={p.id} number={p.number} name={p.name} /></td>
                    <td><Progress valueBp={e.pctCompleteBp} /></td>
                    <td className="num"><M v={e.revisedContract} /></td>
                    <td className="num"><span className={e.projectedMarginBp < 0 ? "text-red-700" : ""}>{pct(e.projectedMarginBp)}</span></td>
                    <td className="num">{e.fadeBp === 0 ? "—" : <Badge tone={e.fadeBp <= -300 ? "red" : e.fadeBp < 0 ? "amber" : "green"}>{e.fadeBp > 0 ? "+" : ""}{(e.fadeBp / 100).toFixed(1)} pts</Badge>}</td>
                    <td className="num"><M v={e.overUnder} signTone="variance" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
