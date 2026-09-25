import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { db, schema as s } from "@/db";
import { and, eq, isNull, count } from "drizzle-orm";

export const metadata: Metadata = {
  title: "ProjectCost — job costing for QuickBooks Online",
  description: "Budgets, cost codes, progress billing and WIP on top of QuickBooks Online.",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const company = await db.query.companies.findFirst();
  const [un] = company ? await db.select({ n: count() }).from(s.costTransactions).where(and(eq(s.costTransactions.companyId, company.id), isNull(s.costTransactions.projectId))) : [{ n: 0 }];
  const [pt] = await db.select({ n: count() }).from(s.timeEntries).where(eq(s.timeEntries.status, "SUBMITTED"));
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-brand-900 py-5 md:flex">
            <div className="mb-6 px-5">
              <div className="text-lg font-semibold tracking-tight text-white">ProjectCost</div>
              <div className="text-xs text-brand-100/80">Job costing for QuickBooks Online</div>
            </div>
            <Nav counts={{ unassigned: un.n, pendingTime: pt.n }} />
            <div className="mt-auto px-5 text-xs text-brand-100/80">
              <div className="font-medium text-white">{company?.name ?? "No company"}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${company?.qboRealmId ? "bg-emerald-400" : "bg-amber-400"}`} />
                {company?.qboRealmId ? "QuickBooks connected" : "Demo data · QBO not connected"}
              </div>
            </div>
          </aside>
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
