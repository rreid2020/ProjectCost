import "server-only";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { planForPriceId } from "./plans";

let client: Stripe | null = null;
export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured: set STRIPE_SECRET_KEY.");
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY));
}

/**
 * Copies a subscription's current state onto its company. Always re-reads the subscription from Stripe,
 * so out-of-order or replayed webhooks can't leave a stale status behind.
 */
export async function syncSubscription(subscriptionId: string) {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const company =
    (sub.metadata?.companyId && (await db.query.companies.findFirst({ where: eq(s.companies.id, sub.metadata.companyId) }))) ||
    (await db.query.companies.findFirst({ where: eq(s.companies.stripeCustomerId, customerId) }));
  if (!company) return null;

  // An old subscription ending must not overwrite a newer one.
  const ended = ["canceled", "incomplete_expired"].includes(sub.status);
  if (company.stripeSubscriptionId && company.stripeSubscriptionId !== sub.id && ended) return company;

  const item = sub.items.data[0];
  const [updated] = await db.update(s.companies).set({
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    plan: planForPriceId(item?.price.id) ?? company.plan,
    currentPeriodEnd: item ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }).where(eq(s.companies.id, company.id)).returning();
  return updated;
}
