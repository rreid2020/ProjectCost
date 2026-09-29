import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { companyOverhead, describeRate } from "@/lib/overhead";
import { Card, PageHeader, Stat, Badge, M } from "@/components/ui";
import { fmtDate, hours, money } from "@/lib/format";
import { saveOverheadSettings } from "@/app/actions";

const BASES = [
  ["labour_cost", "% of direct labour cost", "Overhead ÷ burdened labour cost. Standard for trades."],
  ["labour_hours", "Per labour hour", "Overhead ÷ labour hours. Not affected by pay-rate differences."],
  ["direct_cost", "% of total direct cost", "Overhead ÷ all job costs incl. labour. Suits sub- or material-heavy work."],
] as const;
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", year: "2-digit" });

export default async function Overhead({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { company, isAdmin } = await getTenant();
  const oh = await companyOverhead(company);
  const { saved } = await searchParams;
  const baseLabel = oh.basis === "labour_hours" ? `${hours(oh.base)} labour hours` : money(oh.base, { cents: true }) + (oh.basis === "labour_cost" ? " labour cost" : " direct cost");
  const included = oh.accounts.filter((a) => a.included);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Overhead" subtitle="Profit after overhead, per project. A management view: it doesn't change job cost, % complete, the WIP schedule or QuickBooks." />
      {saved && <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label="Overhead rate in use" value={describeRate(oh.rate, oh.basis)}
          sub={oh.mode === "manual" ? `Entered manually · calculated would be ${describeRate(oh.calculatedRate, oh.basis)}` : "Calculated from QuickBooks"} />
        <Stat label={`Overhead pool · ${fmtDate(oh.period.start)} – ${fmtDate(oh.period.end)}`} value={money(oh.pool)} sub={`${included.length} accounts from the Profit and Loss, less job costs`} />
        <Stat label="Base, same period" value={baseLabel} sub={oh.calculatedRate == null ? "No base in this period yet: enter a rate, or pick another base" : `${money(oh.pool)} ÷ ${baseLabel}`} />
      </div>

      {!oh.hasData && (
        <p className="mt-5 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No Profit and Loss yet. <Link href="/settings" className="underline">Sync from QuickBooks</Link> to load the last 12 months, or enter a rate below.
        </p>
      )}

      <form action={saveOverheadSettings} className="mt-5 grid gap-5">
        <Card title="How overhead is allocated">
          <fieldset disabled={!isAdmin} className="grid gap-4 p-4 text-sm md:grid-cols-2">
            <div className="grid gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Base</span>
              {BASES.map(([key, label, help]) => (
                <label key={key} className="flex items-start gap-2">
                  <input type="radio" name="basis" value={key} defaultChecked={oh.basis === key} className="mt-0.5" />
                  <span><span className="font-medium">{label}</span><span className="block text-xs text-slate-500">{help}</span></span>
                </label>
              ))}
            </div>
            <div className="grid content-start gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Rate</span>
              <label className="flex items-start gap-2">
                <input type="radio" name="mode" value="calculated" defaultChecked={oh.mode !== "manual"} className="mt-0.5" />
                <span><span className="font-medium">Calculate from QuickBooks</span>
                  <span className="block text-xs text-slate-500">Last 12 complete months: pool ÷ base. Currently {describeRate(oh.calculatedRate, oh.basis)}.</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="mode" value="manual" defaultChecked={oh.mode === "manual"} className="mt-0.5" />
                <span className="grid gap-1"><span className="font-medium">Use my own rate</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <input name="manualRate" inputMode="decimal" defaultValue={company.overheadManualRate != null ? company.overheadManualRate / 100 : ""} className="input w-24 text-right" aria-label="Overhead rate" />
                    % of base, or $ per hour when the base is labour hours
                  </span></span>
              </label>
            </div>
          </fieldset>
        </Card>

        <Card title={`Overhead pool · Profit and Loss (accrual) ${fmtDate(oh.period.start)} – ${fmtDate(oh.period.end)}`}
          action={<span className="text-xs text-slate-500">To check: run Profit and Loss in QuickBooks for these dates, by month</span>}>
          {oh.accounts.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">No expense accounts yet.</p> : (
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead><tr><th>In pool</th><th>Account</th><th className="num">Profit and Loss</th><th className="num">Less job costs</th><th className="num">In pool</th></tr></thead>
                <tbody>{oh.accounts.map((a) => (
                  <tr key={a.qboAccountId} className={a.included ? "" : "text-slate-400"}>
                    <td>
                      <input type="hidden" name="account" value={a.qboAccountId} />
                      <input type="checkbox" name="include" value={a.qboAccountId} defaultChecked={a.included} disabled={!isAdmin} aria-label={`Include ${a.name}`} />
                    </td>
                    <td>
                      <details>
                        <summary className="cursor-pointer">{a.name} {a.section === "OtherExpenses" && <Badge>Other expense</Badge>}</summary>
                        <div className="mt-1 grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-slate-500 sm:grid-cols-6">
                          {oh.period.months.map((m) => <span key={m} className="flex justify-between gap-2"><span>{monthLabel(m)}</span><span className="num">{money(a.byMonth[m], { cents: true })}</span></span>)}
                        </div>
                      </details>
                    </td>
                    <td className="num"><M v={a.total} cents /></td>
                    <td className="num">{a.jobCosts ? <M v={-a.jobCosts} cents /> : "—"}</td>
                    <td className="num font-medium">{a.included ? <M v={a.net} cents /> : "—"}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={4}>Overhead pool</td><td className="num"><M v={oh.pool} cents /></td></tr></tfoot>
              </table>
            </div>
          )}
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Operating expenses are in by default; other expenses (interest, FX) and cost of goods sold are not. &ldquo;Less job costs&rdquo; removes costs tagged to
            projects that posted to the same account, so nothing is counted twice. Click an account to see its months.
          </p>
        </Card>

        <Card title="Base for the same period">
          <dl className="grid grid-cols-1 gap-2 p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">Burdened labour cost</dt><dd className="font-medium">{money(oh.bases.labourCostTotal, { cents: true })}</dd></div>
            <div><dt className="text-xs text-slate-500">Labour hours</dt><dd className="font-medium">{hours(oh.bases.labourHours)}</dd></div>
            <div><dt className="text-xs text-slate-500">Direct cost (cost lines + labour)</dt><dd className="font-medium">{money(oh.bases.directCost, { cents: true })}</dd></div>
          </dl>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Approved time and project cost lines dated in the period, across all projects.</p>
        </Card>

        {isAdmin && <div><button className="btn">Save</button></div>}
      </form>
    </div>
  );
}
