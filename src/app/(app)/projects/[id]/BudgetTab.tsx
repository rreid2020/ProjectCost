import Link from "next/link";
import { Card, M, Progress, Badge } from "@/components/ui";
import { money, codeLabel } from "@/lib/format";
import { UNCODED, type LoadedProject } from "@/lib/queries";
import type { OverheadResult } from "@/lib/engine";
import { saveBudgetLine, saveForecast } from "@/app/actions";

const typeLabel: Record<string, string> = { LABOUR: "Labour", MATERIAL: "Material", SUB: "Subcontract", EQUIPMENT: "Equipment", OTHER: "Other" };

type OverheadView = OverheadResult & { rateLabel: string; basis: string };

export function BudgetTab({ data, overhead }: { data: LoadedProject; overhead: OverheadView | null }) {
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
      {e.originalBudget === 0 && (
        <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {p.projectType === "CONTRACT"
            ? <>This project has no budget yet, so % complete and earned revenue aren&apos;t meaningful. Enter the original budget by cost code below, and the contract value under Setup.</>
            : <>This project has no budget yet. Enter it by cost code below to track variance and forecast.</>}
        </p>
      )}
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
                  <td className="num">
                    {r.costCodeId === UNCODED ? <M v={r.originalBudget} /> : (
                      <form action={saveBudgetLine} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="projectId" value={p.id} />
                        <input type="hidden" name="costCodeId" value={r.costCodeId} />
                        <input name="amount" defaultValue={r.originalBudget ? Math.round(r.originalBudget / 100).toLocaleString("en-CA") : ""} placeholder="0"
                          className="input w-24 text-right" aria-label={`Original budget for ${r.code}`} />
                        <button className="btn btn-secondary btn-sm" title="Save budget">✓</button>
                      </form>
                    )}
                  </td>
                  <td className="num">{r.approvedChanges ? <M v={r.approvedChanges} /> : "—"}</td>
                  <td className="num"><M v={r.revisedBudget} /></td>
                  <td className="num"><Link href={`?tab=costs&code=${r.costCodeId}`} className="text-brand-700 hover:underline" title="See the transactions behind this amount"><M v={r.actual} /></Link></td>
                  <td><Progress valueBp={r.pctSpentBp} /></td>
                  <td className="num">
                    {r.costCodeId === UNCODED ? <a href="/costs" className="text-xs text-amber-700 underline">Code these costs</a> :
                    <form action={saveForecast} className="flex items-center justify-end gap-1">
                      <input type="hidden" name="projectId" value={p.id} />
                      <input type="hidden" name="costCodeId" value={r.costCodeId} />
                      <input name="etc" defaultValue={r.etcOverride != null ? Math.round(r.etcOverride / 100).toLocaleString("en-CA") : ""} placeholder={Math.round(r.etc / 100).toLocaleString("en-CA")}
                        className={`input w-24 text-right ${r.etcOverride != null ? "border-sky-300 bg-sky-50" : ""}`} aria-label={`Estimate to complete for ${r.code}`} />
                      <button className="btn btn-secondary btn-sm" title="Save forecast">✓</button>
                    </form>}
                  </td>
                  <td className="num"><M v={r.eac} /></td>
                  <td className="num">{r.variance < 0 ? <Badge tone="red">{money(r.variance)}</Badge> : <M v={r.variance} />}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
            <tr>
              <td colSpan={9} className="!font-normal">
                <form action={saveBudgetLine} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="projectId" value={p.id} />
                  <span className="text-xs text-slate-500">Add to budget</span>
                  <select name="costCodeId" required className="input w-64" defaultValue="">
                    <option value="" disabled>Cost code…</option>
                    {data.codes.filter((c) => c.active && !e.rows.some((r) => r.costCodeId === c.id)).map((c) => <option key={c.id} value={c.id}>{codeLabel(c)}</option>)}
                  </select>
                  <input name="amount" required inputMode="decimal" placeholder="Amount" className="input w-28 text-right" />
                  <button className="btn btn-sm">Add</button>
                </form>
              </td>
            </tr>
            <tr>
              <td>Total</td>
              <td className="num"><M v={e.originalBudget} /></td>
              <td className="num"><M v={e.revisedBudget - e.originalBudget} /></td>
              <td className="num"><M v={e.revisedBudget} /></td>
              <td className="num"><Link href="?tab=costs" className="text-brand-700 hover:underline"><M v={e.costToDate} /></Link></td>
              <td></td>
              <td className="num"><M v={e.etc} /></td>
              <td className="num"><M v={e.eac} /></td>
              <td className="num"><M v={e.revisedBudget - e.eac} signTone="variance" /></td>
            </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className={`grid gap-5 ${p.projectType === "CONTRACT" ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
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
        {p.projectType === "CONTRACT" && <Card title="Overhead" action={<Link href="/overhead" className="text-xs text-brand-600 hover:underline">How the rate is set →</Link>}>
          {!overhead ? <p className="px-4 py-3 text-sm text-slate-500">No overhead rate yet. <Link href="/overhead" className="underline">Set it up</Link>.</p> : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm">
              <dt className="text-slate-500">Rate</dt><dd className="text-right">{overhead.rateLabel}</dd>
              <dt className="text-slate-500">Base to date</dt><dd className="num">{overhead.basis === "labour_hours" ? `${(overhead.baseToDate / 100).toLocaleString("en-CA")} h` : money(overhead.baseToDate)}</dd>
              <dt className="text-slate-500">Overhead to date</dt><dd className="num">{money(overhead.toDate)}</dd>
              <dt className="text-slate-500">Overhead at completion</dt><dd className="num">{money(overhead.atCompletion)}</dd>
              <dt className="text-slate-500">Projected gross profit</dt><dd className="num">{money(e.projectedProfit)}</dd>
              <dt className="font-medium text-slate-700">Profit after overhead</dt><dd className={`num font-medium ${overhead.profitAfterOverhead < 0 ? "text-red-700" : ""}`}>{money(overhead.profitAfterOverhead)}</dd>
            </dl>
          )}
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Management view only. Not in job cost, % complete or WIP.</p>
        </Card>}
      </div>
    </div>
  );
}
