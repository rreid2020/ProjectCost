import { describe, it, expect } from "vitest";
import { accessFor, annualSavingBp, planForPriceId, priceIdFor } from "../src/lib/plans";

const now = new Date("2026-09-25T12:00:00Z");
const base = { trialEndsAt: null, subscriptionStatus: null, stripeSubscriptionId: null };

describe("subscription access", () => {
  it("allows an unexpired trial and counts days left", () => {
    expect(accessFor({ ...base, trialEndsAt: "2026-10-01T12:00:00Z" }, now)).toEqual({ ok: true, kind: "trial", daysLeft: 6 });
  });
  it("blocks an expired trial with no subscription", () => {
    expect(accessFor({ ...base, trialEndsAt: "2026-09-20T00:00:00Z" }, now).ok).toBe(false);
  });
  it("allows active and trialing subscriptions regardless of app trial", () => {
    for (const st of ["active", "trialing"]) expect(accessFor({ ...base, trialEndsAt: "2026-01-01", stripeSubscriptionId: "sub_1", subscriptionStatus: st }, now).ok).toBe(true);
  });
  it("keeps access but warns when past_due", () => {
    const a = accessFor({ ...base, stripeSubscriptionId: "sub_1", subscriptionStatus: "past_due" }, now);
    expect(a.ok && a.kind === "subscribed" && a.warning).toBeTruthy();
  });
  it("blocks canceled, unpaid, incomplete and paused subscriptions even inside the trial window", () => {
    for (const st of ["canceled", "unpaid", "incomplete", "paused"])
      expect(accessFor({ trialEndsAt: "2026-10-30T00:00:00Z", stripeSubscriptionId: "sub_1", subscriptionStatus: st }, now).ok).toBe(false);
  });
});

describe("monthly and annual prices", () => {
  it("finds the plan and billing interval for a Stripe price", () => {
    process.env.STRIPE_PRICE_STARTER = "price_sm"; process.env.STRIPE_PRICE_STARTER_ANNUAL = "price_sy";
    process.env.STRIPE_PRICE_PRO = "price_pm"; delete process.env.STRIPE_PRICE_PRO_ANNUAL;
    expect(priceIdFor("starter", "year")).toBe("price_sy");
    expect(priceIdFor("pro", "year")).toBeNull();
    expect(planForPriceId("price_sy")).toEqual({ plan: "starter", interval: "year" });
    expect(planForPriceId("price_pm")).toEqual({ plan: "pro", interval: "month" });
    expect(planForPriceId("price_other")).toBeNull();
  });
  it("works out the annual saving against twelve monthly payments", () => {
    expect(annualSavingBp(149_00, 1490_00)).toBe(1667); // two months free
    expect(annualSavingBp(0, 100)).toBe(0);
  });
});
