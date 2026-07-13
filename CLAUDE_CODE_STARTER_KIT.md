# Claude Code Starter Kit — GODMADE Client Machine

Copy-paste material to start building. Contains: (1) the CLAUDE.md to put in your repo root, (2) the Phase 0 and Phase 1 kickoff prompts for Claude Code, (3) the miner/composer prompt drafts for the Buyer Brain agents.

---

## 1. CLAUDE.md (put this in the repo root)

```markdown
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
  GEMINI_API_KEY, HIGGSFIELD_API_KEY, GOOGLE_DRIVE_*

## Commands
- pnpm dev            — dashboard on :3000
- pnpm worker:dev     — worker with hot reload
- pnpm db:migrate     — apply Supabase migrations
- pnpm pipeline:test  — run a pipeline against the fixture client with --depth quick
```

---

## 2. Phase 0 kickoff prompt (paste into Claude Code)

```text
Read GODMADE_SYSTEM_BUILD_PLAN.md in the repo root. We are doing Phase 0.

Scaffold a pnpm monorepo:
- apps/dashboard: Next.js 15 (App Router, TypeScript), Tailwind, shadcn/ui,
  Supabase auth (single user: me), dark UI, sidebar nav: Clients / Runs / Review / Settings
- apps/worker: TypeScript service, placeholder pipeline runner
- packages/shared: Zod schemas

Create Supabase migrations for: clients, runs, bbm_versions, ad_candidates,
creatives — exactly per the data model in the build plan (section 3).

Build the Clients page: list, create, edit (name, niche, brief textarea,
website, drive_folder_id). Build an empty Runs page listing runs with status
badges.

Propose your plan first before writing code.
```

## 3. Phase 1 kickoff prompt (Buyer Brain engine)

```text
Read GODMADE_SYSTEM_BUILD_PLAN.md, section 4. We are doing Phase 1: the Buyer
Brain pipeline in apps/worker using @anthropic-ai/claude-agent-sdk.

Requirements:
1. Pipeline entry: runBuyerBrain(clientId, { depth: 'quick' | 'full' })
2. Four research subagents run in parallel (forum miner, reddit miner,
   news miner, youtube miner). Each uses web search + fetch, returns
   structured findings validated by a shared Zod FindingSchema:
   { quote, source_url, platform, signal: 'pain'|'desire'|'belief'|'pattern',
     intensity: 1-5, context }
   depth 'quick' = max 3 searches per miner (for testing), 'full' = 12-15.
3. Composer agent merges findings into the BBM JSON schema from the build
   plan (section 4), deduplicating and clustering. Validate with Zod;
   on failure, retry once with the validation errors in the prompt.
4. Write result to bbm_versions (increment version, set is_active).
5. Load all agent prompts from apps/worker/prompts/*.md. Write first drafts
   of these prompt files based on the specs in CLAUDE_CODE_STARTER_KIT.md
   section 4 — I will tune them by hand afterward.
6. Dashboard: "Run Buyer Brain" button on the client page (enqueues job,
   live status), and a BBM viewer page rendering the matrix as four card
   sections (Pains / Desires / Beliefs / Patterns). Every quote links to
   its source. Show a version dropdown.
7. Log per-run token usage → runs.cost_usd.

Create a fixture client (Test Fitness Coach / women 35+ fat loss niche) and
a pnpm pipeline:test script that runs it at depth quick.

Propose your plan first.
```

---

## 4. Agent prompt drafts (apps/worker/prompts/)

### reddit-miner.md (pattern applies to all miners)

```text
You are a market research miner. Client: {{client_name}}. Niche: {{niche}}.
Brief: {{brief}}. Operator notes: {{operator_prompt}}.

Mission: find the RAW VOICE of this market on Reddit. Not summaries — the
actual words real people use when they complain, dream, doubt, and decide.

Process:
1. Identify 3-6 subreddits where this audience actually posts (including
   adjacent ones where they complain about the problem, not just the topic).
2. Search for: complaint threads, "am I the only one" posts, failure stories
   ("I tried X and..."), buying-decision threads, controversial takes.
   Prioritize high-comment threads — the gold is in the comments.
3. For each strong signal, capture the VERBATIM quote (do not paraphrase),
   the thread URL, and classify: pain / desire / belief / pattern.

What counts as a strong signal:
- Pain: emotional language, specificity, repeated across threads
- Desire: what they say they want AND the identity behind it
- Belief: objections, skepticism, "X doesn't work because...", past burns
- Pattern: recurring behavior loops (start-fail-restart, tool hopping, etc.)

Reject: marketing content, affiliate spam, surface-level platitudes.
Return findings as JSON array matching FindingSchema. Minimum {{min_findings}}
findings, at least 3 per signal type.
```

### composer.md

```text
You are the Buyer Brain composer. Input: research findings from four miners
(attached), client brief, and the previous BBM version (if any).

Build the Buyer Brain Matrix per BBMSchema. Rules:
- Cluster duplicate findings; keep the 3-5 STRONGEST entries per category,
  ranked by intensity × frequency. Depth beats breadth.
- pains[]: current = the felt pain in their words; future = the feared
  trajectory if unsolved (extrapolate honestly, don't invent).
- desires[]: current = surface ask; future = the dream outcome / identity
  they are really buying.
- beliefs[]: development = how the belief formed (failed attempts, industry
  narratives, past burns — cite finding quotes); breaking_angle = the
  specific reframe, mechanism, or proof type that would crack it. The
  breaking_angle must be concrete enough to brief an ad from.
- patterns[]: behavior loops + what each implies for creative strategy.
- language_bank: 15-30 verbatim phrases usable directly in ad copy.
- Every entry cites at least one verbatim quote with source_url.
- If a previous version exists, note what changed in a change_summary field.

Output only valid JSON per BBMSchema.
```

### cross-reference-scorer.md (Phase 2 — for 1.B)

```text
You score competitor ads against a Buyer Brain Matrix. Input: one scraped ad
(copy, media description, days running, advertiser) + the active BBM.

Score 0-100:
- Angle match (40): which BBM pain/desire does the hook target, how directly?
- Belief work (30): does it break a belief listed in the BBM? Via which
  mechanism (proof, reframe, demonstration, story)?
- Longevity signal (20): days running (>60 = strong, >30 = decent).
- Transferability (10): can this skeleton be rebuilt for OUR client without
  copying it?

Return JSON: { score, angle_match: {...}, belief_work: {...},
hook_pattern, format, transferable_skeleton (2-3 sentences),
match_rationale (why this scored what it scored, in plain language) }.
Be harsh. A pretty ad that maps to nothing in the BBM scores under 30.
```

---

## 5. External services checklist (set these up before Phase 1-4)

| Service | What you need | Used in |
|---|---|---|
| Anthropic API key | console.anthropic.com | Phases 1-4 (all agents) |
| Supabase project | supabase.com — free tier fine to start | Phase 0 |
| Apify account + FB Ad Library actor | apify.com — pick a maintained actor, test it manually once on a known competitor | Phase 2 |
| Gemini API key | Google AI Studio — Nano Banana / Nano Banana Pro image models | Phase 3 |
| Higgsfield API | cloud.higgsfield.ai (they also ship an MCP + CLI for agents) | Phase 4 |
| Google Cloud project | Drive API enabled + OAuth or service account for the agency Drive | Phases 1-4 (asset storage) |
| Arcads account | arcads.ai — manual step, no API dependency | Phase 4 |
```
