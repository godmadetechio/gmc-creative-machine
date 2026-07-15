# GODMADE Client Machine

AI-powered agency pipeline: onboard a client → Buyer Brain research →
competitor ad selection → static ad generation → video ad generation.

- **Roadmap & phase kickoff prompts:** [GAMEPLAN.md](GAMEPLAN.md)
- **Architecture:** [GODMADE_SYSTEM_BUILD_PLAN.md](GODMADE_SYSTEM_BUILD_PLAN.md)
- **Training integration notes:** [AI_ADS_TRAINING_INTEGRATION.md](AI_ADS_TRAINING_INTEGRATION.md)
- **Agent/session conventions:** [CLAUDE.md](CLAUDE.md)

## Structure

| Path | What it is |
|---|---|
| `apps/dashboard` | Next.js 15 App Router + Tailwind + shadcn/ui + Supabase |
| `apps/worker` | Pipeline runner built on `@anthropic-ai/claude-agent-sdk` |
| `packages/shared` | Zod schemas (BBM, run payloads), generated DB types |
| `supabase/migrations` | Data model (clients, runs, bbm_versions, competitors, ad_candidates, creatives) |
| `apps/worker/prompts` | All agent prompts live here — never inline in code |

## Quickstart

```bash
pnpm install
cp .env.example .env.local   # or create it — see keys below
pnpm db:migrate              # apply Supabase migrations
pnpm dev                     # dashboard on :3000
pnpm worker:dev              # pipeline runner (separate terminal)
```

`.env.local` keys (never commit): `ANTHROPIC_API_KEY`, `SUPABASE_*`,
`APIFY_TOKEN`, `GEMINI_API_KEY`, `HIGGSFIELD_API_KEY`, `GOOGLE_DRIVE_*`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dashboard on :3000 |
| `pnpm worker:dev` | Worker with hot reload |
| `pnpm db:migrate` | Apply Supabase migrations |
| `pnpm pipeline:test "Client Name"` | Buyer Brain run at depth quick (default "Ben's Fitness") |
| `pnpm pipeline:test-selection "Client Name"` | Creative Selection run with small caps |
| `pnpm --filter worker fbads:test [--scrape]` | Verify the FB Ad Library actor schema (live) |
| `pnpm --filter worker reddit:test` | Verify the Reddit actor (live) |
| `pnpm typecheck` / `pnpm lint` | Workspace checks |
