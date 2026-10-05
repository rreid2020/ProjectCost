"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, lt } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireAdmin } from "@/lib/tenant";
import { importKind } from "@/lib/imports/kinds";
import { parseUpload, type Sheet } from "@/lib/imports/parse";
import { autoMap, detectHeaderRow, savedMappingFrom, type Mapping } from "@/lib/imports/mapping";
import { commitImport, extractRecords, undoBatch } from "@/lib/imports/engine";
import type { DateOrder } from "@/lib/imports/values";

const MAX_BYTES = 10 * 1024 * 1024;

async function ownUpload(companyId: string, id: string) {
  const u = await db.query.importUploads.findFirst({ where: and(eq(s.importUploads.id, id), eq(s.importUploads.companyId, companyId)) });
  if (!u) throw new Error("That upload has expired. Upload the file again.");
  return u;
}

/** Step 1: parse the file and guess the sheet, header row and columns. */
export async function uploadImport(form: FormData) {
  const t = await requireAdmin();
  const kind = importKind(String(form.get("kind") ?? ""));
  const file = form.get("file");
  if (!kind) throw new Error("Unknown import type.");
  if (!(file instanceof File) || file.size === 0) redirect(`/imports?error=nofile&kind=${kind.key}`);
  if (file.size > MAX_BYTES) redirect(`/imports?error=toolarge&kind=${kind.key}`);
  let sheets: Sheet[];
  try { sheets = await parseUpload(await file.arrayBuffer(), file.name); }
  catch (e) { redirect(`/imports?error=${encodeURIComponent(e instanceof Error ? e.message : "That file couldn't be read.")}&kind=${kind.key}`); }
  // pick the sheet whose headers fit this kind best
  const saved = await db.query.importMappings.findFirst({ where: and(eq(s.importMappings.companyId, t.company.id), eq(s.importMappings.kind, kind.key)) });
  const savedMap = saved ? (JSON.parse(saved.mapping) as Record<string, string>) : undefined;
  const scored = sheets.map((sh, i) => { const h = detectHeaderRow(sh.rows, kind); return { i, h, mapping: autoMap(sh.rows[h] ?? [], kind, savedMap) }; });
  const best = scored.reduce((a, b) => (Object.keys(b.mapping).length > Object.keys(a.mapping).length ? b : a));
  // clean up abandoned uploads (older than a day)
  await db.delete(s.importUploads).where(and(eq(s.importUploads.companyId, t.company.id), lt(s.importUploads.createdAt, new Date(Date.now() - 86_400_000).toISOString())));
  const [u] = await db.insert(s.importUploads).values({
    companyId: t.company.id, userId: t.userId, kind: kind.key, fileName: file.name, sheets: JSON.stringify(sheets),
    sheetIndex: best.i, headerRow: best.h, mapping: JSON.stringify({ ...best.mapping, __order: t.company.region === "US" ? "MDY" : "DMY" }), createdAt: new Date().toISOString(),
  }).returning({ id: s.importUploads.id });
  redirect(`/imports/${u.id}`);
}

/** Step 2: change the sheet, header row, date order or column mapping, then re-preview. */
export async function updateUpload(form: FormData) {
  const t = await requireAdmin();
  const u = await ownUpload(t.company.id, String(form.get("id")));
  const kind = importKind(u.kind)!;
  const sheets = JSON.parse(u.sheets) as Sheet[];
  const sheetIndex = Math.min(Math.max(parseInt(String(form.get("sheetIndex") ?? u.sheetIndex), 10) || 0, 0), sheets.length - 1);
  const sheetChanged = sheetIndex !== u.sheetIndex;
  const rows = sheets[sheetIndex].rows;
  const headerRow = sheetChanged ? detectHeaderRow(rows, kind) : Math.min(Math.max(parseInt(String(form.get("headerRow") ?? u.headerRow), 10) - 1 || 0, 0), Math.max(rows.length - 1, 0));
  let mapping: Mapping;
  if (sheetChanged || headerRow !== u.headerRow) mapping = autoMap(rows[headerRow] ?? [], kind);
  else {
    mapping = {};
    for (const f of kind.fields) { const v = String(form.get(`map_${f.key}`) ?? ""); if (v !== "") mapping[f.key] = parseInt(v, 10); }
  }
  const order: DateOrder = String(form.get("dateOrder")) === "MDY" ? "MDY" : "DMY";
  await db.update(s.importUploads).set({ sheetIndex, headerRow, mapping: JSON.stringify({ ...mapping, __order: order }) }).where(eq(s.importUploads.id, u.id));
  redirect(`/imports/${u.id}`);
}

/** Step 3: import. Rows with problems are skipped only when asked. */
export async function commitUpload(form: FormData) {
  const t = await requireAdmin();
  const u = await ownUpload(t.company.id, String(form.get("id")));
  const kind = importKind(u.kind)!;
  const sheets = JSON.parse(u.sheets) as Sheet[];
  const sheet = sheets[u.sheetIndex];
  const { __order, ...mapping } = JSON.parse(u.mapping ?? "{}") as Mapping & { __order?: DateOrder };
  const records = extractRecords(sheet.rows, u.headerRow, mapping, kind);
  let target: string;
  try {
    const r = await commitImport({
      companyId: t.company.id, userId: t.userId, kind: kind.key, fileName: u.fileName, sheetName: sheets.length > 1 ? sheet.name : null,
      records, order: __order ?? "DMY", skipErrors: form.get("skipErrors") === "on",
    });
    // remember the mapping by header name for next time
    const savedMap = JSON.stringify(savedMappingFrom(mapping, sheet.rows[u.headerRow] ?? []));
    await db.insert(s.importMappings).values({ companyId: t.company.id, kind: kind.key, mapping: savedMap, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: [s.importMappings.companyId, s.importMappings.kind], set: { mapping: savedMap, updatedAt: new Date().toISOString() } });
    await db.delete(s.importUploads).where(eq(s.importUploads.id, u.id));
    revalidatePath("/", "layout");
    target = `/imports?done=${r.batchId}`;
  } catch (e) {
    target = `/imports/${u.id}?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`;
  }
  redirect(target);
}

export async function cancelUpload(form: FormData) {
  const t = await requireAdmin();
  await db.delete(s.importUploads).where(and(eq(s.importUploads.id, String(form.get("id"))), eq(s.importUploads.companyId, t.company.id)));
  redirect("/imports");
}

export async function undoImport(form: FormData) {
  const t = await requireAdmin();
  await undoBatch(t.company.id, String(form.get("id")));
  await db.insert(s.syncLogs).values({ companyId: t.company.id, userId: t.userId, entity: "Spreadsheet", direction: "PULL", status: "OK", message: "Import undone", createdAt: new Date().toISOString() });
  revalidatePath("/", "layout");
  redirect("/imports?undone=1");
}
