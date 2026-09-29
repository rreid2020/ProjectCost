import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { loadPortfolio } from "@/lib/queries";
import { projectEntries, entryBalanced, type AccountMap } from "@/lib/project-accounting";
import type { Company } from "@/lib/tenant";
import { Card, Badge } from "@/components/ui";
import { money, fmtDate } from "@/lib/format";

/** Month-end journal entries for capital and build-for-sale projects. Drafts to book in QuickBooks. */
export async function ProjectEntries({ company, month }: { company: Company; month: string }) {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`, end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const [projects, accounts] = await Promise.all([
    loadPortfolio(company.id, ["ACTIVE", "COMPLETE"], ["CAPITAL", "INVENTORY"]),
    db.select({ qboId: s.glAccounts.qboId, fullName: s.glAccounts.fullName }).from(s.glAccounts).where(eq(s.glAccounts.companyId, company.id)),
  ]);
  const name = new Map(accounts.map((a) => [a.qboId, a.fullName]));
  const acct: AccountMap = {
    cip: company.cipAccountId, wipInventory: company.wipInventoryAccountId, finishedGoods: company.finishedGoodsAccountId,
    cogs: company.cogsAccountId, labourCredit: company.labourCreditAccountId,
  };
  const entries = projects.flatMap((p) => projectEntries({
    id: p.project.id, number: p.project.number, name: p.project.name, projectType: p.project.projectType as "CAPITAL" | "INVENTORY",
    unitsPlanned: p.project.unitsPlanned, inServiceDate: p.project.inServiceDate, assetAccountId: p.project.assetAccountId,
    costs: p.datedCosts, labour: p.datedLabour, events: p.events,
  }, acct, start, end));
  const unmapped = entries.some((e) => e.lines.some((l) => !l.account));
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);

  return (
    <Card title={`Capital & build-for-sale entries · ${fmtDate(start)} – ${fmtDate(end)}`} className="mt-5"
      action={<span className="flex gap-3 text-xs"><Link href={`?month=${prev}#entries`} className="text-brand-600 hover:underline">← {prev}</Link><Link href={`?month=${next}#entries`} className="text-brand-600 hover:underline">{next} →</Link></span>}>
      <div id="entries" className="grid gap-4 p-4 text-sm">
        {projects.length === 0 ? <p className="text-slate-500">No capital or build-for-sale projects. <Link href="/projects/new" className="underline">Create one</Link>.</p>
          : entries.length === 0 ? <p className="text-slate-500">No entries for this month.</p> : <>
            {unmapped && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">Some lines have no account yet. Choose the construction-in-progress, inventory, cost-of-goods-sold and labour accounts on the <Link href="/accounts" className="underline">Accounts</Link> page.</p>}
            {entries.map((e) => (
              <div key={e.key} className="rounded-md border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <span className="font-medium">{e.title}</span>
                  <span className="text-xs text-slate-500">{fmtDate(e.date)} · {entryBalanced(e) ? <Badge tone="green">Balanced</Badge> : <Badge tone="red">Out of balance</Badge>}</span>
                </div>
                <table className="grid-table">
                  <thead><tr><th>Account</th><th>Line memo</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
                  <tbody>{e.lines.map((l, i) => (
                    <tr key={i}>
                      <td className={l.credit ? "pl-8" : ""}>{l.account ? name.get(l.account) ?? `QuickBooks account ${l.account}` : <span className="text-amber-700">Not mapped</span>}</td>
                      <td className="text-xs text-slate-500">{l.memo ?? ""}</td>
                      <td className="num">{l.debit ? money(l.debit, { cents: true }) : ""}</td><td className="num">{l.credit ? money(l.credit, { cents: true }) : ""}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="px-3 py-1.5 font-mono text-[0.7rem] text-slate-500">Memo: {e.memo}</p>
              </div>
            ))}
          </>}
        <p className="text-xs text-slate-500">
          Book these in QuickBooks with the memo shown. The &ldquo;[ProjectCost]&rdquo; tag tells the next import not to count them again.
          Reclass entries move the month&apos;s project costs (and burdened labour) out of the accounts they were posted to.
        </p>
      </div>
    </Card>
  );
}
