import { describe, it, expect, vi, beforeAll } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => { throw new Error("no clerk in tests"); } }));

import { buildGuide, GUIDE_STEPS, type GuideFacts } from "@/lib/guide";
import { db, migrateDb, schema as s } from "@/db";
import { loadDemoData } from "@/db/demo";
import { guideFor } from "@/lib/guide-facts";

const fresh: GuideFacts = {
  period: "2026-09", periodLabel: "September 2026", provinceSet: false, sampleData: false, qboConfigured: true, qboConnected: false, connectionOk: false,
  memberCount: 1, projectModeChosen: false, imported: false, lastImportOk: true, daysSinceImport: null, sheetImports: 0, sheetCostImports: 0, daysSinceSheetCosts: null,
  glAccounts: 0, accountsReviewed: false,
  entryAccountsMapped: false, costCodes: 0, labourCodes: 0, activeEmployees: 0, employeesWithoutRate: 0, employeesWithoutBurden: 0, activeProjects: 0,
  activeContracts: 0, contractsWithoutValue: 0, projectsWithoutBudget: 0, balanceSheetProjects: 0, internalWithoutLinks: 0, overheadPoolLoaded: false,
  overheadRateSet: false, unassignedCosts: 0, pendingTime: 0, pendingChangeOrders: 0, contractsForecastThisMonth: 0, contractsWithBudget: 0, draftBills: 0,
  wipSnapshotSaved: false,
};
const step = (g: ReturnType<typeof buildGuide>, key: string) => g.steps.find((x) => x.key === key)!;

describe("guide rules", () => {
  it("numbers every step and starts a fresh workspace at step 1", () => {
    const g = buildGuide(fresh, []);
    expect(g.total).toBe(GUIDE_STEPS.length);
    expect(g.steps.map((x) => x.number)).toEqual(GUIDE_STEPS.map((_, i) => i + 1));
    expect(step(g, "company").status).toBe("partial"); // no sample data: 1 of 2
    expect(step(g, "connect").status).toBe("todo");
    // empty queues count as done this month
    expect(step(g, "coding").status).toBe("done");
    expect(step(g, "time").status).toBe("done");
  });

  it("finishes a step when its checklist passes; confirmable steps also need a mark", () => {
    const f = { ...fresh, costCodes: 12, labourCodes: 2 };
    expect(step(buildGuide(f, []), "costcodes")).toMatchObject({ status: "partial", doneCount: 2, totalCount: 3 });
    expect(step(buildGuide(f, [{ stepKey: "costcodes", period: "setup", status: "DONE" }]), "costcodes").status).toBe("done");
  });

  it("skips optional steps, and monthly marks only count for their month", () => {
    const g = buildGuide(fresh, [
      { stepKey: "team", period: "setup", status: "SKIPPED" },
      { stepKey: "close", period: "2026-08", status: "DONE" },
      { stepKey: "billing", period: "2026-09", status: "DONE" },
    ]);
    expect(step(g, "team").status).toBe("skipped");
    expect(step(g, "close").marked).toBeNull(); // August's mark doesn't carry into September
    expect(step(g, "billing").status).toBe("done");
    expect(g.done).toBe(g.steps.filter((x) => x.status === "done" || x.status === "skipped").length);
  });

  it("adapts to where the data comes from", () => {
    const sheets = buildGuide({ ...fresh, sheetImports: 3, sheetCostImports: 1, daysSinceSheetCosts: 2, activeProjects: 4 }, []);
    expect(step(sheets, "connect").status).toBe("done");
    expect(step(sheets, "sync").status).toBe("done");
    expect(step(sheets, "import").status).toBe("done");
    const sheetText = sheets.steps.flatMap((x) => x.how).join(" ");
    expect(sheetText).toMatch(/Import data/);
    expect(step(sheets, "employees").how.join(" ")).not.toMatch(/In QuickBooks/);
    const qbo = buildGuide({ ...fresh, qboConnected: true, connectionOk: true, imported: true, daysSinceImport: 1 }, []);
    expect(step(qbo, "sync").how.join(" ")).toMatch(/Sync now/);
    expect(step(qbo, "sync").how.join(" ")).not.toMatch(/spreadsheet/i); // QuickBooks-only company isn't pushed to spreadsheets
    expect(step(qbo, "sync").openLabel).toBe("Open settings");
    // a company with nothing connected yet sees both ways in
    expect(step(buildGuide(fresh, []), "connect").how.join(" ")).toMatch(/QuickBooks Online.*spreadsheets/);
  });

  it("adds checks only when they apply", () => {
    expect(step(buildGuide(fresh, []), "accounts").checks).toHaveLength(2);
    expect(step(buildGuide({ ...fresh, balanceSheetProjects: 1 }, []), "accounts").checks).toHaveLength(3);
  });
});

describe("guide facts from the database", () => {
  beforeAll(async () => { await migrateDb(); });

  it("reads a workspace with sample data", async () => {
    const [co] = await db.insert(s.companies).values({ name: "G", clerkOrgId: "org_G", province: "ON" }).returning();
    await loadDemoData(db, co.id);
    const company = (await db.query.companies.findFirst({ where: eq(s.companies.id, co.id) }))!;
    const g = await guideFor(company, "org_G", new Date("2026-09-25T12:00:00Z"));
    const checks = (key: string) => Object.fromEntries(step(g, key).checks.map((c) => [c.label, c.done]));
    expect(checks("company")).toEqual({ "Province or state is set": true, "No sample data in this workspace": false });
    expect(step(g, "team").checks[0].done).toBe(false); // member count unavailable -> not assumed
    expect(checks("costcodes")["At least one labour code"]).toBe(true);
    expect(step(g, "projects").checks[0]).toMatchObject({ done: true, detail: "5 active projects" });
    expect(step(g, "coding").checks[0]).toMatchObject({ done: false, detail: "7 lines waiting" });
    expect(step(g, "time").checks[0].done).toBe(false);
    expect(step(g, "changes").checks[0].done).toBe(false);
  });
});
