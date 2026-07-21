import "../env";
import {
  createFalNanoBananaProvider,
  FalImageResultSchema,
  FAL_EDIT_ENDPOINT,
  FAL_TEXT_TO_IMAGE_ENDPOINT,
  getFalApiKey,
} from "../image-provider";

// pnpm fal:test [--edit=<image-url>]
//
// Live check of the fal.ai Nano Banana Pro endpoints BEFORE the still_ads
// pipeline trusts them (standard rule: never integrate against guessed
// schemas). Generates ONE cheap image, prints the raw response shape, and
// validates it against FalImageResultSchema — the exact schema the
// ImageProvider relies on. With --edit=<publicly-reachable image URL> it
// exercises the edit endpoint (the reference-image path) instead.

const editUrl = process.argv
  .slice(2)
  .find((a) => a.startsWith("--edit="))
  ?.slice("--edit=".length);

async function main() {
  const apiKey = getFalApiKey();
  if (!apiKey) {
    console.error("[fal:test] FAL_API_KEY is not set in .env.local — aborting.");
    process.exit(1);
  }

  const provider = createFalNanoBananaProvider(apiKey);
  const endpoint = editUrl ? FAL_EDIT_ENDPOINT : FAL_TEXT_TO_IMAGE_ENDPOINT;
  console.log(`[fal:test] endpoint: ${endpoint}`);
  console.log(
    `[fal:test] generating ONE test image (~$${provider.costPerImageUsd().toFixed(2)})…`,
  );

  const started = Date.now();
  const result = await provider.generate({
    prompt: editUrl
      ? "Recreate this image as a clean flat-design test card with the text 'GMC FAL EDIT TEST' centered in bold sans-serif on a deep blue background."
      : "A clean flat-design test card with the text 'GMC FAL TEST' centered in bold sans-serif on a deep blue background. Minimal, high contrast.",
    aspectRatio: "4:5",
    referenceImageUrls: editUrl ? [editUrl] : undefined,
    label: "fal:test",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n[fal:test] raw response shape (${seconds}s):`);
  console.log(JSON.stringify(result.raw, null, 2));

  const check = FalImageResultSchema.safeParse(result.raw);
  console.log(
    check.success
      ? "\n[fal:test] ✅ response matches FalImageResultSchema — the ImageProvider integration is safe."
      : `\n[fal:test] ❌ response DOES NOT match FalImageResultSchema — fix image-provider.ts before running still_ads:\n${check.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n")}`,
  );
  console.log(`[fal:test] image URL: ${result.imageUrl}`);
  console.log(`[fal:test] billed ~$${result.costUsd.toFixed(2)}`);
  if (!check.success) process.exit(1);
}

main().catch((err) => {
  console.error("[fal:test] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
