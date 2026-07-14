# GODMADE Client Machine

AI-powered agency pipeline: onboard a client → Buyer Brain research →
competitor ad selection → static ad generation → video ad generation.
Full architecture: see GODMADE_SYSTEM_BUILD_PLAN.md (read it before any work).

## Structure
- apps/dashboard  — Next.js 15 App Router + Tailwind + shadcn/ui + Supabase
- apps/worker     — pipeline runner built on @anthropic-ai/claude-agent-sdk
- packages/shared — Zod schemas (BBM, run payloads), generated DB types

## Quickstart (Phase 0)

1. **Create a Supabase project** at supabase.com (free tier is fine).
2. **Create your single operator user**: Supabase dashboard → Authentication →
   Users → Add user (email + password, confirm email manually). There is no
   sign-up flow — this app is single-operator by design.
3. **Configure env**: copy `.env.example` to `.env.local` at the repo root —
   both apps load it. Fill in `NEXT_PUBLIC_SUPABASE_URL` +
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (dashboard), `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY` (worker), and `ANTHROPIC_API_KEY` (pipelines).
4. **Apply migrations**: install the [Supabase CLI](https://supabase.com/docs/guides/cli),
   then `supabase link --project-ref <your-ref>` and `pnpm db:migrate`.
5. **Run**: `pnpm install`, then `pnpm dev` → http://localhost:3000, sign in,
   add your first client.

## Conventions
- All agent prompts live in apps/worker/prompts/*.md — never inline prompts in code
- All agent outputs validated with Zod before DB writes; retry once on validation failure
- Every research claim in a BBM must carry a source_url + verbatim quote
- Runs are background jobs; never run pipelines inside HTTP request handlers
- Track token cost per run in runs.cost_usd
- Env vars in .env.local (never commit): ANTHROPIC_API_KEY, SUPABASE_*, REDDIT_*,
  APIFY_TOKEN, GEMINI_API_KEY, HIGGSFIELD_API_KEY, GOOGLE_DRIVE_*

## Commands
- pnpm dev            — dashboard on :3000
- pnpm worker:dev     — worker with hot reload
- pnpm db:migrate     — apply Supabase migrations
- pnpm pipeline:test  — run the Buyer Brain pipeline at depth quick against a
  client by name (default "Ben's Fitness"): `pnpm pipeline:test "Client Name"`

## Buyer Brain (Phase 1)

Click **Run Buyer Brain** on a client page (dashboard) or use
`pnpm pipeline:test`. The worker (`pnpm worker:dev`) picks up queued runs:
four research miners (forum / reddit / news / youtube) run in parallel via the
Claude Agent SDK — web search + fetch for most, the official Reddit Data API
(custom agent tools; needs `REDDIT_*` env vars, else that miner is skipped)
for reddit — and a composer merges their findings
into the Buyer Brain Matrix, and the result is written to `bbm_versions`
(version incremented, previous active version deactivated). View it at
`/clients/<id>/bbm` — every quote links to its source. Miner and composer
prompts live in `apps/worker/prompts/*.md`; tune them there.
