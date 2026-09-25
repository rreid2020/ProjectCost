import Link from "next/link";
import { money, pct } from "@/lib/format";

export function Card({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[0.7rem] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
};
export function Badge({ tone = "slate", children }: { tone?: keyof typeof badgeTones; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[0.7rem] font-medium ring-1 ring-inset ${badgeTones[tone]}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ({ APPROVED: "green", POSTED: "green", ACTIVE: "blue", PENDING: "amber", SUBMITTED: "amber", DRAFT: "slate", REJECTED: "red", COMPLETE: "slate", BID: "slate" } as const)[status] ?? "slate";
  return <Badge tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

export function Progress({ valueBp, warnAbove = 10000 }: { valueBp: number; warnAbove?: number }) {
  const w = Math.min(100, Math.max(0, valueBp / 100));
  const over = valueBp > warnAbove;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${over ? "bg-red-500" : "bg-brand-500"}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`tabular-nums text-xs ${over ? "text-red-700" : "text-slate-600"}`}>{pct(valueBp, 0)}</span>
    </div>
  );
}

/** Money cell: negative shown in parentheses; `signTone` colours +/−. */
export function M({ v, signTone, cents }: { v: number; signTone?: "profit" | "variance"; cents?: boolean }) {
  const cls = signTone && v < 0 ? "text-red-700" : "";
  return <span className={cls}>{money(v, { cents })}</span>;
}

export function PageHeader({ title, subtitle, back, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; back?: { href: string; label: string }; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && <Link href={back.href} className="text-xs text-brand-600 hover:underline">← {back.label}</Link>}
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function ProjectCell({ id, number, name }: { id: string; number: string; name: string }) {
  return (
    <div className="min-w-[11rem] max-w-[15rem]">
      <Link href={`/projects/${id}`} className="font-medium text-slate-800 hover:underline">{number}</Link>
      <div className="truncate text-xs text-slate-500" title={name}>{name}</div>
    </div>
  );
}
