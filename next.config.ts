import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM Postgres; load it from node_modules rather than bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
