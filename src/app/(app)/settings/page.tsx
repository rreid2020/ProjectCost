import { db, schema as s } from "@/db";
import { desc, eq } from "drizzle-orm";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDate, pct } from "@/lib/format";
import { CompanyFields } from "@/components/CompanyFields";
import { updateCompanySettings } from "@/app/company-actions";

export default async function Settings() {
  const { company, isAdmin } = await getTenant({ allowInactive: true });
  const logs = await db.select().from(s.syncLogs).where(eq(s.syncLogs.companyId, company.id)).orderBy(desc(s.syncLogs.createdAt)).limit(25);
  const hasKeys = Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
  const env = process.env.QBO_ENVIRONMENT ?? "sandbox";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="QuickBooks & settings" />
      <div className="grid gap-5 md:grid-cols-2">
        <Card title="QuickBooks Online connection" action={company.qboRealmId ? <Badge tone="green">Connected</Badge> : <Badge tone="amber">Not connected</Badge>}>
          <div className="grid gap-3 p-4 text-sm">
            <dl className="grid grid-cols-2 gap-y-1.5">
              <dt className="text-slate-500">Intuit app keys</dt><dd>{hasKeys ? <Badge tone="green">Configured</Badge> : <Badge tone="amber">Missing</Badge>}</dd>
              <dt className="text-slate-500">Environment</dt><dd className="capitalize">{env}</dd>
              <dt className="text-slate-500">Company (realm) ID</dt><dd className="font-mono text-xs">{company.qboRealmId ?? "—"}</dd>
            </dl>
            <button className="btn justify-center opacity-60" disabled title="Arrives in milestone 2">Connect to QuickBooks — milestone 2</button>
            <p className="text-xs text-slate-500">
              Milestone 2 adds the OAuth connection, the first 24-month import, webhooks and write-back. Each company connects its own QuickBooks file.
            </p>
          </div>
        </Card>
        <Card title="Company">
          {isAdmin ? (
            <form action={updateCompanySettings} className="grid gap-3 p-4 text-sm">
              <CompanyFields company={company} />
              <p className="text-xs text-slate-500">Books closed through {fmtDate(company.closedThrough)}. Holdback and tax apply to new projects.</p>
              <button className="btn justify-center">Save</button>
            </form>
          ) : (
            <dl className="grid grid-cols-2 gap-y-1.5 p-4 text-sm">
              <dt className="text-slate-500">Name</dt><dd>{company.name}</dd>
              <dt className="text-slate-500">Region</dt><dd>{company.region === "CA" ? "Canada" : "United States"}{company.province ? ` · ${company.province}` : ""}</dd>
              <dt className="text-slate-500">Fiscal year end</dt><dd>Month {company.fiscalYearEndMonth}</dd>
              <dt className="text-slate-500">Books closed through</dt><dd>{fmtDate(company.closedThrough)}</dd>
              <dt className="text-slate-500">Default holdback</dt><dd>{pct(company.defaultHoldbackBp, 0)}</dd>
              <dt className="text-slate-500">Default sales tax</dt><dd>{pct(company.defaultTaxBp, 0)}</dd>
            </dl>
          )}
        </Card>
      </div>
      <Card title="Sync log" className="mt-5">
        {logs.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">Nothing synced yet.</p> : (
          <table className="grid-table">
            <thead><tr><th>When</th><th>Entity</th><th>Direction</th><th>Status</th><th>Message</th></tr></thead>
            <tbody>{logs.map((l) => (
              <tr key={l.id}><td className="whitespace-nowrap text-xs">{new Date(l.createdAt).toLocaleString("en-CA")}</td><td>{l.entity}</td><td className="text-xs">{l.direction}</td>
                <td><Badge tone={l.status === "OK" ? "green" : l.status === "ERROR" ? "red" : "amber"}>{l.status}</Badge></td><td className="text-slate-600">{l.message}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
