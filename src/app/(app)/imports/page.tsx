import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getTenant } from "@/lib/tenant";
import { IMPORT_KINDS, importKind } from "@/lib/imports/kinds";
import { ACCEPT } from "@/lib/imports/parse";
import { Card, PageHeader, Badge, Empty } from "@/components/ui";
import { uploadImport, undoImport } from "@/app/import-actions";

const ERRORS: Record<string, string> = { nofile: "Choose a file to upload.", toolarge: "That file is over 10 MB. Split it and upload each part." };
const GROUPS = ["Projects", "Costs & time", "Billing & accounts"] as const;

export default async function Imports({ searchParams }: { searchParams: Promise<{ done?: string; undone?: string; error?: string; kind?: string }> }) {
  const { company, isAdmin } = await getTenant();
  const sp = await searchParams;
  const batches = await db.select().from(s.importBatches).where(eq(s.importBatches.companyId, company.id)).orderBy(desc(s.importBatches.createdAt)).limit(30);
  const done = sp.done ? batches.find((b) => b.id === sp.done) : undefined;
  const errorText = sp.error ? ERRORS[sp.error] ?? sp.error : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Import data" subtitle="Load projects, budgets, costs, time, billing and accounts from spreadsheets: exports from Sage, Xero or a field time app, or a workbook you keep yourself. Works alongside QuickBooks or on its own." />
      {done && (
        <p className="mb-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Imported {importKind(done.kind)?.label.toLowerCase()} from {done.fileName}: {done.created} added, {done.updated} updated{done.skipped ? `, ${done.skipped} skipped` : ""}.
          {done.toCode ? <> {done.toCode} line(s) need a project or cost code: <Link href="/costs" className="underline">code them</Link>.</> : null}
        </p>
      )}
      {sp.undone && <p className="mb-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Import undone.</p>}
      {errorText && <p className="mb-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">{errorText}</p>}
      {company.sampleDataLoadedAt && <p className="mb-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">This workspace has sample data. <Link href="/settings" className="underline">Remove it</Link> before importing your own.</p>}
      {!isAdmin && <p className="mb-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">Only organization admins can import data.</p>}

      <p className="mb-4 text-sm text-slate-600">
        Suggested order the first time: <strong>Projects</strong> → <strong>Cost codes</strong> → <strong>Budgets</strong> → <strong>Employees</strong> → <strong>Cost transactions</strong> and <strong>Time</strong> → <strong>Invoices</strong>.
        Columns are matched automatically (including Sage, Xero, QuickBooks Time, ClockShark and Procore exports); you confirm before anything is saved.
      </p>

      {GROUPS.map((g) => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{g}</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {IMPORT_KINDS.filter((k) => k.group === g).map((k) => (
              <Card key={k.key} title={k.label} action={<a href={`/api/imports/template/${k.key}`} className="text-xs text-brand-600 hover:underline">Template (CSV)</a>}>
                <div className={`grid gap-3 p-4 text-sm ${sp.kind === k.key && errorText ? "bg-amber-50/40" : ""}`}>
                  <p className="text-slate-700">{k.description}</p>
                  <p className="text-xs text-slate-500">{k.matchNote}{k.undoable ? "" : " Can't be undone."}</p>
                  {isAdmin && (
                    <form action={uploadImport} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="kind" value={k.key} />
                      <input type="file" name="file" accept={ACCEPT} required className="max-w-full text-xs file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs" aria-label={`File for ${k.label}`} />
                      <button className="btn btn-sm">Upload</button>
                    </form>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <Card title="Import history" className="mt-2">
        {batches.length === 0 ? <Empty>Nothing imported from spreadsheets yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead><tr><th>When</th><th>What</th><th>File</th><th className="num">Added</th><th className="num">Updated</th><th className="num">Skipped</th><th className="num">To code</th><th>Status</th><th></th></tr></thead>
              <tbody>{batches.map((b) => (
                <tr key={b.id}>
                  <td className="whitespace-nowrap text-xs">{new Date(b.createdAt).toLocaleString("en-CA")}</td>
                  <td>{importKind(b.kind)?.label ?? b.kind}</td>
                  <td className="text-xs text-slate-600">{b.fileName}{b.sheetName ? ` · ${b.sheetName}` : ""}</td>
                  <td className="num">{b.created}</td><td className="num">{b.updated}</td><td className="num">{b.skipped || "—"}</td><td className="num">{b.toCode || "—"}</td>
                  <td>{b.status === "UNDONE" ? <Badge>Undone</Badge> : <Badge tone="green">Imported</Badge>}</td>
                  <td className="text-right">
                    {isAdmin && b.status === "COMMITTED" && importKind(b.kind)?.undoable && (
                      <form action={undoImport}><input type="hidden" name="id" value={b.id} /><button className="text-xs text-slate-500 underline" title="Removes the rows this import added">Undo</button></form>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
