import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Single root .env.local feeds both apps (dashboard loads it in
// next.config.ts). A worker-local .env still wins as an override because
// dotenv never overwrites vars that are already set.

const here = dirname(fileURLToPath(import.meta.url));

function findUp(file: string): string | null {
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, file);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const localEnv = findUp(".env");
if (localEnv) config({ path: localEnv });

const rootEnv = findUp(".env.local");
if (rootEnv) config({ path: rootEnv });
