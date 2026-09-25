import { getTenant } from "@/lib/tenant";
import { PLANS, accessFor, priceIdFor, type PlanKey } from "@/lib/plans";
import { stripe, stripeConfigured, syncSubscription } from "@/lib/stripe";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { startCheckout, openBillingPortal } from "@/app/billing-actions";

export default async function Billing({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const tenant = await getTenant({ allowInactive: true });
  let { company, access } = tenant;
  const { isAdmin } = tenant;
  const { session_id } = await searchParams;

  // Returning from Checkout: sync straight away rather than waiting for the webhook.
  if (session_id && stripeConfigured()) {
    const session = await stripe().checkout.sessions.retrieve(session_id).catch(() => null);
    if (session?.client_reference_id === company.id && typeof session.subscription === "string") {
      const updated = await syncSubscription(session.subscription);
      if (updated) { company = updated; access = accessFor(updated); }
    }
  }

  const current = company.plan && company.plan in PLANS ? PLANS[company.plan as PlanKey] : null;
  const subscribed = Boolean(company.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(company.subscriptionStatus ?? ""));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Billing" subtitle={`Subscription for ${company.name}`} />

      <Card title="Status" action={access.ok ? <Badge tone={access.kind === "subscribed" && !access.warning ? "green" : "amber"}>{access.kind === "trial" ? "Free trial" : company.subscriptionStatus}</Badge> : <Badge tone="red">Inactive</Badge>}>
        <div className="grid gap-2 p-4 text-sm">
          {access.ok && access.kind === "trial" && <p>Your free trial ends {fmtDate(company.trialEndsAt?.slice(0, 10))} ({access.daysLeft} day{access.daysLeft === 1 ? "" : "s"} left). Choose a plan to keep going. If you subscribe now, your first charge is on the day the trial would have ended.</p>}
          {access.ok && access.kind === "subscribed" && (
            <p>
              {current ? <><span className="font-medium">{current.name}</span> plan. </> : null}
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
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {(Object.keys(PLANS) as PlanKey[]).map((key) => {
            const p = PLANS[key];
            return (
              <Card key={key} title={p.name}>
                <div className="grid gap-3 p-4 text-sm">
                  <p className="text-slate-600">{p.blurb}</p>
                  <ul className="list-disc pl-5 text-slate-700">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                  {isAdmin && (priceIdFor(key) ? (
                    <form action={startCheckout}><input type="hidden" name="plan" value={key} /><button className="btn w-full justify-center">Choose {p.name}</button></form>
                  ) : <p className="text-xs text-amber-800">Set {p.priceEnv} to sell this plan.</p>)}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
