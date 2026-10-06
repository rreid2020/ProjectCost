/**
 * Builds the marketing page for the main website from src/marketing/Landing.tsx:
 *   landing/dist/projectcost.html            one self-contained page (HTML + only the CSS it uses)
 *   landing/react/ProjectCostLanding.tsx     the same component, for a React + Tailwind website
 * The app address the buttons point to: LANDING_APP_URL, else APP_URL, else the component's default.
 *   npm run build:landing
 */
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { ProjectCostLanding, DEFAULT_APP_URL } from "../src/marketing/Landing";
import { PLANS, TRIAL_DAYS } from "../src/lib/plans";

const root = process.cwd();
const appUrl = (process.env.LANDING_APP_URL || process.env.APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
const out = path.join(root, "landing");

async function main() {
  const plans = Object.values(PLANS).map((p) => ({ name: p.name, blurb: p.blurb, features: [...p.features] }));
  const body = renderToStaticMarkup(createElement(ProjectCostLanding, { appUrl, trialDays: TRIAL_DAYS, plans }));

  // Tailwind, limited to the classes the landing component uses
  const cssFrom = path.join(root, "src/marketing/landing.css");
  const input = `@import "tailwindcss" source(none);\n@source "./Landing.tsx";\nhtml { scroll-behavior: smooth; }\n`;
  const { css } = await postcss([tailwind({ optimize: { minify: true } })]).process(input, { from: cssFrom });

  const description = "Budgets, change orders, progress billing, WIP and month-end entries on top of your accounting system: QuickBooks, Sage, Xero or spreadsheets.";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ProjectCost by Axiom | Project costing, WIP and month-end</title>
<meta name="description" content="${description}">
<meta property="og:title" content="ProjectCost by Axiom">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;
  mkdirSync(path.join(out, "dist"), { recursive: true });
  mkdirSync(path.join(out, "react"), { recursive: true });
  writeFileSync(path.join(out, "dist", "projectcost.html"), html);
  copyFileSync(path.join(root, "src/marketing/Landing.tsx"), path.join(out, "react", "ProjectCostLanding.tsx"));
  console.log(`landing/dist/projectcost.html  (${(html.length / 1024).toFixed(0)} KB, buttons -> ${appUrl})`);
  console.log("landing/react/ProjectCostLanding.tsx");
}

main().catch((e) => { console.error(e); process.exit(1); });
