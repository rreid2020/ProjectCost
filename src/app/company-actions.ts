"use server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { loadDemoData } from "@/db/demo";
import { TRIAL_DAYS } from "@/lib/plans";
import { companyForOrg, requireAdmin } from "@/lib/tenant";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const bp = (f: FormData, k: string, fallback: number) => {
  const v = parseFloat(str(f, k));
  return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 100) : fallback;
};

function companyFields(form: FormData) {
  const month = parseInt(str(form, "fiscalYearEndMonth"), 10);
  return {
    name: str(form, "name").slice(0, 120) || "My company",
    region: str(form, "region") === "US" ? "US" : "CA",
    province: str(form, "province").toUpperCase().slice(0, 3) || null,
    fiscalYearEndMonth: month >= 1 && month <= 12 ? month : 12,
    defaultHoldbackBp: bp(form, "holdbackPct", 1000),
    defaultTaxBp: bp(form, "taxPct", 1300),
  };
}

/** Onboarding: creates the company for the caller's active Clerk organization and starts the free trial. */
export async function createCompany(form: FormData) {
  const { userId, orgId, orgRole } = await auth({ treatPendingAsSignedOut: false });
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");
  if (!(await companyForOrg(orgId))) {
    if (orgRole !== "org:admin") throw new Error("Ask an admin of this organization to finish setting up the company.");
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
    const [company] = await db.insert(s.companies).values({ ...companyFields(form), clerkOrgId: orgId, trialEndsAt })
      .onConflictDoNothing({ target: s.companies.clerkOrgId }).returning();
    if (company && form.get("sample") === "on") await loadDemoData(db, company.id);
    // Keep the Clerk organization's name in step with the company name.
    if (company) await (await clerkClient()).organizations.updateOrganization(orgId, { name: company.name }).catch(() => {});
  }
  redirect("/dashboard");
}

export async function updateCompanySettings(form: FormData) {
  const t = await requireAdmin({ allowInactive: true });
  const fields = companyFields(form);
  await db.update(s.companies).set(fields).where(eq(s.companies.id, t.company.id));
  if (fields.name !== t.company.name) await (await clerkClient()).organizations.updateOrganization(t.orgId, { name: fields.name }).catch(() => {});
  revalidatePath("/", "layout");
}
