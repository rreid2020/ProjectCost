import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { getTenant } from "@/lib/tenant";
import { pendingTimeCount, unassignedCount } from "@/lib/queries";
import { cookies } from "next/headers";
import { guideFor } from "@/lib/guide-facts";
import { GuideProvider, GuideButton, GuidePanel } from "@/components/Guide";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, access, orgId } = await getTenant({ allowInactive: true });
  const [unassigned, pendingTime, guide, jar] = await Promise.all([unassignedCount(company.id), pendingTimeCount(company.id), guideFor(company, orgId), cookies()]);
  // Guide opens on its own until setup is finished; after that it remembers the user's choice.
  const guideCookie = jar.get("pc_guide")?.value;
  const setupDone = guide.steps.filter((s) => !s.monthly).every((s) => s.status === "done" || s.status === "skipped");
  const periodLabel = new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const banner =
    access.ok && access.kind === "trial" ? { tone: "info", text: `Free trial: ${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"} left.`, cta: "Choose a plan" }
    : access.ok && access.kind === "subscribed" && access.warning ? { tone: "warn", text: access.warning, cta: "Update payment" }
    : !access.ok ? { tone: "warn", text: access.reason, cta: "Go to billing" }
    : null;

  return (
    <GuideProvider initialOpen={guideCookie ? guideCookie === "open" : !setupDone}>
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-brand-900 py-5 md:flex">
        <div className="mb-4 px-5">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-white">ProjectCost</Link>
          <div className="text-xs text-brand-100/80">Project costing &amp; WIP</div>
        </div>
        <div className="mb-4 px-3">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            afterCreateOrganizationUrl="/onboarding"
            appearance={{ elements: { rootBox: "w-full", organizationSwitcherTrigger: "w-full justify-between rounded-md bg-white/10 px-2 py-1.5 text-white hover:bg-white/15 [&_*]:!text-white" } }}
          />
        </div>
        <Nav counts={{ unassigned, pendingTime }} />
        <div className="mt-auto flex items-center gap-3 px-5 text-xs text-brand-100/80">
          <UserButton />
          <div className="min-w-0">
            <div className="truncate font-medium text-white">{company.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${company.qboRealmId ? "bg-emerald-400" : "bg-amber-400"}`} />
              {company.qboRealmId ? "QuickBooks connected" : "QBO not connected"}
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {/* compact header for small screens, where the sidebar is hidden */}
        <div className="flex items-center justify-between gap-3 bg-brand-900 px-4 py-2 md:hidden">
          <Link href="/dashboard" className="font-semibold text-white">ProjectCost</Link>
          <div className="flex items-center gap-3">
            <GuideButton done={guide.done} total={guide.total} />
            <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/dashboard" afterCreateOrganizationUrl="/onboarding" appearance={{ elements: { organizationSwitcherTrigger: "[&_*]:!text-white" } }} />
            <UserButton />
          </div>
        </div>
        <div className="hidden items-center justify-end gap-2 border-b border-slate-200 bg-white px-8 py-2 md:flex">
          <GuideButton done={guide.done} total={guide.total} />
        </div>
        {banner && (
          <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm md:px-8 ${banner.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-700"}`}>
            <span>{banner.text}</span>
            <Link href="/billing" className="font-medium underline underline-offset-2">{banner.cta}</Link>
          </div>
        )}
        <div className="px-4 py-6 md:px-8">{children}</div>
      </main>
      <GuidePanel steps={guide.steps} done={guide.done} total={guide.total} periodLabel={periodLabel} />
    </div>
    </GuideProvider>
  );
}
