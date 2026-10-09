import { getTenant } from "@/lib/tenant";
import { buildReport, isReportKey } from "@/lib/reports";
import { toCsv, toXlsx } from "@/lib/report-model";

/** Downloads a report as Excel (default) or, with ?format=csv, its first sheet as CSV. Same data as the Reports page. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const kind = (await params).kind;
  if (!isReportKey(kind)) return new Response("Unknown report", { status: 404 });
  const { company } = await getTenant();
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const report = await buildReport(kind, company, q);
  const disposition = (ext: string) => `attachment; filename="${report.fileName}.${ext}"`;
  if (q.format === "csv") {
    return new Response(toCsv(report.sheets[0]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition("csv"), "Cache-Control": "no-store" } });
  }
  const body = await toXlsx(report);
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition("xlsx"), "Cache-Control": "no-store" },
  });
}
