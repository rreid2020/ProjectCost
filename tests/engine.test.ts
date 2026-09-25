import { describe, it, expect } from "vitest";
import { labourCost, rollUpCode, projectEconomics, progressBill, wipJournal, isBalanced, healthFlags, type CodeInput } from "../src/lib/engine";

const code = (o: Partial<CodeInput>): CodeInput => ({
  costCodeId: "x", code: "01", name: "x", costType: "MATERIAL", originalBudget: 0, approvedChanges: 0, actual: 0, ...o,
});

describe("labour", () => {
  it("applies burden to wages", () => {
    // 7.5h × $42.00 = $315.00; 28.5% burden = $89.78 (89.775 rounded)
    expect(labourCost(750, 4200, 2850)).toEqual({ wages: 31500, burden: 8978, total: 40478 });
  });
});

describe("cost code roll-up", () => {
  it("defaults ETC to remaining revised budget, floored at zero", () => {
    const r = rollUpCode(code({ originalBudget: 100_000, approvedChanges: 20_000, actual: 150_000 }));
    expect(r.revisedBudget).toBe(120_000);
    expect(r.etc).toBe(0);
    expect(r.eac).toBe(150_000);
    expect(r.variance).toBe(-30_000);
  });
  it("uses the PM's ETC override when given", () => {
    const r = rollUpCode(code({ originalBudget: 100_000, actual: 40_000, etcOverride: 80_000 }));
    expect(r.eac).toBe(120_000);
    expect(r.variance).toBe(-20_000);
  });
});

describe("project economics / WIP", () => {
  it("computes cost-to-cost % complete, earned revenue and underbilling", () => {
    const r = projectEconomics({
      originalContract: 1_000_000_00,
      approvedChangeOrderRevenue: 50_000_00,
      codes: [code({ originalBudget: 800_000_00, approvedChanges: 40_000_00, actual: 420_000_00 })],
      billedToDate: 480_000_00,
      holdbackBp: 1000,
    });
    expect(r.revisedContract).toBe(1_050_000_00);
    expect(r.eac).toBe(840_000_00);
    expect(r.pctCompleteBp).toBe(5000);
    expect(r.earnedRevenue).toBe(525_000_00);
    expect(r.overUnder).toBe(-45_000_00); // underbilled
    expect(r.holdbackReceivable).toBe(48_000_00);
    expect(r.projectedProfit).toBe(210_000_00);
    expect(r.lossProvision).toBe(0);
    expect(r.backlog).toBe(525_000_00);
  });

  it("recognizes a projected loss in full", () => {
    // contract 100k, EAC 120k, CTD 60k => 50% complete, loss 20k.
    const r = projectEconomics({
      originalContract: 100_000_00, approvedChangeOrderRevenue: 0,
      codes: [code({ originalBudget: 90_000_00, actual: 60_000_00, etcOverride: 60_000_00 })],
      billedToDate: 50_000_00, holdbackBp: 1000,
    });
    expect(r.pctCompleteBp).toBe(5000);
    expect(r.earnedRevenue).toBe(50_000_00);
    expect(r.lossProvision).toBe(10_000_00);
    // GP to date = full loss
    expect(r.grossProfitToDate).toBe(-20_000_00);
    expect(healthFlags(r)[0]).toEqual({ level: "red", text: "Projected loss" });
  });

  it("caps % complete at 100%", () => {
    const r = projectEconomics({
      originalContract: 100, approvedChangeOrderRevenue: 0,
      codes: [code({ originalBudget: 50, actual: 80 })], billedToDate: 100, holdbackBp: 0,
    });
    expect(r.pctCompleteBp).toBe(10000);
    expect(r.overUnder).toBe(0);
  });
});

describe("progress billing", () => {
  it("computes holdback and tax on the net amount", () => {
    const b = progressBill(
      [
        { sovLineId: "a", lineNo: 1, description: "Mobilization", scheduledValue: 20_000_00, previouslyBilled: 20_000_00, thisPeriod: 0 },
        { sovLineId: "b", lineNo: 2, description: "Rough-in", scheduledValue: 200_000_00, previouslyBilled: 50_000_00, thisPeriod: 60_000_00 },
      ],
      1000, 1300,
    );
    expect(b.gross).toBe(60_000_00);
    expect(b.holdback).toBe(6_000_00);
    expect(b.tax).toBe(7_020_00);
    expect(b.netDue).toBe(61_020_00);
    expect(b.rows[1].pctBp).toBe(5500);
    expect(b.errors).toEqual([]);
  });
  it("flags lines billed past scheduled value", () => {
    const b = progressBill([{ sovLineId: "a", lineNo: 1, description: "x", scheduledValue: 100, previouslyBilled: 90, thisPeriod: 20 }], 0, 0);
    expect(b.errors).toHaveLength(1);
  });
});

describe("WIP journal", () => {
  it("books under/over billings and loss provision, balanced", () => {
    const je = wipJournal([
      { projectNumber: "1", overUnder: -45_000, lossProvision: 0 },
      { projectNumber: "2", overUnder: 12_000, lossProvision: 5_000 },
    ]);
    expect(isBalanced(je)).toBe(true);
    expect(je.find((l) => l.account.startsWith("Costs & estimated"))?.debit).toBe(45_000);
    expect(je.find((l) => l.account.startsWith("Billings in excess"))?.credit).toBe(12_000);
    expect(je.find((l) => l.account.startsWith("Provision"))?.credit).toBe(5_000);
  });
});
