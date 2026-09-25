import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { stripe, stripeConfigured } from "@/lib/stripe";

// Point a Clerk webhook endpoint at /api/clerk/webhook with organization.updated and organization.deleted.
// Signing secret: CLERK_WEBHOOK_SIGNING_SECRET.
export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (evt.type === "organization.updated") {
    await db.update(s.companies).set({ name: evt.data.name }).where(eq(s.companies.clerkOrgId, evt.data.id));
  }

  if (evt.type === "organization.deleted" && evt.data.id) {
    // Soft-delete: the company disappears from the app; rows are kept for a retention window.
    const [company] = await db.update(s.companies).set({ deletedAt: new Date().toISOString() })
      .where(eq(s.companies.clerkOrgId, evt.data.id)).returning();
    if (company?.stripeSubscriptionId && stripeConfigured() && company.subscriptionStatus !== "canceled") {
      await stripe().subscriptions.cancel(company.stripeSubscriptionId).catch((e) => console.error("Could not cancel subscription", e));
    }
  }
  return Response.json({ received: true });
}
