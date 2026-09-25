import { Card, M, Progress, Badge } from "@/components/ui";
import { money } from "@/lib/format";
import type { LoadedProject } from "@/lib/queries";
import { saveForecast } from "@/app/actions";

const typeLabel: Record<string, string> = { LABOUR: "Labour", MATERIAL: "Material", SUB: "Subcontract", EQUIPMENT: "Equipment", OTHER: "Other" };

export function BudgetTab({ data }: { data: LoadedProject }) {
  const { econ: e, project: p } = data;
  const byType = Object.entries(
    e.rows.reduce<Record<string, { budget: number; actual: number; eac: number }>>((acc, r) => {
      const t = (acc[r.costType] ??= { budget: 0, actual: 0, eac: 0 });
      t.budget += r.revisedBudget; t.actual += r.actual; t.eac += r.eac;
      return acc;
    }, {}),
  );
  return (
    <div className="grid gap-5">
      <Card title="Budget vs. actual by cost code" action={<span className="text-xs text-slate-500">Edit “Est. to complete” to override remaining budget · blank = remaining budget</span>}>
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead><tr>
              <th>Cost code</th><th className="num">Original</th><th className="num">Approved COs</th><th className="num">Revised budget</th>
              <th className="num">Actual</th><th>% spent</th><th className="num">Est. to complete</th><th className="num">EAC</th><th className="num">Variance</th>
            </tr></thead>
            <tbody>
              {e.rows.map((r) => (
                <tr key={r.costCodeId}>
                  <td className="whitespace-nowrap"><span className="font-mono text-xs text-slate-500">{r.code}</span> <span className="text-slate-800">{r.name}</span></td>
                  <td className="num"><M v={r.originalBudget} /></td>
                  <td className="num">{r.approvedChanges ? <M v={r.approvedChanges} /> : "—"}</td>
                  <td className="num"><M v={r.revisedBudget} /></td>
                  <td className="num"><M v={r.actual} /></td>
                  <td><Progress valueBp={r.pctSpentBp} /></td>
                  <td className="num">
                    <form action={saveForecast} className="flex items-center justify-end gap-1">
                      <input type="hidden" name="projectId" value={p.id} />
                      <input type="hidden" name="costCodeId" value={r.costCodeId} />
                      <input name="etc" defaultValue={r.etcOverride != null ? Math.round(r.etcOverride / 100).toLocaleString("en-CA") : ""} placeholder={Math.round(r.etc / 100).toLocaleString("en-CA")}
                        className={`input w-24 text-right ${r.etcOverride != null ? "border-sky-300 bg-sky-50" : ""}`} aria-label={`Estimate to complete for ${r.code}`} />
                      <button className="btn btn-secondary btn-sm" title="Save forecast">✓</button>
                    </form>
                  </td>
                  <td className="num"><M v={r.eac} /></td>
                  <td className="num">{r.variance < 0 ? <Badge tone="red">{money(r.variance)}</Badge> : <M v={r.variance} />}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td>Total</td>
              <td className="num"><M v={e.originalBudget} /></td>
              <td className="num"><M v={e.revisedBudget - e.originalBudget} /></td>
              <td className="num"><M v={e.revisedBudget} /></td>
              <td className="num"><M v={e.costToDate} /></td>
              <td></td>
              <td className="num"><M v={e.etc} /></td>
              <td className="num"><M v={e.eac} /></td>
              <td className="num"><M v={e.revisedBudget - e.eac} signTone="variance" /></td>
            </tr></tfoot>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="By cost type">
          <table className="grid-table">
            <thead><tr><th>Type</th><th className="num">Revised budget</th><th className="num">Actual</th><th className="num">EAC</th><th className="num">Variance</th></tr></thead>
            <tbody>{byType.map(([t, v]) => (
              <tr key={t}><td>{typeLabel[t]}</td><td className="num"><M v={v.budget} /></td><td className="num"><M v={v.actual} /></td><td className="num"><M v={v.eac} /></td><td className="num"><M v={v.budget - v.eac} signTone="variance" /></td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="Labour">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm">
            <dt className="text-slate-500">Approved hours</dt><dd className="num">{(data.labour.approvedHours / 100).toLocaleString("en-CA")}</dd>
            <dt className="text-slate-500">Wages</dt><dd className="num">{money(data.labour.wages)}</dd>
            <dt className="text-slate-500">Burden (CPP/EI/WSIB/EHT/benefits)</dt><dd className="num">{money(data.labour.burden)}</dd>
            <dt className="text-slate-500">Burdened labour cost</dt><dd className="num font-medium">{money(data.labour.wages + data.labour.burden)}</dd>
            <dt className="text-slate-500">Hours pending approval</dt><dd className="num">{(data.labour.pendingHours / 100).toLocaleString("en-CA")}</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}
