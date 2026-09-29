import "server-only";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { decrypt, encrypt } from "./crypto";

// Intuit OAuth 2.0 endpoints (from https://developer.api.intuit.com/.well-known/openid_configuration)
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";
export const STATE_COOKIE = "qbo_oauth";
export const MINOR_VERSION = process.env.QBO_MINOR_VERSION ?? "75";

export type QboEnvironment = "sandbox" | "production";
export const qboEnvironment = (): QboEnvironment => (process.env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox");
const apiBase = (env: QboEnvironment) => (env === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com");

export const qboConfigured = () => Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.QBO_TOKEN_KEY);
export const redirectUri = (origin: string) => process.env.QBO_REDIRECT_URI || `${origin}/api/qbo/callback`;

/** An error from Intuit, carrying intuit_tid for support tickets. */
export class QboError extends Error {
  constructor(message: string, public status: number, public intuitTid: string | null, public reconnect = false) {
    super(message);
  }
}

export function authorizeUrl(state: string, redirect: string) {
  const u = new URL(AUTHORIZE_URL);
  u.search = new URLSearchParams({ client_id: process.env.QBO_CLIENT_ID!, response_type: "code", scope: SCOPE, redirect_uri: redirect, state }).toString();
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const invalidGrant = json.error === "invalid_grant";
    throw new QboError(invalidGrant ? "The QuickBooks connection has expired or was revoked. Reconnect QuickBooks." : `QuickBooks token request failed (${json.error ?? res.status}).`,
      res.status, res.headers.get("intuit_tid"), invalidGrant);
  }
  return json as TokenResponse;
}

export const exchangeCode = (code: string, redirect: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirect });

function tokenColumns(t: TokenResponse) {
  const now = Date.now();
  return {
    accessTokenEnc: encrypt(t.access_token),
    accessTokenExpiresAt: new Date(now + t.expires_in * 1000).toISOString(),
    refreshTokenEnc: encrypt(t.refresh_token), // Intuit rotates refresh tokens: always keep the latest
    refreshTokenExpiresAt: new Date(now + t.x_refresh_token_expires_in * 1000).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

export async function saveConnection(companyId: string, realmId: string, userId: string, t: TokenResponse) {
  const now = new Date().toISOString();
  const row = { companyId, realmId, environment: qboEnvironment(), connectedByUserId: userId, connectedAt: now, ...tokenColumns(t) };
  await db.insert(s.qboConnections).values(row).onConflictDoUpdate({ target: s.qboConnections.companyId, set: row });
}

export const getConnection = (companyId: string) => db.query.qboConnections.findFirst({ where: eq(s.qboConnections.companyId, companyId) });

/**
 * A valid access token for the company, refreshing it when it's within 2 minutes of expiry.
 * The refresh runs under a row lock so concurrent requests don't race on Intuit's rotating refresh token.
 */
async function accessToken(companyId: string, force = false) {
  const conn = await getConnection(companyId);
  if (!conn) throw new QboError("QuickBooks is not connected.", 0, null, true);
  if (!force && new Date(conn.accessTokenExpiresAt).getTime() - Date.now() > 120_000) return { token: decrypt(conn.accessTokenEnc), conn };

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(s.qboConnections).where(eq(s.qboConnections.companyId, companyId)).for("update");
    if (!locked) throw new QboError("QuickBooks is not connected.", 0, null, true);
    // Another request may have refreshed while we waited for the lock.
    if (locked.updatedAt !== conn.updatedAt && new Date(locked.accessTokenExpiresAt).getTime() - Date.now() > 120_000)
      return { token: decrypt(locked.accessTokenEnc), conn: locked };
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(locked.refreshTokenEnc) });
    const [updated] = await tx.update(s.qboConnections).set(tokenColumns(t)).where(eq(s.qboConnections.companyId, companyId)).returning();
    return { token: t.access_token, conn: updated };
  });
}

const MAX_THROTTLE_RETRIES = 5;
let retryBaseMs = 1000;
/** Tests shorten the back-off. */
export const setRetryBaseMs = (ms: number) => { retryBaseMs = ms; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function retryDelayMs(res: Response, attempt: number) {
  const after = Number(res.headers.get("retry-after"));
  if (Number.isFinite(after) && after > 0) return Math.min(after * 1000, 60_000);
  return Math.min(retryBaseMs * 2 ** (attempt - 1), 16 * retryBaseMs) + Math.floor(Math.random() * retryBaseMs * 0.25);
}

/** GET/POST against the company's QuickBooks file: /v3/company/{realmId}/{path}. Retries once on 401. */
export async function qboFetch<T = unknown>(companyId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let forceRefresh = false, refreshed = false, throttled = 0;
  for (;;) {
    const { token, conn } = await accessToken(companyId, forceRefresh);
    forceRefresh = false;
    if (conn.environment !== qboEnvironment()) throw new QboError(`This connection was made in ${conn.environment}; the app is set to ${qboEnvironment()}. Reconnect QuickBooks.`, 0, null, true);
    const url = new URL(`${apiBase(conn.environment as QboEnvironment)}/v3/company/${conn.realmId}/${path.replace(/^\//, "")}`);
    url.searchParams.set("minorversion", MINOR_VERSION);
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    if (res.status === 401 && !refreshed) { refreshed = forceRefresh = true; continue; }
    // QuickBooks throttles per company file (about 10 concurrent / 500 per minute): back off and retry
    if (res.status === 429 && throttled < MAX_THROTTLE_RETRIES) { await sleep(retryDelayMs(res, ++throttled)); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = json?.Fault?.Error?.[0];
      throw new QboError(detail ? `${detail.Message}: ${detail.Detail}` : `QuickBooks request failed (${res.status}).`, res.status, res.headers.get("intuit_tid"));
    }
    return json as T;
  }
}

export type CompanyInfo = { CompanyName: string; LegalName?: string; Country?: string };
export async function fetchCompanyInfo(companyId: string, realmId: string) {
  const r = await qboFetch<{ CompanyInfo: CompanyInfo }>(companyId, `companyinfo/${realmId}`);
  return r.CompanyInfo;
}

/** Revokes the grant at Intuit (revoking the refresh token revokes the access token too). Best effort. */
export async function revokeTokens(refreshToken: string) {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ token: refreshToken }),
    cache: "no-store",
  }).catch(() => {});
}

export async function revokeConnection(companyId: string) {
  const conn = await getConnection(companyId);
  if (!conn) return;
  try { await revokeTokens(decrypt(conn.refreshTokenEnc)); } catch { /* key rotated or token unreadable: still remove locally */ }
  await db.delete(s.qboConnections).where(eq(s.qboConnections.companyId, companyId));
}
