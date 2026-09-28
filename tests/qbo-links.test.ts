import { describe, it, expect } from "vitest";
import { qboTxnUrl, qboTypeLabel } from "../src/lib/qbo-links";

const sandbox = { environment: "sandbox" as const, realmId: "9341458092387535" };

describe("QuickBooks deep links", () => {
  it("opens each transaction type on its own page, in the right company", () => {
    expect(qboTxnUrl(sandbox, "Bill", "20")).toBe("https://app.sandbox.qbo.intuit.com/app/bill?txnId=20&deeplinkcompanyid=9341458092387535");
    expect(qboTxnUrl(sandbox, "Purchase", "52", "CHECK")).toContain("/app/check?txnId=52");
    expect(qboTxnUrl(sandbox, "Purchase", "7", "EXPENSE")).toContain("/app/expense?txnId=7");
    expect(qboTxnUrl(sandbox, "Invoice", "1004")).toContain("/app/invoice?txnId=1004");
    expect(qboTxnUrl({ ...sandbox, environment: "production" }, "CreditMemo", "9")).toMatch(/^https:\/\/qbo\.intuit\.com\/app\/creditmemo\?txnId=9/);
  });
  it("has no link for rows that didn't come from QuickBooks", () => {
    expect(qboTxnUrl(sandbox, null, "5")).toBeNull();
    expect(qboTxnUrl({ ...sandbox, realmId: null }, "Bill", "5")).toBeNull();
  });
  it("labels purchases the way QuickBooks does", () => {
    expect(qboTypeLabel("Purchase", "CHECK")).toBe("Cheque");
    expect(qboTypeLabel("Purchase", "EXPENSE")).toBe("Expense");
  });
});
