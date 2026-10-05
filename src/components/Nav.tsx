"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/costs", label: "Unassigned costs", badgeKey: "unassigned" },
  { href: "/time", label: "Timesheets", badgeKey: "pendingTime" },
  { href: "/employees", label: "Employees" },
  { href: "/wip", label: "WIP & month-end" },
  { href: "/overhead", label: "Overhead" },
  { href: "/cost-codes", label: "Cost codes" },
  { href: "/accounts", label: "Accounts" },
  { href: "/imports", label: "Import data" },
  { href: "/settings", label: "Settings" },
  { href: "/team", label: "Team" },
  { href: "/billing", label: "Billing" },
];

export function Nav({ counts }: { counts: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {items.map((i) => {
        const active = path.startsWith(i.href);
        const n = i.badgeKey ? counts[i.badgeKey] : 0;
        return (
          <Link key={i.href} href={i.href}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${active ? "bg-white/10 font-medium text-white" : "text-brand-100 hover:bg-white/5 hover:text-white"}`}>
            {i.label}
            {n ? <span className="rounded-full bg-amber-400 px-1.5 text-[0.68rem] font-semibold text-amber-950">{n}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
