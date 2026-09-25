import { db, schema as s } from "@/db";
import { and, eq, asc, desc } from "drizzle-orm";
import { getCompany, getCostCodes } from "@/lib/queries";
import { Card, PageHeader, M, Empty } from "@/components/ui";
import { fmtDate, hours } from "@/lib/format";
import { labourCost } from "@/lib/engine";
import { addTimeEntry, approveTime } from "@/app/actions";

export default async function Time() {
  const company = await getCompany();
  const [emps, projects, codes, pending] = await Promise.all([
    db.select().from(s.employees).where(eq(s.employees.companyId, company.id)).orderBy(asc(s.employees.name)),
    db.select().from(s.projects).where(and(eq(s.projects.companyId, company.id), eq(s.projects.status, "ACTIVE"))).orderBy(asc(s.projects.number)),
    getCostCodes(company.id),
    db.query.timeEntries.findMany({ where: eq(s.timeEntries.status, "SUBMITTED"), with: { employee: true, project: true, costCode: true }, orderBy: desc(s.timeEntries.date) }),
  ]);
  const labourCodes = codes.filter((c) => c.costType === "LABOUR");
  const today = new Date().toISOString().slice(0, 10);
  const totals = pending.reduce((a, t) => { const lc = labourCost(t.hoursX100, t.payRateCents, t.burdenBp); return { h: a.h + t.hoursX100, c: a.c + lc.total }; }, { h: 0, c: 0 });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Timesheets" subtitle="Approved time becomes burdened job cost and is pushed to QuickBooks as TimeActivity." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Log time">
          <form action={addTimeEntry} className="grid gap-3 p-4 text-sm">
            <label className="grid gap-1"><span className="text-xs text-slate-600">Employee</span>
              <select name="employeeId" required className="input">{emps.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.trade}</option>)}</select></label>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Project</span>
              <select name="projectId" required className="input">{projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></label>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Cost code</span>
              <select name="costCodeId" required className="input">{labourCodes.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1"><span className="text-xs text-slate-600">Date</span><input type="date" name="date" defaultValue={today} className="input" /></label>
              <label className="grid gap-1"><span className="text-xs text-slate-600">Hours</span><input name="hours" required inputMode="decimal" className="input text-right" placeholder="8" /></label>
            </div>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Notes</span><input name="notes" className="input" /></label>
            <button className="btn justify-center">Submit</button>
          </form>
        </Card>

        <Card title={`Waiting for approval (${pending.length})`} className="lg:col-span-2">
          {pending.length === 0 ? <Empty>No time waiting for approval.</Empty> : (
            <form action={approveTime}>
              <div className="max-h-[520px] overflow-auto">
                <table className="grid-table">
                  <thead><tr><th><span className="sr-only">Select</span></th><th>Date</th><th>Employee</th><th>Project</th><th>Code</th><th className="num">Hours</th><th className="num">Burdened cost</th></tr></thead>
                  <tbody>{pending.map((t) => (
                    <tr key={t.id}>
                      <td><input type="checkbox" name="ids" value={t.id} defaultChecked aria-label="Approve" /></td>
                      <td className="whitespace-nowrap text-xs">{fmtDate(t.date)}</td>
                      <td>{t.employee.name}</td>
                      <td>{t.project.number}</td>
                      <td className="font-mono text-xs">{t.costCode.code}</td>
                      <td className="num">{hours(t.hoursX100)}</td>
                      <td className="num"><M v={labourCost(t.hoursX100, t.payRateCents, t.burdenBp).total} cents /></td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr><td colSpan={5}>Total</td><td className="num">{hours(totals.h)}</td><td className="num"><M v={totals.c} cents /></td></tr></tfoot>
                </table>
              </div>
              <div className="flex justify-end border-t border-slate-100 px-4 py-3"><button className="btn">Approve selected</button></div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
