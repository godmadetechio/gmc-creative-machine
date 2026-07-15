# AI × Ads Training → GODMADE Machine Integration Plan

Source: 7 training transcripts (agency AI ops · SaaS UGC system · Perspective's Andromeda creative engine · pay-per-lead media buying · Claude Code statics · non-slop AI video formats · Higgsfield studio). This doc maps every usable insight to a concrete change in our system, phase by phase. Commit this to the repo root so Claude Code sessions can reference it.

---

## 0. What the trainings CONFIRM (no changes needed — we already do it better)

| Training concept | Our implementation |
|---|---|
| "Master brand document" / "best context of the market" (Tabs 2, 3) | The BBM — ours is mined from real sources, versioned, auto-refreshed |
| Swipe file of ads running 3+ months = proven winners (Tabs 5, 6) | Creative Selection: days_running filter + BBM-scored, per-advertiser capped |
| Feed winning creatives + scripts into Claude as context (Tab 3) | Selected ads → concept agent input; Winning Creative Doc (Phase 5) |
| AI as production tool, direct-response skill as the moat (Tab 6) | The BBM + scorer rubric ARE the encoded direct-response skill |
| Study winners, recreate on-brand (Tab 5's whole workflow) | Phases 1B → 2 → 3 pipeline |

## 1. NEW: Avatars — add to Buyer Brain (Phase 1 patch, small)

Tab 2's core discipline: derive 3-5 avatars; every script speaks to exactly ONE avatar; track which avatar converts.

- Composer addition: BBM gains an `avatars` section — 3-5 avatars, each: name, one-line identity ("42yo consulting director, travels weekly, ex-athlete"), top pain, top desire, dominant belief to break, tone notes. Derived from existing findings, no new mining.
- `creatives` rows gain `avatar` field → the feedback loop learns which avatar converts per client.
- Concept/script agents (Phases 3-4) MUST target one avatar per concept and say so.

## 2. Phase 3 upgrades (Still Ads) — fold into the Phase 3 kickoff

a) **Static framework seed library** (Tab 5): encode the proven static formats as a frameworks file (`apps/worker/prompts/static-frameworks.md`): us-vs-them, bold claim, iPhone notes/text-message, features+benefits, before/after, "the offer", testimonial card, question hook, "N reasons why", sticky note. Concept agent distributes concepts across frameworks (even split default, operator can weight). Selected competitor ads remain the *angle* source; frameworks are the *layout* source.

b) **Hook-first generation** (Tabs 2, 3): concepts are generated as 1 core concept × 3-5 DIVERSE hooks (different angle or different avatar per hook — not rewordings). Hooks are first-class rows so winners can be remixed later.

c) **Andromeda wording rule** (Tab 3): creative text does the targeting now. Every concept must name the audience explicitly in copy ("Managers & executives...", "busy dads...") using BBM language. Encode in concept-agent prompt.

d) **Volume mindset** (Tab 3: 7.7% win rate — 13 ads per winner): default output per run should lean higher (e.g. 10 concepts × 3 variants) with cheap review, not 3 precious concepts. Cost per static ~$0.25 → volume is affordable.

## 3. Phase 4 upgrades (Video Ads) — fold into the Phase 4 kickoff

a) **Format hierarchy** (Tab 6 — the anti-slop rule): straight AI UGC (one synthetic face talking to camera) reads as fake and tanks trust with sophisticated audiences. Priority formats:
   1. **Podcast-style** — two people discussing the niche topic (we control every word)
   2. **Interview/street-interview style** — question → answers form the ad
   3. UGC only with heavy edit discipline: fast cuts, b-roll every few seconds, multiple angles — never let one AI face sit on screen long.
   Script agent outputs dialogue formats + a b-roll shot list per script.

b) **Tool routing** (Tabs 6, 7): b-roll/short clips → VO3 / Kling-class models; conversational two-person videos → Infinite Talk-class tools; images/thumbnails → Nano Banana Pro; avatar/try-on/TV-spot → Higgsfield marketing studio. Where we generate via API, add "imperfection prompting" (natural skin, blemishes, imperfect lighting) per Tab 7.

c) **Cost routing** (Tab 6): native platform credits are the expensive path. We already run Higgsfield API; before Phase 4 build, price-check aggregators (kie.ai, muapi.ai) for VO3/Kling access — 30 min of research can cut video costs 70-80%. Keep provider choice behind our own thin interface so swapping stays one-file.

d) **Founder avatar** (Tab 7): if the client provides face photos (asset library `owner_photo`), Higgsfield custom avatars enable founder-style ads at scale — ties directly into identity mode from Phase 2.5. Model consistency matters: one avatar per client, reused.

## 4. NEW Phase 5.5: Iteration Engine (Tab 3 — "new winners before old ones die")

When a creative is marked winning (human flag now; performance data later):
- **Remix hooks × bodies**: winning hook onto other strong bodies; winning body under new hooks (Tab 3: their best ad ever = viral-reel hook slapped onto an unrelated body).
- **New faces/settings**: same winning script, different avatar/creator/setting.
- **New format**: winning static headline → video script; winning video hook → static.
- Rule: iterations must be *of significance* (different hook, face, or format) — never font/filter tweaks.
- Implementation: `iterate(creativeId)` pipeline + "Iterate" button on winning creatives; iteration briefs auto-drafted from the Winning Creative Doc.

## 5. NEW Phase 6: Media Buying Copilot (Tabs 1, 4 — the biggest unlock)

The machine currently ends at "creative delivered." The trainings' largest ROI claim (cutting 4 media buyers to 1) comes from AI reading ad-account data daily. New phase, after Phase 5:

- **Meta Ads API integration** (read-only to start): pull campaign/adset/ad performance daily per client.
- **Morning Report agent**: every morning per active client — which ads to scale / cut / duplicate, with reasoning. Encode Tab 4's rules as the rubric: kill at 2x target CPL with zero conversions after 3 days; don't judge before 3 days; vertical scaling max +20-30% per 3-4 days; watch lead-quality metrics before CPL ("quality cliff"); creative fatigue window 2-3 weeks at meaningful spend → refresh alert.
- **Closed feedback loop**: real performance data (not just human approve/reject) feeds the Winning Creative Doc, avatar win-rates, and the Iteration Engine → the machine finally learns from spend, not opinions.
- **Pipeline guard**: alert when a client has no fresh creatives in testing while a winner is fatiguing ("you're too late if you only test when a winner is already dead").
- Structural advice worth surfacing in the report when relevant (CBO over adset-split testing, broad targeting first, naming conventions) — advisory text, not auto-actions. Human keeps the hands on the wheel; AI does the 80% thinking (Tab 1's split).

## 6. Ops practices to adopt (no code — team habits)

- **Weekly 45-min creative meeting** (Tab 3): define winners → kick iteration briefs → check testing pipeline volume → funnel/CRO notes → launch batch. The dashboard's Phase 5/6 views should be shaped to run this meeting.
- **80/20 rule** (Tab 2): 80% of creative volume on proven concepts/iterations, 20% on new exploration.
- **Launch volume target** (Tab 3): tens of ads per week per mature client, not 3-5. The machine makes this affordable; the review queue makes it manageable.

## 7. Sequencing (updated roadmap deltas)

1. **Now**: finish Phase 2 breadth restructure → select winners.
2. **Phase 1 patch (30 min)**: avatars in composer + BBM viewer section.
3. **Phase 2.5**: asset library as planned (now also feeds founder-avatar work).
4. **Phase 3**: build WITH the upgrades in §2 (frameworks file, hook-first, wording rule, volume defaults).
5. **Phase 4**: build WITH §3 (format hierarchy, tool/cost routing, imperfection prompts, founder avatars).
6. **Phase 5**: flywheel as planned + Iteration Engine (§4).
7. **Phase 6**: Media Buying Copilot (§5) — needs Meta Marketing API access (system user token per ad account); start read-only.
