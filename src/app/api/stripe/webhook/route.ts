import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { stripe, syncSubscription } from "@/lib/stripe";

// Point a Stripe webhook endpoint at /api/stripe/webhook with these events:
// checkout.session.completed, customer.subscription.created|updated|deleted|paused|resumed
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return new Response("Missing signature or webhook secret", { status: 400 });

  let event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  // Process each event once; Stripe retries and may deliver duplicates.
  const fresh = await db.insert(s.stripeEvents).values({ id: event.id, type: event.type, receivedAt: new Date().toISOString() })
    .onConflictDoNothing().returning();
  if (!fresh.length) return Response.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && typeof session.subscription === "string") await syncSubscription(session.subscription);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await syncSubscription(event.data.object.id);
        break;
    }
  } catch (err) {
    // Let Stripe retry: forget the event and return 500.
    await db.delete(s.stripeEvents).where(eq(s.stripeEvents.id, event.id));
    console.error("Stripe webhook failed", event.type, err);
    return new Response("Webhook handler failed", { status: 500 });
  }
  return Response.json({ received: true });
}
