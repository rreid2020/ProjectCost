import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProjectCost — project costing, WIP and month-end",
  description: "Budgets, change orders, progress billing, WIP and month-end entries on top of your accounting system: QuickBooks, Sage, Xero or spreadsheets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React hydrates; ignore those only. */}
      <body className="antialiased" suppressHydrationWarning>
        <ClerkProvider
          signInFallbackRedirectUrl="/dashboard"
          signUpFallbackRedirectUrl="/onboarding"
          taskUrls={{ "choose-organization": "/onboarding" }}
          appearance={{ variables: { colorPrimary: "#0E7C86" } }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
