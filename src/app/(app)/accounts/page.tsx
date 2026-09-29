import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, Badge } from "@/components/ui";
import { saveAccountSettings } from "@/app/actions";

const ENTRY_ACCOUNTS = [
  ["cipAccountId", "Construction in progress", "Capital project costs accumulate here until the project is placed in service.", /Asset/],
  ["wipInventoryAccountId", "Inventory: work in process", "Build-for-sale costs accumulate here until units are completed.", /Asset/],
  ["finishedGoodsAccountId", "Inventory: finished goods", "Completed units wait here until sold.", /Asset/],
  ["cogsAccountId", "Cost of goods sold", "Units sold are expensed here.", /Cost of Goods Sold|Expense/],
  ["labourCreditAccountId", "Labour capitalized (credit)", "Credited when burdened labour is moved into construction in progress or inventory, e.g. a wages or 'labour capitalized' account.", /Expense|Cost of Goods Sold/],
] as const;
const TYPE_ORDER = ["Cost of Goods Sold", "Expense", "Other Expense", "Other Current Asset", "Fixed Asset", "Other Asset"];

export default async function Accounts({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { company, isAdmin } = await getTenant();
  const { saved } = await searchParams;
  const accounts = await db.select().from(s.glAccounts).where(eq(s.glAccounts.companyId, company.id)).orderBy(asc(s.glAccounts.fullName));
  const relevant = accounts.filter((a) => TYPE_ORDER.includes(a.accountType)).sort((a, b) => TYPE_ORDER.indexOf(a.accountType) - TYPE_ORDER.indexOf(b.accountType) || a.fullName.localeCompare(b.fullName));
  const isCost = (a: (typeof accounts)[number]) => a.isProjectCost ?? a.accountType === "Cost of Goods Sold";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Accounts" subtitle="Which QuickBooks accounts carry project costs, and where capital and build-for-sale entries post." />
      {saved && <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved. Sync from QuickBooks to apply project-cost account changes to imported lines.</p>}
      {accounts.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900"><Link href="/settings" className="underline">Sync from QuickBooks</Link> to load your chart of accounts.</p>
      ) : (
        <form action={saveAccountSettings} className="grid gap-5">
          <Card title="Accounts for capital and build-for-sale entries">
            <fieldset disabled={!isAdmin} className="grid gap-3 p-4 text-sm md:grid-cols-2">
              {ENTRY_ACCOUNTS.map(([field, label, help, types]) => (
                <label key={field} className="grid gap-1">
                  <span className="font-medium text-slate-800">{label}</span>
                  <select name={field} defaultValue={company[field] ?? ""} className="input">
                    <option value="">Not set</option>
                    {accounts.filter((a) => types.test(a.accountType)).map((a) => <option key={a.qboId} value={a.qboId}>{a.fullName} ({a.accountType})</option>)}
                  </select>
                  <span className="text-xs text-slate-500">{help}</span>
                </label>
              ))}
            </fieldset>
          </Card>

          <Card title="Project-cost accounts" action={<span className="text-xs text-slate-500">Lines posted here are imported even with no customer</span>}>
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead><tr><th>Project cost</th><th>Account</th><th>Type</th></tr></thead>
                <tbody>{relevant.map((a) => (
                  <tr key={a.qboId} className={a.active ? "" : "opacity-60"}>
                    <td><input type="hidden" name="account" value={a.qboId} /><input type="checkbox" name="projectCost" value={a.qboId} defaultChecked={isCost(a)} disabled={!isAdmin} aria-label={`Project cost: ${a.fullName}`} /></td>
                    <td>{a.fullName} {!a.active && <Badge>Inactive</Badge>}</td>
                    <td className="text-xs text-slate-500">{a.accountType}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Cost of goods sold accounts are on by default. Turn on asset accounts such as construction in progress or inventory work in process when project
              costs are posted there directly. Lines on these accounts that don&apos;t match a project (by customer, class, location or account link) go to Unassigned costs.
            </p>
          </Card>
          {isAdmin && <div><button className="btn">Save</button></div>}
        </form>
      )}
    </div>
  );
}
