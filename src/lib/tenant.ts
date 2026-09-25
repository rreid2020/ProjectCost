import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { accessFor, type Access } from "./plans";

export type Company = typeof s.companies.$inferSelect;
export type Tenant = { company: Company; userId: string; orgId: string; isAdmin: boolean; access: Access };

/**
 * The signed-in user's active Clerk organization, resolved to its company row.
 * Every page and server action gets its company from here; nothing reads a company any other way.
 * Memoized per request.
 */
const resolveTenant = cache(async (): Promise<Tenant> => {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");
  const company = await companyForOrg(orgId);
  if (!company) redirect("/onboarding");
  return { company, userId, orgId, isAdmin: orgRole === "org:admin", access: accessFor(company) };
});

export async function companyForOrg(orgId: string) {
  return db.query.companies.findFirst({ where: and(eq(s.companies.clerkOrgId, orgId), isNull(s.companies.deletedAt)) });
}

/** For pages. Sends companies without an active trial/subscription to /billing unless allowInactive. */
export async function getTenant(opts: { allowInactive?: boolean } = {}): Promise<Tenant> {
  const t = await resolveTenant();
  if (!t.access.ok && !opts.allowInactive) redirect("/billing");
  return t;
}

/** For server actions that change data: requires an active trial or subscription. */
export async function requireWrite(): Promise<Tenant> {
  const t = await resolveTenant();
  if (!t.access.ok) throw new Error("This company's subscription is not active. Go to Billing to continue.");
  return t;
}

/** For admin-only actions (company settings, billing, cost-code library, month-end close). */
export async function requireAdmin(opts: { allowInactive?: boolean } = {}): Promise<Tenant> {
  const t = opts.allowInactive ? await resolveTenant() : await requireWrite();
  if (!t.isAdmin) throw new Error("Only organization admins can do this.");
  return t;
}
