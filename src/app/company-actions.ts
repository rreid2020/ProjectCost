"use server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { loadDemoData } from "@/db/demo";
import { TRIAL_DAYS } from "@/lib/plans";
import { companyForOrg, requireAdmin } from "@/lib/tenant";
import { PROVINCES, STATES } from "@/components/CompanyFields";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const bp = (f: FormData, k: string, fallback: number) => {
  const v = parseFloat(str(f, k));
  return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 100) : fallback;
};

function companyFields(form: FormData) {
  const month = parseInt(str(form, "fiscalYearEndMonth"), 10);
  const code = str(form, "province").toUpperCase();
  const inCanada = PROVINCES.some(([c]) => c === code), inUS = STATES.some(([c]) => c === code);
  return {
    name: str(form, "name").slice(0, 120) || "My company",
    // the province/state decides the country, so tax treatment can't contradict it
    region: inUS ? "US" : inCanada ? "CA" : str(form, "region") === "US" ? "US" : "CA",
    province: inCanada || inUS ? code : null,
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
