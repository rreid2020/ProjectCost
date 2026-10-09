import { getTenant } from "@/lib/tenant";
import Link from "next/link";
import { PLANS, accessFor, annualSavingBp, priceIdFor, type Interval, type PlanKey } from "@/lib/plans";
import { planPrices, stripe, stripeConfigured, syncSubscription, type PlanPrice } from "@/lib/stripe";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { startCheckout, openBillingPortal } from "@/app/billing-actions";

export default async function Billing({ searchParams }: { searchParams: Promise<{ session_id?: string; interval?: string }> }) {
  const tenant = await getTenant({ allowInactive: true });
  let { company, access } = tenant;
  const { isAdmin } = tenant;
  const { session_id, interval: requested } = await searchParams;

  // Returning from Checkout: sync straight away rather than waiting for the webhook.
  if (session_id && stripeConfigured()) {
    const session = await stripe().checkout.sessions.retrieve(session_id).catch(() => null);
    if (session?.client_reference_id === company.id && typeof session.subscription === "string") {
      const updated = await syncSubscription(session.subscription);
      if (updated) { company = updated; access = accessFor(updated); }
    }
  }

  const current = company.plan && company.plan in PLANS ? PLANS[company.plan as PlanKey] : null;
  const keys = Object.keys(PLANS) as PlanKey[];
  const annualOffered = keys.some((k) => priceIdFor(k, "year"));
  const interval: Interval = annualOffered && requested === "year" ? "year" : "month";
  const prices = stripeConfigured() ? await planPrices(keys.flatMap((k) => [priceIdFor(k, "month"), priceIdFor(k, "year")]).filter(Boolean) as string[]) : new Map<string, PlanPrice>();
  // largest annual saving across plans, for the switch label
  const savings = keys.map((k) => {
    const m = prices.get(priceIdFor(k, "month") ?? ""), y = prices.get(priceIdFor(k, "year") ?? "");
    return m && y ? annualSavingBp(m.amountCents, y.amountCents) : 0;
  });
  const bestSaving = Math.max(0, ...savings);
  const subscribed = Boolean(company.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(company.subscriptionStatus ?? ""));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Billing" subtitle={`Subscription for ${company.name}`} />

      <Card title="Status" action={access.ok ? <Badge tone={access.kind === "subscribed" && !access.warning ? "green" : "amber"}>{access.kind === "trial" ? "Free trial" : company.subscriptionStatus}</Badge> : <Badge tone="red">Inactive</Badge>}>
        <div className="grid gap-2 p-4 text-sm">
          {access.ok && access.kind === "trial" && <p>Your free trial ends {fmtDate(company.trialEndsAt?.slice(0, 10))} ({access.daysLeft} day{access.daysLeft === 1 ? "" : "s"} left). Choose a plan to keep going. If you subscribe now, your first charge is on the day the trial would have ended.</p>}
          {access.ok && access.kind === "subscribed" && (
            <p>
              {current ? <><span className="font-medium">{current.name}</span> plan{company.billingInterval === "year" ? ", billed annually" : company.billingInterval === "month" ? ", billed monthly" : ""}. </> : null}
              {company.cancelAtPeriodEnd ? `Cancels on ${fmtDate(company.currentPeriodEnd?.slice(0, 10))}.` : company.currentPeriodEnd ? `Renews ${fmtDate(company.currentPeriodEnd.slice(0, 10))}.` : null}
              {access.warning ? <span className="block text-amber-800">{access.warning}</span> : null}
            </p>
          )}
          {!access.ok && <p className="text-amber-900">{access.reason} Your data is safe. Choose a plan to get back in.</p>}
          {!isAdmin && <p className="text-slate-500">Only organization admins can change billing.</p>}
          {isAdmin && company.stripeCustomerId && stripeConfigured() && (
            <form action={openBillingPortal}><button className="btn btn-secondary">Manage billing, invoices & card</button></form>
          )}
        </div>
      </Card>

      {!stripeConfigured() ? (
        <Card title="Stripe isn't configured" className="mt-5">
          <p className="p-4 text-sm text-slate-600">Set <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code> and a price ID for each plan (<code>STRIPE_PRICE_STARTER</code>, <code>STRIPE_PRICE_PRO</code>) to enable subscriptions. See the README.</p>
        </Card>
      ) : !subscribed && (
        <>
          {annualOffered && (
            <div className="mt-5 flex items-center justify-center gap-3 text-sm">
              <div className="inline-flex rounded-full border border-slate-200 bg-white p-1">
                {(["month", "year"] as const).map((i) => (
                  <Link key={i} href={i === "year" ? "/billing?interval=year" : "/billing"} scroll={false}
                    className={`rounded-full px-4 py-1.5 font-medium ${interval === i ? "bg-brand-600 text-white" : "text-slate-600 hover:text-slate-900"}`}>
                    {i === "month" ? "Monthly" : "Annual"}
                  </Link>
                ))}
              </div>
              {bestSaving > 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Save up to {Math.round(bestSaving / 100)}% with annual billing</span>}
            </div>
          )}
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {keys.map((key, n) => {
              const p = PLANS[key];
              const priceId = priceIdFor(key, interval);
              const price = priceId ? prices.get(priceId) : undefined;
              const monthly = prices.get(priceIdFor(key, "month") ?? "");
              return (
                <Card key={key} title={p.name}>
                  <div className="grid gap-3 p-4 text-sm">
                    {price ? (
                      <div>
                        <span className="text-2xl font-bold text-slate-900">{fmtPrice(price)}</span>
                        <span className="text-slate-500"> / {interval === "year" ? "year" : "month"}</span>
                        {interval === "year" && (
                          <span className="block text-xs text-slate-500">
                            {fmtPrice({ ...price, amountCents: Math.round(price.amountCents / 12) })} a month, billed annually
                            {savings[n] > 0 && monthly ? <span className="ml-1 font-medium text-emerald-700">· save {fmtPrice({ ...price, amountCents: monthly.amountCents * 12 - price.amountCents })} ({Math.round(savings[n] / 100)}%)</span> : null}
                          </span>
                        )}
                      </div>
                    ) : null}
                    <p className="text-slate-600">{p.blurb}</p>
                    <ul className="list-disc pl-5 text-slate-700">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                    {isAdmin && (priceId ? (
                      <form action={startCheckout}>
                        <input type="hidden" name="plan" value={key} /><input type="hidden" name="interval" value={interval} />
                        <button className="btn w-full justify-center">Choose {p.name}{interval === "year" ? ", annual" : ", monthly"}</button>
                      </form>
                    ) : <p className="text-xs text-amber-800">Set {p.priceEnv[interval]} to sell this plan{interval === "year" ? " annually" : ""}.</p>)}
                  </div>
                </Card>
              );
            })}
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">Prices in {[...prices.values()][0]?.currency ?? "CAD"}. Change plan, switch between monthly and annual, or cancel at any time from Manage billing.</p>
        </>
      )}
    </div>
  );
}

function fmtPrice(p: { amountCents: number; currency: string }) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: p.currency, minimumFractionDigits: p.amountCents % 100 ? 2 : 0 }).format(p.amountCents / 100);
}
