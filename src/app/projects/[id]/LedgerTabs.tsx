import { Card, M, StatusBadge, Empty } from "@/components/ui";
import { fmtDate, hours } from "@/lib/format";
import { labourCost } from "@/lib/engine";
import type { LoadedProject } from "@/lib/queries";

export function CostsTab({ data }: { data: LoadedProject }) {
  const { costs } = data;
  return (
    <Card title={`Cost transactions from QuickBooks (${costs.length})`} action={<span className="text-xs text-slate-500">Pre-tax job cost · recoverable HST (ITC) excluded</span>}>
      {costs.length === 0 ? <Empty>No costs posted yet.</Empty> : (
        <div className="max-h-[560px] overflow-auto">
          <table className="grid-table">
            <thead><tr><th>Date</th><th>Source</th><th>Doc #</th><th>Vendor</th><th>Description</th><th>Cost code</th><th className="num">Amount</th><th className="num">HST (ITC)</th></tr></thead>
            <tbody>{costs.map((c) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap text-xs">{fmtDate(c.date)}</td>
                <td className="text-xs text-slate-500">{c.source}</td>
                <td className="font-mono text-xs">{c.docNumber}</td>
                <td>{c.vendor?.name}</td>
                <td className="text-slate-600">{c.description}</td>
                <td className="font-mono text-xs">{c.costCode?.code}</td>
                <td className="num"><M v={c.amountCents} cents /></td>
                <td className="num text-slate-500"><M v={c.taxCents} cents /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function TimeTab({ data }: { data: LoadedProject }) {
  const { time } = data;
  return (
    <Card title={`Time entries (${time.length})`} action={<span className="text-xs text-slate-500">Labour cost = hours × pay rate × (1 + burden)</span>}>
      {time.length === 0 ? <Empty>No time logged.</Empty> : (
        <div className="max-h-[560px] overflow-auto">
          <table className="grid-table">
            <thead><tr><th>Date</th><th>Employee</th><th>Cost code</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Burden</th><th className="num">Labour cost</th><th>Status</th></tr></thead>
            <tbody>{time.map((t) => {
              const lc = labourCost(t.hoursX100, t.payRateCents, t.burdenBp);
              return (
                <tr key={t.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDate(t.date)}</td>
                  <td>{t.employee.name}<div className="text-xs text-slate-500">{t.employee.trade}</div></td>
                  <td className="font-mono text-xs">{t.costCode.code}</td>
                  <td className="num">{hours(t.hoursX100)}</td>
                  <td className="num"><M v={t.payRateCents} cents /></td>
                  <td className="num text-xs">{(t.burdenBp / 100).toFixed(1)}%</td>
                  <td className="num"><M v={lc.total} cents /></td>
                  <td><StatusBadge status={t.status} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
