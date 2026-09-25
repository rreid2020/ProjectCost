"use client";
import { useMemo, useState } from "react";
import { progressBill, type SovInput } from "@/lib/engine";
import { money, pct, toCents } from "@/lib/format";
import { createProgressBill } from "@/app/actions";

export function NewBillForm({ projectId, periodEnd, holdbackBp, taxBp, lines, pctCompleteBp }: {
  projectId: string; periodEnd: string; holdbackBp: number; taxBp: number; lines: SovInput[]; pctCompleteBp: number;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const bill = useMemo(
    () => progressBill(lines.map((l) => ({ ...l, thisPeriod: toCents(vals[l.sovLineId] ?? "0") })), holdbackBp, taxBp),
    [vals, lines, holdbackBp, taxBp],
  );
  const scheduled = bill.scheduledTotal;

  // Suggest this-period amounts that bring every line to the project's cost-to-cost % complete.
  const fillToPct = () => {
    const next: Record<string, string> = {};
    for (const l of lines) {
      const target = Math.min(l.scheduledValue, Math.round((l.scheduledValue * pctCompleteBp) / 10000));
      const amt = Math.max(0, target - l.previouslyBilled);
      if (amt) next[l.sovLineId] = (amt / 100).toFixed(2);
    }
    setVals(next);
  };

  return (
    <form action={createProgressBill}>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>#</th><th>Description</th><th className="num">Scheduled value</th><th className="num">Previously billed</th><th className="num">This period</th><th className="num">Completed to date</th><th className="num">%</th><th className="num">Balance to finish</th></tr></thead>
          <tbody>{bill.rows.map((r) => (
            <tr key={r.sovLineId} className={r.overBilled ? "bg-red-50" : ""}>
              <td className="font-mono text-xs">{r.lineNo}</td>
              <td>{r.description}</td>
              <td className="num">{money(r.scheduledValue, { cents: true })}</td>
              <td className="num text-slate-500">{money(r.previouslyBilled, { cents: true })}</td>
              <td className="num">
                <input name={`line_${r.sovLineId}`} value={vals[r.sovLineId] ?? ""} onChange={(e) => setVals({ ...vals, [r.sovLineId]: e.target.value })}
                  className="input w-28 text-right" inputMode="decimal" placeholder="0.00" aria-label={`This period for line ${r.lineNo}`} />
              </td>
              <td className="num">{money(r.completed, { cents: true })}</td>
              <td className="num text-xs">{pct(r.pctBp)}</td>
              <td className="num">{money(r.balanceToFinish, { cents: true })}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr>
            <td colSpan={2}>Total</td>
            <td className="num">{money(scheduled, { cents: true })}</td>
            <td className="num">{money(bill.completedTotal - bill.gross, { cents: true })}</td>
            <td className="num">{money(bill.gross, { cents: true })}</td>
            <td className="num">{money(bill.completedTotal, { cents: true })}</td>
            <td className="num text-xs">{scheduled ? pct(Math.round((bill.completedTotal / scheduled) * 10000)) : "—"}</td>
            <td className="num">{money(scheduled - bill.completedTotal, { cents: true })}</td>
          </tr></tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1"><span className="text-xs text-slate-600">Period end</span><input type="date" name="periodEnd" defaultValue={periodEnd} className="input" /></label>
          <button type="button" onClick={fillToPct} className="btn btn-secondary">Fill to {pct(pctCompleteBp, 0)} complete</button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 text-sm">
          <dt className="text-slate-500">Gross this period</dt><dd className="num">{money(bill.gross, { cents: true })}</dd>
          <dt className="text-slate-500">Less holdback {pct(holdbackBp, 0)}</dt><dd className="num">({money(bill.holdback, { cents: true })})</dd>
          <dt className="text-slate-500">HST {pct(taxBp, 0)}</dt><dd className="num">{money(bill.tax, { cents: true })}</dd>
          <dt className="font-medium">Net amount due</dt><dd className="num font-semibold">{money(bill.netDue, { cents: true })}</dd>
        </dl>
        <div className="flex flex-col items-end gap-1">
          {bill.errors.map((e) => <span key={e} className="text-xs text-red-700">{e}</span>)}
          <button className="btn" disabled={bill.gross === 0 || bill.errors.length > 0}>Save draft bill</button>
        </div>
      </div>
    </form>
  );
}
