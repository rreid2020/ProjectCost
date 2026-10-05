// Finding the header row and matching columns to fields.
import type { ImportKind } from "./kinds";
import { normHeader, parseMonth } from "./values";

export type Mapping = Record<string, number>; // fieldKey -> column index

const aliasSet = (kind: ImportKind) => new Set(kind.fields.flatMap((f) => f.aliases.map(normHeader)));

/** The row (within the first 15) whose cells look most like this kind's column names. Exports often have title rows above. */
export function detectHeaderRow(rows: string[][], kind: ImportKind): number {
  const aliases = aliasSet(kind);
  let best = 0, bestScore = -1;
  rows.slice(0, 15).forEach((row, i) => {
    const score = row.filter((c) => aliases.has(normHeader(c))).length * 10 + row.filter((c) => c && isNaN(Number(c))).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

/**
 * Matches each field to a column: a saved mapping (by header text) wins, then an exact alias match, then a header that
 * contains a longer alias. Required fields are matched first; each column is used once.
 */
export function autoMap(headers: string[], kind: ImportKind, saved?: Record<string, string>): Mapping {
  const norm = headers.map(normHeader);
  const used = new Set<number>();
  const map: Mapping = {};
  const take = (key: string, i: number) => { if (i >= 0 && !used.has(i)) { map[key] = i; used.add(i); return true; } return false; };
  if (saved) for (const [key, header] of Object.entries(saved)) if (kind.fields.some((f) => f.key === key)) take(key, norm.indexOf(normHeader(header)));
  const ordered = [...kind.fields].sort((a, b) => Number(!!b.required) - Number(!!a.required));
  for (const f of ordered) {
    if (map[f.key] != null) continue;
    for (const a of [f.label, ...f.aliases].map(normHeader)) if (take(f.key, norm.findIndex((h, i) => h === a && !used.has(i)))) break; // template headers are the labels
  }
  for (const f of ordered) {
    if (map[f.key] != null) continue;
    for (const a of f.aliases.map(normHeader).filter((a) => a.length >= 5)) if (take(f.key, norm.findIndex((h, i) => h.includes(a) && !used.has(i)))) break;
  }
  return map;
}

/** For a P&L laid out with one column per month: the columns whose header is a month. */
export function monthColumns(headers: string[], mapping: Mapping): { index: number; month: string }[] {
  const mapped = new Set(Object.values(mapping));
  return headers.flatMap((h, index) => {
    const month = mapped.has(index) ? null : parseMonth(h);
    return month ? [{ index, month }] : [];
  });
}

/** Problems with the mapping itself (before looking at rows). */
export function mappingProblems(kind: ImportKind, mapping: Mapping, headers: string[]): string[] {
  const out: string[] = [];
  for (const f of kind.fields) if (f.required && mapping[f.key] == null) out.push(`Choose the column for "${f.label}".`);
  for (const group of kind.oneOf ?? []) if (!group.some((k) => mapping[k] != null))
    out.push(`Choose a column for ${group.map((k) => `"${kind.fields.find((f) => f.key === k)!.label}"`).join(" or ")}.`);
  if (kind.key === "pnl" && (mapping.month == null || mapping.amount == null) && monthColumns(headers, mapping).length === 0)
    out.push("Map Month and Amount, or use a layout with one column per month (e.g. \"Jan 2026\").");
  return out;
}

export const savedMappingFrom = (mapping: Mapping, headers: string[]) =>
  Object.fromEntries(Object.entries(mapping).filter(([, i]) => headers[i]).map(([k, i]) => [k, headers[i]]));
