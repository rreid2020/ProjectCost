import { db, schema as s } from "@/db";
import { and, eq, desc } from "drizzle-orm";
import { activeProjects, getCostCodes, unassignedCosts, unassignedTime } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, M, Empty, Badge } from "@/components/ui";
import { fmtDate, codeLabel } from "@/lib/format";
import { assignCost, assignTime, markTimeNonProject } from "@/app/actions";
import { QboRef } from "@/app/(app)/projects/[id]/LedgerTabs";
import { qboEnvironment } from "@/lib/qbo";

export default async function Costs() {
  const { company } = await getTenant();
  const qbo = { environment: qboEnvironment(), realmId: company.qboRealmId };
  const [items, codes, projects, recent, time] = await Promise.all([
    unassignedCosts(company.id),
    getCostCodes(company.id),
    activeProjects(company.id),
    db.query.costTransactions.findMany({ where: and(eq(s.costTransactions.companyId, company.id), eq(s.costTransactions.pendingPush, true)), with: { project: true, costCode: true, vendor: true }, orderBy: desc(s.costTransactions.assignedAt), limit: 10 }),
    unassignedTime(company.id),
  ]);
  const labourCodes = codes.filter((cc) => cc.costType === "LABOUR");
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Unassigned costs" subtitle="Costs and time from QuickBooks or spreadsheets that still need a project or a cost code. Assign them here. Assignments are kept in ProjectCost and survive every sync; QuickBooks isn&apos;t changed." />
      <Card title={`${items.length} waiting`}>
        {items.length === 0 ? <Empty>Everything is coded. Nice.</Empty> : (
          <table className="grid-table">
            <thead><tr><th>Date</th><th>Vendor</th><th>QuickBooks transaction</th><th>Description</th><th>Source said</th><th className="num">Amount</th><th>Assign to</th></tr></thead>
            <tbody>{items.map((c) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap text-xs">{fmtDate(c.date)}</td>
                <td>{c.vendor?.name}</td>
                <td><QboRef ctx={qbo} type={c.qboTxnType} id={c.qboTxnId} source={c.source} doc={c.docNumber} line={c.qboLineId} /></td>
                <td className="text-slate-600">{c.description}</td>
                <td className="text-xs text-slate-500">{c.qboCustomerName ?? "—"}</td>
                <td className="num"><M v={c.amountCents} cents /></td>
                <td>
                  <form action={assignCost} className="flex gap-1.5">
                    <input type="hidden" name="id" value={c.id} />
                    <select name="projectId" required className="input w-40" defaultValue={c.projectId ?? ""}>
                      <option value="" disabled>Project…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
                      {c.project && !projects.some((p) => p.id === c.project!.id) && <option value={c.project.id}>{c.project.number} {c.project.name}</option>}
                    </select>
                    <select name="costCodeId" required className="input w-44" defaultValue="">
                      <option value="" disabled>Cost code…</option>
                      {codes.map((cc) => <option key={cc.id} value={cc.id}>{codeLabel(cc)}</option>)}
                    </select>
                    <button className="btn btn-sm">Assign</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <Card title={`Time: ${time.length} waiting`} className="mt-5">
        {time.length === 0 ? <Empty>No unassigned time. QuickBooks time that isn&apos;t linked to a project shows up here.</Empty> : (
          <table className="grid-table">
            <thead><tr><th>Date</th><th>Employee</th><th className="num">Hours</th><th>Notes</th><th>Source said</th><th>Assign to</th><th></th></tr></thead>
            <tbody>{time.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-xs">{fmtDate(e.date)}</td>
                <td>{e.employee?.name}</td>
                <td className="num">{(e.hoursX100 / 100).toFixed(2)}</td>
                <td className="text-slate-600">{e.notes ?? ""}</td>
                <td className="text-xs text-slate-500">{e.qboCustomerName ?? "—"}</td>
                <td>
                  <form action={assignTime} className="flex gap-1.5">
                    <input type="hidden" name="id" value={e.id} />
                    <select name="projectId" required className="input w-40" defaultValue="">
                      <option value="" disabled>Project…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
                    </select>
                    <select name="costCodeId" required className="input w-44" defaultValue={e.costCode?.code === "LAB-UNCODED" ? "" : e.costCodeId}>
                      <option value="" disabled>Cost code…</option>
                      {(labourCodes.length ? labourCodes : codes).filter((cc) => cc.code !== "LAB-UNCODED").map((cc) => <option key={cc.id} value={cc.id}>{codeLabel(cc)}</option>)}
                    </select>
                    <button className="btn btn-sm">Assign</button>
                  </form>
                </td>
                <td>
                  <form action={markTimeNonProject}>
                    <input type="hidden" name="id" value={e.id} />
                    <button className="btn btn-sm btn-secondary whitespace-nowrap" title="Shop, admin, training or other time that isn't project work">Not project time</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      {recent.length > 0 && (
        <Card title="Recently coded in ProjectCost" className="mt-5">
          <table className="grid-table">
            <thead><tr><th>Vendor</th><th>Description</th><th>Project</th><th>Cost code</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{recent.map((c) => (
              <tr key={c.id}><td>{c.vendor?.name}</td><td className="text-slate-600">{c.description}</td><td>{c.project?.number}</td><td className="font-mono text-xs">{c.costCode?.code}</td><td className="num"><M v={c.amountCents} cents /></td><td><Badge tone="green">Coded</Badge></td></tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
