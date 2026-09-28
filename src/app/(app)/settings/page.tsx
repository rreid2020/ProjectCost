import { db, schema as s } from "@/db";
import { desc, eq } from "drizzle-orm";
import { getTenant } from "@/lib/tenant";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDate, pct } from "@/lib/format";
import { CompanyFields } from "@/components/CompanyFields";
import { updateCompanySettings } from "@/app/company-actions";
import { removeSampleData } from "@/app/actions";
import { disconnectQbo, testQboConnection } from "@/app/qbo-actions";
import { qboConfigured, qboEnvironment, redirectUri } from "@/lib/qbo";
import { appOrigin } from "@/lib/origin";

const QBO_NOTICES: Record<string, { tone: "good" | "warn"; text: string }> = {
  connected: { tone: "good", text: "QuickBooks is connected." },
  tested: { tone: "good", text: "Connection works: QuickBooks answered." },
  disconnected: { tone: "good", text: "Disconnected. Access was revoked at Intuit; your ProjectCost data is unchanged." },
  cancelled: { tone: "warn", text: "Connection cancelled at Intuit. Nothing was changed." },
  state_mismatch: { tone: "warn", text: "That connection attempt expired or came from another session. Please try again." },
  realm_in_use: { tone: "warn", text: "That QuickBooks company is already connected to another ProjectCost workspace." },
  different_realm: { tone: "warn", text: "This workspace is linked to a different QuickBooks company. Disconnect it first." },
  expired: { tone: "warn", text: "The QuickBooks authorization has expired or was revoked. Disconnect and connect again." },
  test_failed: { tone: "warn", text: "QuickBooks didn't answer. See the sync log below for details." },
  error: { tone: "warn", text: "The connection didn't complete. See the sync log below for details." },
  not_configured: { tone: "warn", text: "Connecting to QuickBooks isn't available yet." },
  admin_only: { tone: "warn", text: "Only organization admins can connect QuickBooks." },
};

export default async function Settings({ searchParams }: { searchParams: Promise<{ qbo?: string }> }) {
  const { company, isAdmin } = await getTenant({ allowInactive: true });
  const logs = await db.select().from(s.syncLogs).where(eq(s.syncLogs.companyId, company.id)).orderBy(desc(s.syncLogs.createdAt)).limit(25);
  const configured = qboConfigured();
  const redirect = redirectUri(await appOrigin());
  const notice = QBO_NOTICES[(await searchParams).qbo ?? ""];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="QuickBooks & settings" />
      <div className="grid gap-5 md:grid-cols-2">
        <Card title="QuickBooks Online connection" action={company.qboRealmId ? <Badge tone="green">Connected</Badge> : <Badge tone="amber">Not connected</Badge>}>
          <div className="grid gap-3 p-4 text-sm">
            {notice && <p className={`rounded-md px-3 py-2 text-xs ${notice.tone === "good" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{notice.text}</p>}
            <dl className="grid grid-cols-2 gap-y-1.5">
              {company.qboRealmId && <><dt className="text-slate-500">QuickBooks company</dt><dd className="font-medium">{company.qboCompanyName ?? "—"}</dd></>}
              <dt className="text-slate-500">Environment</dt><dd className="capitalize">{qboEnvironment()}</dd>
              <dt className="text-slate-500">Company (realm) ID</dt><dd className="font-mono text-xs">{company.qboRealmId ?? "—"}</dd>
              {company.qboConnectedAt && <><dt className="text-slate-500">Connected</dt><dd>{new Date(company.qboConnectedAt).toLocaleString("en-CA")}</dd></>}
            </dl>
            {!configured ? (
              // The Intuit app keys belong to ProjectCost (set once by the operator), never to a tenant.
              // Setup instructions only show in development; customers just see that it isn't available.
              process.env.NODE_ENV === "development" ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span className="font-medium">Developer setup (not shown to customers):</span> set <code>QBO_CLIENT_ID</code>, <code>QBO_CLIENT_SECRET</code> and <code>QBO_TOKEN_KEY</code> in
                  the server environment and add <code>{redirect}</code> as a redirect URI in the ProjectCost Intuit app. Every company then connects its own file with the button that appears here.
                </p>
              ) : (
                <p className="text-xs text-slate-500">Connecting to QuickBooks isn&apos;t available yet. Please contact support.</p>
              )
            ) : !isAdmin ? (
              <p className="text-xs text-slate-500">Only organization admins can connect or disconnect QuickBooks.</p>
            ) : company.qboRealmId ? (
              <div className="flex flex-wrap gap-2">
                <form action={testQboConnection}><button className="btn btn-secondary">Test connection</button></form>
                <form action={disconnectQbo}><button className="btn btn-secondary">Disconnect</button></form>
              </div>
            ) : (
              <>
                {/* Plain <a>: this is a route handler that redirects to Intuit, not a page */}
                <a href="/api/qbo/connect" className="btn justify-center">Connect to QuickBooks</a>
                <p className="text-xs text-slate-500">You&apos;ll sign in to Intuit and pick the QuickBooks company to connect. ProjectCost asks for accounting access only.</p>
              </>
            )}
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
      {isAdmin && company.sampleDataLoadedAt && (
        <Card title="Sample data" className="mt-5" action={<Badge tone="amber">Loaded {fmtDate(company.sampleDataLoadedAt.slice(0, 10))}</Badge>}>
          <form action={removeSampleData} className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_auto] md:items-end">
            <div className="grid gap-2">
              <p className="text-slate-600">
                This workspace has the Northline Mechanical sample data. Remove it before importing from QuickBooks. This deletes <span className="font-medium">all</span> projects,
                change orders, bills, costs, timesheets, WIP snapshots, customers, vendors, employees and cost codes here, including any you added.
                Company settings, your team, billing and the QuickBooks connection stay.
              </p>
              <label className="flex items-center gap-2"><input type="checkbox" name="confirm" required /> I understand this can&apos;t be undone</label>
            </div>
            <button className="btn bg-red-700 hover:bg-red-800">Remove sample data</button>
          </form>
        </Card>
      )}

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
