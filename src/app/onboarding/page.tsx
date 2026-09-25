import { auth, clerkClient } from "@clerk/nextjs/server";
import { OrganizationList, UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { companyForOrg } from "@/lib/tenant";
import { CompanyFields } from "@/components/CompanyFields";
import { createCompany } from "@/app/company-actions";
import { TRIAL_DAYS } from "@/lib/plans";

export const dynamic = "force-dynamic";

function Shell({ step, title, children }: { step: 1 | 2; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between bg-brand-900 px-5 py-3">
        <span className="font-semibold text-white">ProjectCost</span>
        <UserButton />
      </header>
      <div className="mx-auto max-w-xl px-4 py-10">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Step {step} of 2</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export default async function Onboarding() {
  // Users who haven't picked an organization yet have a "pending" session; still treat them as signed in here.
  const { userId, orgId, orgRole } = await auth({ treatPendingAsSignedOut: false });
  if (!userId) redirect("/sign-in");

  if (!orgId) {
    return (
      <Shell step={1} title="Create your company workspace">
        <p className="mb-5 text-sm text-slate-600">Each company gets its own private workspace. Create one for your business, or join one you&apos;ve been invited to.</p>
        <OrganizationList hidePersonal afterCreateOrganizationUrl="/onboarding" afterSelectOrganizationUrl="/onboarding" />
      </Shell>
    );
  }

  if (await companyForOrg(orgId)) redirect("/dashboard");

  if (orgRole !== "org:admin") {
    return (
      <Shell step={2} title="Almost there">
        <p className="text-sm text-slate-600">An admin of this organization still needs to finish setting up the company. You&apos;ll have access once they do.</p>
      </Shell>
    );
  }

  const org = await (await clerkClient()).organizations.getOrganization({ organizationId: orgId }).catch(() => null);
  return (
    <Shell step={2} title="Set up your company">
      <form action={createCompany} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 text-sm shadow-sm">
        <CompanyFields company={{ name: org?.name }} />
        <label className="flex items-start gap-2 rounded-md bg-slate-50 p-3">
          <input type="checkbox" name="sample" className="mt-0.5" />
          <span>
            <span className="font-medium text-slate-800">Start with sample data</span>
            <span className="block text-xs text-slate-500">Six example projects so you can explore. Use a separate test workspace for this if you plan to connect your real QuickBooks file here.</span>
          </span>
        </label>
        <button className="btn justify-center">Start {TRIAL_DAYS}-day free trial</button>
        <p className="text-center text-xs text-slate-500">No card needed to start.</p>
      </form>
    </Shell>
  );
}
