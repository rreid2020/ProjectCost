import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader } from "@/components/ui";
import { createProject } from "@/app/actions";

const TYPES = [
  ["CONTRACT", "Customer contract", "Work billed to a customer. Tracks contract, billing, % complete and the WIP schedule."],
  ["CAPITAL", "Capital project", "Something you build or improve for your own use. Costs accumulate in construction in progress, then are capitalized."],
  ["INVENTORY", "Build for sale", "Units you build to sell (spec homes, fabricated units, a production run). Work in process → finished goods → cost of goods sold."],
] as const;

export default async function NewProject() {
  const { company } = await getTenant();
  const customers = await db.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(eq(s.customers.companyId, company.id)).orderBy(asc(s.customers.name));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: "/projects", label: "Projects" }} title="New project"
        subtitle="Projects from QuickBooks customers are created by the import. Create capital, build-for-sale, or other projects here, then link their QuickBooks class, location or account." />
      <Card>
        <form action={createProject} className="grid gap-4 p-4 text-sm">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Type</legend>
            {TYPES.map(([key, label, help], i) => (
              <label key={key} className="flex items-start gap-2 rounded-md border border-slate-200 p-3">
                <input type="radio" name="projectType" value={key} defaultChecked={i === 0} className="mt-0.5" />
                <span><span className="font-medium">{label}</span><span className="block text-xs text-slate-500">{help}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <label className="grid gap-1"><span className="text-xs text-slate-600">Project number</span><input name="number" required className="input" placeholder="CAP-2601" /></label>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Name</span><input name="name" required className="input" placeholder="Shop expansion" /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1"><span className="text-xs text-slate-600">Customer (contracts)</span>
              <select name="customerId" defaultValue="" className="input"><option value="">None</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Contract value (contracts)</span><input name="contract" inputMode="decimal" className="input text-right" /></label>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Units (build for sale)</span><input name="unitsPlanned" inputMode="numeric" defaultValue="1" className="input text-right" /></label>
          </div>
          <label className="grid w-48 gap-1"><span className="text-xs text-slate-600">Start date</span><input type="date" name="startDate" className="input" /></label>
          <div><button className="btn">Create project</button></div>
        </form>
      </Card>
    </div>
  );
}
