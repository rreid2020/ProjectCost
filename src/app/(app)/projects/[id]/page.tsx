import Link from "next/link";
import { notFound } from "next/navigation";
import { loadProject } from "@/lib/queries";
import { getTenant } from "@/lib/tenant";
import { PageHeader, Stat, StatusBadge, Badge } from "@/components/ui";
import { money, pct, fmtDate } from "@/lib/format";
import { BudgetTab } from "./BudgetTab";
import { ChangeOrdersTab } from "./ChangeOrdersTab";
import { BillingTab } from "./BillingTab";
import { CostsTab, TimeTab } from "./LedgerTabs";
import { SetupTab } from "./SetupTab";
import { qboEnvironment } from "@/lib/qbo";

const TABS = [
  ["budget", "Budget vs. actual"],
  ["changes", "Change orders"],
  ["billing", "Progress billing"],
  ["costs", "Costs"],
  ["time", "Labour"],
  ["setup", "Setup"],
] as const;

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string; code?: string }> }) {
  const { id } = await params;
  const { tab = "budget", saved, code } = await searchParams;
  const { company } = await getTenant();
  const data = await loadProject(company.id, id);
  const qbo = { environment: qboEnvironment(), realmId: company.qboRealmId };
  if (!data) notFound();
  const { project: p, econ: e, flags } = data;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        back={{ href: "/projects", label: "Projects" }}
        title={<span className="flex items-center gap-2">{p.number} · {p.name} <StatusBadge status={p.status} /></span>}
        subtitle={`${p.customer.name} · PM ${p.projectManager ?? "—"} · ${fmtDate(p.startDate)} – ${fmtDate(p.endDate)} · Holdback ${pct(p.holdbackBp, 0)} · HST ${pct(p.taxBp, 0)}`}
        actions={<div className="flex flex-wrap gap-1.5">{flags.map((f, i) => <Badge key={i} tone={f.level}>{f.text}</Badge>)}</div>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Revised contract" value={money(e.revisedContract)} sub={data.pendingCoRevenue ? `+${money(data.pendingCoRevenue)} pending COs` : `Original ${money(p.originalContractCents)}`} />
        <Stat label="Revised budget" value={money(e.revisedBudget)} sub={`Budget margin ${pct(e.budgetMarginBp)}`} />
        <Stat label="Cost to date" value={money(e.costToDate)} sub={`${pct(e.pctCompleteBp)} complete`} />
        <Stat label="Est. at completion" value={money(e.eac)} sub={`ETC ${money(e.etc)}`} tone={e.eac > e.revisedBudget ? "warn" : undefined} />
        <Stat label="Projected profit" value={money(e.projectedProfit)} sub={`${pct(e.projectedMarginBp)} · fade ${(e.fadeBp / 100).toFixed(1)} pts`} tone={e.projectedProfit < 0 ? "bad" : e.fadeBp < -100 ? "warn" : "good"} />
        <Stat label="Earned / billed" value={money(e.earnedRevenue)} sub={`Billed ${money(e.billedToDate)}`} />
        <Stat label={e.overUnder >= 0 ? "Overbilled" : "Underbilled"} value={money(Math.abs(e.overUnder))} sub={`Holdback rec. ${money(e.holdbackReceivable)}`} tone={e.overUnder < 0 ? "warn" : undefined} />
      </div>

      <div className="mt-6 flex gap-1 border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`?tab=${k}`} scroll={false}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {label}
            {k === "changes" && data.changeOrders.some((c) => c.status === "PENDING") && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[0.68rem] text-amber-800">{data.changeOrders.filter((c) => c.status === "PENDING").length}</span>}
          </Link>
        ))}
      </div>
      <div className="mt-4">
        {tab === "budget" && <BudgetTab data={data} />}
        {tab === "changes" && <ChangeOrdersTab data={data} />}
        {tab === "billing" && <BillingTab data={data} ctx={qbo} />}
        {tab === "costs" && <CostsTab data={data} ctx={qbo} code={code} region={company.region} />}
        {tab === "time" && <TimeTab data={data} code={code} />}
        {tab === "setup" && <SetupTab data={data} saved={saved === "1"} />}
      </div>
    </div>
  );
}
