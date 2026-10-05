// Reading uploaded spreadsheets into plain rows of text. CSV via papaparse, .xlsx via exceljs (server side).
import Papa from "papaparse";
import ExcelJS from "exceljs";

export type Sheet = { name: string; rows: string[][] };
export const MAX_ROWS = 20_000;
export const ACCEPT = ".csv,.txt,.xlsx,.xlsm";

function decode(buf: Uint8Array) {
  const utf8 = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
  // Excel's "CSV" on Windows is often Windows-1252: fall back when UTF-8 decoding produced replacement characters
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

type CellValue = ExcelJS.CellValue;
function cellText(v: CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("result" in v) return cellText(v.result as CellValue);
    if ("text" in v) return String(v.text).trim();
    if ("error" in v) return "";
  }
  return String(v);
}

const trimRows = (rows: string[][]) => {
  const out = rows.map((r) => r.map((c) => (c ?? "").toString().trim()));
  const width = Math.max(0, ...out.map((r) => r.reduce((w, c, i) => (c ? i + 1 : w), 0)));
  return out.filter((r) => r.some((c) => c)).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
};

export async function parseUpload(data: ArrayBuffer, fileName: string): Promise<Sheet[]> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "xls") throw new Error("Old Excel (.xls) files aren't supported. Save it as .xlsx or CSV and upload that.");
  if (ext === "csv" || ext === "txt") {
    const parsed = Papa.parse<string[]>(decode(new Uint8Array(data)), { skipEmptyLines: "greedy" });
    const rows = trimRows(parsed.data);
    if (rows.length > MAX_ROWS) throw new Error(`That file has ${rows.length.toLocaleString()} rows; the limit is ${MAX_ROWS.toLocaleString()} per upload. Split it and upload each part.`);
    return [{ name: fileName.replace(/\.[^.]+$/, ""), rows }];
  }
  if (ext === "xlsx" || ext === "xlsm") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data);
    const sheets: Sheet[] = [];
    for (const ws of wb.worksheets) {
      if (ws.state && ws.state !== "visible") continue;
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = row.values as CellValue[]; // 1-based
        rows.push(vals.slice(1).map(cellText));
      });
      if (rows.length > MAX_ROWS) throw new Error(`Sheet "${ws.name}" has ${rows.length.toLocaleString()} rows; the limit is ${MAX_ROWS.toLocaleString()}.`);
      const trimmed = trimRows(rows);
      if (trimmed.length) sheets.push({ name: ws.name, rows: trimmed });
    }
    if (!sheets.length) throw new Error("That workbook has no data.");
    return sheets;
  }
  throw new Error("Upload a CSV or Excel (.xlsx) file.");
}
