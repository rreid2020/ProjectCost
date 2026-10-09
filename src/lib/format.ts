export const money = (cents: number, opts: { cents?: boolean } = {}) => {
  const v = cents / 100;
  const s = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(Math.abs(v));
  return v < 0 ? `(${s})` : s;
};
export const pct = (basisPoints: number, digits = 1) => `${(basisPoints / 100).toFixed(digits)}%`;
export const hours = (x100: number) => (x100 / 100).toFixed(2);
export const toCents = (input: string | number) => Math.round(parseFloat(String(input).replace(/[$,\s]/g, "")) * 100) || 0;
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "—";
export const PROJECT_TYPE_LABEL: Record<string, string> = { CONTRACT: "Customer contract", CAPITAL: "Capital project", INVENTORY: "Build for sale" };

/** "LAB-01 Labour", or just "Catering" when the code is the name (QuickBooks items without a SKU use their name as the code). */
export const codeLabel = (c: { code: string; name: string }) => {
  const code = c.code.trim(), name = c.name.trim();
  return !name || name === code || name.startsWith(code) ? name || code : `${code} ${name}`;
};
