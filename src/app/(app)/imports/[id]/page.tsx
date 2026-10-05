import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getTenant } from "@/lib/tenant";
import { importKind } from "@/lib/imports/kinds";
import type { Sheet } from "@/lib/imports/parse";
import { mappingProblems, monthColumns, type Mapping } from "@/lib/imports/mapping";
import { analyze, extractRecords } from "@/lib/imports/engine";
import type { DateOrder } from "@/lib/imports/values";
import { Card, PageHeader, Badge } from "@/components/ui";
import { money } from "@/lib/format";
import { updateUpload, commitUpload, cancelUpload } from "@/app/import-actions";

const col = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
const PREVIEW_ROWS = 50;

function show(v: unknown, type: string) {
  if (v == null || v === "") return <span className="text-slate-300">—</span>;
  if (type === "money" && typeof v === "number") return money(v, { cents: true });
  if (type === "percent" && typeof v === "number") return `${(v / 100).toFixed(1)}%`;
  if (type === "hours" && typeof v === "number") return (v / 100).toFixed(2);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (type === "projectType") return ({ CONTRACT: "Contract", CAPITAL: "Capital", INVENTORY: "Build for sale" } as Record<string, string>)[String(v)] ?? String(v);
  return String(v);
}

export default async function ImportMapping({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { company, isAdmin } = await getTenant();
  const { id } = await params;
  const { error } = await searchParams;
  const u = await db.query.importUploads.findFirst({ where: and(eq(s.importUploads.id, id), eq(s.importUploads.companyId, company.id)) });
  if (!u || !isAdmin) notFound();
  const kind = importKind(u.kind)!;
  const sheets = JSON.parse(u.sheets) as Sheet[];
  const sheet = sheets[u.sheetIndex];
  const { __order, ...mapping } = JSON.parse(u.mapping ?? "{}") as Mapping & { __order?: DateOrder };
  const order: DateOrder = __order ?? "DMY";
  const headers = sheet.rows[u.headerRow] ?? [];
  const sample = sheet.rows[u.headerRow + 1] ?? [];
  const problems = mappingProblems(kind, mapping, headers);
  const wide = kind.key === "pnl" && (mapping.month == null || mapping.amount == null) ? monthColumns(headers, mapping) : [];
  const analysis = problems.length ? null : await analyze(db, company.id, kind.key, extractRecords(sheet.rows, u.headerRow, mapping, kind), order);
  const shownFields = kind.fields.filter((f) => mapping[f.key] != null || (wide.length && (f.key === "month" || f.key === "amount")));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader back={{ href: "/imports", label: "Import data" }} title={`Import ${kind.label.toLowerCase()}`} subtitle={`${u.fileName}${sheets.length > 1 ? ` · sheet "${sheet.name}"` : ""} · ${sheet.rows.length - u.headerRow - 1} data rows`} />
      {error && <p className="mb-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>}

      <form action={updateUpload} className="grid gap-5">
        <input type="hidden" name="id" value={u.id} />
        <Card title="1. Where the data is">
          <div className="flex flex-wrap items-end gap-4 p-4 text-sm">
            {sheets.length > 1 && (
              <label className="grid gap-1"><span className="text-xs text-slate-600">Sheet</span>
                <select name="sheetIndex" defaultValue={u.sheetIndex} className="input">{sheets.map((sh, i) => <option key={sh.name} value={i}>{sh.name}</option>)}</select></label>
            )}
            <label className="grid gap-1"><span className="text-xs text-slate-600">Column names are on row</span>
              <input name="headerRow" inputMode="numeric" defaultValue={u.headerRow + 1} className="input w-20 text-right" /></label>
            <label className="grid gap-1"><span className="text-xs text-slate-600">Dates like 03/04/2026 mean</span>
              <select name="dateOrder" defaultValue={order} className="input"><option value="DMY">3 April (day/month)</option><option value="MDY">March 4 (month/day)</option></select></label>
            <button className="btn btn-secondary">Apply</button>
          </div>
        </Card>

        <Card title="2. Match columns" action={<span className="text-xs text-slate-500">Matched automatically; change any that are wrong</span>}>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead><tr><th>Field</th><th>Column in your file</th><th>First row says</th><th>Notes</th></tr></thead>
              <tbody>{kind.fields.map((f) => (
                <tr key={f.key}>
                  <td className="whitespace-nowrap">{f.label}{f.required && <span className="text-red-600"> *</span>}</td>
                  <td>
                    <select name={`map_${f.key}`} defaultValue={mapping[f.key] ?? ""} className={`input w-64 ${f.required && mapping[f.key] == null ? "border-amber-400 bg-amber-50" : ""}`}>
                      <option value="">— not in this file —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{col(i)}: {h || "(no name)"}</option>)}
                    </select>
                  </td>
                  <td className="max-w-[16rem] truncate text-xs text-slate-600">{mapping[f.key] != null ? sample[mapping[f.key]] || "—" : ""}</td>
                  <td className="text-xs text-slate-500">{f.help ?? ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {wide.length > 0 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">One column per month found: {wide.map((w) => headers[w.index]).join(", ")}.</p>}
          <div className="border-t border-slate-100 px-4 py-3"><button className="btn btn-secondary">Update preview</button></div>
        </Card>
      </form>

      <Card title="3. Check and import" className="mt-5">
        {problems.length > 0 ? (
          <ul className="grid gap-1 p-4 text-sm text-amber-900">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : analysis && (
          <>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <Badge tone="green">{analysis.valid} ready</Badge>
              {analysis.invalid > 0 && <Badge tone="red">{analysis.invalid} with problems</Badge>}
              <span className="text-xs text-slate-500">{analysis.rows.length > PREVIEW_ROWS ? `Showing the first ${PREVIEW_ROWS} rows, problems first.` : ""}</span>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="grid-table">
                <thead><tr><th>Row</th>{shownFields.map((f) => <th key={f.key} className={f.type === "money" || f.type === "hours" ? "num" : ""}>{f.label}</th>)}<th>Result</th></tr></thead>
                <tbody>{[...analysis.rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0)).slice(0, PREVIEW_ROWS).map((r, i) => (
                  <tr key={`${r.row}-${i}`} className={r.errors.length ? "bg-red-50/50" : ""}>
                    <td className="text-xs text-slate-500">{r.row}</td>
                    {shownFields.map((f) => <td key={f.key} className={`text-xs ${f.type === "money" || f.type === "hours" ? "num" : ""}`}>{show(r.data[f.key], f.type)}</td>)}
                    <td className="text-xs">
                      {r.errors.length ? <span className="text-red-700">{r.errors.join("; ")}</span> : r.notes.length ? <span className="text-slate-600">{r.notes.join("; ")}</span> : <span className="text-emerald-700">OK</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <form action={commitUpload} className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm">
              <input type="hidden" name="id" value={u.id} />
              {analysis.invalid > 0 && <label className="flex items-center gap-2"><input type="checkbox" name="skipErrors" /> Skip the {analysis.invalid} row(s) with problems</label>}
              <button className="btn" disabled={!analysis.valid}>Import {analysis.valid} row{analysis.valid === 1 ? "" : "s"}</button>
              <span className="text-xs text-slate-500">All or nothing: if anything fails, nothing is saved.{kind.undoable ? " You can undo it afterwards." : ""}</span>
            </form>
          </>
        )}
        <form action={cancelUpload} className="px-4 pb-3"><input type="hidden" name="id" value={u.id} /><button className="text-xs text-slate-500 underline">Cancel and discard this upload</button></form>
      </Card>
      <p className="mt-3 text-xs text-slate-500"><Link href={`/api/imports/template/${kind.key}`} className="underline">Download the {kind.label.toLowerCase()} template</Link> to see the expected columns.</p>
    </div>
  );
}
