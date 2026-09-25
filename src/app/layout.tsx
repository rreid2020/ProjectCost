import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProjectCost — job costing for QuickBooks Online",
  description: "Budgets, cost codes, progress billing and WIP on top of QuickBooks Online.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ClerkProvider
          signInFallbackRedirectUrl="/dashboard"
          signUpFallbackRedirectUrl="/onboarding"
          taskUrls={{ "choose-organization": "/onboarding" }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
