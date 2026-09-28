import { Card } from "@/components/ui";
import type { LoadedProject } from "@/lib/queries";
import { updateProject } from "@/app/actions";

const field = "grid gap-1";
const label = "text-xs text-slate-600";

export function SetupTab({ data, saved }: { data: LoadedProject; saved: boolean }) {
  const p = data.project;
  return (
    <Card title="Project setup" action={p.qboProjectId ? <span className="text-xs text-slate-500">Linked to QuickBooks customer #{p.qboProjectId}</span> : undefined}>
      <form action={updateProject} className="grid gap-4 p-4 text-sm">
        <input type="hidden" name="projectId" value={p.id} />
        {saved && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saved.</p>}
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className={field}><span className={label}>Project number</span><input name="number" required defaultValue={p.number} className="input" /></label>
          <label className={field}><span className={label}>Name</span><input name="name" required defaultValue={p.name} className="input" /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={field}><span className={label}>Status</span>
            <select name="status" defaultValue={p.status} className="input"><option value="BID">Bid</option><option value="ACTIVE">Active</option><option value="COMPLETE">Complete</option></select></label>
          <label className={field}><span className={label}>Contract type</span>
            <select name="contractType" defaultValue={p.contractType} className="input"><option value="FIXED">Fixed price</option><option value="TM">Time &amp; materials</option><option value="COST_PLUS">Cost plus</option></select></label>
          <label className={field}><span className={label}>Original contract value</span>
            <input name="contract" inputMode="decimal" defaultValue={(p.originalContractCents / 100).toFixed(2)} className="input text-right" /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={field}><span className={label}>Holdback %</span><input name="holdbackPct" inputMode="decimal" defaultValue={p.holdbackBp / 100} className="input text-right" /></label>
          <label className={field}><span className={label}>Sales tax %</span><input name="taxPct" inputMode="decimal" defaultValue={p.taxBp / 100} className="input text-right" /></label>
          <label className={field}><span className={label}>Project manager</span><input name="projectManager" defaultValue={p.projectManager ?? ""} className="input" /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={field}><span className={label}>Start date</span><input type="date" name="startDate" defaultValue={p.startDate ?? ""} className="input" /></label>
          <label className={field}><span className={label}>End date</span><input type="date" name="endDate" defaultValue={p.endDate ?? ""} className="input" /></label>
        </div>
        <p className="text-xs text-slate-500">Approved change orders add to the contract value. The budget is entered by cost code on the Budget tab.</p>
        <div><button className="btn">Save</button></div>
      </form>
    </Card>
  );
}
