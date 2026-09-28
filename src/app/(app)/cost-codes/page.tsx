import { getCostCodes } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, Badge } from "@/components/ui";
import { addCostCode, updateCostCode } from "@/app/actions";

export default async function CostCodes() {
  const { company, isAdmin } = await getTenant();
  const codes = await getCostCodes(company.id);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Cost codes" subtitle="Company-wide library (CSI MasterFormat-style). Each code maps to a QBO Product/Service item or Class." />
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="md:col-span-2">
          <table className="grid-table">
            <thead><tr><th>Code</th><th>Name</th><th>Cost type</th><th>QBO mapping</th></tr></thead>
            <tbody>{codes.map((c) => (
              <tr key={c.id}><td className="font-mono">{c.code}</td><td>{c.name}</td><td className="text-xs text-slate-600">{isAdmin ? (
                <form action={updateCostCode} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={c.id} />
                  <select name="costType" defaultValue={c.costType} className="input py-0.5 text-xs" aria-label={`Cost type for ${c.code}`}>{["LABOUR", "MATERIAL", "SUB", "EQUIPMENT", "OTHER"].map((t) => <option key={t}>{t}</option>)}</select>
                  <button className="btn btn-secondary btn-sm">✓</button>
                </form>
              ) : c.costType}</td><td>{c.qboItemId ? <Badge tone="green">Item {c.qboItemId}</Badge> : <Badge>Not mapped</Badge>}{!c.active && <> <Badge>Inactive</Badge></>}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        {isAdmin ? <Card title="Add cost code">
          <form action={addCostCode} className="grid gap-3 p-4 text-sm">
            <label className="grid gap-1"><span className="text-xs text-slate-600">Code</span><input name="code" required className="input" placeholder="23-600" /></label>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Name</span><input name="name" required className="input" placeholder="Hydronic piping" /></label>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Cost type</span>
              <select name="costType" className="input">{["LABOUR", "MATERIAL", "SUB", "EQUIPMENT", "OTHER"].map((t) => <option key={t}>{t}</option>)}</select></label>
            <button className="btn justify-center">Add</button>
          </form>
        </Card> : <Card title="Add cost code"><p className="p-4 text-sm text-slate-500">Only organization admins can change the cost-code library.</p></Card>}
      </div>
    </div>
  );
}
