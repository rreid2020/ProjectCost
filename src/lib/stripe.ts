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
    plan: planForPriceId(item?.price.id)?.plan ?? company.plan,
    billingInterval: item?.price.recurring?.interval ?? company.billingInterval,
    currentPeriodEnd: item ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }).where(eq(s.companies.id, company.id)).returning();
  return updated;
}

export type PlanPrice = { id: string; amountCents: number; currency: string; interval: string };
let priceCache: { at: number; prices: Map<string, PlanPrice> } | null = null;
/** The configured plan prices as Stripe has them (amount, currency), cached for 10 minutes. */
export async function planPrices(ids: string[]): Promise<Map<string, PlanPrice>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000 && wanted.every((id) => priceCache!.prices.has(id))) return priceCache.prices;
  const prices = new Map<string, PlanPrice>();
  await Promise.all(wanted.map(async (id) => {
    const p = await stripe().prices.retrieve(id).catch(() => null);
    if (p?.unit_amount != null) prices.set(id, { id, amountCents: p.unit_amount, currency: p.currency.toUpperCase(), interval: p.recurring?.interval ?? "month" });
  }));
  priceCache = { at: Date.now(), prices };
  return prices;
}
