import { db, schema as s } from "@/db";
import { and, eq, desc } from "drizzle-orm";
import { activeProjects, getCostCodes, unassignedCosts } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, M, Empty, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { assignCost } from "@/app/actions";

export default async function Costs() {
  const { company } = await getTenant();
  const [items, codes, projects, recent] = await Promise.all([
    unassignedCosts(company.id),
    getCostCodes(company.id),
    activeProjects(company.id),
    db.query.costTransactions.findMany({ where: and(eq(s.costTransactions.companyId, company.id), eq(s.costTransactions.pendingPush, true)), with: { project: true, costCode: true, vendor: true }, orderBy: desc(s.costTransactions.assignedAt), limit: 10 }),
  ]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Unassigned costs" subtitle="Bills, expenses and cheques in QuickBooks with no project or cost code. Code them here; the project and class are written back to the QBO line." />
      <Card title={`${items.length} waiting`}>
        {items.length === 0 ? <Empty>Everything is coded. Nice.</Empty> : (
          <table className="grid-table">
            <thead><tr><th>Date</th><th>Vendor</th><th>Doc #</th><th>Description</th><th className="num">Amount</th><th>Assign to</th></tr></thead>
            <tbody>{items.map((c) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap text-xs">{fmtDate(c.date)}</td>
                <td>{c.vendor?.name}</td>
                <td className="whitespace-nowrap font-mono text-xs">{c.docNumber}</td>
                <td className="text-slate-600">{c.description}</td>
                <td className="num"><M v={c.amountCents} cents /></td>
                <td>
                  <form action={assignCost} className="flex gap-1.5">
                    <input type="hidden" name="id" value={c.id} />
                    <select name="projectId" required className="input w-40" defaultValue="">
                      <option value="" disabled>Project…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
                    </select>
                    <select name="costCodeId" required className="input w-44" defaultValue="">
                      <option value="" disabled>Cost code…</option>
                      {codes.map((cc) => <option key={cc.id} value={cc.id}>{cc.code} {cc.name}</option>)}
                    </select>
                    <button className="btn btn-sm">Assign</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      {recent.length > 0 && (
        <Card title="Recently coded — queued to write back to QuickBooks" className="mt-5">
          <table className="grid-table">
            <thead><tr><th>Vendor</th><th>Description</th><th>Project</th><th>Cost code</th><th className="num">Amount</th><th>Sync</th></tr></thead>
            <tbody>{recent.map((c) => (
              <tr key={c.id}><td>{c.vendor?.name}</td><td className="text-slate-600">{c.description}</td><td>{c.project?.number}</td><td className="font-mono text-xs">{c.costCode?.code}</td><td className="num"><M v={c.amountCents} cents /></td><td><Badge tone="amber">Queued</Badge></td></tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
