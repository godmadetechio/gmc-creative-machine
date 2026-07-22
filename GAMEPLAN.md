# GODMADE Client Machine — Gameplan & Status

Living playbook. Where we are, what's next, and the exact Claude Code prompt for every remaining phase. Updated: July 15, 2026 — post AI×Ads training integration (see AI_ADS_TRAINING_INTEGRATION.md, committed alongside this doc).

---

## Where we are

| Phase | Status | Proof / Notes |
|---|---|---|
| 0 — Monorepo foundation | ✅ DONE | Dashboard live, DB migrated, client CRUD working |
| 1 — Buyer Brain engine | ✅ DONE | BBM v8: 84-finding full run, all 4 miners healthy, sourced verbatim quotes, $3.40/run |
| 1.x — Miner hardening | ✅ DONE | Reddit via Apify (short-query discipline), YouTube comments via Apify, permalink+validation fixes |
| 2 — Creative Selection (1.B) | 🔄 FINAL STRETCH | Pipeline works end-to-end (scout → derive → scrape → score → queue). Breadth restructure in flight: 25-30 competitors, top-3-per-advertiser, collation dedupe, run_id/superseded. Then: human selects winners |
| 1 patch — Avatars in BBM | ⬜ NEXT (30 min) | Composer emits 3-5 avatars; creatives get avatar tag (training §1) |
| 2.5 — Client Asset Library | ⬜ | Collect owner photos, logo, brand hex codes, fonts, liked/hated ads |
| 3 — Still Ads (Nano Banana) | 🔄 BUILT | Via fal.ai (FAL_API_KEY) · training upgrades §2 in · verify: `pnpm fal:test` → `pnpm pipeline:test-stills` (2×2 smoke) → full run → thumb regression check: open one grid thumbnail URL directly — must show the FULL ad uncropped (transform is width-only + resize=contain; a cropped thumb means someone reintroduced height/cover) |
| 4 — Video Ads (Higgsfield+) | ⬜ | Needs HIGGSFIELD_API_KEY · build WITH training upgrades §3 (podcast/interview formats, cost routing, imperfection prompts) |
| 5 — The flywheel | ⬜ | 2-week BBM refresh + diff, Winning Creative Doc, feedback injection, cost rollups |
| 5.5 — Iteration Engine | ⬜ NEW | Remix winning hooks × bodies, new faces/formats — "new winners before old ones die" |
| 6 — Media Buying Copilot | ⬜ NEW | Meta Ads API (read-only) + morning scale/cut/duplicate report + performance-driven feedback loop |
| Deploy — worker + dashboard | ⬜ DEFERRED (user choice: after local finalization) | Railway (worker) + Vercel (dashboard) → no more terminals to operate |

**Standing rules:** one phase per Claude Code session · fresh session off main for new phases, same session for fixes to fresh work · merge before the next phase · every phase ends with a live test on Ben's Fitness · bring outputs to Cowork for quality review · verify third-party API schemas with a live check script BEFORE integrating (the Reddit/FB lesson) · tool calls log result counts and surface real errors into warnings.

**Prompt-tuning loop (ongoing):** the prompts in `apps/worker/prompts/` are the product. Review outputs → edit prompts by hand → re-run. Known pending tune: composer hard caps (5/5/5 pains-desires-beliefs, 10 patterns, 40 phrases, prune-and-name-drops) to stop matrix inflation.

---

## Immediate next steps

1. **Finish Phase 2**: merge breadth restructure → clean stale candidates → `pnpm pipeline:test-selection` → review the by-advertiser queue → **Select 3-5 winners** (aim for one identity-callout, one lead-magnet, one challenge/offer skeleton). Phase 2 = done.
2. **Phase 1 avatar patch** (same-day, small — prompt below).
3. **Phase 2.5** (prompt below) — have Ben's assets ready.
4. **Phase 3** is built (fal.ai Nano Banana Pro). Get FAL_API_KEY into .env.local, run `pnpm db:migrate`, then `pnpm fal:test` and `pnpm pipeline:test-stills`.

---

## Phase 1 patch — Avatars · kickoff prompt (small; can run in a short session)

```text
Read AI_ADS_TRAINING_INTEGRATION.md section 1. Patch the Buyer Brain:

1. BBMSchema: add avatars[] (3-5) — { name, identity_line, top_pain,
   top_desire, belief_to_break, tone_notes }. Composer derives them from
   existing findings (no new mining) and keeps them stable across versions
   unless the research materially shifts (note changes in change_summary).
2. Migration: creatives.avatar (text, nullable). ad_candidates untouched.
3. BBM viewer: Avatars section rendered as persona cards.
4. prompts/composer.md: add the avatar derivation instructions + the
   hard caps: max 5 pains, 5 desires, 5 beliefs, 10 patterns, 40
   language_bank phrases — when new signal deserves entry, drop/merge the
   weakest and say what was dropped in change_summary.
5. Re-run pipeline:test (quick) to confirm v9 emits avatars.
```

## Phase 2.5 — Client Asset Library · kickoff prompt

```text
Read GODMADE_SYSTEM_BUILD_PLAN.md — section 6 "The Client Asset Library" —
and AI_ADS_TRAINING_INTEGRATION.md §3d (founder avatars). We are doing
Phase 2.5.

1. Migration: client_assets table per the build plan (kind enum:
   owner_photo, logo, product_shot, lifestyle_photo, example_ad,
   inspiration_ad, testimonial_screenshot, brand_doc) + clients.brand_json
   jsonb. Supabase Storage bucket 'client-assets' (authenticated RLS).
2. Zod schemas in packages/shared: AssetKind, BrandKit (colors: hex[],
   fonts: string[], tone_notes, rules: string[]).
3. Dashboard: Assets tab on client page — drag-and-drop multi-upload,
   kind selector, notes, thumbnail grid by kind, delete with confirm.
   Brand Kit editor writing clients.brand_json.
4. Auto-registration: when an ad_candidate is marked 'selected', download
   its media to Storage NOW (fbcdn URLs expire) and register as
   'inspiration_ad' (notes = advertiser + score + skeleton).
5. Worker helper: getAssetManifest(clientId) → assets by kind with signed
   URLs, for Phase 3/4 agents.
```

## Phase 3 — Still Ads · kickoff prompt (training-upgraded)

Prereqs: GEMINI_API_KEY in root .env.local; Phases 2 + 2.5 merged; winners selected; assets uploaded.

```text
Read GODMADE_SYSTEM_BUILD_PLAN.md section 6 (incl. Asset Library),
AI_ADS_TRAINING_INTEGRATION.md section 2, and section 3 of the build plan.
We are doing Phase 3: Still Ad Creation.

1. Pipeline: runStillAds(clientId, { conceptCount?: number }) for run type
   'still_ads'. Inputs: selected ad_candidates (winners), active BBM incl.
   avatars, brand_json, asset manifest, rejection-feedback history.
2. Create prompts/static-frameworks.md: the proven static formats —
   us-vs-them, bold claim, iPhone-notes/text-thread, features+benefits,
   before/after, "the offer", testimonial card, question hook, "N reasons",
   sticky note. Concept agent distributes concepts across frameworks.
3. Concept agent (no tools): each concept targets EXACTLY ONE BBM avatar
   (named), names the audience explicitly in the copy (Andromeda wording
   rule), extracts the transferable skeleton from a selected winner, and
   is generated hook-first: 1 core concept x 3-5 genuinely diverse hooks
   (different angle or avatar — not rewordings). Zod-validated; hooks
   stored as first-class data on the concept.
4. Prompt compiler: concept -> Gemini request. Brand colors/fonts/rules in
   the text prompt; attach reference images per mode (identity: owner
   photos / style: inspiration_ad / product: product shots). Nano Banana
   Pro tier for text-heavy statics.
5. Generation defaults lean VOLUME (win-rate math: ~13:1): default 10
   concepts x 3 variants statics; carousels 3-5 cards with visual
   continuity (pass previous card as input image). Cap per-run cost,
   log spend.
6. Store: Supabase Storage + client Drive folder (warn-and-skip if Drive
   creds absent). creatives rows: type, avatar, prompt_used, hook,
   framework, model 'nano_banana', file_url, status 'draft',
   ad_candidate_id.
7. Dashboard: /clients/[id]/creatives review grid — filter by
   framework/avatar/status, Approve / Reject with required feedback on
   reject. Approved -> Winning Creative Doc entry; feedback -> injected
   into next run's concept prompt.
8. pnpm pipeline:test-stills (2 concepts x 2 variants, cheap).
```

## Phase 4 — Video Ads · kickoff prompt (training-upgraded)

Prereqs: HIGGSFIELD_API_KEY; Phase 3 merged. Before this session: 30-min price-check of VO3/Kling API aggregators (kie.ai, muapi.ai) vs Higgsfield for b-roll generation — pick the stack, tell the session.

```text
Read GODMADE_SYSTEM_BUILD_PLAN.md section 7 and
AI_ADS_TRAINING_INTEGRATION.md section 3. We are doing Phase 4: Video Ads.

1. Pipeline: runVideoAds(clientId, { conceptCount? }) for run type
   'video_ads'. Same inputs as still ads.
2. FORMAT HIERARCHY (anti-slop rule — single AI face talking = trust
   killer): script agent produces (a) podcast-style two-person dialogue
   ads, (b) interview-style Q->A ads, (c) UGC only with heavy-edit
   discipline (cuts every few seconds, b-roll shot list, multiple angles).
   Every script: one named BBM avatar, audience named in the first lines
   (wording rule), verbatim language_bank phrases, hook variants, b-roll
   shot list, on-screen text, voice direction. HERO ARC as the longer
   narrative format.
3. Generation routing behind our own thin provider interface (one-file
   swap): dialogue video -> [chosen provider]; b-roll/short clips ->
   [chosen provider]; images/thumbnails -> Nano Banana. Include
   imperfection prompting (natural skin, blemishes, imperfect lighting).
   Founder mode: if owner_photo assets exist, use Higgsfield custom avatar
   for founder-style ads (one persistent avatar per client).
4. Long-running jobs: submit -> poll -> resume-safe; download -> Storage +
   Drive. creatives rows with model, avatar, hook, format.
5. Arcads manual handoff: script + shot list card with copy button and an
   upload slot for the finished render.
6. Same review queue (extend to video players) + feedback loop.
7. pnpm pipeline:test-videos (1 short podcast-style script, cost-capped).
```

## Phase 5 — The Flywheel · kickoff prompt

```text
Read GODMADE_SYSTEM_BUILD_PLAN.md section 8 (Phase 5). We are doing the
flywheel.

1. BBM refresh: worker cron re-runs buyer_brain (full) every 14 days per
   client with an active BBM; diff agent writes change_summary; dashboard
   diff view between any two versions.
2. Winning Creative Doc: per-client page aggregating approved creatives +
   concepts + hooks + performance notes; injected as context into Phase
   3/4 concept agents.
3. Creative-preferences doc compiled from all rejection feedback,
   versioned, injected into every concept prompt.
4. Cost dashboard: per-client / per-month rollups from runs.cost_usd.
5. Agency cockpit landing page: per client — last BBM refresh, last
   creative batch, pending reviews, competitor changes.
```

## Phase 5.5 — Iteration Engine · kickoff prompt (NEW)

```text
Read AI_ADS_TRAINING_INTEGRATION.md section 4. We are building the
Iteration Engine.

1. "Mark as winner" action on approved creatives (human flag now;
   performance data joins in Phase 6).
2. iterate(creativeId) pipeline generating SIGNIFICANT variations only:
   (a) winning hook x other strong bodies, (b) winning body x new hooks,
   (c) same script, new face/setting/avatar, (d) format flip
   (static <-> video script). Never cosmetic tweaks (font/filter).
3. Iteration briefs auto-drafted from the Winning Creative Doc; Iterate
   button on winner cards enqueues a run; outputs land in the same review
   queue tagged iteration_of.
4. 80/20 guard: dashboard shows exploration vs iteration mix per client.
```

## Phase 6 — Media Buying Copilot · kickoff prompt (NEW — the loop closer)

Prereq: Meta Marketing API access — system-user token with ads_read on the client ad account. Start read-only.

```text
Read AI_ADS_TRAINING_INTEGRATION.md section 5. We are building the Media
Buying Copilot (read-only v1).

1. Meta Marketing API integration: daily pull of campaign/adset/ad
   performance per client (spend, CPL/CPA, CTR, frequency, conversions,
   lead-quality fields where available). Store time series.
2. Morning Report agent (cron, per client): scale / cut / duplicate /
   watch recommendations with reasoning. Rubric: no kill judgments before
   3 days; kill at 2x target CPL with zero conversions after 3 days;
   vertical scaling max +20-30% per 3-4 days; watch quality metrics before
   CPL (quality cliff); flag creative fatigue at 2-3 weeks of meaningful
   spend; structural advisories (CBO, broad-first, naming) as text only.
   Human executes — v1 changes nothing in the ad account.
3. Pipeline guard: alert when a winner is fatiguing and no fresh creatives
   are in testing.
4. Close the loop: ad-level performance joins creatives rows -> real
   win/loss data feeds the Winning Creative Doc, avatar win-rates, and
   the Iteration Engine.
5. Dashboard: Morning Report view per client + report archive; this page
   + the cockpit should run the weekly 45-min creative meeting.
```

---

## External accounts checklist

| Service | Needed for | Status |
|---|---|---|
| Anthropic API key | All pipelines | ✅ |
| Supabase | Everything | ✅ live |
| Apify (+ Reddit, YouTube, FB Ad Library actors) | Phases 1-2 | ✅ token in .env.local, all three actors verified |
| fal.ai API key (Nano Banana Pro) | Phase 3 | ⬜ verify with `pnpm fal:test` |
| Higgsfield Cloud API | Phase 4 | ⬜ |
| VO3/Kling via aggregator (kie.ai / muapi.ai) | Phase 4 b-roll (optional, cost-saver) | ⬜ price-check before Phase 4 |
| Google Cloud (Drive API) | Phase 3+ delivery | ⬜ warn-and-skip until configured |
| Meta Marketing API (system user, ads_read) | Phase 6 | ⬜ |
| Arcads account | Phase 4 manual lane | ⬜ optional |
| Railway + Vercel | Deploy | ⬜ deferred until local finalization |

## The operating loop once everything ships (per client)

1. Onboard: create client, brief, upload assets + brand kit, seed known competitors (15 min human)
2. Buyer Brain full run → review matrix + avatars (30 min human)
3. Creative Selection → select winners per advertiser (20 min human)
4. Still + Video runs → approve/reject with feedback (30 min human)
5. Ship approved creatives; Copilot watches the account daily
6. Weekly 45-min meeting off the Morning Report: define winners → kick iterations → keep the testing pipeline full
7. Every 2 weeks: BBM auto-refresh → diff review → new round informed by real performance

~80% AI / 20% human — with the 20% spent on judgment, not production.
