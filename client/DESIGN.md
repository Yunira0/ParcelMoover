---
name: ParcelMoover Ops Console
description: A calm, high-signal command center for running courier operations and vendor self-service in one system.
colors:
  rust-signal: "#c2410c"
  rust-invert: "#ffedd5"
  ink: "#030712"
  slate-caption: "#4b5563"
  slate-placeholder: "#6b7280"
  border-gray: "#d1d5db"
  elevated-gray: "#e5e7eb"
  canvas-gray: "#f3f4f6"
  surface-white: "#ffffff"
  success-green: "#15803d"
  warning-olive: "#a16207"
  danger-red: "#dc2626"
  danger-red-deep: "#b91c1c"
  danger-red-chip: "#991b1b"
  info-blue: "#1d4ed8"
typography:
  title:
    fontFamily: "Inter, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "32px"
  body:
    fontFamily: "Inter, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  caption:
    fontFamily: "Inter, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  label:
    fontFamily: "Inter, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.04em"
rounded:
  sm: "2px"
  default: "4px"
  md: "6px"
  lg: "8px"
  modal: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  "0.5": "2px"
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.rust-signal}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.rust-signal}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    height: "36px"
  button-danger:
    backgroundColor: "#fef2f2"
    textColor: "{colors.danger-red-deep}"
    rounded: "{rounded.default}"
    padding: "8px 12px"
    height: "36px"
  status-chip-solid:
    rounded: "{rounded.full}"
    padding: "4px 8px"
    typography: "{typography.label}"
  input-field:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "8px"
    height: "36px"
---

# Design System: ParcelMoover Ops Console

## 1. Overview

**Creative North Star: "The Control Tower"**

This is the room where you watch parcels, money, and people move — pickup to dispatch to delivery to settlement — and every screen exists to keep that view legible at a glance. The system is calm and low-noise by design: white surfaces, cool gray structure, and a single rust-orange signal color reserved for what actually needs attention. It rejects anything that would compete with the data — no gradients, no decorative color, no shadow-heavy "showcase" chrome. Internal ops staff and vendor users share this same tower; whichever seat they're in, the room should feel identically calm, precise, and fast.

**Key Characteristics:**
- One warm signal color (rust) against an otherwise cool, neutral palette
- Borders do the separating; shadows are rare and reserved for things that truly float
- Dense, compact controls (36px height) built for repeated use, not for browsing
- Status is always color- and shape-coded (outline vs. solid chips) so state reads before text does

## 2. Colors

A cool, quiet neutral system with exactly one warm accent — rust is the only color allowed to say "look here."

### Primary
- **Rust Signal** (`#c2410c`): the single primary-action and brand color — primary buttons, active nav/tab state, links, focus rings, brand mark. Used sparingly and consistently as the system's one "act now" color.
- **Rust Invert** (`#ffedd5`): the on-primary tint, used for subtle highlighted backgrounds behind rust content (e.g. selected states) rather than as a background in its own right.

### Neutral
- **Ink** (`#030712`): default body and heading text, default icons — the darkest neutral in the system.
- **Slate Caption** (`#4b5563`): secondary/caption text and icons — labels, helper text, table captions.
- **Slate Placeholder** (`#6b7280`): placeholder text and inactive icon states.
- **Border Gray** (`#d1d5db`): the default 1px border/divider color used everywhere surfaces meet.
- **Elevated Gray** (`#e5e7eb`): table headers and other "raised" flat surfaces that need to read as a distinct layer without a shadow.
- **Canvas Gray** (`#f3f4f6`): the page background every card/table/panel sits on top of.
- **Surface White** (`#ffffff`): cards, tables, modals, inputs — anything meant to read as "content," not "canvas."

### Status colors
- **Success Green** (`#15803d`) / surface `rgb(21 128 61 / 10%)`: completed, delivered, settled states.
- **Warning Olive** (`#a16207`) / surface `rgb(161 98 7 / 10%)`: held, pending, needs-review states.
- **Danger Red** (`#dc2626`, text `#b91c1c`, chip `#991b1b`): failed, returned, lost & damaged, destructive actions.
- **Info Blue** (`#1d4ed8`) / surface `rgb(29 78 216 / 10%)`: informational, in-transit, neutral-notice states.

### Named Rules
**The One Warm Color Rule.** Rust is the only warm hue in the system. If a new screen needs a second accent, reach for status color (green/amber/red/blue) or a deeper/lighter step of gray — never a second warm hue competing with rust for attention.

## 3. Typography

**Body/UI Font:** Inter (with system-ui, 'Segoe UI', Roboto, sans-serif fallback)
**Mono Font:** ui-monospace, Consolas, monospace (reserved for tabular/code-like values, not currently a primary role)

**Character:** One typeface, weight and size carry all the hierarchy — a dashboard that needs to be scanned in seconds, not read for pleasure. No display serif, no decorative pairing; consistency is the point.

### Hierarchy
- **Title** (700, 24px, 32px line-height): page and section headings (`PageHeader`).
- **Body** (500, 14px, 20px line-height): the default weight for table cells, buttons, and most UI text — medium weight throughout keeps a dense screen from feeling flimsy.
- **Caption** (400, 12px, 16px line-height): helper text, form labels, secondary metadata.
- **Label** (600, 12px, 16px line-height, 0.04em tracking, uppercase): table column headers and solid status chips — the one place uppercase + tracking is used, reserved for structural labels, not body copy.

### Named Rules
**The Medium-Weight Rule.** Body text defaults to 500 (medium), not 400 (regular). In a dense operational UI, regular weight reads as too light against gray borders and small control heights; medium is the true default.

## 4. Elevation

Flat by default, separated by 1px borders rather than shadows — tables, sidebar, cards, and panels all use `border: 1px solid var(--color-border-default)` to distinguish themselves from the canvas. Shadows exist in the token set (`shadow-sm/md/lg`) but are reserved for things that genuinely float above the page: modals, dropdown menus, and the app header's ambient separation from content behind it. If a component isn't floating over other content, it should be bordered, not shadowed.

### Shadow Vocabulary
- **shadow-sm** (`0 1px 2px rgb(3 7 18 / 6%)`): minimal separation, rarely used alone.
- **shadow-md** (`0 4px 6px -1px rgb(3 7 18 / 10%), 0 2px 4px -2px rgb(3 7 18 / 6%)`): dropdowns, popovers.
- **shadow-lg** (`0 8px 24px rgba(0,0,0,0.12)`): modals and other overlay surfaces.
- **shadow-focus** (`0 0 0 2px rgb(194 65 12 / 12%)`): the rust focus ring, used on focused inputs/controls instead of the browser default.

### Named Rules
**The Border-Not-Shadow Rule.** If two surfaces are on the same visual plane (a table inside a page, a card in a grid), separate them with a border. Reach for shadow only when a surface is meant to be perceived as physically above the content behind it.

## 5. Components

Every control is sized for repeated, rapid use: compact (36px), precise, and quiet — the chrome should never be the most interesting thing on the screen.

### Buttons
- **Shape:** 4px radius (`--border-radius-default`), 36px height at default size, 28-ish auto height at `sm`.
- **Primary** (`btn-primary`): rust background, white text, rust border — the one "do this" action per view.
- **Secondary** (`btn-secondary`): white background, default gray border, ink text — the default, most-used button.
- **Outline** (`btn-outline`): white background, rust border and text; inverts to solid rust on hover.
- **Ghost** (`btn-ghost`): no background or border, caption-gray text — for low-emphasis inline actions.
- **Danger** (`btn-danger`): danger-surface background and border, darkening on hover — destructive actions only.
- **Hover / Focus:** hover states shift background/border per variant (see CSS above); disabled state drops to 60% opacity and blocks the pointer.

### Status Chips
- **Outline variant:** thin `currentColor` border, sentence-case text, `xs` size — used for order/dispatch/return statuses that appear inline with other text.
- **Solid variant:** bold uppercase pill, no border, tinted background per tone — used for settlement/active-style statuses that need to stand out at a glance.
- **Tone mapping:** success (green), info (blue), warning (olive), danger (red), neutral (gray) — tone is the only signal; never rely on color alone without the accompanying label text.

### Tables
- **Container:** white surface, 1px default-gray border, `--border-radius-modal` (8px) corners, horizontal scroll on overflow.
- **Header row:** elevated-gray background, uppercase caption-gray label text, bottom border — reads as a distinct structural layer without a shadow.
- **Body rows:** white background, 1px bottom border between rows, medium-weight ink text, generous 68px min row height for scanability.

### Inputs / Fields
- **Style:** 1px default-gray border, 4px radius, white background, 36px height, `sm` body text.
- **Label:** caption-gray, medium weight, sits above the field; required fields get a danger-red asterisk.
- **Focus:** replaces default outline with the rust `shadow-focus` ring.
- **Textarea:** same treatment, vertical-resize only, 72px minimum height.

### Navigation (Sidebar)
- **Style:** white surface, right border, collapsible from 256px to 56px with a 0.2s width transition.
- **Toggle:** small (28px) bordered icon button, default-gray border, background/color shift on hover.
- **Active/hover states:** follow the same rust-signal convention as buttons — active item takes the rust accent, nothing else does.

## 6. Do's and Don'ts

### Do:
- **Do** keep rust (`#c2410c`) as the only warm color in the system — every other accent need is a status color or a gray step.
- **Do** separate same-plane surfaces (tables, cards, panels) with a 1px `border-gray` border, not a shadow.
- **Do** default body/UI text to medium weight (500) at 14px — this system does not use regular-weight body text.
- **Do** keep controls compact (36px height, 4px radius) — density and speed are core to "efficient, precise, trustworthy."
- **Do** pair a status chip's tone with its text label; never ship color as the only signal.

### Don't:
- **Don't** introduce a second warm accent color (a second orange, a gold, a warm red-orange) — it competes with rust and breaks the One Warm Color Rule.
- **Don't** add drop shadows to tables, sidebars, or cards that sit flat on the canvas — reserve shadow for modals, dropdowns, and true overlays.
- **Don't** use gradients, glassmorphism, or decorative blur anywhere in this system — it is an operations tool, not a marketing surface, and PRODUCT.md's guardrail is clarity and speed over visual flourish.
- **Don't** widen controls or add whitespace "for elegance" — this is a high-volume daily-use tool where density is a feature, not a compromise.
- **Don't** use light/thin body text or low-contrast gray-on-white for anything a user must read to do their job (amounts, statuses, addresses).
