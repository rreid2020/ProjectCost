import { describe, it, expect } from "vitest";
import { inventoryFlow, capitalFlow, projectEntries, entryBalanced, type DatedCost, type BalanceSheetProject } from "../src/lib/project-accounting";

const c = (date: string, amount: number, account: string | null = "mat"): DatedCost => ({ date, amount, account });

describe("build for sale", () => {
  const costs = [c("2026-01-10", 300_000_00), c("2026-02-10", 100_000_00)];

  it("moves WIP to finished goods per unit completed, using cost to that date", () => {
    // 4 units planned. Jan 31: 1 of 4 done -> 1/4 of $300k. Feb 28: 3 of remaining 3 -> all remaining WIP.
    const f = inventoryFlow(costs, 4, [{ kind: "COMPLETED", date: "2026-01-31", units: 1 }, { kind: "COMPLETED", date: "2026-02-28", units: 3 }]);
    expect(f.transfers.map((t) => t.amount)).toEqual([75_000_00, 325_000_00]);
    expect(f).toMatchObject({ wip: 0, fg: 400_000_00, completedUnits: 4, remainingUnits: 0, warnings: [] });
  });

  it("relieves finished goods to COGS at average cost when units sell", () => {
    const f = inventoryFlow(costs, 4, [
      { kind: "COMPLETED", date: "2026-02-28", units: 4 },
      { kind: "SOLD", date: "2026-03-05", units: 1, saleAmountCents: 150_000_00 },
      { kind: "SOLD", date: "2026-03-20", units: 3 },
    ]);
    expect(f.reliefs.map((r) => r.amount)).toEqual([100_000_00, 300_000_00]);
    expect(f).toMatchObject({ fg: 0, cogs: 400_000_00, soldUnits: 4, fgUnits: 0 });
    expect(f.reliefs[0].sale).toBe(150_000_00);
  });

  it("respects the as-of date and flags impossible events instead of inventing numbers", () => {
    const f = inventoryFlow(costs, 2, [
      { kind: "SOLD", date: "2026-01-15", units: 1 },
      { kind: "COMPLETED", date: "2026-01-31", units: 3 },
      { kind: "COMPLETED", date: "2026-02-28", units: 1 },
    ], "2026-01-31");
    expect(f.soldUnits).toBe(0);
    expect(f.completedUnits).toBe(2);
    expect(f.warnings.join(" ")).toMatch(/sold with none finished/);
    expect(f.warnings.join(" ")).toMatch(/ignored/);
    expect(f.wip).toBe(0);
    const later = inventoryFlow([...costs, c("2026-03-01", 5_000_00)], 1, [{ kind: "COMPLETED", date: "2026-02-28", units: 1 }]);
    expect(later.wip).toBe(5_000_00);
    expect(later.warnings.join(" ")).toMatch(/after every unit was completed/);
  });
});

describe("capital", () => {
  it("capitalizes cost to the in-service date and flags later costs", () => {
    expect(capitalFlow([c("2026-01-10", 80_000_00)], null)).toMatchObject({ cip: 80_000_00, capitalized: 0 });
    const f = capitalFlow([c("2026-01-10", 80_000_00), c("2026-03-15", 2_000_00)], "2026-02-28");
    expect(f).toMatchObject({ capitalized: 80_000_00, cip: 2_000_00, afterInService: 2_000_00 });
    expect(f.warnings).toHaveLength(1);
  });
});

describe("month-end entries", () => {
  const acct = { cip: "CIP", wipInventory: "WIPINV", finishedGoods: "FG", cogs: "COGS", labourCredit: "WAGES" };
  const base: BalanceSheetProject = {
    id: "p1", number: "CAP-1", name: "Shop expansion", projectType: "CAPITAL", unitsPlanned: 1, inServiceDate: null, assetAccountId: "BLDG",
    costs: [c("2026-03-03", 10_000_00, "REPAIRS"), c("2026-03-09", 4_000_00, "REPAIRS"), c("2026-03-12", 6_000_00, "CIP"), c("2026-03-20", -1_000_00, "MATERIALS"), c("2026-02-10", 9_999_00, "REPAIRS")],
    labour: [{ date: "2026-03-15", amount: 2_500_00 }], events: [],
  };

  it("reclasses the month's costs by source account and labour into CIP, skipping costs already in CIP", () => {
    const [e] = projectEntries(base, acct, "2026-03-01", "2026-03-31");
    expect(entryBalanced(e)).toBe(true);
    expect(e.memo).toMatch(/^\[ProjectCost\]/);
    const on = (a: string) => e.lines.filter((l) => l.account === a).reduce((x, l) => x + l.debit - l.credit, 0);
    expect(on("CIP")).toBe(14_000_00 - 1_000_00 + 2_500_00);
    expect(on("REPAIRS")).toBe(-14_000_00);
    expect(on("MATERIALS")).toBe(1_000_00); // a credit (return) reverses direction
    expect(on("WAGES")).toBe(-2_500_00);
  });

  it("capitalizes in the month the project goes into service", () => {
    const entries = projectEntries({ ...base, inServiceDate: "2026-03-31" }, acct, "2026-03-01", "2026-03-31");
    const cap = entries.find((x) => x.key.endsWith("capitalize"))!; // 10,000 + 4,000 + 6,000 − 1,000 + 9,999 (Feb) + 2,500 labour
    expect(cap.lines).toEqual([{ account: "BLDG", debit: 31_499_00, credit: 0, memo: undefined }, { account: "CIP", debit: 0, credit: 31_499_00, memo: undefined }]);
  });

  it("moves inventory through WIP, finished goods and COGS", () => {
    const inv: BalanceSheetProject = { ...base, projectType: "INVENTORY", unitsPlanned: 2, costs: [c("2026-03-02", 100_000_00, "WIPINV")], labour: [],
      events: [{ kind: "COMPLETED", date: "2026-03-25", units: 2 }, { kind: "SOLD", date: "2026-03-28", units: 1 }] };
    const entries = projectEntries(inv, acct, "2026-03-01", "2026-03-31");
    expect(entries.map((e) => e.key.split(":")[1])).toEqual(["complete", "sold"]); // costs already in WIP inventory: no reclass
    expect(entries.every(entryBalanced)).toBe(true);
    expect(entries[0].lines[0]).toMatchObject({ account: "FG", debit: 100_000_00 });
    expect(entries[1].lines[0]).toMatchObject({ account: "COGS", debit: 50_000_00 });
  });
});
