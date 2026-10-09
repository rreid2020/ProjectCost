import { Card, M, StatusBadge, Empty } from "@/components/ui";
import { fmtDate, money, codeLabel } from "@/lib/format";
import type { LoadedProject } from "@/lib/queries";
import { createChangeOrder, setChangeOrderStatus } from "@/app/actions";

export function ChangeOrdersTab({ data }: { data: LoadedProject }) {
  const { changeOrders, codes, project: p } = data;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Change order log" className="lg:col-span-2">
        {changeOrders.length === 0 ? <Empty>No change orders yet.</Empty> : (
          <table className="grid-table">
            <thead><tr><th>#</th><th>Description</th><th>Issued</th><th>Status</th><th className="num">Contract change</th><th className="num">Cost change</th><th className="num">Margin</th><th></th></tr></thead>
            <tbody>
              {changeOrders.map((c) => {
                const cost = c.lines.reduce((a, l) => a + l.costCents, 0);
                return (
                  <tr key={c.id}>
                    <td className="font-mono text-xs">CO-{c.number}</td>
                    <td>{c.title}<div className="text-xs text-slate-500">{c.lines.map((l) => `${l.costCode.code} ${money(l.costCents)}`).join(" · ")}</div></td>
                    <td className="text-xs text-slate-500">{fmtDate(c.dateIssued)}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="num"><M v={c.contractAmountCents} /></td>
                    <td className="num"><M v={cost} /></td>
                    <td className="num text-xs">{c.contractAmountCents ? `${(((c.contractAmountCents - cost) / c.contractAmountCents) * 100).toFixed(1)}%` : "—"}</td>
                    <td className="text-right whitespace-nowrap">
                      {c.status === "PENDING" && (
                        <span className="inline-flex gap-1">
                          <form action={setChangeOrderStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="APPROVED" /><button className="btn btn-sm">Approve</button></form>
                          <form action={setChangeOrderStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="REJECTED" /><button className="btn btn-secondary btn-sm">Reject</button></form>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Approving a change order updates the revised contract and cost budget, and adds a billable line to the schedule of values.</p>
      </Card>

      <Card title="New change order">
        <form action={createChangeOrder} className="grid gap-3 p-4 text-sm">
          <input type="hidden" name="projectId" value={p.id} />
          <label className="grid gap-1"><span className="text-xs text-slate-600">Description</span><input name="title" required className="input" placeholder="e.g. Relocate RTU-3 curb" /></label>
          <label className="grid gap-1"><span className="text-xs text-slate-600">Contract change ($)</span><input name="contractAmount" required className="input text-right" inputMode="decimal" placeholder="0" /></label>
          <div className="grid gap-1">
            <span className="text-xs text-slate-600">Cost budget change by code</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2">
                <select name={`code${i}`} className="input flex-1" defaultValue="">
                  <option value="">— cost code —</option>
                  {codes.map((c) => <option key={c.id} value={c.id}>{codeLabel(c)}</option>)}
                </select>
                <input name={`cost${i}`} className="input w-24 text-right" inputMode="decimal" placeholder="$" />
              </div>
            ))}
          </div>
          <button className="btn justify-center">Create as pending</button>
        </form>
      </Card>
    </div>
  );
}
