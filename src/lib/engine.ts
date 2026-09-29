// Core costing engine — pure functions, no I/O. All money in integer cents, rates in basis points.
// Rounding: half-away-from-zero to the cent at each derived amount.

export const round = (n: number) => (n < 0 ? -Math.round(-n) : Math.round(n));
export const bp = (amountCents: number, basisPoints: number) => round((amountCents * basisPoints) / 10_000);

export type CostType = "LABOUR" | "MATERIAL" | "SUB" | "EQUIPMENT" | "OTHER";

// ---------- Labour ----------
export function labourCost(hoursX100: number, payRateCents: number, burdenBp: number) {
  const wages = round((hoursX100 * payRateCents) / 100);
  const burden = bp(wages, burdenBp);
  return { wages, burden, total: wages + burden };
}

// ---------- Cost-code roll-up ----------
export interface CodeInput {
  costCodeId: string;
  code: string;
  name: string;
  costType: CostType;
  originalBudget: number;
  approvedChanges: number; // approved CO cost lines
  actual: number; // posted costs + burdened labour
  committed?: number; // open POs / subcontracts (later phase)
  etcOverride?: number | null; // PM's estimate to complete
}

export interface CodeRow extends CodeInput {
  revisedBudget: number;
  etc: number;
  eac: number;
  variance: number; // revised budget − EAC (negative = overrun)
  pctSpentBp: number;
}

export function rollUpCode(c: CodeInput): CodeRow {
  const revisedBudget = c.originalBudget + c.approvedChanges;
  const etc = c.etcOverride ?? Math.max(revisedBudget - c.actual, 0);
  const eac = c.actual + etc;
  return {
    ...c,
    revisedBudget,
    etc,
    eac,
    variance: revisedBudget - eac,
    pctSpentBp: revisedBudget > 0 ? Math.round((c.actual / revisedBudget) * 10_000) : c.actual > 0 ? 10_000 : 0,
  };
}

// ---------- Project economics + WIP (cost-to-cost percentage of completion) ----------
export interface ProjectInput {
  originalContract: number;
  approvedChangeOrderRevenue: number;
  codes: CodeInput[];
  billedToDate: number; // gross progress billings before holdback
  holdbackBp: number;
}

export interface ProjectResult {
  revisedContract: number;
  originalBudget: number;
  revisedBudget: number;
  costToDate: number;
  etc: number;
  eac: number;
  projectedProfit: number;
  projectedMarginBp: number;
  budgetMarginBp: number;
  fadeBp: number; // projected margin − budgeted margin (negative = fade)
  pctCompleteBp: number;
  earnedRevenue: number;
  grossProfitToDate: number;
  billedToDate: number;
  overUnder: number; // + billings in excess of costs & est. earnings (liability); − costs & est. earnings in excess of billings (asset)
  lossProvision: number; // remaining provision for a projected loss on the contract
  holdbackReceivable: number;
  backlog: number; // revised contract − earned revenue
  rows: CodeRow[];
}

export function projectEconomics(p: ProjectInput): ProjectResult {
  const rows = p.codes.map(rollUpCode);
  const sum = (f: (r: CodeRow) => number) => rows.reduce((a, r) => a + f(r), 0);

  const revisedContract = p.originalContract + p.approvedChangeOrderRevenue;
  const originalBudget = sum((r) => r.originalBudget);
  const revisedBudget = sum((r) => r.revisedBudget);
  const costToDate = sum((r) => r.actual);
  const etc = sum((r) => r.etc);
  const eac = costToDate + etc;
  const projectedProfit = revisedContract - eac;

  const pct = eac > 0 ? Math.min(costToDate / eac, 1) : 0;
  const pctCompleteBp = Math.round(pct * 10_000);
  const earnedRevenue = round(revisedContract * pct);

  // A projected loss is recognized in full immediately (ASPE 3400 / IFRS 15 onerous contract / ASC 605-35).
  // Earned revenue less cost to date already recognizes pct × loss; the provision carries the rest.
  const lossProvision = projectedProfit < 0 ? round(-projectedProfit * (1 - pct)) : 0;
  const grossProfitToDate = earnedRevenue - costToDate - lossProvision;

  const marginBp = (profit: number, rev: number) => (rev !== 0 ? Math.round((profit / rev) * 10_000) : 0);
  const projectedMarginBp = marginBp(projectedProfit, revisedContract);
  const budgetMarginBp = marginBp(revisedContract - revisedBudget, revisedContract);

  return {
    revisedContract,
    originalBudget,
    revisedBudget,
    costToDate,
    etc,
    eac,
    projectedProfit,
    projectedMarginBp,
    budgetMarginBp,
    fadeBp: projectedMarginBp - budgetMarginBp,
    pctCompleteBp,
    earnedRevenue,
    grossProfitToDate,
    billedToDate: p.billedToDate,
    overUnder: p.billedToDate - earnedRevenue,
    lossProvision,
    holdbackReceivable: bp(p.billedToDate, p.holdbackBp),
    backlog: revisedContract - earnedRevenue,
    rows,
  };
}

// ---------- Progress billing (schedule of values) ----------
export interface SovInput {
  sovLineId: string;
  lineNo: number;
  description: string;
  scheduledValue: number;
  previouslyBilled: number;
  thisPeriod: number;
}

export function progressBill(lines: SovInput[], holdbackBp: number, taxBp: number) {
  const rows = lines.map((l) => {
    const completed = l.previouslyBilled + l.thisPeriod;
    return {
      ...l,
      completed,
      pctBp: l.scheduledValue ? Math.round((completed / l.scheduledValue) * 10_000) : 0,
      balanceToFinish: l.scheduledValue - completed,
      overBilled: completed > l.scheduledValue,
    };
  });
  const gross = rows.reduce((a, r) => a + r.thisPeriod, 0);
  const holdback = bp(gross, holdbackBp);
  // CA: GST/HST on holdback is not payable until the holdback itself becomes payable, so tax is on the net.
  const taxable = gross - holdback;
  const tax = bp(taxable, taxBp);
  return {
    rows,
    scheduledTotal: rows.reduce((a, r) => a + r.scheduledValue, 0),
    completedTotal: rows.reduce((a, r) => a + r.completed, 0),
    gross,
    holdback,
    tax,
    netDue: taxable + tax,
    errors: rows.filter((r) => r.overBilled).map((r) => `Line ${r.lineNo} bills past its scheduled value`),
  };
}

// ---------- Month-end WIP journal entry ----------
export interface JeLine {
  account: string;
  debit: number;
  credit: number;
  memo?: string;
}

export const WIP_ACCOUNTS = {
  underbillings: "Costs & estimated earnings in excess of billings",
  overbillings: "Billings in excess of costs & estimated earnings",
  revenue: "Contract revenue — WIP adjustment",
  lossProvision: "Provision for contract losses",
  lossExpense: "Contract costs — loss provision",
};

/** Reversing month-end entry that books the WIP position for all projects. */
export function wipJournal(items: { projectNumber: string; overUnder: number; lossProvision: number }[]): JeLine[] {
  const under = items.filter((i) => i.overUnder < 0).reduce((a, i) => a - i.overUnder, 0);
  const over = items.filter((i) => i.overUnder > 0).reduce((a, i) => a + i.overUnder, 0);
  const loss = items.reduce((a, i) => a + i.lossProvision, 0);
  const lines: JeLine[] = [];
  if (under) {
    lines.push({ account: WIP_ACCOUNTS.underbillings, debit: under, credit: 0 });
    lines.push({ account: WIP_ACCOUNTS.revenue, debit: 0, credit: under });
  }
  if (over) {
    lines.push({ account: WIP_ACCOUNTS.revenue, debit: over, credit: 0 });
    lines.push({ account: WIP_ACCOUNTS.overbillings, debit: 0, credit: over });
  }
  if (loss) {
    lines.push({ account: WIP_ACCOUNTS.lossExpense, debit: loss, credit: 0 });
    lines.push({ account: WIP_ACCOUNTS.lossProvision, debit: 0, credit: loss });
  }
  return lines;
}

/** Burden journal: moves burden from payroll-expense clearing into job cost. */
export function burdenJournal(totalBurden: number): JeLine[] {
  if (!totalBurden) return [];
  return [
    { account: "Job cost — labour burden", debit: totalBurden, credit: 0 },
    { account: "Payroll burden applied (clearing)", debit: 0, credit: totalBurden },
  ];
}

export function isBalanced(lines: JeLine[]) {
  return lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0;
}

// ---------- Project health flags ----------
export function healthFlags(r: ProjectResult) {
  const flags: { level: "red" | "amber"; text: string }[] = [];
  if (r.projectedProfit < 0) flags.push({ level: "red", text: "Projected loss" });
  else if (r.fadeBp <= -300) flags.push({ level: "red", text: `Margin fade ${(r.fadeBp / 100).toFixed(1)} pts` });
  else if (r.fadeBp <= -100) flags.push({ level: "amber", text: `Margin fade ${(r.fadeBp / 100).toFixed(1)} pts` });
  if (r.overUnder < 0 && -r.overUnder > r.revisedContract * 0.05) flags.push({ level: "amber", text: "Underbilled > 5% of contract" });
  const overrun = r.rows.filter((x) => x.variance < 0);
  if (overrun.length) flags.push({ level: "amber", text: `${overrun.length} cost code${overrun.length > 1 ? "s" : ""} over budget` });
  return flags;
}

// ---------- Overhead (management view: profit after overhead; never part of job cost or WIP) ----------
export type OverheadBasis = "labour_cost" | "labour_hours" | "direct_cost";

/** Rate from a pool and a base over the same period: basis points of base, or cents per hour for labour_hours. Base hours are x100. */
export function overheadRate(poolCents: number, base: number, basis: OverheadBasis): number | null {
  if (base <= 0) return null;
  return basis === "labour_hours" ? round((poolCents * 100) / base) : round((poolCents / base) * 10_000);
}

export function applyOverhead(base: number, rate: number, basis: OverheadBasis) {
  return basis === "labour_hours" ? round((base * rate) / 100) : bp(base, rate);
}

export interface OverheadResult {
  baseToDate: number;
  baseAtCompletion: number;
  toDate: number;
  atCompletion: number;
  profitAfterOverhead: number; // projected profit − overhead at completion
  marginAfterBp: number;
  grossProfitToDateAfter: number;
}

/**
 * Overhead for one project. At completion, labour is taken from the LABOUR cost-type rows' EAC;
 * hours at completion scale hours to date by labour EAC / labour to date.
 */
export function projectOverhead(e: ProjectResult, labour: { wages: number; burden: number; approvedHours: number }, rate: number, basis: OverheadBasis): OverheadResult {
  const labourToDate = labour.wages + labour.burden;
  const labourEac = Math.max(e.rows.filter((r) => r.costType === "LABOUR").reduce((a, r) => a + r.eac, 0), labourToDate);
  const [baseToDate, baseAtCompletion] =
    basis === "labour_cost" ? [labourToDate, labourEac]
    : basis === "labour_hours" ? [labour.approvedHours, labourToDate > 0 ? round((labour.approvedHours * labourEac) / labourToDate) : labour.approvedHours]
    : [e.costToDate, e.eac];
  const toDate = applyOverhead(baseToDate, rate, basis);
  const atCompletion = applyOverhead(baseAtCompletion, rate, basis);
  const profitAfterOverhead = e.projectedProfit - atCompletion;
  return {
    baseToDate, baseAtCompletion, toDate, atCompletion, profitAfterOverhead,
    marginAfterBp: e.revisedContract ? Math.round((profitAfterOverhead / e.revisedContract) * 10_000) : 0,
    grossProfitToDateAfter: e.grossProfitToDate - toDate,
  };
}
