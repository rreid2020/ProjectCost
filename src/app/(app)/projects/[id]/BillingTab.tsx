import { Card, M, StatusBadge, Empty } from "@/components/ui";
import { fmtDate, money, pct } from "@/lib/format";
import { progressBill } from "@/lib/engine";
import type { LoadedProject } from "@/lib/queries";
import { postProgressBill, deleteProgressBill } from "@/app/actions";
import { NewBillForm } from "./NewBillForm";
import { QboRef } from "./LedgerTabs";
import type { QboLinkContext } from "@/lib/qbo-links";

export function BillingTab({ data, ctx }: { data: LoadedProject; ctx: QboLinkContext }) {
  const { sov, bills, project: p } = data;
  const posted = bills.filter((b) => b.status === "POSTED");
  const prevByLine = new Map<string, number>();
  for (const b of posted) for (const l of b.lines) prevByLine.set(l.sovLineId, (prevByLine.get(l.sovLineId) ?? 0) + l.thisPeriodCents);
  const hasDraft = bills.some((b) => b.status === "DRAFT");

  const billSummary = (b: (typeof bills)[number]) =>
    progressBill(b.lines.map((l) => ({ sovLineId: l.sovLineId, lineNo: 0, description: "", scheduledValue: 0, previouslyBilled: 0, thisPeriod: l.thisPeriodCents })), p.holdbackBp, p.taxBp);

  const today = new Date();
  const eom = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const billedHere = data.econ.billedToDate - data.billedInQbo;
  return (
    <div className="grid gap-5">
      <p className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
        Billed to date <span className="font-semibold">{money(data.econ.billedToDate, { cents: true })}</span> = progress bills posted in ProjectCost {money(billedHere, { cents: true })}
        {" "}+ invoices and credit memos in QuickBooks {money(data.billedInQbo, { cents: true })} (pre-tax)
      </p>
      {sov.length === 0 ? (
        <Card title="Progress billing">
          <p className="px-4 py-3 text-sm text-slate-600">This project has no schedule of values yet, so progress bills can&apos;t be drafted here.{data.qboInvoices.length ? " Invoices raised in QuickBooks are listed below and count toward billed to date." : ""}</p>
        </Card>
      ) : hasDraft ? (
        <Card title="Draft progress bill">
          <p className="px-4 py-3 text-sm text-slate-600">There is a draft bill below. Post or delete it before starting the next one.</p>
        </Card>
      ) : (
        <Card title="New progress bill (schedule of values)" action={<span className="text-xs text-slate-500">Holdback {pct(p.holdbackBp, 0)} · HST {pct(p.taxBp, 0)} on amount net of holdback</span>}>
          <NewBillForm
            projectId={p.id} periodEnd={eom} holdbackBp={p.holdbackBp} taxBp={p.taxBp} pctCompleteBp={data.econ.pctCompleteBp}
            lines={sov.map((l) => ({ sovLineId: l.id, lineNo: l.lineNo, description: l.description, scheduledValue: l.scheduledValueCents, previouslyBilled: prevByLine.get(l.id) ?? 0, thisPeriod: 0 }))}
          />
        </Card>
      )}

      {data.qboInvoices.length > 0 && (
        <Card title="Invoiced in QuickBooks" action={<span className="text-xs text-slate-500">Pre-tax · counts toward billed to date · {money(data.billedInQbo)}</span>}>
          <table className="grid-table">
            <thead><tr><th>Date</th><th>QuickBooks transaction</th><th className="num">Total in QuickBooks</th><th className="num">Less tax</th><th className="num">Billed (pre-tax)</th></tr></thead>
            <tbody>{data.qboInvoices.map((i) => (
              <tr key={i.id}>
                <td className="text-xs">{fmtDate(i.date)}</td>
                <td><QboRef ctx={ctx} type={i.qboTxnType} id={i.qboTxnId} doc={i.docNumber} /></td>
                <td className="num">{i.totalCents != null ? <>{i.currency && i.exchangeRate !== "1" ? `${i.currency} ` : ""}<M v={i.totalCents} cents /></> : "—"}</td>
                <td className="num text-slate-500">{i.taxCents != null ? <M v={-i.taxCents} cents /> : "—"}</td>
                <td className="num font-medium"><M v={i.amountCents} cents />{i.exchangeRate && i.exchangeRate !== "1" && <span className="block text-[0.68rem] text-slate-400">× {i.exchangeRate}</span>}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={4}>Billed in QuickBooks</td><td className="num"><M v={data.billedInQbo} cents /></td></tr></tfoot>
          </table>
        </Card>
      )}

      <Card title="Billing history">
        {bills.length === 0 ? <Empty>No progress bills yet.</Empty> : (
          <table className="grid-table">
            <thead><tr><th>#</th><th>Period end</th><th>Status</th><th>QBO invoice</th><th className="num">Gross this period</th><th className="num">Holdback</th><th className="num">HST</th><th className="num">Net due</th><th></th></tr></thead>
            <tbody>{[...bills].reverse().map((b) => {
              const s = billSummary(b);
              return (
                <tr key={b.id}>
                  <td className="font-mono text-xs">PB-{b.number}</td>
                  <td className="text-xs">{fmtDate(b.periodEnd)}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td className="font-mono text-xs text-slate-500">{b.qboInvoiceId ?? (b.status === "POSTED" ? "queued" : "—")}</td>
                  <td className="num"><M v={s.gross} cents /></td>
                  <td className="num"><M v={s.holdback} cents /></td>
                  <td className="num"><M v={s.tax} cents /></td>
                  <td className="num font-medium"><M v={s.netDue} cents /></td>
                  <td className="text-right whitespace-nowrap">
                    {b.status === "DRAFT" && (
                      <span className="inline-flex gap-1">
                        <form action={postProgressBill}><input type="hidden" name="id" value={b.id} /><button className="btn btn-sm">Post → QBO invoice</button></form>
                        <form action={deleteProgressBill}><input type="hidden" name="id" value={b.id} /><button className="btn btn-secondary btn-sm">Delete</button></form>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
