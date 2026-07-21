# GODMADE Client Machine — System Build Plan

**The full pipeline:** Client Onboarding → Buyer Brain → Creative Selection → Still Ad Creation → Video Ad Creation
**Architecture decision:** Custom web app dashboard, operated by you (technical), built with Claude Code.
**Build order:** Step 1.A (Buyer Brain) first, then 1.B, then Steps 2 and 3.

---

## 1. The Big Picture — How the Machine Fits Together

Your diagrams describe a **pipeline with human checkpoints**, not a fully autonomous system (80% AI / 20% human, as you noted). The cleanest way to build this is:

```
┌─────────────────────────────────────────────────────────────────┐
│                     WEB DASHBOARD (Next.js)                     │
│   Clients · Runs · BBM Viewer · Ad Review Queue · Settings      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ triggers / reads
┌──────────────────────────┴──────────────────────────────────────┐
│                  ORCHESTRATOR (Claude Agent SDK)                │
│   Runs pipelines as background jobs, writes results to DB       │
├──────────┬──────────────┬──────────────┬────────────────────────┤
│ 1.A      │ 1.B          │ 2            │ 3                      │
│ Buyer    │ Creative     │ Still Ads    │ Video Ads              │
│ Brain    │ Selection    │ (Nano Banana)│ (Higgsfield / Arcads)  │
└──────────┴──────────────┴──────────────┴────────────────────────┘
                           │ writes assets
┌──────────────────────────┴──────────────────────────────────────┐
│         STORAGE: Postgres (data) + Google Drive (assets)        │
└─────────────────────────────────────────────────────────────────┘
```

The single most important design decision: **the Buyer Brain Matrix (BBM) is a structured JSON document, not just prose.** Every downstream step (1.B cross-referencing, Step 2 prompts, Step 3 scripts) consumes the BBM programmatically. If the BBM is a Google Doc of paragraphs, the machine breaks. If it's structured JSON rendered nicely in your dashboard, everything downstream becomes a template fill.

---

## 2. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Dashboard | **Next.js 15 (App Router) + Tailwind + shadcn/ui** | Claude Code is extremely good at this stack; fastest path to a polished dashboard |
| Database | **Postgres via Supabase** (or Neon) | Free tier, JSON columns for BBM, auth built in, realtime subscriptions for run status |
| Agent engine | **Claude Agent SDK (TypeScript)** | This is the same engine behind Claude Code — it gives you web search, subagents, tool use, and long-running agentic loops as a library. Your pipelines become code you own. |
| Job runner | **Trigger.dev** or a simple worker + queue (BullMQ + Redis) | Buyer Brain runs take 10–30+ min; they must run as background jobs, not HTTP requests |
| Ad library data | **Apify Facebook Ad Library scraper actor** | Structured JSON of competitor ads by keyword/page/country; called via Apify API |
| Still ads | **Nano Banana Pro (Gemini image API)** | Best-in-class text rendering in images = actual usable statics; called via Gemini API |
| Video ads | **Higgsfield Cloud API / MCP** (primary), Arcads (manual, secondary) | Higgsfield has an official API + MCP designed for agents. Arcads has no solid public API — treat it as a human step for now |
| Asset storage | **Google Drive API** (client-facing) + Supabase Storage (internal) | Keeps your existing "store in Drive, client reviews in Drive" workflow |
| Hosting | Vercel (dashboard) + Railway/Fly (worker) | Standard, cheap, zero-ops |

**Cost picture (rough):** Claude API for pipeline runs ~$3–15 per full Buyer Brain run depending on depth; Apify ~$5–40/mo; Gemini image gen ~$0.13–0.24/image (Nano Banana Pro tier); Higgsfield per their credit plans. A full client onboarding through all 3 steps should land in the $30–80 range of API costs — trivial vs. agency retainers.

---

## 3. Data Model (the backbone)

```
clients
  id, name, niche, brief (text), website, drive_folder_id, created_at

runs                          ← every pipeline execution is a "run"
  id, client_id, type ('buyer_brain' | 'creative_selection' | 'still_ads' | 'video_ads')
  status ('queued' | 'running' | 'needs_review' | 'approved' | 'failed')
  input_json, output_json, cost_usd, started_at, finished_at

bbm_versions                  ← Buyer Brain Matrix, versioned (your "iterate every 2 weeks")
  id, client_id, version, matrix_json, sources_json, created_at, is_active

ad_candidates                 ← output of 1.B
  id, client_id, bbm_version_id, source ('fb_ad_library'), advertiser, ad_url,
  media_urls, ad_copy, run_time_days, match_score, match_rationale_json,
  status ('candidate' | 'selected' | 'rejected'), reviewed_by, reviewed_at

creatives                     ← output of Steps 2 & 3
  id, client_id, ad_candidate_id, type ('static' | 'carousel' | 'ugc' | 'hero_arc'),
  prompt_used, model ('nano_banana' | 'higgsfield' | 'arcads'),
  file_url, drive_file_id, status ('draft' | 'approved' | 'rejected'),
  feedback (text)             ← your "Feedback to AI" box — feeds the next generation round
```

Two details from your diagrams that this encodes:

- **"Iterate every 2 weeks"** → `bbm_versions` is append-only with an `is_active` flag. A scheduled job re-runs Search & Extract every 14 days per active client, produces a new version, and shows you a **diff view** in the dashboard (what pains/desires/beliefs changed).
- **"Feedback to AI"** → the `feedback` field on rejected creatives is injected into the next generation prompt for that client. This is your compounding advantage: the system literally learns each client's taste.

---

## 4. Step 1.A — Buyer Brain (build this first)

### Agent architecture

One orchestrator + parallel research subagents, exactly mirroring your diagram columns:

```
INPUT: { client_name, niche, brief, operator_prompt }
   │
   ├── Subagent: Forum Miner      → niche forums, Quora, FB groups (public), Trustpilot/G2 reviews
   ├── Subagent: Reddit Miner     → relevant subreddits: top + controversial posts, comment threads
   ├── Subagent: News/Article Miner → industry news, trend pieces, studies
   ├── Subagent: YouTube Miner    → top videos in niche, titles/comments (comments = raw pain language)
   │
   └── COMPOSER agent → merges all extractions into the BBM schema below
                      → every claim must carry a source URL + verbatim quote
```

Each miner returns **structured findings** (quote, source URL, signal type: pain/desire/belief/pattern, intensity 1–5). The composer deduplicates, clusters, and fills the matrix. Verbatim quotes are non-negotiable — they become your ad copy raw material ("voice of customer" language).

### The Buyer Brain Matrix schema (your Pains / Desires / Beliefs / Patterns)

```json
{
  "client": "...", "niche": "...", "version": 3, "generated_at": "...",
  "pains": [{
    "current": "What hurts right now (their words)",
    "future": "Where this pain leads if unsolved — the feared trajectory",
    "verbatim_quotes": [{ "quote": "...", "source_url": "...", "platform": "reddit" }],
    "intensity": 4, "frequency": "how often it appeared across sources"
  }],
  "desires": [{
    "current": "What they want today (surface-level ask)",
    "future": "The dream outcome / identity they're really buying",
    "verbatim_quotes": [...], "intensity": 5
  }],
  "beliefs": [{
    "belief": "What they currently believe (often the objection)",
    "development": "How this belief formed — past experiences, failed solutions, industry narratives",
    "breaking_angle": "The reframe/mechanism/proof that breaks it — this is your ad angle",
    "verbatim_quotes": [...]
  }],
  "patterns": [{
    "pattern": "Recurring behavior/language/objection cycle",
    "implication": "What this means for creative & offer positioning"
  }],
  "language_bank": ["exact phrases the market uses — for ad copy"],
  "sources_summary": { "reddit_threads": 14, "forums": 6, "articles": 9, "youtube": 5 }
}
```

### Why the Claude Agent SDK here (and not just prompts in a chat)

Because Buyer Brain is a **long, tool-heavy, parallel** job: 4 subagents each doing 10–30 web searches and fetches, then a synthesis pass. The Agent SDK gives you exactly what Claude Code has — `WebSearch`, `WebFetch`, subagents, structured output — as a TypeScript library you call from your worker. Your dashboard's "Run Buyer Brain" button enqueues a job; the worker runs the agent; results stream into Postgres; the dashboard shows live progress.

---

## 5. Step 1.B — Creative Selection

```
INPUT: { active BBM, operator_prompt }
   │
   ├── 1. Derive search terms: agent reads BBM → generates competitor names,
   │      niche keywords, "breaking angle" phrases to search the Ad Library with
   ├── 2. Apify actor call: Facebook Ad Library scrape per term
   │      (filter: active ads, running >30 days = likely winners; US/EU or client geo)
   ├── 3. Cross-reference agent: for each scraped ad, score 0–100 against the BBM:
   │      · which pain/desire does the hook hit?
   │      · which belief does it break, and how?
   │      · hook pattern, format, offer structure
   │      → match_rationale_json (so YOU see WHY it scored high)
   ├── 4. Top N (e.g. 25) → ad_candidates table + media mirrored to Drive
   └── 5. YOU review in the dashboard: swipe-style Select / Reject queue
```

The key insight from your diagram: **ad longevity is the filter** (an ad running 60+ days is spending profitably), and **the BBM is the lens** (an ad only matters if its angle maps to a real pain/belief in your matrix). The cross-reference agent is what makes this different from every generic "ad spy" tool.

---

## 6. Step 2 — Still Ad Creation (Claude × Nano Banana)

```
INPUT: { selected ads (winners), BBM, operator_prompt, feedback history }
   │
   ├── 1. Concept agent (Claude): for each selected ad, extract its skeleton
   │      (hook type, visual structure, angle) → recombine with BBM language
   │      → N concepts, each with: headline, subhead, visual description, CTA
   ├── 2. Prompt compiler: concept → detailed Nano Banana prompt
   │      (layout, text placement, brand colors/fonts from client settings)
   ├── 3. Generation: Gemini API (Nano Banana Pro for text-heavy statics)
   │      · Static: 1 image per concept, 3 variants
   │      · Carousel: 3–5 sequential cards per concept (story arc across cards)
   ├── 4. Store: upload to client's Drive folder + creatives table
   ├── 5. Dashboard review queue: Approve / Reject + feedback text
   └── 6. Feedback loop: rejection feedback → appended to client's "creative
          preferences" doc → injected into every future prompt compile
```

Also from your diagram: approved winners get logged into a **Winning Creative Doc** per client (a living document of what worked — the composer references it in future rounds).

### Format reliability strategy (round-two learnings)

Generation reliability differs sharply by format class, and the pipeline is weighted accordingly:

- **Text-native formats** (iPhone Notes, Sticky Note, Us vs Them, Bold Claim, Testimonial Card, checkmark/numbered lists) generate reliably — they carry **~60-70% of the default concept mix** (encoded in `concept-agent.md`; the worker warns when a batch drifts past 40% photo-compositing).
- **Photo-compositing concepts** (identity/product reference modes, identity especially) are higher-risk: the worker compiles **extra variants for them (4-5 vs 3)** so post-attrition yield matches the text-native concepts.
- **Identity mode is conservative**: prompts preserve the client's real photo as shot and compose text/graphics around or over it via the edit endpoint — re-rendering a real face into a new scene is where visible flaws come from (encoded in `image-compiler.md`).
- **Retry with feedback**: a rejected creative can be re-queued as a cheap single-image `creative_regen` run (retry mode) with the rejection feedback appended to its compiled prompt — salvages near-misses without a full round.

### The Client Asset Library (feeds Steps 2 & 3)

Pure text-to-image ads are the floor, not the ceiling. The generation agents get dramatically better when every client has a curated asset library the prompt compiler can pull from:

```
client_assets
  id, client_id, kind ('owner_photo' | 'logo' | 'product_shot' | 'lifestyle_photo' |
  'example_ad' | 'inspiration_ad' | 'testimonial_screenshot' | 'brand_doc'),
  storage_path, drive_file_id, notes (text), tags, created_at

clients.brand_json            ← brand kit: colors (hex), fonts, tone-of-voice notes,
                                 do/don't rules ("never show scales", "no red")
```

How generation consumes it — Nano Banana (Gemini image API) accepts **multiple input images alongside the text prompt**, which unlocks three modes the prompt compiler chooses between:

- **Identity mode**: owner photos passed as reference → the generated ad features the actual client (consistent likeness), not a synthetic face. Real faces outperform AI faces in most coaching/personal-brand niches, and it sidesteps AI-likeness disclosure issues.
- **Style/layout mode**: an `example_ad` or `inspiration_ad` passed as reference → "rebuild this layout/energy with OUR hook and OUR brand colors." This is exactly how the 1.B winners become templates — selected ads from Creative Selection auto-register here as `inspiration_ad` assets.
- **Product mode**: real product/lifestyle shots composited into generated scenes instead of hallucinated ones.

Dashboard side: an **Assets tab** on the client page — drag-and-drop upload to Supabase Storage (mirrored to the client's Drive folder), kind selector, notes field ("this is Ben's preferred headshot", "client hates this style"). The Step 2/3 concept agents receive the asset manifest and pick references per concept; the prompt compiler attaches the actual images to the generation call.

Onboarding implication: collecting owner photos, logo, brand colors, and 3-5 ads the client likes/hates becomes part of your client intake form — 15 minutes of collection that upgrades every creative the machine ever makes for them.

## 7. Step 3 — Video Ad Creation (Claude × Higgsfield / Arcads)

Same skeleton as Step 2, different generation backend:

- **Script agent** writes UGC scripts (hook → problem agitation in market language → mechanism → CTA) and HERO ARC scripts (narrative arc) straight from BBM verbatim quotes + selected-ad structures.
- **Higgsfield** is the API-first path: official Cloud API + MCP + CLI built for agents — your worker can generate talking-head/UGC-style and cinematic clips programmatically, poll for completion, download, push to Drive. (Note: the Higgsfield MCP is already connected to this Cowork workspace, so we can prototype generations here before you wire the API into your app.)
- **Arcads** has no reliable public API — treat it as a **human-in-the-loop step**: the dashboard shows the finished script + shot list, you paste it into Arcads, then drop the render back into the review queue (or upload via the dashboard).
- Review queue + feedback loop identical to Step 2.

---

## 8. Build Roadmap — Phase by Phase with Claude Code

Each phase is 1–3 focused Claude Code sessions. Ship in this order; every phase produces something usable on its own.

### Phase 0 — Foundation (1 session)
Repo scaffold: Next.js + Supabase + auth (just you), the data model above as migrations, a Clients CRUD page, and an empty Runs page. **Definition of done:** you can add a client with name/niche/brief in the dashboard.

### Phase 1 — Buyer Brain engine (2–3 sessions) ← START HERE
Worker service with the Claude Agent SDK, the 4 miner subagents + composer, BBM schema validation (Zod), `bbm_versions` writes, and a BBM viewer page (matrix rendered as cards: Pains / Desires / Beliefs / Patterns, each quote linking to its source). **Definition of done:** click "Run Buyer Brain" on a real client → 20–30 min later a full, sourced BBM appears in the dashboard.

**→ Validate here with a real client before building further.** Read the BBM. Is it sharper than what you'd do manually in a week? Tune the miner prompts until yes. This is the 20% human part applied to the system itself.

### Phase 2 — Creative Selection (1–2 sessions)
Apify integration, search-term derivation agent, cross-reference scoring agent, ad_candidates table, and the swipe-style review queue in the dashboard. **Definition of done:** one click → 25 scored competitor ads with rationale, you select winners in the UI.

### Phase 2.5 — Client Asset Library (1 session)
The `client_assets` table + `clients.brand_json`, Supabase Storage upload, the Assets tab on the client page, and auto-registration of 1.B selected ads as inspiration assets. **Definition of done:** upload owner photos, logo, brand colors, and reference ads for a client; the data is queryable by kind.

### Phase 3 — Still Ads (1–2 sessions)
Concept agent + prompt compiler + Gemini/Nano Banana integration (multi-image input: identity/style/product reference modes from the asset library), Drive upload, creative review queue with feedback capture. **Definition of done:** select 5 winning ads → get 15 static variants + 3 carousels in Drive and in the dashboard for approval, featuring the client's real face/brand where assets exist.

### Phase 4 — Video Ads (1–2 sessions)
Script agent, Higgsfield API integration, Arcads manual handoff view. **Definition of done:** approved concepts → UGC + HERO ARC videos land in Drive.

### Phase 5 — The flywheel (1 session)
The 2-week BBM refresh cron + diff view, the Winning Creative Doc per client, feedback-injection into prompts, and cost tracking per run. This phase is what turns a tool into a machine.

---

## 9. How to Run This Build in Claude Code (practical guidance)

1. **One repo, monorepo layout:** `apps/dashboard` (Next.js), `apps/worker` (Agent SDK pipelines), `packages/shared` (BBM schema, DB types). Claude Code handles monorepos well and shared types keep the agent output and the UI in lockstep.
2. **Write the spec into the repo first.** Drop the companion file I'm giving you (`CLAUDE_CODE_STARTER_KIT.md`) plus this plan into the repo root, and have `CLAUDE.md` point at them. Claude Code sessions then always know the architecture, schema, and conventions — you stop re-explaining the system every session.
3. **One phase per session, with a fresh plan.** Start each session with "Read the build plan, we're doing Phase N, propose your plan first." Keep sessions scoped; merge working code before moving on.
4. **Test pipelines with a fixture client.** Create a fake client ("Test Fitness Coach, women 35+, fat loss") and cheap/small run modes (e.g. `--depth quick` = 3 searches per miner) so you can iterate on prompts without burning 30 minutes per test.
5. **Keep prompts in files, not code.** `apps/worker/prompts/*.md` — miner prompts, composer prompt, scoring rubric, concept-agent prompt. You will tune these constantly; they're the product. Version them in git.

---

## 10. Risks & Honest Caveats

- **Apify/Meta scraping**: Ad Library scrapers work well today but Meta changes markup; pick a actively-maintained actor and expect occasional breakage. Budget a fallback (manual CSV import into `ad_candidates`).
- **Arcads**: no public API — designed as manual until that changes. Higgsfield covers the programmatic path.
- **BBM quality is everything.** If Phase 1 output is generic ("they want to lose weight and feel confident"), stop and fix the miners — force verbatim quotes, controversial threads, 1-star reviews. Generic in → generic ads out, all the way down the pipeline.
- **Platform policies**: AI-generated UGC-style ads must comply with Meta's ad policies (e.g., disclosure norms are tightening for AI likenesses). Keep the human review gate — it's not just taste, it's compliance.
- **Costs compound at Step 2/3.** Image/video generation per client per round is cheap individually but add per-run cost tracking (the `cost_usd` column) from day one so you can price clients correctly.
