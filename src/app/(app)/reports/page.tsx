import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { REPORTS, buildReport, isReportKey, normalizeParams, reportOptions, type ReportKey, type ReportParams } from "@/lib/reports";
import { formatCell, totalOf, type Sheet } from "@/lib/report-model";
import { Card, PageHeader, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const SHOWN = 500; // rows per sheet on screen; the download has everything

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { company } = await getTenant();
  const sp = await searchParams;
  const kind: ReportKey = isReportKey(sp.r ?? "") ? (sp.r as ReportKey) : "wip";
  const params = normalizeParams(kind, sp as ReportParams);
  const [report, options] = await Promise.all([buildReport(kind, company, params), reportOptions(company.id)]);
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  const download = `/api/reports/${kind}${query ? `?${query}` : ""}`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Reports" subtitle="View any report here, or download it as Excel for your surety, bank, auditor or accountant." />

      <nav className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {REPORTS.map((r) => (
          <Link key={r.key} href={`/reports?r=${r.key}`}
            className={`rounded-lg border p-3 text-sm ${r.key === kind ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
            <span className="font-semibold text-slate-900">{r.label}</span>
            <span className="mt-1 block text-xs text-slate-500">{r.blurb}</span>
          </Link>
        ))}
      </nav>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-4">
          <form className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="r" value={kind} />
            {kind === "wip" && (
              <Field label="Period">
                <select name="period" defaultValue={params.period} className="input">
                  <option value="current">Current (live)</option>
                  {options.periods.map((p) => <option key={p} value={p}>Saved: {fmtDate(p)}</option>)}
                </select>
              </Field>
            )}
            {kind === "journal" && <Field label="Month"><input type="month" name="month" defaultValue={params.month} className="input" /></Field>}
            {kind === "detail" && <>
              <Field label="From"><input type="date" name="from" defaultValue={params.from} className="input" /></Field>
              <Field label="To"><input type="date" name="to" defaultValue={params.to} className="input" /></Field>
            </>}
            {(kind === "jobcost" || kind === "detail") && (
              <Field label="Project">
                <select name="project" defaultValue={params.project} className="input max-w-64">
                  <option value="">{kind === "detail" ? "All, including unassigned" : "All"}</option>
                  {options.projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}{p.status !== "ACTIVE" ? ` (${p.status.toLowerCase()})` : ""}</option>)}
                </select>
              </Field>
            )}
            {kind === "jobcost" && (
              <Field label="Projects">
                <select name="status" defaultValue={params.status} className="input">
                  <option value="active">Active</option><option value="all">All, including complete</option>
                </select>
              </Field>
            )}
            {kind !== "wip" || options.periods.length ? <button className="btn btn-secondary">Show</button> : null}
          </form>
          <div className="flex gap-2">
            <a href={download} className="btn">Download Excel</a>
            {kind === "journal" && <a href={`${download}${query ? "&" : "?"}format=csv`} className="btn btn-secondary">CSV</a>}
          </div>
        </div>
        <div className="px-4 pt-3">
          <h2 className="font-semibold text-slate-900">{report.title}</h2>
          <p className="text-xs text-slate-500">{report.subtitle}</p>
        </div>
        {report.sheets.map((sheet) => <SheetTable key={sheet.name} sheet={sheet} titled={report.sheets.length > 1} />)}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-xs text-slate-500">{label}{children}</label>;
}

function SheetTable({ sheet, titled }: { sheet: Sheet; titled: boolean }) {
  const right = (k: string) => k !== "text" && k !== "date";
  const shown = sheet.rows.slice(0, SHOWN);
  const hasTotals = sheet.columns.some((c) => c.total);
  return (
    <section className="mt-3">
      {titled && <h3 className="px-4 pb-1 text-sm font-semibold text-slate-800">{sheet.name} <span className="font-normal text-slate-500">· {sheet.rows.length} rows</span></h3>}
      {sheet.note && <p className="mx-4 mb-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{sheet.note}</p>}
      {sheet.rows.length === 0 ? <Empty>{sheet.emptyText ?? "Nothing to show."}</Empty> : (
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead><tr>{sheet.columns.map((c) => <th key={c.key} className={right(c.kind) ? "num" : ""}>{c.label}</th>)}</tr></thead>
            <tbody>{shown.map((r, i) => (
              <tr key={i}>{sheet.columns.map((c) => {
                const v = r[c.key];
                return <td key={c.key} className={right(c.kind) ? `num${typeof v === "number" && v < 0 ? " text-red-700" : ""}` : c.kind === "date" ? "whitespace-nowrap text-xs" : ""}>{formatCell(c.kind, v)}</td>;
              })}</tr>
            ))}</tbody>
            {hasTotals && (
              <tfoot><tr>{sheet.columns.map((c, i) => (
                <td key={c.key} className={right(c.kind) ? "num" : ""}>{i === 0 ? "Total" : c.total ? formatCell(c.kind, totalOf(sheet, c.key)) : ""}</td>
              ))}</tr></tfoot>
            )}
          </table>
        </div>
      )}
      {sheet.rows.length > SHOWN && <p className="px-4 py-2 text-xs text-slate-500">Showing the first {SHOWN} of {sheet.rows.length} rows. The Excel download has them all.</p>}
    </section>
  );
}
