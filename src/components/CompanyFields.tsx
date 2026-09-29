type Defaults = { name?: string | null; region?: string; province?: string | null; fiscalYearEndMonth?: number; defaultHoldbackBp?: number; defaultTaxBp?: number };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const PROVINCES: [string, string][] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"],
  ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
];
export const STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

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
          {/* a list, not free text: a placeholder in an empty box looked like a saved value */}
          <select name="province" required defaultValue={company.province ?? ""} className="input">
            <option value="" disabled>Choose…</option>
            <optgroup label="Canada">{PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</optgroup>
            <optgroup label="United States">{STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</optgroup>
          </select></label>
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
