# GODMADE Client Machine

AI-powered agency pipeline: onboard a client → Buyer Brain research →
competitor ad selection → static ad generation → video ad generation.
Full architecture: see GODMADE_SYSTEM_BUILD_PLAN.md (read it before any work).

## Structure
- apps/dashboard  — Next.js 15 App Router + Tailwind + shadcn/ui + Supabase
- apps/worker     — pipeline runner built on @anthropic-ai/claude-agent-sdk
- packages/shared — Zod schemas (BBM, run payloads), generated DB types

## Conventions
- All agent prompts live in apps/worker/prompts/*.md — never inline prompts in code
- All agent outputs validated with Zod before DB writes; retry once on validation failure
- Every research claim in a BBM must carry a source_url + verbatim quote
- Runs are background jobs; never run pipelines inside HTTP request handlers
- Track token cost per run in runs.cost_usd
- Env vars in .env.local (never commit): ANTHROPIC_API_KEY, SUPABASE_*, APIFY_TOKEN,
  FAL_API_KEY, GEMINI_API_KEY, HIGGSFIELD_API_KEY, GOOGLE_DRIVE_*

## Commands
- pnpm dev            — dashboard on :3000
- pnpm worker:dev     — worker with hot reload
- pnpm db:migrate     — apply Supabase migrations
- pnpm pipeline:test  — run buyer_brain at depth quick against a client by name
  (default "Ben's Fitness"): pnpm pipeline:test "Client Name"
