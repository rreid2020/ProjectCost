"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireAdmin } from "@/lib/tenant";
import { isPlanKey, priceIdFor } from "@/lib/plans";
import { stripe } from "@/lib/stripe";

async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Starts Stripe Checkout for a plan. Admins only; reachable even when the trial has ended. */
export async function startCheckout(form: FormData) {
  const { company, orgId } = await requireAdmin({ allowInactive: true });
  const plan = String(form.get("plan") ?? "");
  if (!isPlanKey(plan)) throw new Error("Unknown plan.");
  const price = priceIdFor(plan);
  if (!price) throw new Error(`No Stripe price configured for the ${plan} plan.`);

  // Already subscribed? Plan changes and cancellations go through the customer portal, not a second subscription.
  if (company.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(company.subscriptionStatus ?? "")) return openBillingPortal();

  let customerId = company.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe().customers.create({ name: company.name, metadata: { companyId: company.id, clerkOrgId: orgId } });
    customerId = customer.id;
    await db.update(s.companies).set({ stripeCustomerId: customerId }).where(eq(s.companies.id, company.id));
  }

  // Keep any unused app trial: the first charge happens when it would have ended (Stripe needs >= 48h).
  const trialEnd = company.trialEndsAt ? Math.floor(new Date(company.trialEndsAt).getTime() / 1000) : 0;
  const keepTrial = !company.stripeSubscriptionId && trialEnd > Date.now() / 1000 + 48 * 3600;

  const origin = await appOrigin();
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: company.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { companyId: company.id }, ...(keepTrial ? { trial_end: trialEnd } : {}) },
    allow_promotion_codes: true,
    success_url: `${origin}/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing`,
  });
  redirect(session.url!);
}

/** Stripe customer portal: change plan, update card, see invoices, cancel. */
export async function openBillingPortal() {
  const { company } = await requireAdmin({ allowInactive: true });
  if (!company.stripeCustomerId) throw new Error("This company has no billing account yet.");
  const portal = await stripe().billingPortal.sessions.create({ customer: company.stripeCustomerId, return_url: `${await appOrigin()}/billing` });
  redirect(portal.url);
}
