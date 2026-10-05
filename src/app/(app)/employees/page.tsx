import Link from "next/link";
import { and, asc, count, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, Badge, Empty } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { updateEmployee } from "@/app/actions";

export default async function Employees() {
  const { company, isAdmin } = await getTenant();
  const [emps, noRate] = await Promise.all([
    db.select().from(s.employees).where(eq(s.employees.companyId, company.id)).orderBy(asc(s.employees.name)),
    db.select({ employeeId: s.timeEntries.employeeId, n: count() }).from(s.timeEntries)
      .where(and(eq(s.timeEntries.companyId, company.id), eq(s.timeEntries.payRateCents, 0))).groupBy(s.timeEntries.employeeId),
  ]);
  const unrated = new Map(noRate.map((r) => [r.employeeId, r.n]));
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Employees" subtitle="Labour job cost = approved hours × pay rate × (1 + burden)."
        actions={<span className="flex gap-2"><Link href="/imports" className="btn btn-secondary">Import</Link><Link href="/settings" className="btn btn-secondary">Sync from QuickBooks</Link></span>} />
      <p className="mb-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        <span className="font-medium">Where employees come from:</span> QuickBooks (add them under <span className="font-medium">Payroll → Employees</span>, then <span className="font-medium">Sync now</span>),
        or a spreadsheet on <Link href="/imports" className="underline">Import data</Link> (an <span className="font-medium">Employees &amp; rates</span> file, or a <span className="font-medium">Time</span> file adds people as it goes).
        Pay rate, burden and trade are set here or in that spreadsheet; accounting systems don&apos;t carry them for job costing. Subcontractors aren&apos;t employees: their cost arrives on their bills.
      </p>
      <Card>
        {emps.length === 0 ? (
          <Empty>
            No employees yet. Add them in QuickBooks and <Link href="/settings" className="underline">sync</Link>, or <Link href="/imports" className="underline">import a spreadsheet</Link>.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead><tr><th>Employee</th><th>Trade / role</th><th className="num">Pay rate /h</th><th className="num">Burden %</th><th className="num">Bill rate /h</th><th></th></tr></thead>
              <tbody>{emps.map((e) => (
                <tr key={e.id} className={e.active ? "" : "opacity-60"}>
                  <td>
                    <div className="font-medium text-slate-800">{e.name}</div>
                    <div className="flex gap-1">
                      {!e.active && <Badge>Inactive</Badge>}
                      {e.payRateCents === 0 && <Badge tone="amber">No pay rate</Badge>}
                      {unrated.get(e.id) ? <Badge tone="amber">{unrated.get(e.id)} time entries at $0</Badge> : null}
                    </div>
                  </td>
                  {isAdmin ? (
                    <td colSpan={5}>
                      <form action={updateEmployee} className="flex flex-wrap items-center justify-end gap-2">
                        <input type="hidden" name="id" value={e.id} />
                        <input name="trade" defaultValue={e.trade} className="input w-48" aria-label="Trade" />
                        <input name="payRate" inputMode="decimal" defaultValue={(e.payRateCents / 100).toFixed(2)} className="input w-24 text-right" aria-label="Pay rate" />
                        <input name="burdenPct" inputMode="decimal" defaultValue={e.burdenBp / 100} className="input w-20 text-right" aria-label="Burden percent" />
                        <input name="billRate" inputMode="decimal" defaultValue={(e.billRateCents / 100).toFixed(2)} className="input w-24 text-right" aria-label="Bill rate" />
                        <button className="btn btn-secondary btn-sm">Save</button>
                      </form>
                    </td>
                  ) : (
                    <><td>{e.trade}</td><td className="num">{money(e.payRateCents, { cents: true })}</td><td className="num">{pct(e.burdenBp)}</td><td className="num">{money(e.billRateCents, { cents: true })}</td><td /></>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {isAdmin && emps.length > 0 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Burden covers CPP/EI/WSIB/EHT and benefits as a % of wages. Saving a pay rate also fills in time entries that were imported without one; entries that already have a rate keep it.</p>}
      </Card>
    </div>
  );
}
