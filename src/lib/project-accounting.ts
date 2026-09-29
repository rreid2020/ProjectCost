// Balance-sheet projects: capital projects (construction in progress -> fixed asset) and build-for-sale projects
// (work-in-process inventory -> finished goods -> cost of goods sold). Pure functions: no I/O.
// Money in integer cents. Dates ISO 'YYYY-MM-DD'.
import { round } from "./engine";

export type DatedCost = { date: string; amount: number; account: string | null }; // account = QuickBooks GL account the cost posted to (null for labour)
export type UnitEvent = { id?: string; kind: "COMPLETED" | "SOLD"; date: string; units: number; saleAmountCents?: number | null };

export const costThrough = (costs: DatedCost[], date: string) => costs.reduce((a, c) => (c.date <= date ? a + c.amount : a), 0);

// ---------- build for sale ----------
export interface InventoryFlow {
  costToDate: number;
  transferredToFG: number;
  wip: number; // work-in-process inventory
  fg: number; // finished goods on hand
  cogs: number; // relieved to cost of goods sold
  completedUnits: number;
  soldUnits: number;
  fgUnits: number;
  remainingUnits: number;
  transfers: { date: string; units: number; amount: number; eventId?: string }[];
  reliefs: { date: string; units: number; amount: number; sale: number | null; eventId?: string }[];
  warnings: string[];
}

/**
 * Completing k of the r units still in process moves k/r of the WIP at that date to finished goods.
 * Selling k of the f finished units moves k/f of the finished-goods balance (average cost) to COGS.
 */
export function inventoryFlow(costs: DatedCost[], unitsPlanned: number, events: UnitEvent[], asOf = "9999-12-31"): InventoryFlow {
  const sorted = [...events].filter((e) => e.date <= asOf).sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "COMPLETED" ? -1 : 1));
  let transferred = 0, fg = 0, cogs = 0, completed = 0, sold = 0;
  const transfers: InventoryFlow["transfers"] = [], reliefs: InventoryFlow["reliefs"] = [], warnings: string[] = [];
  for (const e of sorted) {
    if (e.units <= 0) continue;
    if (e.kind === "COMPLETED") {
      const remaining = unitsPlanned - completed;
      if (remaining <= 0) { warnings.push(`${e.date}: ${e.units} unit(s) completed, but all ${unitsPlanned} planned units were already complete. Increase units planned.`); continue; }
      const units = Math.min(e.units, remaining);
      if (units < e.units) warnings.push(`${e.date}: only ${remaining} unit(s) were still in process; ${e.units - units} ignored.`);
      const wipThen = costThrough(costs, e.date) - transferred;
      const amount = units === remaining ? wipThen : round((wipThen * units) / remaining);
      transferred += amount; fg += amount; completed += units;
      transfers.push({ date: e.date, units, amount, eventId: e.id });
    } else {
      const onHand = completed - sold;
      if (onHand <= 0) { warnings.push(`${e.date}: ${e.units} unit(s) sold with none finished. Record completion first.`); continue; }
      const units = Math.min(e.units, onHand);
      if (units < e.units) warnings.push(`${e.date}: only ${onHand} finished unit(s) on hand; ${e.units - units} ignored.`);
      const amount = units === onHand ? fg : round((fg * units) / onHand);
      fg -= amount; cogs += amount; sold += units;
      reliefs.push({ date: e.date, units, amount, sale: e.saleAmountCents ?? null, eventId: e.id });
    }
  }
  const costToDate = costThrough(costs, asOf);
  const wip = costToDate - transferred;
  if (completed >= unitsPlanned && wip !== 0) warnings.push("Costs arrived after every unit was completed. They are still in work in process: record them against finished goods or cost of goods sold.");
  return { costToDate, transferredToFG: transferred, wip, fg, cogs, completedUnits: completed, soldUnits: sold, fgUnits: completed - sold, remainingUnits: unitsPlanned - completed, transfers, reliefs, warnings };
}

// ---------- capital ----------
export interface CapitalFlow { costToDate: number; cip: number; capitalized: number; capitalizedOn: string | null; afterInService: number; warnings: string[] }

export function capitalFlow(costs: DatedCost[], inServiceDate: string | null, asOf = "9999-12-31"): CapitalFlow {
  const costToDate = costThrough(costs, asOf);
  if (!inServiceDate || inServiceDate > asOf) return { costToDate, cip: costToDate, capitalized: 0, capitalizedOn: null, afterInService: 0, warnings: [] };
  const capitalized = costThrough(costs, inServiceDate);
  const afterInService = costToDate - capitalized;
  return {
    costToDate, cip: afterInService, capitalized, capitalizedOn: inServiceDate, afterInService,
    warnings: afterInService ? ["Costs were recorded after the in-service date. They sit in construction in progress: capitalize them as an addition or expense them."] : [],
  };
}

// ---------- journal entries ----------
export type JeLine = { account: string | null; debit: number; credit: number; memo?: string };
export type DraftEntry = { key: string; date: string; title: string; memo: string; lines: JeLine[] };

export type BalanceSheetProject = {
  id: string; number: string; name: string; projectType: "CAPITAL" | "INVENTORY";
  unitsPlanned: number; inServiceDate: string | null; assetAccountId: string | null;
  costs: DatedCost[]; labour: { date: string; amount: number }[]; events: UnitEvent[];
};
export type AccountMap = { cip: string | null; wipInventory: string | null; finishedGoods: string | null; cogs: string | null; labourCredit: string | null };

/** Posts a signed amount as debit (positive) or credit (negative), and the reverse on the other account. */
function pair(debitAccount: string | null, creditAccount: string | null, amount: number, memo?: string): JeLine[] {
  if (!amount) return [];
  return amount > 0
    ? [{ account: debitAccount, debit: amount, credit: 0, memo }, { account: creditAccount, debit: 0, credit: amount, memo }]
    : [{ account: debitAccount, debit: 0, credit: -amount, memo }, { account: creditAccount, debit: -amount, credit: 0, memo }];
}

/** Collapses lines on the same account and side. */
function consolidate(lines: JeLine[]): JeLine[] {
  const m = new Map<string, JeLine>();
  for (const l of lines) {
    const k = `${l.account}|${l.debit ? "D" : "C"}`;
    const cur = m.get(k);
    if (cur) { cur.debit += l.debit; cur.credit += l.credit; } else m.set(k, { ...l });
  }
  return [...m.values()].filter((l) => l.debit || l.credit).sort((a, b) => b.debit - a.debit);
}

/** Entries for one project for the month [start, end]. Account ids are QuickBooks ids; null means not mapped yet. */
export function projectEntries(p: BalanceSheetProject, acct: AccountMap, start: string, end: string): DraftEntry[] {
  const out: DraftEntry[] = [];
  const tag = (what: string) => `[ProjectCost] ${what} · ${p.number} ${p.name}`;
  const inPeriod = (d: string) => d >= start && d <= end;
  const target = p.projectType === "CAPITAL" ? acct.cip : acct.wipInventory;

  // 1. Reclass the month's project costs into CIP / WIP inventory from wherever they posted, plus labour.
  const reclass: JeLine[] = [];
  const byAccount = new Map<string, number>();
  for (const c of p.costs) if (inPeriod(c.date) && c.account && c.account !== target) byAccount.set(c.account, (byAccount.get(c.account) ?? 0) + c.amount);
  for (const [account, amount] of byAccount) reclass.push(...pair(target, account, amount));
  const labour = p.labour.filter((l) => inPeriod(l.date)).reduce((a, l) => a + l.amount, 0);
  reclass.push(...pair(target, acct.labourCredit, labour, "Burdened labour"));
  if (reclass.length) out.push({ key: `${p.id}:reclass`, date: end, title: p.projectType === "CAPITAL" ? "Costs to construction in progress" : "Costs to work-in-process inventory", memo: tag("Reclass project costs"), lines: consolidate(reclass) });

  const allCosts: DatedCost[] = [...p.costs, ...p.labour.map((l) => ({ ...l, account: null }))];
  if (p.projectType === "CAPITAL") {
    // 2. Capitalize when placed in service
    if (p.inServiceDate && inPeriod(p.inServiceDate)) {
      const f = capitalFlow(allCosts, p.inServiceDate, p.inServiceDate);
      if (f.capitalized) out.push({ key: `${p.id}:capitalize`, date: p.inServiceDate, title: "Capitalize to fixed asset", memo: tag("Placed in service"), lines: pair(p.assetAccountId, acct.cip, f.capitalized) });
    }
  } else {
    // 3. Units completed (WIP -> FG) and sold (FG -> COGS) this month
    const f = inventoryFlow(allCosts, p.unitsPlanned, p.events, end);
    const moved = f.transfers.filter((t) => inPeriod(t.date)).reduce((a, t) => a + t.amount, 0);
    const units = f.transfers.filter((t) => inPeriod(t.date)).reduce((a, t) => a + t.units, 0);
    if (moved) out.push({ key: `${p.id}:complete`, date: end, title: `${units} unit(s) completed to finished goods`, memo: tag("Units completed"), lines: pair(acct.finishedGoods, acct.wipInventory, moved) });
    const relieved = f.reliefs.filter((r) => inPeriod(r.date)).reduce((a, r) => a + r.amount, 0);
    const sold = f.reliefs.filter((r) => inPeriod(r.date)).reduce((a, r) => a + r.units, 0);
    if (relieved) out.push({ key: `${p.id}:sold`, date: end, title: `${sold} unit(s) sold to cost of goods sold`, memo: tag("Units sold"), lines: pair(acct.cogs, acct.finishedGoods, relieved) });
  }
  return out;
}

export const entryBalanced = (e: DraftEntry) => e.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0;
