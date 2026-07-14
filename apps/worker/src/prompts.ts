import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "prompts",
);

// Loads apps/worker/prompts/<name>.md and substitutes {{placeholders}}.
// Throws on unknown placeholders so a typo in a prompt file fails loudly
// instead of shipping "{{niche}}" to the model.
export function loadPrompt(
  name: string,
  vars: Record<string, string | number>,
): string {
  const raw = readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Prompt '${name}' uses undefined placeholder {{${key}}}`);
    }
    return String(vars[key]);
  });
}
