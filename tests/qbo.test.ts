// QuickBooks token handling against a fake Intuit (stubbed fetch) and a real in-memory Postgres.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));
process.env.QBO_CLIENT_ID = "client";
process.env.QBO_CLIENT_SECRET = "secret";
process.env.QBO_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.QBO_ENVIRONMENT = "sandbox";

import { db, migrateDb, schema as s } from "@/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { qboFetch, saveConnection, getConnection } from "@/lib/qbo";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", intuit_tid: "tid-1" } });
const tokens = (n: number) => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600, x_refresh_token_expires_in: 8_640_000 });

let companyId: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await migrateDb();
  [{ id: companyId }] = await db.insert(s.companies).values({ name: "Q", clerkOrgId: "org_Q" }).returning();
});
beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await saveConnection(companyId, "9130", "user_1", tokens(1));
});

describe("token encryption", () => {
  it("round-trips and stores no plaintext", async () => {
    expect(decrypt(encrypt("hello"))).toBe("hello");
    expect(encrypt("hello")).not.toBe(encrypt("hello")); // random IV
    const row = (await getConnection(companyId))!;
    expect(row.accessTokenEnc).not.toContain("access-1");
    expect(row.refreshTokenEnc).not.toContain("refresh-1");
  });
  it("rejects tampered ciphertext", () => {
    const box = encrypt("secret");
    expect(() => decrypt(box.slice(0, -2) + (box.endsWith("A") ? "BB" : "AA"))).toThrow();
  });
});

describe("qboFetch", () => {
  it("uses a fresh token without refreshing", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { CompanyInfo: { CompanyName: "Sandbox Co" } }));
    await qboFetch(companyId, "companyinfo/9130");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/9130/companyinfo/9130?minorversion=75");
    expect(init.headers.Authorization).toBe("Bearer access-1");
  });

  it("refreshes an expired access token and keeps the rotated refresh token", async () => {
    await db.update(s.qboConnections).set({ accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(s.qboConnections.companyId, companyId));
    fetchMock.mockResolvedValueOnce(json(200, tokens(2))).mockResolvedValueOnce(json(200, { ok: true }));
    await qboFetch(companyId, "companyinfo/9130");
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    expect(String(tokenInit.body)).toContain("grant_type=refresh_token");
    expect(String(tokenInit.body)).toContain("refresh_token=refresh-1");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer access-2");
    const row = (await getConnection(companyId))!;
    expect(decrypt(row.refreshTokenEnc)).toBe("refresh-2");
  });

  it("refreshes once and retries after a 401", async () => {
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(200, tokens(3))).mockResolvedValueOnce(json(200, { ok: true }));
    await expect(qboFetch(companyId, "companyinfo/9130")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("flags a revoked grant as needing reconnect", async () => {
    await db.update(s.qboConnections).set({ accessTokenExpiresAt: new Date(0).toISOString() }).where(eq(s.qboConnections.companyId, companyId));
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_grant" }));
    await expect(qboFetch(companyId, "companyinfo/9130")).rejects.toMatchObject({ reconnect: true, intuitTid: "tid-1" });
  });

  it("surfaces QuickBooks fault details", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { Fault: { Error: [{ Message: "Object Not Found", Detail: "Something you're trying to use has been made inactive" }] } }));
    await expect(qboFetch(companyId, "item/1")).rejects.toThrow("Object Not Found");
  });
});
