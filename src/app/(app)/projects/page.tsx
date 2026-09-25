import { loadPortfolio } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, StatusBadge, Progress, M, ProjectCell } from "@/components/ui";
import { pct, fmtDate } from "@/lib/format";

export default async function Projects() {
  const { company } = await getTenant();
  const projects = await loadPortfolio(company.id, ["ACTIVE", "BID", "COMPLETE"]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Projects" subtitle="Each project maps to a QuickBooks Online Project (Plus/Advanced)." />
      <Card>
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead><tr><th>Project</th><th>Customer</th><th>Status</th><th>Dates</th><th>% complete</th><th className="num">Contract</th><th className="num">Cost to date</th><th className="num">EAC</th><th className="num">Proj. profit</th><th className="num">Margin</th><th className="num">Billed</th></tr></thead>
            <tbody>
              {projects.map(({ project: p, econ: e }) => (
                <tr key={p.id}>
                  <td><ProjectCell id={p.id} number={p.number} name={p.name} /></td>
                  <td className="text-slate-600">{p.customer.name}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</td>
                  <td><Progress valueBp={e.pctCompleteBp} /></td>
                  <td className="num"><M v={e.revisedContract} /></td>
                  <td className="num"><M v={e.costToDate} /></td>
                  <td className="num"><M v={e.eac} /></td>
                  <td className="num"><M v={e.projectedProfit} signTone="profit" /></td>
                  <td className="num">{pct(e.projectedMarginBp)}</td>
                  <td className="num"><M v={e.billedToDate} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
