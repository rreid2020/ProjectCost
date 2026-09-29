"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireWrite } from "@/lib/tenant";
import { GUIDE_STEPS } from "@/lib/guide";

function stepAndPeriod(form: FormData) {
  const step = GUIDE_STEPS.find((d) => d.key === String(form.get("step") ?? ""));
  if (!step) throw new Error("Unknown guide step.");
  const now = new Date();
  const period = step.monthly ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` : "setup";
  return { step, period };
}

/** Marks a guide step done (confirmation) or skipped (not needed). Only optional or monthly steps can be skipped. */
export async function markGuideStep(form: FormData) {
  const t = await requireWrite();
  const { step, period } = stepAndPeriod(form);
  const status = String(form.get("status")) === "SKIPPED" ? "SKIPPED" : "DONE";
  if (status === "SKIPPED" && !step.optional && !step.monthly) throw new Error("This step can't be skipped.");
  if (status === "DONE" && !step.confirmable) throw new Error("This step completes itself when its checklist is done.");
  const row = { companyId: t.company.id, stepKey: step.key, period, status, userId: t.userId, at: new Date().toISOString() };
  await db.insert(s.guideMarks).values(row).onConflictDoUpdate({ target: [s.guideMarks.companyId, s.guideMarks.stepKey, s.guideMarks.period], set: { status, userId: t.userId, at: row.at } });
  revalidatePath("/", "layout");
}

export async function clearGuideStep(form: FormData) {
  const t = await requireWrite();
  const { step, period } = stepAndPeriod(form);
  await db.delete(s.guideMarks).where(and(eq(s.guideMarks.companyId, t.company.id), eq(s.guideMarks.stepKey, step.key), eq(s.guideMarks.period, period)));
  revalidatePath("/", "layout");
}
