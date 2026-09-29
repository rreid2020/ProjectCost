import Link from "next/link";
import { Card, M, Empty, Badge } from "@/components/ui";
import { fmtDate, money } from "@/lib/format";
import type { LoadedProject } from "@/lib/queries";
import { addUnitEvent, deleteUnitEvent } from "@/app/actions";

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return <ul className="grid gap-1 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">{list.map((w) => <li key={w}>{w}</li>)}</ul>;
}

export function InventoryTab({ data }: { data: LoadedProject }) {
  const f = data.inventory!;
  const p = data.project;
  const today = new Date().toISOString().slice(0, 10);
  const perUnit = f.completedUnits ? Math.round(f.transferredToFG / f.completedUnits) : f.remainingUnits ? Math.round(f.wip / f.remainingUnits) : 0;
  const byEvent = new Map([...f.transfers, ...f.reliefs].filter((x) => x.eventId).map((x) => [x.eventId!, x.amount]));
  return (
    <div className="grid gap-5">
      <Warnings list={f.warnings} />
      <Card title="Where the cost sits" action={<Link href="/wip#entries" className="text-xs text-brand-600 hover:underline">Month-end entries →</Link>}>
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead><tr><th>Units</th><th className="num">Planned</th><th className="num">In process</th><th className="num">Finished, on hand</th><th className="num">Sold</th></tr></thead>
            <tbody><tr><td>Count</td><td className="num">{p.unitsPlanned}</td><td className="num">{f.remainingUnits}</td><td className="num">{f.fgUnits}</td><td className="num">{f.soldUnits}</td></tr></tbody>
          </table>
          <table className="grid-table">
            <thead><tr><th>Balance</th><th className="num">Cost to date</th><th className="num">Work in process</th><th className="num">Finished goods</th><th className="num">Cost of goods sold</th></tr></thead>
            <tbody><tr>
              <td>Amount</td>
              <td className="num"><Link href="?tab=costs" className="hover:underline"><M v={f.costToDate} cents /></Link></td>
              <td className="num"><M v={f.wip} cents /></td><td className="num"><M v={f.fg} cents /></td><td className="num"><M v={f.cogs} cents /></td>
            </tr></tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Cost per unit {f.completedUnits ? "completed" : "so far"}: {money(perUnit, { cents: true })}. Completing units moves their share of work in process to finished goods;
          selling moves finished goods to cost of goods sold at average cost.
        </p>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Record units">
          <form action={addUnitEvent} className="grid gap-3 p-4 text-sm">
            <input type="hidden" name="projectId" value={p.id} />
            <div className="grid grid-cols-3 gap-2">
              <label className="grid gap-1"><span className="text-xs text-slate-600">What happened</span>
                <select name="kind" className="input"><option value="COMPLETED">Completed</option><option value="SOLD">Sold</option></select></label>
              <label className="grid gap-1"><span className="text-xs text-slate-600">Date</span><input type="date" name="date" defaultValue={today} required className="input" /></label>
              <label className="grid gap-1"><span className="text-xs text-slate-600">Units</span><input name="units" inputMode="numeric" required defaultValue="1" className="input text-right" /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1"><span className="text-xs text-slate-600">Sale amount (if sold, optional)</span><input name="saleAmount" inputMode="decimal" className="input text-right" /></label>
              <label className="grid gap-1"><span className="text-xs text-slate-600">Note</span><input name="notes" className="input" placeholder="e.g. Lot 12 closed" /></label>
            </div>
            <div><button className="btn">Record</button></div>
          </form>
        </Card>
        <Card title="History">
          {data.unitEvents.length === 0 ? <Empty>No units completed or sold yet.</Empty> : (
            <table className="grid-table">
              <thead><tr><th>Date</th><th>Event</th><th className="num">Units</th><th className="num">Cost moved</th><th className="num">Sale</th><th></th></tr></thead>
              <tbody>{data.unitEvents.map((e) => (
                <tr key={e.id}>
                  <td className="text-xs">{fmtDate(e.date)}</td>
                  <td><Badge tone={e.kind === "SOLD" ? "green" : "blue"}>{e.kind === "SOLD" ? "Sold" : "Completed"}</Badge>{e.notes && <span className="ml-2 text-xs text-slate-500">{e.notes}</span>}</td>
                  <td className="num">{e.units}</td>
                  <td className="num">{byEvent.has(e.id) ? <M v={byEvent.get(e.id)!} cents /> : "—"}</td>
                  <td className="num">{e.saleAmountCents != null ? <M v={e.saleAmountCents} cents /> : "—"}</td>
                  <td><form action={deleteUnitEvent}><input type="hidden" name="id" value={e.id} /><button className="text-xs text-slate-500 underline">Delete</button></form></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

export function CapitalTab({ data }: { data: LoadedProject }) {
  const f = data.capital!;
  const p = data.project;
  return (
    <div className="grid gap-5">
      <Warnings list={f.warnings} />
      <Card title="Construction in progress" action={<Link href="/wip#entries" className="text-xs text-brand-600 hover:underline">Month-end entries →</Link>}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Cost to date</dt><dd className="font-medium"><Link href="?tab=costs" className="hover:underline">{money(f.costToDate, { cents: true })}</Link></dd></div>
          <div><dt className="text-xs text-slate-500">In construction in progress</dt><dd className="font-medium">{money(f.cip, { cents: true })}</dd></div>
          <div><dt className="text-xs text-slate-500">Capitalized</dt><dd className="font-medium">{f.capitalizedOn ? `${money(f.capitalized, { cents: true })} on ${fmtDate(f.capitalizedOn)}` : "Not yet"}</dd></div>
          <div><dt className="text-xs text-slate-500">Budget / forecast</dt><dd className="font-medium">{money(data.econ.revisedBudget)} / {money(data.econ.eac)}</dd></div>
        </dl>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          {p.inServiceDate ? <>Placed in service {fmtDate(p.inServiceDate)}{p.assetAccountId ? "" : " — choose the fixed-asset account on the Setup tab"}.</> : <>When it&apos;s placed in service, set the in-service date and fixed-asset account on the <Link href="?tab=setup" className="underline">Setup</Link> tab; the capitalization entry is drafted for that month.</>}
        </p>
      </Card>
    </div>
  );
}
