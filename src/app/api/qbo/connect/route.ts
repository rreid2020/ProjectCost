import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { appOrigin } from "@/lib/origin";
import { STATE_COOKIE, authorizeUrl, qboConfigured, redirectUri } from "@/lib/qbo";

/** Starts "Connect to QuickBooks": admin only; the state value ties Intuit's callback to this browser and company. */
export async function GET() {
  const t = await getTenant();
  const origin = await appOrigin();
  if (!t.isAdmin) return NextResponse.redirect(`${origin}/settings?qbo=admin_only`);
  if (!qboConfigured()) return NextResponse.redirect(`${origin}/settings?qbo=not_configured`);

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(STATE_COOKIE, JSON.stringify({ state, companyId: t.company.id }), {
    httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/api/qbo", maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state, redirectUri(origin)));
}
