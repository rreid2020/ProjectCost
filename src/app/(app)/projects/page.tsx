import Link from "next/link";
import { loadPortfolio } from "@/lib/queries";
import { companyOverhead } from "@/lib/overhead";
import { projectOverhead } from "@/lib/engine";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, StatusBadge, Progress, M, ProjectCell, Empty } from "@/components/ui";
import { pct, fmtDate } from "@/lib/format";

const TYPES = [["CONTRACT", "Customer contracts"], ["CAPITAL", "Capital projects"], ["INVENTORY", "Build for sale"]] as const;

export default async function Projects({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { company } = await getTenant();
  const { type: raw } = await searchParams;
  const type = TYPES.some(([k]) => k === raw) ? raw! : "CONTRACT";
  const [projects, oh] = await Promise.all([loadPortfolio(company.id, ["ACTIVE", "BID", "COMPLETE"], [type]), type === "CONTRACT" ? companyOverhead(company) : null]);
  const afterOh = new Map(projects.map((p) => [p.project.id, oh?.rate != null ? projectOverhead(p.econ, p.labour, oh.rate, oh.basis).profitAfterOverhead : null]));
  const costLink = (id: string, v: number) => <Link href={`/projects/${id}?tab=costs`} className="hover:underline"><M v={v} /></Link>;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Projects" subtitle="Customer contracts, capital projects and builds for sale."
        actions={<Link href="/projects/new" className="btn">New project</Link>} />
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {TYPES.map(([k, label]) => (
          <Link key={k} href={`?type=${k}`} className={`-mb-px border-b-2 px-3 py-2 text-sm ${type === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{label}</Link>
        ))}
      </div>
      <Card>
        {projects.length === 0 ? <Empty>No {TYPES.find(([k]) => k === type)![1].toLowerCase()} yet. <Link href="/projects/new" className="underline">Create one</Link>.</Empty> : (
          <div className="overflow-x-auto">
            {type === "CONTRACT" ? (
              <table className="grid-table">
                <thead><tr><th>Project</th><th>Customer</th><th>Status</th><th>Dates</th><th>% complete</th><th className="num">Contract</th><th className="num">Cost to date</th><th className="num">EAC</th><th className="num">Proj. profit</th><th className="num">Margin</th><th className="num"><Link href="/overhead" className="hover:underline">After overhead</Link></th><th className="num">Billed</th></tr></thead>
                <tbody>{projects.map(({ project: p, econ: e }) => (
                  <tr key={p.id}>
                    <td><ProjectCell id={p.id} number={p.number} name={p.name} /></td>
                    <td className="text-slate-600">{p.customer?.name ?? "—"}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</td>
                    <td><Progress valueBp={e.pctCompleteBp} /></td>
                    <td className="num"><M v={e.revisedContract} /></td>
                    <td className="num">{costLink(p.id, e.costToDate)}</td>
                    <td className="num"><M v={e.eac} /></td>
                    <td className="num"><M v={e.projectedProfit} signTone="profit" /></td>
                    <td className="num">{pct(e.projectedMarginBp)}</td>
                    <td className="num">{afterOh.get(p.id) == null ? "—" : <M v={afterOh.get(p.id)!} signTone="profit" />}</td>
                    <td className="num"><Link href={`/projects/${p.id}?tab=billing`} className="hover:underline"><M v={e.billedToDate} /></Link></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : (
              <table className="grid-table">
                <thead><tr>
                  <th>Project</th><th>Status</th><th>Dates</th><th className="num">Budget</th><th className="num">Cost to date</th><th className="num">Forecast</th><th className="num">Variance</th>
                  {type === "CAPITAL" ? <><th className="num">In CIP</th><th className="num">Capitalized</th></> : <><th className="num">Units done / sold</th><th className="num">WIP</th><th className="num">Finished goods</th><th className="num">COGS</th></>}
                </tr></thead>
                <tbody>{projects.map(({ project: p, econ: e, capital, inventory }) => (
                  <tr key={p.id}>
                    <td><ProjectCell id={p.id} number={p.number} name={p.name} /></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(p.startDate)} – {fmtDate(p.inServiceDate ?? p.endDate)}</td>
                    <td className="num"><M v={e.revisedBudget} /></td>
                    <td className="num">{costLink(p.id, e.costToDate)}</td>
                    <td className="num"><M v={e.eac} /></td>
                    <td className="num"><M v={e.revisedBudget - e.eac} signTone="variance" /></td>
                    {capital && <><td className="num"><M v={capital.cip} /></td><td className="num">{capital.capitalizedOn ? <M v={capital.capitalized} /> : "—"}</td></>}
                    {inventory && <>
                      <td className="num">{inventory.completedUnits}/{inventory.soldUnits} of {p.unitsPlanned}</td>
                      <td className="num"><M v={inventory.wip} /></td><td className="num"><M v={inventory.fg} /></td><td className="num"><M v={inventory.cogs} /></td>
                    </>}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
