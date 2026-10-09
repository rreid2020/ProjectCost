// Reports as plain data: shown as tables in the app and written to Excel / CSV by the same definitions,
// so the screen and the download always agree. Money is in cents, percentages in basis points, hours x100.
import ExcelJS from "exceljs";
import Papa from "papaparse";

export type ColKind = "text" | "date" | "money" | "pct" | "hours" | "number";
export type Col = { key: string; label: string; kind: ColKind; total?: boolean; width?: number };
export type Cell = string | number | null | undefined;
export type Row = Record<string, Cell>;
export type Sheet = { name: string; columns: Col[]; rows: Row[]; note?: string; emptyText?: string };
export type Report = { key: string; title: string; subtitle: string; company: string; fileName: string; sheets: Sheet[] };

export const totalOf = (sheet: Sheet, key: string) => sheet.rows.reduce((a, r) => a + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);

/** A value as it reads on screen and in CSV. */
export function formatCell(kind: ColKind, v: Cell): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  switch (kind) {
    case "money": return (v / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "pct": return `${(v / 100).toFixed(1)}%`;
    case "hours": return (v / 100).toFixed(2);
    default: return String(v);
  }
}

const NUM_FMT: Partial<Record<ColKind, string>> = {
  money: '#,##0.00;[Red]-#,##0.00', pct: "0.0%", hours: "0.00", number: "#,##0", date: "yyyy-mm-dd",
};
const excelValue = (kind: ColKind, v: Cell): ExcelJS.CellValue => {
  if (v == null || v === "") return null;
  if (typeof v === "string") return kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v;
  if (kind === "money" || kind === "hours") return v / 100;
  if (kind === "pct") return v / 10_000;
  return v;
};
const colLetter = (i: number) => { let s = "", n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** One worksheet per sheet: title block, header, rows, and a totals row with SUM formulas. */
export async function toXlsx(report: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ProjectCost by Axiom";
  wb.created = new Date();
  for (const sheet of report.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    ws.addRow([report.company]).font = { bold: true, size: 13 };
    ws.addRow([`${report.title}${report.sheets.length > 1 ? ` · ${sheet.name}` : ""}`]).font = { bold: true };
    ws.addRow([report.subtitle]).font = { color: { argb: "FF64748B" } };
    if (sheet.note) ws.addRow([sheet.note]).font = { italic: true, color: { argb: "FF64748B" } };
    ws.addRow([]);
    const header = ws.addRow(sheet.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00204A" } }; cell.alignment = { vertical: "middle", wrapText: true }; });
    const headerRow = header.number;
    ws.views = [{ state: "frozen", ySplit: headerRow }];

    for (const r of sheet.rows) ws.addRow(sheet.columns.map((c) => excelValue(c.kind, r[c.key])));
    const first = headerRow + 1, last = headerRow + sheet.rows.length;
    if (sheet.rows.length && sheet.columns.some((c) => c.total)) {
      const totals = ws.addRow(sheet.columns.map((c, i) => (i === 0 ? "Total" : c.total ? { formula: `SUM(${colLetter(i)}${first}:${colLetter(i)}${last})` } : null)));
      totals.font = { bold: true };
      totals.eachCell((cell) => { cell.border = { top: { style: "thin" } }; });
    }
    sheet.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? (c.kind === "text" ? 28 : c.kind === "date" ? 12 : 15);
      if (NUM_FMT[c.kind]) col.numFmt = NUM_FMT[c.kind]!;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV of one sheet (for importing journal entries elsewhere): plain numbers, dollars not cents. */
export function toCsv(sheet: Sheet): string {
  const plain = (kind: ColKind, v: Cell) => (v == null ? "" : typeof v === "string" ? v
    : kind === "money" ? (v / 100).toFixed(2) : kind === "hours" ? (v / 100).toFixed(2) : kind === "pct" ? (v / 100).toFixed(1) : String(v));
  return "﻿" + Papa.unparse({ fields: sheet.columns.map((c) => c.label), data: sheet.rows.map((r) => sheet.columns.map((c) => plain(c.kind, r[c.key]))) });
}
