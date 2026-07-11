---
target: homepage (client/src/pages/Home.tsx)
total_score: 13
p0_count: 2
p1_count: 2
timestamp: 2026-07-10T07-59-50Z
slug: client-src-pages-home-tsx
---
Method: dual-agent (A: abd8f33cd4032c7d1 · B: af95917df0fb5447f)

## Design Health Score

Nielsen's 10 heuristics scored 0-4. Three are genuinely not applicable (n/a) to a single static marketing hero with no forms/async state.

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | CTA gives no interactive feedback on hover; feels inert until clicked. |
| 2 | Match System / Real World | 3/4 | Plain, sector-appropriate copy ("Register your business," "Vendor Partner"). |
| 3 | User Control and Freedom | 1/4 | No secondary path for a not-yet-ready visitor — no "learn more," no preview of requirements before `/apply`. |
| 4 | Consistency and Standards | 2/4 | Spacing/type tokens match the system, but the page invents two CSS variable names that don't exist anywhere in `tokens.css`. |
| 5 | Error Prevention | n/a | No form/input on this page. |
| 6 | Recognition Rather Than Recall | 3/4 | Nothing to remember; stat cards even over-repeat the benefits list. |
| 7 | Flexibility and Efficiency | n/a | Single first-visit marketing screen; no power-user path applies. |
| 8 | Aesthetic and Minimalist Design | 2/4 | Clean at a glance, but 2 of 3 stat cards are redundant and 2 CSS bugs mean the shipped page doesn't match its own intended design. |
| 9 | Error Recovery | n/a | No error states possible on a static page. |
| 10 | Help and Documentation | 0/4 | Zero contact info, FAQ, or "how it works" link anywhere on the page or shared footer. |
| **Total** | | **13/28 applicable** | **Poor-to-Acceptable border** — low scores concentrated in trust/control/help, not a broad failure |

Most real interfaces score 20-32/40. This page's applicable-heuristic average (≈1.9/4) sits well below that even accounting for the three n/a's — it's a single hero doing one job, and it isn't fully doing it.

## Anti-Patterns Verdict

**Yes, this reads as AI-made** — not from one gaudy effect, but from template scaffolding plus unedited content.

**LLM assessment (Assessment A)**: Two classic tells are present verbatim — a tiny uppercase tracked eyebrow badge (`.home-badge`: 12px, 600 weight, 0.04em tracking, uppercase, pill radius) and the hero-metric template, tripled (`.home-stat-card`/`.home-stat-number`/`.home-stat-label`, a 24px/800-weight number over a 12px caption, repeated three times). To its credit, the page avoids gradient text, glassmorphism, side-stripe borders, and numbered 01/02/03 markers entirely — the more garish tells were held back. The real fingerprint is editorial, not visual: two of three stat cards near-verbatim restate two of three benefit checkmarks above them ("50+ Districts" → "50+ Districts Covered", "24h Onboarding" → "24h Quick Onboarding") — evidence the benefits list and stats block were generated as disconnected passes with no unifying edit.

**Deterministic scan (Assessment B)**: `detect.mjs --json` against both `Home.tsx` and `Home.css` returned zero findings (exit 0, `[]` both times). This is a coverage gap, not a clean bill of health: non-HTML files route through the lighter regex-based engine rather than the full DOM/computed-style engine, and the one path that would exercise that fuller engine — a live Puppeteer URL scan of `http://localhost:5173/` — failed with `Error: puppeteer is required for URL scanning. Install: npm install puppeteer`, which isn't installed anywhere in the repo. No interactive browser tool was exposed in this session either, so no visual overlay could be presented. **The detector's zero findings should not be read as "clean" — it simply couldn't see what Assessment A found by reading source directly.**

**Where they agree / where one caught what the other missed**: The detector caught nothing; Assessment A caught two real, verifiable correctness bugs the detector's rule set has no signature for at all — undefined CSS custom properties. `.home-badge` references `var(--color-background-info-subtle)` and `var(--color-text-info)`, neither of which exists in `tokens.css` (the real tokens are `--color-info-surface` / `--color-info-text`) — so the badge is currently rendering with a transparent background and inherited gray text, not the intended tinted-blue pill. Separately, `.home-benefit svg` references `--color-success-default`, which also doesn't exist (`tokens.css` only defines `--color-background-success-default`) — the same wrong name is reused in `VendorFormPage.css`, `RiderFormPage.css`, and `AdminFormPage.css`, so it's a systemic token-file gap, not a Home-only typo. Neither is a "false positive" concern in the other direction; there's nothing to flag as a detector overreach since the detector found nothing at all this run.

**Visual overlays**: Not available this run. No browser automation tool is exposed in this session, and the bundled Puppeteer dependency the detector needs for URL-mode rendering isn't installed. Fallback signal only — no `[Human]` tab overlay to point you to.

## Overall Impression

The page clears the bar on the more obvious AI-slop tells (no gradients, no glassmorphism, no fake numbered sections) but fails at the one job a vendor-recruitment landing page actually has: building enough trust for a skeptical small-business owner to hand over their business details to a company that will be holding their money and parcels. Two of the three "proof" stat cards are redundant restatements of the benefits list above them, there's no contact channel or rate transparency anywhere, and — this is the sharpest finding — two of the CSS custom properties this page relies on for its trust-building color cues (the badge tint, the reassurance-green checkmarks) don't exist in the codebase's actual token file, so the page is not even rendering as designed. The single biggest opportunity: fix the two broken tokens first (they're one-line CSS fixes with outsized visual impact), then replace the redundant stat card with real proof.

## What's Working

- **Restraint on the worst slop tells**: no gradient text, no glassmorphism, no decorative side-stripe borders, no fake 01/02/03 section numbering — genuinely absent, which is the harder discipline to hold.
- **Token discipline where it does work**: spacing, radius, and font-size values are pulled from the shared design system rather than hardcoded, so structurally the page belongs to the same product.
- **Sensible responsive staging**: breakpoints at 768px (stack + center + full-width CTA) and 480px (stat cards go full-column) show real consideration for mobile, not a desktop-only afterthought.

## Priority Issues

**[P0] Badge renders broken due to undefined CSS variables**
- **Why it matters**: `Home.css:23-24` reference `--color-background-info-subtle` / `--color-text-info`, which don't exist anywhere in `tokens.css`. The "Nepal's Delivery Network" badge — the very first thing a visitor reads — is currently rendering as plain gray text with no background instead of the intended tinted-blue pill.
- **Fix**: Swap to the tokens that actually exist: `var(--color-info-surface)` and `var(--color-info-text)` (defined in `tokens.css:37-38`).
- **Suggested command**: `/impeccable polish` (client/src/pages/Home.css)

**[P0] Primary CTA has no hover or focus state**
- **Why it matters**: `.home-cta-button` is an `<a>` styled with `.btn-primary`, which defines no `:hover` rule (`Button.css:30-34`), and the app's one global hover/focus rule (`index.css:70-77`) is scoped to the `button` element, not `a`. The single conversion action on the page looks inert on hover and falls back to the browser's default blue focus ring on keyboard focus — clashing with the system's own documented rust `shadow-focus` convention used everywhere else.
- **Fix**: Add `.btn-primary:hover` / `:focus-visible` rules (darker rust background + the system's `--shadow-focus` ring) so this CTA behaves like every other primary button in the product.
- **Suggested command**: `/impeccable polish` (client/src/components/Button.css)

**[P1] Zero trust/proof content for a page recruiting people into a money-handling relationship**
- **Why it matters**: No testimonials, vendor names, rate transparency, or contact channel exist on this page or the shared footer, despite `PRODUCT.md` confirming this system handles COD/settlements. A skeptical small-business owner has nothing to substantiate "competitive rates" or "reliable support" beyond the page's own say-so.
- **Fix**: Add at least one concrete proof element (a named/quoted vendor, a sourced stat, or a direct contact line) before the CTA.
- **Suggested command**: `/impeccable clarify` (client/src/pages/Home.tsx — copy and proof content)

**[P1] Two of three stat cards duplicate the benefits list above them**
- **Why it matters**: "50+ Districts Covered" and "24h Quick Onboarding" restate "50+ Districts" and "24h Onboarding" two components above with no new information — reads as unedited generated output rather than considered content, and wastes a scarce trust-building slot.
- **Fix**: Replace at least one duplicate stat with genuinely new proof (active vendor count, average settlement turnaround, COD collection reliability).
- **Suggested command**: `/impeccable distill` (client/src/pages/Home.tsx)

**[P2] Undefined `--color-success-default` token breaks trust-signal checkmarks systemically**
- **Why it matters**: `Home.css:66` uses a token absent from `tokens.css` (only `--color-background-success-default` exists), so the three reassurance checkmarks render in inherited ink-black instead of green. The same wrong name is reused in `VendorFormPage.css`, `RiderFormPage.css`, and `AdminFormPage.css` — fixing the token file once fixes four files.
- **Fix**: Add `--color-success-default` to `tokens.css` (or repoint the four files at the correct existing token).
- **Suggested command**: `/impeccable harden` (client/src/styles/tokens.css)

**[P3] Hardcoded `<br />` mid-headline is brittle across viewports**
- **Why it matters**: `<h1>Become a<br />Vendor Partner</h1>` forces a fixed two-line break regardless of viewport width or future copy edits, rather than letting natural wrap handle it.
- **Fix**: Drop the manual break; let the existing `max-width` container wrap naturally.
- **Suggested command**: `/impeccable adapt` (client/src/pages/Home.tsx)

## Persona Red Flags

**Jordan (skeptical small-business owner / first-timer)**: Lands, reads three generic sentences and three numbers. The badge meant to establish credibility ("Nepal's Delivery Network") is rendering wrong — flat gray text, no blue tint — so the first trust cue simply isn't there. The reassurance checkmarks intended as confident green ticks render in plain black for the same reason. No pricing, no proof anyone real uses this, no contact number to ask a question first. The only next step is "click through and hand over business details." Jordan bounces or hesitates exactly where the page needed to convert.

**Riley (deliberate stress tester)**: Layout doesn't structurally break at 320-480px — the 768/480 breakpoints handle stacking reasonably. But `.home-hero-visual { min-height: calc(100vh - 120px) }` bakes in a guessed 120px header height that doesn't match the actual `.public-header` (padding: 16px top/bottom around one row) — an unverified magic number, not a value tied to the real rendered header. At 200% text zoom, the fixed `<br />` plus the fixed 48px CTA height risk clipping or an awkward two-line recombination, since nothing here was built to reflow past its assumed sizes. The sharpest thing Riley finds isn't a viewport issue at all: the two invalid `var()` references are a stress-test finding independent of screen size.

**Deepak (vendor owner — derived from `PRODUCT.md`'s stated secondary/co-equal audience)**: A real small-business owner in Nepal deciding whether to hand parcels and money to a new courier partner. Not a tech power user; evaluates on trust and concrete numbers, not design polish. Scans for proof before clicking through, looks for a phone/WhatsApp line to ask a question before committing business details, and mentally compares "competitive rates" against his existing courier relationship — a claim this page never substantiates. Red flags: no rate transparency, no contact channel anywhere on the page or footer, and the two broken trust-signal colors (badge tint, checkmark green) mean the page isn't even shipping the confidence cues it was designed to show him.

## Minor Observations

- `MainLayout.css` applies both a `border-bottom` and the ambient `--app-shadow` to the public header — a shadow not part of `DESIGN.md`'s documented vocabulary (`shadow-sm/md/lg/focus`), so the shell around this page already drifts from the documented elevation system before `Home.tsx` renders.
- The shared footer contains only a copyright line — no links, no contact, no legal/terms — for a page whose entire job is recruiting external partners.
- Once fixed, `.home-badge` would be the only use of the info-blue tone on this page — worth confirming that an operational "informational" status color is the right semantic choice for a marketing eyebrow versus a neutral gray tag.

## Questions to Consider

- If this page's only job is converting skeptical vendors, why does it contain zero proof a skeptic couldn't dismiss as "just marketing copy" — what's the cheapest real proof point available today?
- This system handles COD and settlements per `PRODUCT.md` — should the vendor-recruitment page be the one surface explicitly designed to build financial trust before commitment, rather than inheriting the ops-tool visual language built for people who already trust the system enough to use it daily?
- `DESIGN.md` explicitly states this is "an operations tool, not a marketing surface" — given Home.tsx is the one genuinely marketing page in the product, should it intentionally diverge more from the ops token system rather than inheriting tokens 1:1, several of which don't even correctly resolve for its own needs?
