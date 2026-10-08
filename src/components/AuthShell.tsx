// Split-screen frame for the Clerk sign-in and sign-up pages, matching the other Axiom apps (ARO Suite):
// a dark brand panel on the left, the Clerk form on a light panel on the right. Colours follow the landing page.
import type { ReactNode } from "react";

export const authAppearance = {
  variables: {
    colorPrimary: "#0E7C86",
    colorText: "#12202F",
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-[0_10px_30px_rgba(0,32,74,0.12)] border border-[#D9E1EA]",
    formButtonPrimary: "font-semibold",
    footerActionLink: "font-semibold text-[#0E7C86]",
  },
};

function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="2" fill="#0E7C86" />
      <rect x="5" y="13" width="3" height="6" fill="#fff" />
      <rect x="10.5" y="9" width="3" height="10" fill="#fff" />
      <rect x="16" y="5" width="3" height="14" fill="#fff" />
    </svg>
  );
}

const FACTS: [string, string][] = [
  ["Sources", "QuickBooks, Sage, Xero, spreadsheets"],
  ["Output", "Surety-format WIP"],
  ["Month-end", "Draft journal entries"],
  ["Audit trail", "Every number to its source"],
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#F2F4F7]">
      <aside className="hidden w-[58%] flex-col justify-between bg-[#00204A] p-12 text-[#DBE6F2] lg:flex">
        <div className="flex items-center gap-3">
          <Mark className="h-7 w-7" />
          <span className="text-lg font-bold tracking-tight text-white">PROJECTCOST <span className="font-semibold text-[#7FC7CF]">by Axiom</span></span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">Know where every project stands.</h1>
          <p className="mt-5 text-[0.95rem] leading-relaxed">
            Budgets, change orders, progress billing, WIP and month-end entries for contracts, capital projects and builds for sale,
            built from the books you already keep.
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-white/15 pt-5">
            {FACTS.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#7FC7CF]">{k}</dt>
                <dd className="mt-1 text-sm font-semibold text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Mark className="h-6 w-6" />
            <span className="font-bold tracking-tight text-[#00204A]">PROJECTCOST <span className="font-semibold text-[#0E7C86]">by Axiom</span></span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[#12202F]">{title}</h2>
          <p className="mb-6 mt-2 text-sm text-slate-600">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
