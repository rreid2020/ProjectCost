import { Card, Badge } from "@/components/ui";
import type { LoadedProject } from "@/lib/queries";
import { updateProject, addProjectLink, removeProjectLink } from "@/app/actions";

const field = "grid gap-1";
const label = "text-xs text-slate-600";
const KIND_LABEL: Record<string, string> = { customer: "Customer", class: "Class", department: "Location", account: "GL account" };

export type SetupOptions = {
  customers: { id: string; name: string; qboId: string | null }[];
  classes: { qboId: string; name: string }[];
  locations: { qboId: string; name: string }[];
  accounts: { qboId: string; fullName: string; accountType: string }[];
};

function LinkForm({ projectId, kind, options }: { projectId: string; kind: string; options: { value: string; label: string }[] }) {
  if (!options.length) return null;
  return (
    <form action={addProjectLink} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="kind" value={kind} />
      <span className="w-40 text-xs text-slate-600">{KIND_LABEL[kind]}</span>
      <select name="qboId" required defaultValue="" className="input w-72">
        <option value="" disabled>Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button className="btn btn-secondary btn-sm">Link</button>
    </form>
  );
}

export function SetupTab({ data, saved, options }: { data: LoadedProject; saved: boolean; options: SetupOptions }) {
  const p = data.project;
  const linkedIds = new Set(data.links.map((l) => `${l.kind}|${l.qboId}`));
  const free = <T,>(kind: string, list: T[], id: (x: T) => string, name: (x: T) => string) =>
    list.filter((x) => !linkedIds.has(`${kind}|${id(x)}`)).map((x) => ({ value: id(x), label: name(x) }));
  const assetAccounts = options.accounts.filter((a) => /Fixed Asset|Other Asset/.test(a.accountType));

  return (
    <div className="grid gap-5">
      <Card title="Project setup">
        <form action={updateProject} className="grid gap-4 p-4 text-sm">
          <input type="hidden" name="projectId" value={p.id} />
          {saved && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saved.</p>}
          <div className="grid gap-3 sm:grid-cols-[12rem_10rem_1fr]">
            <label className={field}><span className={label}>Type</span>
              <select name="projectType" defaultValue={p.projectType} className="input">
                <option value="CONTRACT">Customer contract</option><option value="CAPITAL">Capital project</option><option value="INVENTORY">Build for sale</option>
              </select></label>
            <label className={field}><span className={label}>Project number</span><input name="number" required defaultValue={p.number} className="input" /></label>
            <label className={field}><span className={label}>Name</span><input name="name" required defaultValue={p.name} className="input" /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={field}><span className={label}>Customer {p.projectType === "CONTRACT" ? "(required for contracts)" : "(optional)"}</span>
              <select name="customerId" defaultValue={p.customerId ?? ""} className="input">
                <option value="">None</option>
                {options.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label className={field}><span className={label}>Status</span>
              <select name="status" defaultValue={p.status} className="input"><option value="BID">Bid</option><option value="ACTIVE">Active</option><option value="COMPLETE">Complete</option></select></label>
            <label className={field}><span className={label}>Project manager</span><input name="projectManager" defaultValue={p.projectManager ?? ""} className="input" /></label>
          </div>

          <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-3">
            <legend className="px-1 text-xs font-medium text-slate-600">Customer contract</legend>
            <label className={field}><span className={label}>Contract type</span>
              <select name="contractType" defaultValue={p.contractType} className="input"><option value="FIXED">Fixed price</option><option value="TM">Time &amp; materials</option><option value="COST_PLUS">Cost plus</option></select></label>
            <label className={field}><span className={label}>Original contract value</span>
              <input name="contract" inputMode="decimal" defaultValue={(p.originalContractCents / 100).toFixed(2)} className="input text-right" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className={field}><span className={label}>Holdback %</span><input name="holdbackPct" inputMode="decimal" defaultValue={p.holdbackBp / 100} className="input text-right" /></label>
              <label className={field}><span className={label}>Sales tax %</span><input name="taxPct" inputMode="decimal" defaultValue={p.taxBp / 100} className="input text-right" /></label>
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-xs font-medium text-slate-600">Build for sale</legend>
              <label className={field}><span className={label}>Units this project produces</span>
                <input name="unitsPlanned" inputMode="numeric" defaultValue={p.unitsPlanned} className="input w-28 text-right" /></label>
              <p className="text-xs text-slate-500">One for a spec home or custom unit; more for a production run. You can change it as the project goes.</p>
            </fieldset>
            <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-xs font-medium text-slate-600">Capital project</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className={field}><span className={label}>In-service date</span><input type="date" name="inServiceDate" defaultValue={p.inServiceDate ?? ""} className="input" /></label>
                <label className={field}><span className={label}>Capitalize to</span>
                  <select name="assetAccountId" defaultValue={p.assetAccountId ?? ""} className="input">
                    <option value="">Choose a fixed-asset account…</option>
                    {assetAccounts.map((a) => <option key={a.qboId} value={a.qboId}>{a.fullName}</option>)}
                  </select></label>
              </div>
            </fieldset>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className={field}><span className={label}>Start date</span><input type="date" name="startDate" defaultValue={p.startDate ?? ""} className="input" /></label>
            <label className={field}><span className={label}>End date</span><input type="date" name="endDate" defaultValue={p.endDate ?? ""} className="input" /></label>
          </div>
          <p className="text-xs text-slate-500">Only the section for this project&apos;s type is used. The budget is entered by cost code on the Budget tab.</p>
          <div><button className="btn">Save</button></div>
        </form>
      </Card>

      <Card title="Where this project's costs come from in QuickBooks" action={<span className="text-xs text-slate-500">Matched in this order: customer, class, location, GL account</span>}>
        <div className="grid gap-3 p-4 text-sm">
          {p.qboProjectId && <p className="text-xs text-slate-600"><Badge tone="green">Customer</Badge> Created from QuickBooks customer #{p.qboProjectId}</p>}
          {data.links.length > 0 && (
            <ul className="grid gap-1">
              {data.links.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <Badge tone="blue">{KIND_LABEL[l.kind]}</Badge><span>{l.qboName ?? l.qboId}</span>
                  <form action={removeProjectLink}><input type="hidden" name="id" value={l.id} /><button className="text-xs text-slate-500 underline">Unlink</button></form>
                </li>
              ))}
            </ul>
          )}
          {!p.qboProjectId && data.links.length === 0 && <p className="text-slate-600">Nothing linked yet. Costs reach this project only when coded in Unassigned costs.</p>}
          <div className="grid gap-2 border-t border-slate-100 pt-3">
            <LinkForm projectId={p.id} kind="customer" options={free("customer", options.customers.filter((c) => c.qboId), (c) => c.qboId!, (c) => c.name)} />
            <LinkForm projectId={p.id} kind="class" options={free("class", options.classes, (c) => c.qboId, (c) => c.name)} />
            <LinkForm projectId={p.id} kind="department" options={free("department", options.locations, (c) => c.qboId, (c) => c.name)} />
            <LinkForm projectId={p.id} kind="account" options={free("account", options.accounts, (a) => a.qboId, (a) => `${a.fullName} (${a.accountType})`)} />
          </div>
          <p className="text-xs text-slate-500">
            Link a class or location when internal work is tracked that way, or a dedicated GL account (e.g. a construction-in-progress sub-account for this project).
            New links pick up transactions on the next sync from QuickBooks.
          </p>
        </div>
      </Card>
    </div>
  );
}
