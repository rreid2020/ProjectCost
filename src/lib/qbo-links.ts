// Deep links into the QuickBooks Online web app, so any number can be traced to its source transaction.
// deeplinkcompanyid makes QuickBooks switch to the right company if the user has several.
const PAGES: Record<string, string> = {
  Bill: "bill",
  VendorCredit: "vendorcredit",
  Invoice: "invoice",
  CreditMemo: "creditmemo",
  Check: "check",
  Expense: "expense",
};

export type QboLinkContext = { environment: "sandbox" | "production"; realmId: string | null };

/** For cost lines, pass the ProjectCost source (CHECK / EXPENSE) so Purchases open on the right page. */
export function qboTxnUrl(ctx: QboLinkContext, qboTxnType: string | null, qboTxnId: string | null, source?: string) {
  if (!qboTxnType || !qboTxnId || !ctx.realmId) return null;
  const type = qboTxnType === "Purchase" ? (source === "CHECK" ? "Check" : "Expense") : qboTxnType;
  const page = PAGES[type];
  if (!page) return null;
  const host = ctx.environment === "production" ? "https://qbo.intuit.com" : "https://app.sandbox.qbo.intuit.com";
  return `${host}/app/${page}?txnId=${encodeURIComponent(qboTxnId)}&deeplinkcompanyid=${encodeURIComponent(ctx.realmId)}`;
}

export const qboTypeLabel = (qboTxnType: string | null, source?: string) =>
  qboTxnType === "Purchase" ? (source === "CHECK" ? "Cheque" : "Expense") : qboTxnType === "VendorCredit" ? "Vendor credit" : qboTxnType === "CreditMemo" ? "Credit memo" : qboTxnType ?? source ?? "";
