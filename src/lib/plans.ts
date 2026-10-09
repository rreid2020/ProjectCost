// Subscription plans. Prices live in Stripe; each plan points at a monthly and an (optional) annual Price ID
// from the environment. Edit names, blurbs and features here; create matching recurring Prices in Stripe.
export const TRIAL_DAYS = 14;

export const PLANS = {
  starter: {
    name: "Starter",
    priceEnv: { month: "STRIPE_PRICE_STARTER", year: "STRIPE_PRICE_STARTER_ANNUAL" },
    blurb: "For a single estimator or PM running a handful of jobs.",
    features: ["Budgets, change orders & progress billing", "WIP schedule & month-end entries", "QuickBooks Online sync"],
  },
  pro: {
    name: "Pro",
    priceEnv: { month: "STRIPE_PRICE_PRO", year: "STRIPE_PRICE_PRO_ANNUAL" },
    blurb: "For contractors with several PMs and field crews.",
    features: ["Everything in Starter", "Unlimited team members", "Surety-format WIP exports & priority support"],
  },
} as const;

export type PlanKey = keyof typeof PLANS;
export const isPlanKey = (k: string): k is PlanKey => k in PLANS;
export type Interval = "month" | "year";
export const INTERVALS: Interval[] = ["month", "year"];
export const isInterval = (k: string): k is Interval => k === "month" || k === "year";
export const priceIdFor = (plan: PlanKey, interval: Interval = "month") => process.env[PLANS[plan].priceEnv[interval]] || null;
/** Which plan and billing interval a Stripe price belongs to. */
export function planForPriceId(priceId: string | null | undefined): { plan: PlanKey; interval: Interval } | null {
  if (!priceId) return null;
  for (const plan of Object.keys(PLANS) as PlanKey[]) for (const interval of INTERVALS) if (priceIdFor(plan, interval) === priceId) return { plan, interval };
  return null;
}
/** Annual saving against twelve monthly payments, in basis points (1700 = 17%). */
export const annualSavingBp = (monthlyCents: number, annualCents: number) =>
  monthlyCents > 0 ? Math.round((1 - annualCents / (monthlyCents * 12)) * 10_000) : 0;

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
