// Tenant isolation: two companies with full sample data in an in-memory Postgres (PGlite).
// Acting as company A, every server action is fed company B's IDs and must neither read nor change B's rows.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

type FakeTenant = { company: typeof import("@/db/schema").companies.$inferSelect; userId: string; orgId: string; isAdmin: boolean };
const state = vi.hoisted(() => ({ tenant: null as null | FakeTenant }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  requireWrite: async () => state.tenant,
  requireAdmin: async () => {
    if (!state.tenant?.isAdmin) throw new Error("Only organization admins can do this.");
    return state.tenant;
  },
  getTenant: async () => state.tenant,
}));

import { db, migrateDb, schema as s } from "@/db";
import { loadDemoData } from "@/db/demo";
import { loadProject, loadPortfolio, unassignedCosts } from "@/lib/queries";
import * as actions from "@/app/actions";

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return f;
};
const actAs = (company: FakeTenant["company"], isAdmin = true) => {
  state.tenant = { company, userId: `user_${company.name}`, orgId: `org_${company.name}`, isAdmin };
};

let A: FakeTenant["company"], B: FakeTenant["company"];
let bProjectId: string;

beforeAll(async () => {
  await migrateDb();
  [A] = await db.insert(s.companies).values({ name: "A", clerkOrgId: "org_A" }).returning();
  [B] = await db.insert(s.companies).values({ name: "B", clerkOrgId: "org_B" }).returning();
  await loadDemoData(db, A.id);
  await loadDemoData(db, B.id);
  bProjectId = (await db.query.projects.findFirst({ where: and(eq(s.projects.companyId, B.id), eq(s.projects.number, "P-2401")) }))!.id;
});

describe("reads are scoped to the company", () => {
  it("won't load another company's project", async () => {
    expect(await loadProject(A.id, bProjectId)).toBeNull();
    expect(await loadProject(B.id, bProjectId)).not.toBeNull();
  });

  it("portfolio and unassigned queue only show own rows", async () => {
    const a = await loadPortfolio(A.id, ["ACTIVE", "BID", "COMPLETE"]);
    expect(a.length).toBe(6);
    expect(a.every((p) => p.project.companyId === A.id)).toBe(true);
    const un = await unassignedCosts(A.id);
    expect(un.length).toBe(7);
    expect(un.every((c) => c.companyId === A.id)).toBe(true);
  });
});

describe("actions can't touch another company's rows", () => {
  it("approving B's change order as A does nothing", async () => {
    const co = (await db.query.changeOrders.findFirst({ where: and(eq(s.changeOrders.companyId, B.id), eq(s.changeOrders.status, "PENDING")) }))!;
    actAs(A);
    await actions.setChangeOrderStatus(form({ id: co.id, status: "APPROVED" }));
    expect((await db.query.changeOrders.findFirst({ where: eq(s.changeOrders.id, co.id) }))!.status).toBe("PENDING");
  });

  it("approving B's time entries as A does nothing", async () => {
    const pending = await db.select({ id: s.timeEntries.id }).from(s.timeEntries)
      .where(and(eq(s.timeEntries.companyId, B.id), eq(s.timeEntries.status, "SUBMITTED")));
    expect(pending.length).toBeGreaterThan(0);
    actAs(A);
    await actions.approveTime(form({ ids: pending.map((p) => p.id) }));
    const after = await db.select().from(s.timeEntries).where(inArray(s.timeEntries.id, pending.map((p) => p.id)));
    expect(after.every((t) => t.status === "SUBMITTED")).toBe(true);
  });

  it("posting or deleting B's draft progress bill as A does nothing", async () => {
    const [draft] = await db.insert(s.progressBills).values({ companyId: B.id, projectId: bProjectId, number: 99, periodEnd: "2026-09-30", status: "DRAFT" }).returning();
    actAs(A);
    await actions.postProgressBill(form({ id: draft.id }));
    await actions.deleteProgressBill(form({ id: draft.id }));
    expect((await db.query.progressBills.findFirst({ where: eq(s.progressBills.id, draft.id) }))?.status).toBe("DRAFT");
  });

  it("can't assign B's unassigned cost, or assign A's cost to B's project", async () => {
    const bCost = (await unassignedCosts(B.id))[0];
    const aCost = (await unassignedCosts(A.id))[0];
    const aCode = (await db.query.costCodes.findFirst({ where: eq(s.costCodes.companyId, A.id) }))!;
    const aProject = (await db.query.projects.findFirst({ where: eq(s.projects.companyId, A.id) }))!;
    actAs(A);
    await actions.assignCost(form({ id: bCost.id, projectId: aProject.id, costCodeId: aCode.id }));
    expect((await db.query.costTransactions.findFirst({ where: eq(s.costTransactions.id, bCost.id) }))!.projectId).toBeNull();
    await expect(actions.assignCost(form({ id: aCost.id, projectId: bProjectId, costCodeId: aCode.id }))).rejects.toThrow();
    expect((await db.query.costTransactions.findFirst({ where: eq(s.costTransactions.id, aCost.id) }))!.projectId).toBeNull();
  });

  it("can't create change orders, forecasts, bills or time on B's project", async () => {
    const aEmp = (await db.query.employees.findFirst({ where: eq(s.employees.companyId, A.id) }))!;
    const aCode = (await db.query.costCodes.findFirst({ where: eq(s.costCodes.companyId, A.id) }))!;
    actAs(A);
    await expect(actions.createChangeOrder(form({ projectId: bProjectId, title: "x", contractAmount: "1" }))).rejects.toThrow("Project not found");
    await expect(actions.saveForecast(form({ projectId: bProjectId, costCodeId: aCode.id, etc: "1" }))).rejects.toThrow("Project not found");
    await expect(actions.createProgressBill(form({ projectId: bProjectId, periodEnd: "2026-09-30" }))).rejects.toThrow("Project not found");
    await expect(actions.addTimeEntry(form({ employeeId: aEmp.id, projectId: bProjectId, costCodeId: aCode.id, date: "2026-09-25", hours: "8" }))).rejects.toThrow("Project not found");
  });

  it("can't reference B's cost code from A's project (enforced by the database)", async () => {
    const aProject = (await db.query.projects.findFirst({ where: and(eq(s.projects.companyId, A.id), eq(s.projects.number, "P-2408")) }))!;
    const bCode = (await db.query.costCodes.findFirst({ where: eq(s.costCodes.companyId, B.id) }))!;
    actAs(A);
    await expect(actions.createChangeOrder(form({ projectId: aProject.id, title: "x", contractAmount: "100", code0: bCode.id, cost0: "50" }))).rejects.toThrow();
    // and directly, bypassing app code entirely
    await expect(db.insert(s.budgetLines).values({ companyId: A.id, projectId: bProjectId, costCodeId: bCode.id, originalCents: 1 })).rejects.toThrow();
  });
});

describe("roles and idempotency", () => {
  it("members can't change the cost-code library or close WIP", async () => {
    actAs(A, false);
    await expect(actions.addCostCode(form({ code: "99-999", name: "Nope", costType: "OTHER" }))).rejects.toThrow("admins");
    await expect(actions.closeWipPeriod(form({ periodEnd: "2026-09-30" }))).rejects.toThrow("admins");
  });

  it("approving the same change order twice adds one SOV line", async () => {
    const co = (await db.query.changeOrders.findFirst({ where: and(eq(s.changeOrders.companyId, A.id), eq(s.changeOrders.status, "PENDING")) }))!;
    const sovCount = async () => (await db.select().from(s.sovLines).where(eq(s.sovLines.projectId, co.projectId))).length;
    const before = await sovCount();
    actAs(A);
    await actions.setChangeOrderStatus(form({ id: co.id, status: "APPROVED" }));
    await actions.setChangeOrderStatus(form({ id: co.id, status: "APPROVED" }));
    expect(await sovCount()).toBe(before + 1);
  });
});

// Runs last: it empties company A.
describe("removing sample data", () => {
  const counts = async (companyId: string) => ({
    projects: (await db.select().from(s.projects).where(eq(s.projects.companyId, companyId))).length,
    costs: (await db.select().from(s.costTransactions).where(eq(s.costTransactions.companyId, companyId))).length,
    time: (await db.select().from(s.timeEntries).where(eq(s.timeEntries.companyId, companyId))).length,
    codes: (await db.select().from(s.costCodes).where(eq(s.costCodes.companyId, companyId))).length,
  });

  it("needs an admin and the confirmation tick", async () => {
    const a = (await db.query.companies.findFirst({ where: eq(s.companies.id, A.id) }))!;
    actAs(a, false);
    await expect(actions.removeSampleData(form({ confirm: "on" }))).rejects.toThrow("admins");
    actAs(a);
    await actions.removeSampleData(form({}));
    expect((await counts(A.id)).projects).toBe(6);
  });

  it("empties only the caller's workspace and clears the flag", async () => {
    const before = await counts(B.id);
    const a = (await db.query.companies.findFirst({ where: eq(s.companies.id, A.id) }))!;
    expect(a.sampleDataLoadedAt).not.toBeNull();
    actAs(a);
    await actions.removeSampleData(form({ confirm: "on" }));
    expect(await counts(A.id)).toEqual({ projects: 0, costs: 0, time: 0, codes: 0 });
    expect(await counts(B.id)).toEqual(before);
    const after = (await db.query.companies.findFirst({ where: eq(s.companies.id, A.id) }))!;
    expect(after.sampleDataLoadedAt).toBeNull();
    expect(await loadPortfolio(A.id)).toEqual([]);
  });
});
