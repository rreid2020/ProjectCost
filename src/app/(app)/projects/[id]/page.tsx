import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { loadProject } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";
import { PageHeader, Stat, StatusBadge, Badge } from "@/components/ui";
import { money, pct, fmtDate, PROJECT_TYPE_LABEL } from "@/lib/format";
import { BudgetTab } from "./BudgetTab";
import { ChangeOrdersTab } from "./ChangeOrdersTab";
import { BillingTab } from "./BillingTab";
import { CostsTab, TimeTab } from "./LedgerTabs";
import { SetupTab } from "./SetupTab";
import { InventoryTab, CapitalTab } from "./BalanceTabs";
import { qboEnvironment } from "@/lib/qbo";
import { companyOverhead, describeRate } from "@/lib/overhead";
import { projectOverhead } from "@/lib/engine";

// Tabs per project type: revenue tabs only for customer contracts; balance tabs for capital / build-for-sale.
const TABS: Record<string, [string, string][]> = {
  CONTRACT: [["budget", "Budget vs. actual"], ["changes", "Change orders"], ["billing", "Progress billing"], ["costs", "Costs"], ["time", "Labour"], ["setup", "Setup"]],
  CAPITAL: [["budget", "Budget vs. actual"], ["capital", "Capitalization"], ["costs", "Costs"], ["time", "Labour"], ["setup", "Setup"]],
  INVENTORY: [["budget", "Budget vs. actual"], ["inventory", "Units & inventory"], ["costs", "Costs"], ["time", "Labour"], ["setup", "Setup"]],
};

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string; code?: string }> }) {
  const { id } = await params;
  const { tab = "budget", saved, code } = await searchParams;
  const { company } = await getTenant();
  const data = await loadProject(company.id, id);
  if (!data) notFound();
  const qbo = { environment: qboEnvironment(), realmId: company.qboRealmId };
  const { project: p, econ: e, flags } = data;
  const isContract = p.projectType === "CONTRACT";
  const oh = isContract ? await companyOverhead(company) : null;
  const po = oh && oh.rate != null ? projectOverhead(e, data.labour, oh.rate, oh.basis) : null;

  const options = tab === "setup" ? {
    customers: await db.select({ id: s.customers.id, name: s.customers.name, qboId: s.customers.qboId }).from(s.customers).where(eq(s.customers.companyId, company.id)).orderBy(asc(s.customers.name)),
    classes: await db.select({ qboId: s.qboTags.qboId, name: s.qboTags.name }).from(s.qboTags).where(and(eq(s.qboTags.companyId, company.id), eq(s.qboTags.kind, "class"), eq(s.qboTags.active, true))).orderBy(asc(s.qboTags.name)),
    locations: await db.select({ qboId: s.qboTags.qboId, name: s.qboTags.name }).from(s.qboTags).where(and(eq(s.qboTags.companyId, company.id), eq(s.qboTags.kind, "department"), eq(s.qboTags.active, true))).orderBy(asc(s.qboTags.name)),
    accounts: await db.select({ qboId: s.glAccounts.qboId, fullName: s.glAccounts.fullName, accountType: s.glAccounts.accountType }).from(s.glAccounts).where(and(eq(s.glAccounts.companyId, company.id), eq(s.glAccounts.active, true))).orderBy(asc(s.glAccounts.fullName)),
  } : null;

  const subtitle = [
    PROJECT_TYPE_LABEL[p.projectType], p.customer?.name, `PM ${p.projectManager ?? "—"}`, `${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}`,
    ...(isContract ? [`Holdback ${pct(p.holdbackBp, 0)}`, `Tax ${pct(p.taxBp, 0)}`] : []),
    ...(p.projectType === "INVENTORY" ? [`${p.unitsPlanned} unit${p.unitsPlanned === 1 ? "" : "s"} planned`] : []),
  ].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        back={{ href: "/projects", label: "Projects" }}
        title={<span className="flex items-center gap-2">{p.number} · {p.name} <StatusBadge status={p.status} /></span>}
        subtitle={subtitle}
        actions={<div className="flex flex-wrap gap-1.5">{flags.map((f, i) => <Badge key={i} tone={f.level}>{f.text}</Badge>)}</div>}
      />

      {isContract ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Revised contract" value={money(e.revisedContract)} sub={data.pendingCoRevenue ? `+${money(data.pendingCoRevenue)} pending COs` : `Original ${money(p.originalContractCents)}`} />
          <Stat label="Revised budget" value={money(e.revisedBudget)} sub={`Budget margin ${pct(e.budgetMarginBp)}`} />
          <Stat label="Cost to date" value={money(e.costToDate)} sub={`${pct(e.pctCompleteBp)} complete`} />
          <Stat label="Est. at completion" value={money(e.eac)} sub={`ETC ${money(e.etc)}`} tone={e.eac > e.revisedBudget ? "warn" : undefined} />
          <Stat label="Projected profit" value={money(e.projectedProfit)} sub={`${pct(e.projectedMarginBp)} · fade ${(e.fadeBp / 100).toFixed(1)} pts`} tone={e.projectedProfit < 0 ? "bad" : e.fadeBp < -100 ? "warn" : "good"} />
          <Stat label="Earned / billed" value={money(e.earnedRevenue)} sub={`Billed ${money(e.billedToDate)}`} />
          <Stat label={e.overUnder >= 0 ? "Overbilled" : "Underbilled"} value={money(Math.abs(e.overUnder))} sub={`Holdback rec. ${money(e.holdbackReceivable)}`} tone={e.overUnder < 0 ? "warn" : undefined} />
          <Stat label="Profit after overhead" value={po ? money(po.profitAfterOverhead) : "—"}
            sub={po ? <Link href="/overhead" className="hover:underline">{pct(po.marginAfterBp)} · overhead {money(po.atCompletion)}</Link> : <Link href="/overhead" className="underline">Set up overhead</Link>}
            tone={po ? (po.profitAfterOverhead < 0 ? "bad" : "good") : undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Revised budget" value={money(e.revisedBudget)} sub={`Original ${money(e.originalBudget)}`} />
          <Stat label="Cost to date" value={money(e.costToDate)} sub={e.revisedBudget ? `${pct(Math.round((e.costToDate / e.revisedBudget) * 10_000))} of budget` : "No budget yet"} />
          <Stat label="Forecast at completion" value={money(e.eac)} sub={`To complete ${money(e.etc)}`} tone={e.revisedBudget && e.eac > e.revisedBudget ? "bad" : undefined} />
          <Stat label="Variance to budget" value={money(e.revisedBudget - e.eac)} tone={e.revisedBudget - e.eac < 0 ? "bad" : "good"} />
          {data.capital && <>
            <Stat label="Construction in progress" value={money(data.capital.cip)} sub="Asset until capitalized" />
            <Stat label="Capitalized" value={money(data.capital.capitalized)} sub={data.capital.capitalizedOn ? `In service ${fmtDate(data.capital.capitalizedOn)}` : "Not in service yet"} />
          </>}
          {data.inventory && <>
            <Stat label="Work in process / finished" value={`${money(data.inventory.wip)} / ${money(data.inventory.fg)}`} sub={`${data.inventory.remainingUnits} in process · ${data.inventory.fgUnits} on hand`} />
            <Stat label="Cost of goods sold" value={money(data.inventory.cogs)} sub={`${data.inventory.soldUnits} of ${p.unitsPlanned} sold`} />
          </>}
        </div>
      )}

      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS[p.projectType].map(([k, label]) => (
          <Link key={k} href={`?tab=${k}`} scroll={false}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {label}
            {k === "changes" && data.changeOrders.some((c) => c.status === "PENDING") && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[0.68rem] text-amber-800">{data.changeOrders.filter((c) => c.status === "PENDING").length}</span>}
          </Link>
        ))}
      </div>
      <div className="mt-4">
        {tab === "budget" && <BudgetTab data={data} overhead={po && oh?.rate != null ? { ...po, rateLabel: describeRate(oh.rate, oh.basis), basis: oh.basis } : null} />}
        {tab === "changes" && isContract && <ChangeOrdersTab data={data} />}
        {tab === "billing" && isContract && <BillingTab data={data} ctx={qbo} />}
        {tab === "inventory" && data.inventory && <InventoryTab data={data} />}
        {tab === "capital" && data.capital && <CapitalTab data={data} />}
        {tab === "costs" && <CostsTab data={data} ctx={qbo} code={code} region={company.region} />}
        {tab === "time" && <TimeTab data={data} code={code} />}
        {tab === "setup" && options && <SetupTab data={data} saved={saved === "1"} options={options} />}
      </div>
    </div>
  );
}
