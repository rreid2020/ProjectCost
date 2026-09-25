type Defaults = { name?: string | null; region?: string; province?: string | null; fiscalYearEndMonth?: number; defaultHoldbackBp?: number; defaultTaxBp?: number };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Company fields shared by onboarding and settings. Percentages are entered as %, stored as basis points. */
export function CompanyFields({ company = {} }: { company?: Defaults }) {
  return (
    <>
      <label className="grid gap-1"><span className="text-xs text-slate-600">Company name</span>
        <input name="name" required maxLength={120} defaultValue={company.name ?? ""} className="input" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1"><span className="text-xs text-slate-600">Country</span>
          <select name="region" defaultValue={company.region ?? "CA"} className="input"><option value="CA">Canada</option><option value="US">United States</option></select></label>
        <label className="grid gap-1"><span className="text-xs text-slate-600">Province / state</span>
          <input name="province" maxLength={3} defaultValue={company.province ?? ""} placeholder="ON" className="input uppercase" /></label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1"><span className="text-xs text-slate-600">Fiscal year ends</span>
          <select name="fiscalYearEndMonth" defaultValue={company.fiscalYearEndMonth ?? 12} className="input">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label className="grid gap-1"><span className="text-xs text-slate-600">Holdback %</span>
          <input name="holdbackPct" inputMode="decimal" defaultValue={(company.defaultHoldbackBp ?? 1000) / 100} className="input text-right" /></label>
        <label className="grid gap-1"><span className="text-xs text-slate-600">Sales tax %</span>
          <input name="taxPct" inputMode="decimal" defaultValue={(company.defaultTaxBp ?? 1300) / 100} className="input text-right" /></label>
      </div>
    </>
  );
}
