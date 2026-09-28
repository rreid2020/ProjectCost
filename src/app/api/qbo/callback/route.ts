import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getTenant } from "@/lib/tenant";
import { appOrigin } from "@/lib/origin";
import { QboError, STATE_COOKIE, exchangeCode, fetchCompanyInfo, redirectUri, revokeConnection, revokeTokens, saveConnection } from "@/lib/qbo";

/** Intuit redirects here with ?code&state&realmId (or ?error=access_denied if the user cancelled). */
export async function GET(req: NextRequest) {
  const t = await getTenant();
  const origin = await appOrigin();
  const back = (status: string) => NextResponse.redirect(`${origin}/settings?qbo=${status}`);
  const q = req.nextUrl.searchParams;

  const jar = await cookies();
  const saved = (() => { try { return JSON.parse(jar.get(STATE_COOKIE)?.value ?? "null"); } catch { return null; } })();
  jar.delete({ name: STATE_COOKIE, path: "/api/qbo" });

  if (q.get("error")) return back("cancelled");
  const code = q.get("code"), state = q.get("state"), realmId = q.get("realmId");
  if (!code || !state || !realmId || !saved || saved.state !== state) return back("state_mismatch");
  // The company that started the flow must still be the active one, and the user still an admin.
  if (saved.companyId !== t.company.id || !t.isAdmin) return back("state_mismatch");

  const log = (status: string, message: string) =>
    db.insert(s.syncLogs).values({ companyId: t.company.id, userId: t.userId, entity: "Connection", qboId: realmId, direction: "PULL", status, message, createdAt: new Date().toISOString() });

  try {
    const tokens = await exchangeCode(code, redirectUri(origin));

    // A QuickBooks file can feed only one live company; and a company can't silently switch files.
    const other = await db.query.companies.findFirst({ where: and(eq(s.companies.qboRealmId, realmId), ne(s.companies.id, t.company.id), isNull(s.companies.deletedAt)) });
    if (other || (t.company.qboRealmId && t.company.qboRealmId !== realmId)) {
      await revokeTokens(tokens.refresh_token);
      await log("ERROR", other ? `QuickBooks company ${realmId} is already connected to another ProjectCost workspace` : `Tried to connect a different QuickBooks company (${realmId}); disconnect first`);
      return back(other ? "realm_in_use" : "different_realm");
    }

    await saveConnection(t.company.id, realmId, t.userId, tokens);
    const info = await fetchCompanyInfo(t.company.id, realmId);
    await db.update(s.companies).set({ qboRealmId: realmId, qboConnectedAt: new Date().toISOString(), qboCompanyName: info.CompanyName })
      .where(eq(s.companies.id, t.company.id));
    await log("OK", `Connected to QuickBooks company "${info.CompanyName}"`);
    return back("connected");
  } catch (e) {
    // A first-time connect that failed part-way shouldn't leave tokens behind.
    if (!t.company.qboRealmId) await revokeConnection(t.company.id).catch(() => {});
    const tid = e instanceof QboError && e.intuitTid ? ` (intuit_tid ${e.intuitTid})` : "";
    await log("ERROR", `Connect failed: ${e instanceof Error ? e.message : String(e)}${tid}`);
    return back("error");
  }
}
