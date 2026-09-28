import Link from "next/link";
import { Card, M, StatusBadge, Empty } from "@/components/ui";
import { fmtDate, hours, money } from "@/lib/format";
import { labourCost } from "@/lib/engine";
import { UNCODED, type LoadedProject } from "@/lib/queries";
import { qboTxnUrl, qboTypeLabel, type QboLinkContext } from "@/lib/qbo-links";

/** "Open in QuickBooks" link for a transaction, or plain text when it didn't come from QuickBooks. */
export function QboRef({ ctx, type, id, source, doc, line }: { ctx: QboLinkContext; type: string | null; id: string | null; source?: string; doc: string | null; line?: string | null }) {
  const url = qboTxnUrl(ctx, type, id, source);
  const label = <>{qboTypeLabel(type, source)} <span className="font-mono">{doc ?? id}</span></>;
  return (
    <div className="whitespace-nowrap text-xs">
      {url ? <a href={url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline" title="Open in QuickBooks">{label} ↗</a> : label}
      {line && <span className="block text-[0.68rem] text-slate-400">QBO #{id} · line {line}</span>}
    </div>
  );
}

const codeLabel = (data: LoadedProject, code?: string) => {
  const row = code ? data.econ.rows.find((r) => r.costCodeId === code) : undefined;
  return row ? `${row.code} ${row.name}` : null;
};

function labourTotal(time: LoadedProject["time"]) {
  return time.filter((t) => t.status === "APPROVED").reduce((a, t) => a + labourCost(t.hoursX100, t.payRateCents, t.burdenBp).total, 0);
}

export function CostsTab({ data, ctx, code, region }: { data: LoadedProject; ctx: QboLinkContext; code?: string; region: string }) {
  const costs = code ? data.costs.filter((c) => (c.costCodeId ?? UNCODED) === code) : data.costs;
  const time = code ? data.time.filter((t) => t.costCodeId === code) : data.time;
  const linesTotal = costs.reduce((a, c) => a + c.amountCents, 0);
  const labour = labourTotal(time);
  const filterName = codeLabel(data, code);
  const recoverable = region !== "US"; // Canadian purchase tax is an input tax credit, not job cost
  return (
    <div className="grid gap-3">
      <p className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
        {filterName ? <><span className="font-medium">{filterName}</span> actual </> : <>Cost to date </>}
        <span className="font-semibold">{money(linesTotal + labour, { cents: true })}</span> = cost lines below {money(linesTotal, { cents: true })}
        {" "}+ approved labour <Link href={`?tab=time${code ? `&code=${code}` : ""}`} className="text-brand-600 underline">{money(labour, { cents: true })}</Link>
        {filterName && <> · <Link href="?tab=costs" className="text-brand-600 underline">show all cost codes</Link></>}
      </p>
      <Card title={`Cost lines (${costs.length})`} action={<span className="text-xs text-slate-500">Pre-tax job cost{recoverable ? " · recoverable sales tax (ITC) shown separately, not in cost" : " · sales tax included in cost"}</span>}>
        {costs.length === 0 ? <Empty>No cost lines{filterName ? " for this cost code" : ""}.</Empty> : (
          <div className="max-h-[640px] overflow-auto">
            <table className="grid-table">
              <thead><tr><th>Date</th><th>QuickBooks transaction</th><th>Vendor</th><th>Description</th><th>Cost code</th><th className="num">Amount</th>{recoverable && <th className="num">Tax (ITC)</th>}</tr></thead>
              <tbody>{costs.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDate(c.date)}</td>
                  <td><QboRef ctx={ctx} type={c.qboTxnType} id={c.qboTxnId} source={c.source} doc={c.docNumber} line={c.qboLineId} /></td>
                  <td>{c.vendor?.name}</td>
                  <td className="text-slate-600">{c.description}</td>
                  <td className="font-mono text-xs">{c.costCode?.code ?? <Link href="/costs" className="text-amber-700 underline">needs code</Link>}</td>
                  <td className="num">
                    <M v={c.amountCents} cents />
                    {c.qboExchangeRate && c.qboExchangeRate !== "1" && c.qboLineAmountCents != null && (
                      <span className="block text-[0.68rem] text-slate-400">{c.qboCurrency} {(c.qboLineAmountCents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })} × {c.qboExchangeRate}</span>
                    )}
                  </td>
                  {recoverable && <td className="num text-slate-500"><M v={c.taxCents} cents /></td>}
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5}>Total</td><td className="num"><M v={linesTotal} cents /></td>{recoverable && <td className="num"><M v={costs.reduce((a, c) => a + c.taxCents, 0)} cents /></td>}</tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function TimeTab({ data, code }: { data: LoadedProject; code?: string }) {
  const time = code ? data.time.filter((t) => t.costCodeId === code) : data.time;
  const filterName = codeLabel(data, code);
  return (
    <Card title={`Time entries (${time.length})${filterName ? ` · ${filterName}` : ""}`} action={<span className="text-xs text-slate-500">Labour cost = hours × pay rate × (1 + burden){filterName && <> · <Link href="?tab=time" className="text-brand-600 underline">show all</Link></>}</span>}>
      {time.length === 0 ? <Empty>No time logged.</Empty> : (
        <div className="max-h-[640px] overflow-auto">
          <table className="grid-table">
            <thead><tr><th>Date</th><th>Employee</th><th>Cost code</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Burden</th><th className="num">Labour cost</th><th>Status</th><th>Source</th></tr></thead>
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
                  <td className="text-xs text-slate-500">{t.qboTimeActivityId ? `QBO time #${t.qboTimeActivityId}` : "ProjectCost"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
