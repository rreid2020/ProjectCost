/**
 * Seeds a fictional Ontario mechanical subcontractor with five projects in different states.
 * Run: npm run seed   (drops and recreates the local SQLite database)
 */
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import * as s from "../src/db/schema";

const file = "./data/projectcost.db";
mkdirSync("./data", { recursive: true });
for (const f of [file, file + "-journal", file + "-wal", file + "-shm"]) if (existsSync(f)) rmSync(f);
const db = drizzle(createClient({ url: "file:" + file }), { schema: s });

// deterministic PRNG so demo numbers are stable
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const now = new Date().toISOString();

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });

  const [co] = await db.insert(s.companies).values({
    name: "Northline Mechanical Ltd.", region: "CA", province: "ON", fiscalYearEndMonth: 12,
    closedThrough: "2026-08-31", defaultHoldbackBp: 1000, defaultTaxBp: 1300,
  }).returning();

  const codeDefs: [string, string, string][] = [
    ["01-100", "Project management & supervision", "LABOUR"],
    ["01-500", "Temporary facilities & site setup", "OTHER"],
    ["01-900", "Permits, fees & bonds", "OTHER"],
    ["22-100", "Plumbing labour", "LABOUR"],
    ["22-200", "Plumbing materials & fixtures", "MATERIAL"],
    ["23-100", "HVAC labour", "LABOUR"],
    ["23-200", "HVAC equipment (RTUs, AHUs, boilers)", "MATERIAL"],
    ["23-300", "Sheet metal & ductwork (sub)", "SUB"],
    ["23-400", "Controls & BAS (sub)", "SUB"],
    ["23-500", "Insulation (sub)", "SUB"],
    ["23-800", "Equipment rental (lifts, cranes)", "EQUIPMENT"],
    ["23-900", "Testing, balancing & commissioning", "SUB"],
  ];
  const codes = await db.insert(s.costCodes).values(codeDefs.map(([code, name, costType]) => ({ companyId: co.id, code, name, costType }))).returning();
  const C = Object.fromEntries(codes.map((c) => [c.code, c]));

  const custs = await db.insert(s.customers).values(
    ["Beacon Construction Group", "Stonebridge Builders Inc.", "Harbourline Developments", "Crestview General Contractors"].map((name) => ({ companyId: co.id, name })),
  ).returning();

  const vendorNames: Record<string, string[]> = {
    MATERIAL: ["Wolseley Canada", "Emco Supply", "Noble Trade", "Engineered Air", "Trane Canada"],
    SUB: ["Precision Sheet Metal Ltd.", "Summit Controls Inc.", "ThermaWrap Insulation", "Accu-Air Balancing"],
    EQUIPMENT: ["Sunbelt Rentals", "United Rentals", "Herc Rentals"],
    OTHER: ["City of Toronto — Building", "Aviva Surety", "Modu-Loc Fence Rentals", "Home Depot Pro"],
  };
  const vendors = await db.insert(s.vendors).values(Object.values(vendorNames).flat().map((name) => ({ companyId: co.id, name }))).returning();
  const V = Object.fromEntries(vendors.map((v) => [v.name, v]));

  const emps = await db.insert(s.employees).values([
    { name: "Dana Kowalski", trade: "Project manager", payRateCents: 5800, burdenBp: 2400, billRateCents: 12500 },
    { name: "Marco Silva", trade: "Foreman — plumbing", payRateCents: 4850, burdenBp: 3050, billRateCents: 11000 },
    { name: "Priya Nair", trade: "Journeyperson plumber", payRateCents: 4400, burdenBp: 3050, billRateCents: 9800 },
    { name: "Liam O'Connor", trade: "Foreman — HVAC", payRateCents: 4950, burdenBp: 3050, billRateCents: 11200 },
    { name: "Aiden Tremblay", trade: "Refrigeration mechanic", payRateCents: 4600, burdenBp: 3050, billRateCents: 10200 },
    { name: "Sofia Haddad", trade: "Apprentice (3rd year)", payRateCents: 2900, burdenBp: 3050, billRateCents: 7200 },
  ].map((e) => ({ ...e, companyId: co.id }))).returning();
  const labourCrew: Record<string, typeof emps> = {
    "01-100": [emps[0]],
    "22-100": [emps[1], emps[2], emps[5]],
    "23-100": [emps[3], emps[4], emps[5]],
  };

  // --- projects: budget mix (share of cost budget) and target progress per code
  type P = { number: string; name: string; cust: number; contract: number; margin: number; start: string; end: string; pm: string;
    progress: number; billedRatio: number; overrun?: Record<string, number>; cos?: { title: string; rev: number; lines: [string, number][]; status: string; date: string }[]; status?: string };
  const mix: Record<string, number> = {
    "01-100": 0.05, "01-500": 0.02, "01-900": 0.015, "22-100": 0.13, "22-200": 0.12, "23-100": 0.16,
    "23-200": 0.22, "23-300": 0.14, "23-400": 0.07, "23-500": 0.03, "23-800": 0.02, "23-900": 0.015,
  };
  const P: P[] = [
    { number: "P-2401", name: "Riverside Medical Office Building", cust: 0, contract: 2_450_000, margin: 0.18, start: "2026-01-12", end: "2026-12-18", pm: "Dana Kowalski", progress: 0.66, billedRatio: 1.04,
      cos: [{ title: "Add exam-room sinks (level 3)", rev: 48_500, lines: [["22-100", 14_000], ["22-200", 22_500]], status: "APPROVED", date: "2026-05-14" },
            { title: "Upsize RTU-2 to 25 ton", rev: 36_000, lines: [["23-200", 27_000], ["23-800", 2_500]], status: "APPROVED", date: "2026-07-02" },
            { title: "Medical gas outlets relocation", rev: 18_200, lines: [["22-100", 6_500], ["22-200", 7_000]], status: "PENDING", date: "2026-09-10" }] },
    { number: "P-2403", name: "Maple Ridge Secondary School HVAC Retrofit", cust: 1, contract: 1_180_000, margin: 0.16, start: "2026-03-02", end: "2026-11-27", pm: "Dana Kowalski", progress: 0.48, billedRatio: 0.97,
      overrun: { "23-300": 1.32, "23-100": 1.12 },
      cos: [{ title: "Asbestos abatement delay — standby", rev: 22_000, lines: [["23-100", 15_000]], status: "PENDING", date: "2026-08-20" }] },
    { number: "P-2405", name: "Harbourfront Condominiums — Phase 2", cust: 2, contract: 4_200_000, margin: 0.17, start: "2026-05-04", end: "2027-09-30", pm: "Dana Kowalski", progress: 0.21, billedRatio: 0.72,
      cos: [{ title: "Amenity floor fan-coil changes", rev: 64_000, lines: [["23-100", 18_000], ["23-200", 29_000]], status: "APPROVED", date: "2026-08-05" }] },
    { number: "P-2406", name: "Kingston Distribution Centre", cust: 3, contract: 860_000, margin: 0.12, start: "2026-02-09", end: "2026-10-16", pm: "Dana Kowalski", progress: 0.84, billedRatio: 1.0,
      overrun: { "23-200": 1.28, "23-100": 1.35, "23-800": 1.9, "22-100": 1.2 } },
    { number: "P-2408", name: "Lakeshore Public Library Renovation", cust: 0, contract: 395_000, margin: 0.21, start: "2026-08-17", end: "2027-02-26", pm: "Dana Kowalski", progress: 0.09, billedRatio: 0.9 },
    { number: "P-2311", name: "Eastgate Retail Plaza", cust: 3, contract: 640_000, margin: 0.15, start: "2025-06-02", end: "2026-02-27", pm: "Dana Kowalski", progress: 1, billedRatio: 1, status: "COMPLETE" },
  ];

  const asOf = "2026-09-25";
  for (const p of P) {
    const [proj] = await db.insert(s.projects).values({
      companyId: co.id, customerId: custs[p.cust].id, number: p.number, name: p.name, status: p.status ?? "ACTIVE",
      contractType: "FIXED", originalContractCents: p.contract * 100, holdbackBp: 1000, taxBp: 1300,
      projectManager: p.pm, startDate: p.start, endDate: p.end,
    }).returning();

    const costBudget = p.contract * (1 - p.margin);
    const budgetByCode: Record<string, number> = {};
    for (const [code, share] of Object.entries(mix)) budgetByCode[code] = Math.round((costBudget * share) / 100) * 100;
    await db.insert(s.budgetLines).values(Object.entries(budgetByCode).map(([code, amt]) => ({ projectId: proj.id, costCodeId: C[code].id, originalCents: amt * 100 })));

    // change orders
    let coNo = 1; const coBudget: Record<string, number> = {}; let coRev = 0;
    for (const c of p.cos ?? []) {
      const [row] = await db.insert(s.changeOrders).values({ projectId: proj.id, number: coNo++, title: c.title, status: c.status, contractAmountCents: c.rev * 100, dateIssued: c.date, dateApproved: c.status === "APPROVED" ? addDays(c.date, 9) : null }).returning();
      await db.insert(s.changeOrderLines).values(c.lines.map(([code, amt]) => ({ changeOrderId: row.id, costCodeId: C[code].id, costCents: amt * 100 })));
      if (c.status === "APPROVED") { coRev += c.rev; for (const [code, amt] of c.lines) coBudget[code] = (coBudget[code] ?? 0) + amt; }
    }

    // actual costs: spread through time between start and asOf (or end)
    const endActual = p.status === "COMPLETE" ? p.end : asOf;
    const spanDays = Math.max(20, Math.round((+new Date(endActual) - +new Date(p.start)) / 86400000));
    const frontLoad: Record<string, number> = { "01-500": 0.5, "01-900": 0.2, "23-900": 3 };
    for (const [code, base] of Object.entries(budgetByCode)) {
      const revised = base + (coBudget[code] ?? 0);
      const codeProgress = Math.min(1, p.progress ** (frontLoad[code] ?? 1)) * (p.overrun?.[code] ?? 1);
      const target = Math.round(revised * codeProgress * (0.95 + rnd() * 0.1));
      if (target <= 0) continue;
      const def = codes.find((c) => c.code === code)!;
      if (def.costType === "LABOUR") {
        const crew = labourCrew[code];
        let spent = 0; let d = p.start;
        while (spent < target && d <= endActual) {
          for (const e of crew) {
            if (spent >= target) break;
            const hrs = code === "01-100" ? pick([4, 6, 8]) : pick([7.5, 8, 8, 9, 10]);
            const cost = hrs * (e.payRateCents / 100) * (1 + e.burdenBp / 10000);
            spent += cost;
            await db.insert(s.timeEntries).values({
              employeeId: e.id, projectId: proj.id, costCodeId: C[code].id, date: d, hoursX100: Math.round(hrs * 100),
              payRateCents: e.payRateCents, burdenBp: e.burdenBp, billRateCents: e.billRateCents,
              status: d > "2026-09-18" ? "SUBMITTED" : "APPROVED",
            });
          }
          // step so entries spread across the span
          const step = Math.max(1, Math.floor(spanDays / Math.max(1, target / (crew.length * 450))));
          d = addDays(d, step);
          const wd = new Date(d + "T12:00:00Z").getUTCDay(); if (wd === 0) d = addDays(d, 1); if (wd === 6) d = addDays(d, 2);
        }
      } else {
        const n = Math.max(1, Math.min(14, Math.round(target / 18000)));
        const vlist = vendorNames[def.costType];
        let remaining = target;
        for (let i = 0; i < n; i++) {
          const amt = i === n - 1 ? remaining : Math.round((target / n) * (0.7 + rnd() * 0.6));
          remaining -= amt;
          const date = addDays(p.start, Math.round(((i + 0.5) / n) * spanDays * (0.85 + rnd() * 0.1)));
          const vendor = code === "23-300" ? "Precision Sheet Metal Ltd." : code === "23-400" ? "Summit Controls Inc." : code === "23-500" ? "ThermaWrap Insulation" : code === "23-900" ? "Accu-Air Balancing" : pick(vlist);
          await db.insert(s.costTransactions).values({
            companyId: co.id, projectId: proj.id, costCodeId: C[code].id, vendorId: V[vendor].id, date: date > endActual ? endActual : date,
            source: def.costType === "SUB" || def.costType === "MATERIAL" ? "BILL" : pick(["BILL", "EXPENSE", "CHECK"]),
            docNumber: `${vendor.slice(0, 3).toUpperCase()}-${10000 + Math.floor(rnd() * 89999)}`,
            description: `${def.name}${def.costType === "SUB" ? ` — progress claim ${i + 1}` : ""}`,
            amountCents: amt * 100, taxCents: Math.round(amt * 13), qboTxnId: String(1000 + Math.floor(rnd() * 9000)), assignedAt: date,
          });
        }
      }
    }

    // schedule of values: split contract across lines, plus approved COs as their own lines
    const sovDefs: [string, number][] = [
      ["Mobilization, bonds & permits", 0.04], ["Plumbing rough-in", 0.16], ["Plumbing finish & fixtures", 0.12],
      ["HVAC equipment supply", 0.24], ["Ductwork & insulation", 0.18], ["HVAC piping & installation", 0.14],
      ["Controls & BAS", 0.07], ["Testing, balancing, commissioning & closeout", 0.05],
    ];
    let lineNo = 1; let alloc = 0;
    const sov = [] as (typeof s.sovLines.$inferSelect)[];
    for (const [i, [desc, share]] of sovDefs.entries()) {
      const val = i === sovDefs.length - 1 ? p.contract - alloc : Math.round(p.contract * share);
      alloc += val;
      const [row] = await db.insert(s.sovLines).values({ projectId: proj.id, lineNo: lineNo++, description: desc, scheduledValueCents: val * 100 }).returning();
      sov.push(row);
    }
    let coNum = 1;
    for (const c of p.cos ?? []) {
      if (c.status === "APPROVED") {
        const [row] = await db.insert(s.sovLines).values({ projectId: proj.id, lineNo: lineNo++, description: `CO #${coNum}: ${c.title}`, scheduledValueCents: c.rev * 100, changeOrderNumber: coNum }).returning();
        sov.push(row);
      }
      coNum++;
    }

    // progress bills: monthly, billing to target % by line (front lines earlier)
    const totalContract = p.contract + coRev;
    const targetBilled = Math.min(totalContract, Math.round(totalContract * p.progress * p.billedRatio));
    const months: string[] = [];
    const lastBill = p.status === "COMPLETE" ? p.end : "2026-08-31";
    for (let m = new Date(p.start + "T12:00:00Z"); ; ) {
      const eom = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
      if (iso(eom) > lastBill) break;
      months.push(iso(eom)); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    }
    if (p.status === "COMPLETE") months.push(p.end);
    // final billed amount per SOV line: earlier lines further along, scaled so the total hits targetBilled
    const weights = sov.map((l) => {
      const idx = l.lineNo / sov.length;
      return l.scheduledValueCents * Math.max(0.05, 1.35 - idx * 0.6);
    });
    const finalByLine: Record<string, number> = {};
    let remainingTarget = targetBilled * 100;
    let open = sov.map((l, i) => ({ l, w: weights[i] }));
    for (let iter = 0; iter < 6 && open.length; iter++) {
      const wsum = open.reduce((a, o) => a + o.w, 0);
      const next: typeof open = [];
      let used = 0;
      for (const o of open) {
        const amt = Math.round((remainingTarget * o.w) / wsum);
        if (amt >= o.l.scheduledValueCents) { finalByLine[o.l.id] = o.l.scheduledValueCents; used += o.l.scheduledValueCents; }
        else { finalByLine[o.l.id] = amt; next.push(o); }
      }
      if (next.length === open.length) break;
      remainingTarget = targetBilled * 100 - Object.entries(finalByLine).filter(([id]) => !next.some((o) => o.l.id === id)).reduce((a, [, v]) => a + v, 0);
      open = next;
      void used;
    }
    const prev: Record<string, number> = {};
    let billNo = 1;
    for (const [mi, pe] of months.entries()) {
      const frac = (mi + 1) / months.length;
      const lines = sov.map((l) => {
        const want = mi === months.length - 1 ? finalByLine[l.id] ?? 0 : Math.round((finalByLine[l.id] ?? 0) * frac);
        const thisP = Math.max(0, want - (prev[l.id] ?? 0));
        return { sovLineId: l.id, thisPeriodCents: thisP };
      }).filter((l) => l.thisPeriodCents > 0);
      if (!lines.length) continue;
      const [bill] = await db.insert(s.progressBills).values({ projectId: proj.id, number: billNo, periodEnd: pe, status: "POSTED", qboInvoiceId: `INV-${p.number.slice(2)}-${billNo}` }).returning();
      billNo++;
      await db.insert(s.progressBillLines).values(lines.map((l) => ({ ...l, progressBillId: bill.id })));
      for (const l of lines) prev[l.sovLineId] = (prev[l.sovLineId] ?? 0) + l.thisPeriodCents;
    }

    // PM forecasts where the job is in trouble
    if (p.number === "P-2406") {
      await db.insert(s.forecasts).values([
        { projectId: proj.id, costCodeId: C["23-100"].id, etcCents: 62_000_00, updatedAt: now },
        { projectId: proj.id, costCodeId: C["23-200"].id, etcCents: 21_000_00, updatedAt: now },
      ]);
    }
    if (p.number === "P-2403") {
      await db.insert(s.forecasts).values([{ projectId: proj.id, costCodeId: C["23-300"].id, etcCents: 118_000_00, updatedAt: now }]);
    }
  }

  // unassigned QBO costs waiting to be coded
  const un: [string, string, number, string][] = [
    ["2026-09-22", "Wolseley Canada", 4_318.62, "Copper fittings & PEX — counter sale"],
    ["2026-09-21", "Home Depot Pro", 612.4, "Consumables, fasteners"],
    ["2026-09-19", "Sunbelt Rentals", 2_875, "Scissor lift 19' — 1 week"],
    ["2026-09-18", "Engineered Air", 18_940, "Make-up air unit MAU-1 deposit"],
    ["2026-09-16", "Emco Supply", 1_206.75, "Floor drains (4) & cleanouts"],
    ["2026-09-12", "Modu-Loc Fence Rentals", 940, "Site fencing — September"],
    ["2026-09-09", "Accu-Air Balancing", 3_400, "Pre-balance site visit"],
  ];
  for (const [date, vendor, amt, desc] of un) {
    await db.insert(s.costTransactions).values({
      companyId: co.id, vendorId: V[vendor].id, date, source: "BILL", docNumber: `${vendor.slice(0, 3).toUpperCase()}-${20000 + Math.floor(rnd() * 70000)}`,
      description: desc, amountCents: Math.round(amt * 100), taxCents: Math.round(amt * 13), qboTxnId: String(5000 + Math.floor(rnd() * 4000)),
    });
  }

  await db.insert(s.syncLogs).values({ companyId: co.id, entity: "System", direction: "PULL", status: "OK", message: "Demo data seeded — QBO not connected yet", createdAt: now });
  console.log("Seeded:", file);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
