// Subscription plans. Prices live in Stripe; each plan points at a Price ID from the environment.
// Edit names, blurbs and features here; create matching recurring Prices in the Stripe dashboard.
export const TRIAL_DAYS = 14;

export const PLANS = {
  starter: {
    name: "Starter",
    priceEnv: "STRIPE_PRICE_STARTER",
    blurb: "For a single estimator or PM running a handful of jobs.",
    features: ["Budgets, change orders & progress billing", "WIP schedule & month-end entries", "QuickBooks Online sync"],
  },
  pro: {
    name: "Pro",
    priceEnv: "STRIPE_PRICE_PRO",
    blurb: "For contractors with several PMs and field crews.",
    features: ["Everything in Starter", "Unlimited team members", "Surety-format WIP exports & priority support"],
  },
} as const;

export type PlanKey = keyof typeof PLANS;
export const isPlanKey = (k: string): k is PlanKey => k in PLANS;
export const priceIdFor = (plan: PlanKey) => process.env[PLANS[plan].priceEnv] || null;
export const planForPriceId = (priceId: string | null | undefined): PlanKey | null =>
  (Object.keys(PLANS) as PlanKey[]).find((k) => priceIdFor(k) === priceId) ?? null;

// ---------- access rules ----------
type BillingFields = { trialEndsAt: string | null; subscriptionStatus: string | null; stripeSubscriptionId: string | null };

export type Access =
  | { ok: true; kind: "trial"; daysLeft: number }
  | { ok: true; kind: "subscribed"; status: string; warning?: string }
  | { ok: false; reason: string };

/**
 * A company can use the app while its free trial runs, or while it has a Stripe subscription that is
 * active/trialing. past_due keeps access (Stripe is retrying the card) but shows a warning.
 * Anything else (canceled, unpaid, incomplete, paused, expired trial) sends the company to billing.
 */
export function accessFor(c: BillingFields, now = new Date()): Access {
  const status = c.subscriptionStatus;
  if (c.stripeSubscriptionId && status) {
    if (status === "active" || status === "trialing") return { ok: true, kind: "subscribed", status };
    if (status === "past_due") return { ok: true, kind: "subscribed", status, warning: "Your last payment failed. Update your card in Billing to keep access." };
    if (status === "incomplete") return { ok: false, reason: "Your subscription payment hasn't gone through yet." };
    return { ok: false, reason: status === "canceled" ? "Your subscription has ended." : "Your subscription is not active." };
  }
  if (c.trialEndsAt) {
    const ms = new Date(c.trialEndsAt).getTime() - now.getTime();
    if (ms > 0) return { ok: true, kind: "trial", daysLeft: Math.ceil(ms / 86_400_000) };
  }
  return { ok: false, reason: "Your free trial has ended." };
}
