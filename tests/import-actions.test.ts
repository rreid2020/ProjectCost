// The upload -> map -> import flow through the real server actions (sign-in stubbed), against an in-memory Postgres.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";

type FakeTenant = { company: typeof import("@/db/schema").companies.$inferSelect; userId: string; orgId: string; isAdmin: boolean };
const state = vi.hoisted(() => ({ tenant: null as null | FakeTenant }));
class Redirect extends Error { constructor(public url: string) { super(`redirect ${url}`); } }
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); }, notFound: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  requireAdmin: async () => { if (!state.tenant?.isAdmin) throw new Error("Only organization admins can do this."); return state.tenant; },
  requireWrite: async () => state.tenant,
  getTenant: async () => state.tenant,
}));

import { db, migrateDb, schema as s } from "@/db";
import { uploadImport, updateUpload, commitUpload, undoImport, cancelUpload } from "@/app/import-actions";

const redirected = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof Redirect) return e.url; throw e; } throw new Error("expected a redirect"); };
const form = (o: Record<string, string | Blob>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const file = (name: string, body: BlobPart) => new File([body], name);

let A: FakeTenant["company"];
beforeAll(async () => {
  await migrateDb();
  [A] = await db.insert(s.companies).values({ name: "Acts", clerkOrgId: "org_acts", region: "CA" }).returning();
  state.tenant = { company: A, userId: "u1", orgId: "org_acts", isAdmin: true };
});

describe("spreadsheet import actions", () => {
  it("uploads Excel, picks the right sheet and columns, imports, remembers the mapping, and can be undone", async () => {
    // projects first, so costs can find their project
    let url = await redirected(uploadImport(form({ kind: "projects", file: file("jobs.csv", "Job,Job Name,Customer\n2401,Riverside,Beacon\n") })));
    expect(url).toMatch(/^\/imports\/[\w-]+$/);
    expect(await redirected(commitUpload(form({ id: url.split("/").pop()! })))).toMatch(/^\/imports\?done=/);

    // a workbook whose first sheet is a cover page; costs are on the second sheet, under a title row
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Cover").addRow(["Monthly cost export"]);
    const ws = wb.addWorksheet("GL detail");
    ws.addRow(["Job cost detail, September 2026"]);
    ws.addRow(["Posting Date", "Job", "Phase", "Vendor", "Debit", "Credit", "Reference"]);
    ws.addRow([new Date(Date.UTC(2026, 8, 15)), "2401", "22-100", "Wolseley", 1000, null, "W-1"]);
    ws.addRow([new Date(Date.UTC(2026, 8, 16)), "2401", "22-100", "Wolseley", null, 100, "W-2"]);
    url = await redirected(uploadImport(form({ kind: "costs", file: file("sept.xlsx", await wb.xlsx.writeBuffer() as ArrayBuffer) })));
    const id = url.split("/").pop()!;
    const upload = (await db.query.importUploads.findFirst({ where: eq(s.importUploads.id, id) }))!;
    expect(upload).toMatchObject({ sheetIndex: 1, headerRow: 1 });
    const mapping = JSON.parse(upload.mapping!);
    expect(mapping).toMatchObject({ date: 0, project: 1, code: 2, vendor: 3, debit: 4, credit: 5, reference: 6, __order: "DMY" });

    // change the date order, keep the columns
    await redirected(updateUpload(form({ id, sheetIndex: "1", headerRow: "2", dateOrder: "MDY", ...Object.fromEntries(Object.entries(mapping).filter(([k]) => k !== "__order").map(([k, v]) => [`map_${k}`, String(v)])) })));
    expect(JSON.parse((await db.query.importUploads.findFirst({ where: eq(s.importUploads.id, id) }))!.mapping!).__order).toBe("MDY");

    const done = await redirected(commitUpload(form({ id })));
    const batchId = done.split("=").pop()!;
    const costs = await db.select().from(s.costTransactions).where(eq(s.costTransactions.companyId, A.id));
    expect(costs.map((c) => c.amountCents).sort((a, b) => a - b)).toEqual([-10_000, 100_000]);
    expect(costs.every((c) => c.projectId && !c.costCodeId)).toBe(true); // project found; code 22-100 doesn't exist yet -> needs coding
    expect(await db.query.importUploads.findFirst({ where: eq(s.importUploads.id, id) })).toBeUndefined();
    const saved = await db.query.importMappings.findFirst({ where: and(eq(s.importMappings.companyId, A.id), eq(s.importMappings.kind, "costs")) });
    expect(JSON.parse(saved!.mapping)).toMatchObject({ date: "Posting Date", debit: "Debit" });

    expect(await redirected(undoImport(form({ id: batchId })))).toBe("/imports?undone=1");
    expect(await db.select().from(s.costTransactions).where(eq(s.costTransactions.companyId, A.id))).toHaveLength(0);
  });

  it("sends problems back to the preview instead of half-importing", async () => {
    const url = await redirected(uploadImport(form({ kind: "costs", file: file("bad.csv", "Date,Job,Amount\nnope,2401,10\n2026-09-02,2401,20\n") })));
    const id = url.split("/").pop()!;
    expect(await redirected(commitUpload(form({ id })))).toMatch(new RegExp(`^/imports/${id}\\?error=`));
    expect(await db.select().from(s.costTransactions).where(eq(s.costTransactions.companyId, A.id))).toHaveLength(0);
    expect(await redirected(commitUpload(form({ id, skipErrors: "on" })))).toMatch(/^\/imports\?done=/);
    expect(await db.select().from(s.costTransactions).where(eq(s.costTransactions.companyId, A.id))).toHaveLength(1);
  });

  it("rejects unreadable files, and keeps uploads private to their company", async () => {
    expect(await redirected(uploadImport(form({ kind: "costs", file: file("old.xls", "x") })))).toMatch(/error=Old%20Excel/);
    const url = await redirected(uploadImport(form({ kind: "costs", file: file("c.csv", "Date,Amount\n2026-09-01,5\n") })));
    const [B] = await db.insert(s.companies).values({ name: "B", clerkOrgId: "org_b_acts" }).returning();
    state.tenant = { company: B, userId: "u2", orgId: "org_b_acts", isAdmin: true };
    await expect(commitUpload(form({ id: url.split("/").pop()! }))).rejects.toThrow(/expired/);
    await expect(cancelUpload(form({ id: url.split("/").pop()! }))).rejects.toBeInstanceOf(Redirect); // no-op for another company
    expect(await db.query.importUploads.findFirst({ where: eq(s.importUploads.id, url.split("/").pop()!) })).toBeTruthy();
    state.tenant = { company: A, userId: "u1", orgId: "org_acts", isAdmin: false };
    await expect(uploadImport(form({ kind: "costs", file: file("c.csv", "Date,Amount\n2026-09-01,5\n") }))).rejects.toThrow(/admins/);
  });
});
