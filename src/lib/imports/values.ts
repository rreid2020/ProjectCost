// Turning spreadsheet cells into typed values. Pure functions; each returns null for blank and throws a readable
// message for something it can't read.

export type DateOrder = "DMY" | "MDY";

export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
export const isBlank = (v: string | undefined | null) => v == null || String(v).trim() === "";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
function iso(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error("isn't a real date");
  return `${y}-${pad(m)}-${pad(d)}`;
}
const year = (y: number) => (y < 100 ? 2000 + y : y);

/** 2026-09-22, 2026/09/22, 22/09/2026 (or 09/22/2026), 22-Sep-2026, Sep 22, 2026, Excel serial numbers. */
export function parseDate(raw: string | null | undefined, order: DateOrder): string | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T].*)?$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = year(+m[3]);
    // an unambiguous day (13-31) settles the order; otherwise use the company's
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return order === "DMY" ? iso(y, b, a) : iso(y, a, b);
  }
  m = /^(\d{1,2})[-\s]([a-z]{3,9})\.?[-\s,]+(\d{2,4})$/i.exec(s);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return iso(year(+m[3]), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/i.exec(s);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return iso(year(+m[3]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(s)) { // Excel serial date (days since 1899-12-30)
    const n = Math.floor(+s);
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  }
  throw new Error(`"${s}" isn't a date ProjectCost can read`);
}

/** "2026-09", "Sep 2026", "Sep. 2026", "September 2026", "09/2026", "2026-09-30" -> "2026-09"; null if it isn't a month. */
export function parseMonth(raw: string | null | undefined): string | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim();
  let m = /^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  m = /^([a-z]{3,9})\.?[\s-]+(\d{2,4})$/i.exec(s);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return `${year(+m[2])}-${pad(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1)}`;
  return null;
}

/** "$1,234.56", "(1,234.56)", "1,234.56-", "1234.56 CR" -> cents. */
export function parseMoney(raw: string | null | undefined): number | null {
  if (isBlank(raw)) return null;
  let s = String(raw).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\s*cr$/i.test(s)) { neg = true; s = s.replace(/\s*cr$/i, ""); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^-/.test(s.replace(/^[^\d-]+/, ""))) { neg = !neg; s = s.replace("-", ""); }
  s = s.replace(/[$€£¥\s,]|CAD|USD/gi, "");
  if (!/^\d*\.?\d+$/.test(s)) throw new Error(`"${String(raw).trim()}" isn't an amount`);
  const cents = Math.round(parseFloat(s) * 100);
  return neg ? -cents : cents;
}

/** "30.5%", "30.5" -> 3050 bp. A bare fraction ("0.305") is read as 30.5%. */
export function parsePercent(raw: string | null | undefined): number | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim();
  const n = parseFloat(s.replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error(`"${s}" isn't a percentage`);
  return Math.round((!s.includes("%") && n > 0 && n <= 1 ? n * 100 : n) * 100);
}

/** "7.5", "7:30", "7h 30m", "7.5 hrs" -> hundredths of an hour (750). */
export function parseHours(raw: string | null | undefined): number | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim().toLowerCase();
  let m = /^(\d+):(\d{1,2})(?::\d{1,2})?$/.exec(s);
  if (m) return Math.round((+m[1] + +m[2] / 60) * 100);
  m = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(s);
  if (m && (m[1] || m[2])) return Math.round((+(m[1] ?? 0) + +(m[2] ?? 0) / 60) * 100);
  const n = parseFloat(s);
  if (Number.isFinite(n) && /^-?\d*\.?\d+$/.test(s)) return Math.round(n * 100);
  throw new Error(`"${String(raw).trim()}" isn't a number of hours`);
}

export function parseInteger(raw: string | null | undefined): number | null {
  if (isBlank(raw)) return null;
  const n = Number(String(raw).trim().replace(/,/g, ""));
  if (!Number.isInteger(n)) throw new Error(`"${String(raw).trim()}" isn't a whole number`);
  return n;
}

export function parseYesNo(raw: string | null | undefined): boolean | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim().toLowerCase();
  if (["y", "yes", "true", "1", "x", "active", "on"].includes(s)) return true;
  if (["n", "no", "false", "0", "inactive", "off"].includes(s)) return false;
  throw new Error(`"${String(raw).trim()}" isn't yes or no`);
}

export function parseCostType(raw: string | null | undefined): string | null {
  if (isBlank(raw)) return null;
  const s = String(raw).toLowerCase();
  if (/lab(ou)?r|wage|crew|\bl\b/.test(s)) return "LABOUR";
  if (/sub/.test(s)) return "SUB";
  if (/equip|rental|\be\b/.test(s)) return "EQUIPMENT";
  if (/mat|supply|suppl|\bm\b/.test(s)) return "MATERIAL";
  return "OTHER";
}

export function parseProjectType(raw: string | null | undefined): string | null {
  if (isBlank(raw)) return null;
  const s = String(raw).toLowerCase();
  if (/capital|internal|cip|own use|fixed asset/.test(s)) return "CAPITAL";
  if (/sale|inventory|spec|build|stock|production/.test(s)) return "INVENTORY";
  return "CONTRACT";
}

export function parseStatus(raw: string | null | undefined, allowed: string[], map: Record<string, string>): string | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim().toLowerCase();
  for (const [needle, value] of Object.entries(map)) if (s.includes(needle)) return value;
  const up = s.toUpperCase();
  if (allowed.includes(up)) return up;
  throw new Error(`"${String(raw).trim()}" isn't a status ProjectCost knows (${allowed.join(", ").toLowerCase()})`);
}

/** Maps account-type wording from QuickBooks, Xero, Sage or a plain list onto QuickBooks-style types. */
export function parseAccountType(raw: string | null | undefined): string | null {
  if (isBlank(raw)) return null;
  const s = String(raw).toLowerCase();
  if (/cost of (goods|sales)|cogs|direct ?costs?|cost of revenue/.test(s)) return "Cost of Goods Sold";
  if (/other (expense|charges)/.test(s)) return "Other Expense";
  if (/expense|overhead|operating/.test(s)) return "Expense";
  if (/fixed|non-?current asset|property|plant|ppe/.test(s)) return "Fixed Asset";
  if (/asset|inventory|current|bank|receivable|prepay/.test(s)) return "Other Current Asset";
  if (/liabilit|payable/.test(s)) return "Other Current Liability";
  if (/equity|capital/.test(s)) return "Equity";
  if (/income|revenue|sales/.test(s)) return "Income";
  return null;
}
