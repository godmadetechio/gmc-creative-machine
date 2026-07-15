# Static Ad Frameworks

Proven static ad layouts (AI_ADS_TRAINING_INTEGRATION.md §2a). This file seeds
the global `format_library` and is read by Phase 3 concept agents as the layout
source. The worker seeder parses the exact
`##` / `**Description:**` / `**Psychology:**` / `**Skeleton:**` structure below —
keep it when editing, and never add double-curly-brace placeholders
(loadPrompt throws on any it can't resolve). An optional `**Detection:**`
line (text | visual | both, default text) marks formats the text-only
extractor cannot confirm — 'visual' formats are exempt from fading.

## Us vs Them
**Description:** Two-column comparison of the old way (or competitors as a category) versus the product's way.
**Psychology:** Contrast effect — the buyer self-sorts into the losing column and wants out. Positions the product as the obvious upgrade without naming competitors, and pre-frames the evaluation criteria in your favor.
**Skeleton:**
- Header: "Them" vs "Us" (or old way vs new way)
- 3-5 paired bullets, each pair one pain → one relief
- Visual cues: ✗ on the left column, ✓ on the right
- Product shot or logo anchored to the "Us" side
- CTA under the winning column

## Bold Claim
**Description:** One oversized, confident statement fills the creative, with minimal supporting elements.
**Psychology:** Pattern interrupt through sheer typographic confidence — a big specific promise stops the scroll and dares the reader to disagree. Specificity ("in 21 days", "without ads") does the believability work.
**Skeleton:**
- Single dominant headline, 5-10 words, takes 60%+ of the canvas
- Optional one-line qualifier or proof point underneath
- Brand mark small in a corner
- High-contrast background, little to no imagery

## iPhone Notes
**Description:** The ad is a screenshot of a note in the iPhone Notes app (or a text-message thread) — plain text, native UI.
**Detection:** visual
**Psychology:** Native camouflage — it reads as a friend's note, not an ad, so ad-blindness never triggers. The lo-fi format signals authenticity and makes claims feel like private advice rather than marketing.
**Skeleton:**
- Notes-app (or iMessage) UI chrome: title bar, timestamp
- Short personal-sounding list or confession, 4-8 lines
- One idea per line; casual punctuation, no marketing-speak
- Optional single emoji or checklist ticks
- No logo inside the note; CTA lives in the ad copy below

## Features + Benefits
**Description:** Product image annotated with callout lines, each feature paired with the outcome it delivers.
**Psychology:** Bridges the "so what?" gap — every spec is translated into a life improvement. Annotated diagrams borrow the credibility of technical documentation while staying skimmable.
**Skeleton:**
- Hero product shot centered
- 3-6 callout lines pointing at parts of the product
- Each callout: feature name + the benefit it buys ("aerospace aluminum → survives every drop")
- Optional social-proof strip (stars, review count) at the bottom
- CTA button or price anchor

## Before / After
**Description:** Split-frame showing the state before the product and the state after.
**Detection:** visual
**Psychology:** Visualized transformation — the buyer sees the gap between their current self and desired self, and the product is the bridge. The most primal proof format: outcomes, not arguments.
**Skeleton:**
- Two panels side-by-side (or top/bottom), labeled "Before" / "After"
- Same subject, same framing, one changed variable
- Timeframe or condition caption ("Week 1 → Week 6")
- Product placed at the seam or in the After panel
- One-line claim tying the change to the mechanism

## The Offer
**Description:** The deal itself is the creative: price, discount, bundle, or guarantee rendered like a coupon or price tag.
**Psychology:** For bottom-funnel buyers the only remaining question is "what's the deal?" — leading with the offer removes friction and triggers loss aversion (limited time, save X) directly.
**Skeleton:**
- Dominant offer statement: "%-off", bundle, free-gift, or trial terms
- Strikethrough old price next to new price
- Deadline or scarcity line ("ends Sunday")
- Product imagery secondary, behind or beside the numbers
- Risk reversal near the CTA ("free returns", "money-back guarantee")

## Testimonial Card
**Description:** A real customer quote styled as a review card or social post screenshot, star rating included.
**Psychology:** Social proof transfers trust — a peer's verbatim words are believed where the brand's words are discounted. The review-card visual borrows the credibility of third-party platforms.
**Skeleton:**
- 5-star row on top
- Short punchy quote (1-3 sentences) in large type, ideally with a specific result
- Customer name/initials + context ("verified buyer", city, use case)
- Product thumbnail or brand mark small at the bottom
- Optional platform chrome (Trustpilot/Google/Twitter styling)

## Question Hook
**Description:** The creative leads with a direct question aimed at the target's pain or identity.
**Psychology:** Questions open a curiosity loop the brain wants closed, and a well-aimed question makes the target self-identify ("that's me") — the copy does the audience targeting.
**Skeleton:**
- Big headline question naming the pain or audience ("Still doing payroll by hand?")
- Optional second line teasing the answer or mechanism
- Supporting visual dramatizing the pain or the relieved after-state
- CTA framed as the answer ("See how →")

## N Reasons Why
**Description:** A numbered list — "7 reasons why X" or "5 signs you need Y" — laid out as the ad itself.
**Detection:** visual
**Psychology:** Numbered lists promise finite, skimmable value (a known cognitive shortcut), and each reason is another hook — one of N will land on any given reader. Odd, specific numbers read as researched, not rounded.
**Skeleton:**
- Headline: number + promise ("6 reasons runners are switching to ___")
- Numbered list, each item one short benefit or proof point
- Highlight or emphasize 1-2 items visually
- Product image beside or beneath the list
- CTA closing the list ("See reason #7 →" works as a curiosity gap)

## Sticky Note
**Description:** A handwritten-style note on a sticky note (or torn paper/whiteboard), photographed as if left for the reader.
**Detection:** visual
**Psychology:** Handwriting signals a human, effortful, personal message — the opposite of polished ad craft — which disarms skepticism. Feels like a reminder you wrote yourself, so the message is adopted, not evaluated.
**Skeleton:**
- Single sticky note (or scrap of paper) fills the frame, slightly rotated
- 1-2 handwritten lines: a reminder, confession, or tip
- Casual imperative voice ("cancel the gym, try this")
- Real-world backdrop: laptop, fridge, mirror
- No logo on the note; branding stays in the ad copy/CTA
