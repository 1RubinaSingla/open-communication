import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Next only reads .env from the app dir; load the monorepo-root .env so a single
// file drives every service (orchestrator, worker, web) and NEXT_PUBLIC_* vars.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const raw = readFileSync(resolve(__dirname, "../../.env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no root .env — fall back to defaults */
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@0c/protocol", "@0c/crypto", "@0c/credits"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  env: {
    NEXT_PUBLIC_ORCH_URL: process.env.NEXT_PUBLIC_ORCH_URL ?? "http://localhost:4000",
  },
};

export default nextConfig;
