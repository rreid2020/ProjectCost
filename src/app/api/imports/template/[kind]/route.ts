import Papa from "papaparse";
import { importKind } from "@/lib/imports/kinds";

/** A CSV template for one import kind: field labels as headers, plus example rows. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const kind = importKind((await params).kind);
  if (!kind) return new Response("Unknown template", { status: 404 });
  const csv = Papa.unparse({ fields: kind.fields.map((f) => f.label), data: kind.example.map((ex) => kind.fields.map((f) => ex[f.key] ?? "")) });
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="projectcost-${kind.key}-template.csv"` },
  });
}
