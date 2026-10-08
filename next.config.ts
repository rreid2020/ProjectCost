import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lets a second dev server (e.g. against a scratch database) run beside the main one
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PGlite ships a WASM Postgres; load it from node_modules rather than bundling it.
  serverExternalPackages: ["@electric-sql/pglite", "exceljs"],
  // spreadsheet uploads go through a server action
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // hide the "N" dev-tools badge in the corner while running locally (it never shows in production)
  devIndicators: false,
};

export default nextConfig;
