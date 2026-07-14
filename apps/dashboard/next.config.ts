import { join } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// Single root .env.local feeds both apps (the worker loads it in src/env.ts).
// This runs before build/dev, so NEXT_PUBLIC_* inlining picks it up too.
// An app-local .env.local (loaded first by Next itself) still wins because
// dotenv never overwrites vars that are already set.
config({ path: join(process.cwd(), "..", "..", ".env.local") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
