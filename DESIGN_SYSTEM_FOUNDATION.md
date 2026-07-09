# Design System Foundation

Date: 2026-07-09
Step: 4
Stack assumption: React + Next.js App Router

## 4.1 Selected component architecture

Recommended option: **Option B — Shadcn/Radix**

Reasoning:

- best fit for a high-density admin/product workflow
- strong accessibility defaults for dialogs, dropdowns, popovers, tabs, and menus
- easier to stabilize clickability and focus behavior than custom-only patterns
- works well with the existing token-based CSS variable system
- allows us to keep a polished enterprise UI without locking the app into a heavy component framework

Fallback compatibility:

- Existing custom components such as `Field`, `SelectField`, `InlineFieldError`, `AirportSearchField`, and modal flows can be merged gradually into this architecture.

## 4.2 Theme variants

The app already has a good token backbone. We should formalize it into the following 5 theme variants.

### Theme 1 — Light Professional

- Purpose: default enterprise day mode
- Mood: clean, high-legibility, restrained
- Background: soft cool white / pale slate
- Surface: white + low-glass overlays
- Accent: strong atlas blue
- Best for: finance, HR, report-heavy use

Preview:

- App background: `#f5f7fb`
- Main surface: `#ffffff`
- Primary text: `#07111f`
- Accent: `#0b63f6`
- Danger: `#e11d48`

### Theme 2 — Dark Professional

- Purpose: low-glare night/admin mode
- Mood: calm, serious, premium
- Background: ink blue / charcoal
- Surface: deep layered slate
- Accent: electric blue
- Best for: power users, monitoring, long sessions

Preview:

- App background: `#0b1220`
- Main surface: `#111827`
- Primary text: `#e5eefb`
- Accent: `#0b63f6`
- Danger: `#fb7185`

### Theme 3 — High Contrast

- Purpose: accessibility-first visual mode
- Mood: crisp, explicit, high separation
- Background: near-white or near-black depending on scheme
- Surface: strong border contrast
- Accent: saturated cobalt / amber signal states
- Best for: visibility-sensitive users and testing

Preview:

- App background: `#ffffff`
- Main surface: `#ffffff`
- Primary text: `#000000`
- Accent: `#0047ff`
- Border: `#111111`

### Theme 4 — Brand Color 1: Emerald Command

- Purpose: trust-oriented operational theme
- Mood: controlled, modern, steady
- Background: soft mint-tinted neutral
- Surface: white / light glass
- Accent: emerald with teal support
- Best for: workflow screens, approvals, policy modules

Preview:

- App background: `#f3fbf8`
- Main surface: `#ffffff`
- Primary text: `#0b1720`
- Accent: `#047857`
- Support accent: `#0f766e`

### Theme 5 — Brand Color 2: Slate Executive

- Purpose: neutral executive/admin skin
- Mood: quiet, structured, premium
- Background: pale slate
- Surface: white / smoky panels
- Accent: slate with indigo support
- Best for: company admin, reports, system maintenance

Preview:

- App background: `#f6f8fb`
- Main surface: `#ffffff`
- Primary text: `#111827`
- Accent: `#334155`
- Support accent: `#4f46e5`

## Proposed token contract

These are the design tokens we should standardize across all variants:

- `--bg-app`
- `--surface`
- `--surface-elevated`
- `--surface-glass`
- `--text-primary`
- `--text-muted`
- `--text-inverse`
- `--border-subtle`
- `--border-strong`
- `--accent-primary`
- `--accent-secondary`
- `--accent-danger`
- `--accent-success`
- `--shadow-soft`
- `--shadow-elevated`
- `--shadow-extruded`
- `--control-height`
- `--radius-card`
- `--radius-control`
- `--sidebar-width`
- `--topbar-height`
- `--page-gap`
- `--card-padding`

## 4.3 Spacing scale

Recommended spacing rhythm:

| Token | Size | Use |
|---|---:|---|
| `space-1` | 4px | tight icon spacing, inline micro-gaps |
| `space-2` | 8px | compact list gaps, chip spacing |
| `space-3` | 12px | standard control gaps |
| `space-4` | 16px | card internal spacing |
| `space-5` | 20px | major control groups |
| `space-6` | 24px | section spacing |
| `space-7` | 32px | panel separation |
| `space-8` | 40px | page band spacing |
| `space-9` | 48px | large desktop section spacing |

## Typography scale

Recommended hierarchy:

| Token | Size | Weight | Use |
|---|---:|---:|---|
| `text-xs` | 12px | 600 | helper text, pills, metadata |
| `text-sm` | 14px | 400/500 | form body, table body |
| `text-md` | 16px | 500/600 | controls, primary body |
| `text-lg` | 18px | 600 | compact card titles |
| `text-xl` | 22px | 700 | section titles |
| `text-2xl` | 30px | 800 | page title |
| `text-3xl` | 42px | 800 | hero-style overview only |

Font direction support:

- English UI: Inter / Segoe UI Variable / system sans
- Arabic UI: Cairo for interface, Amiri only for formal document/print contexts

## Elevation scale

| Token | Use | Character |
|---|---|---|
| `elevation-0` | flat table rows / embedded form groups | no lift |
| `elevation-1` | standard cards | soft shadow |
| `elevation-2` | active cards / sticky bars | stronger lift |
| `elevation-3` | dialogs / menus / drawers | dominant overlay |
| `elevation-press` | buttons while active | compressed tactile state |

## Interaction guidance

- Primary actions use solid accent surfaces with tactile press depth
- Secondary actions use neutral outlined controls
- Dangerous actions use restrained red, not oversaturated warning slabs
- Sticky action bars should not overlap content hit areas
- Sidebar footer cards must never sit on top of nav rows
- Modals should have fixed action footers only when content padding guarantees no overlap

## 4.4 Theme preview recommendation

Best default starting point for `/v2` shell:

1. **Light Professional** for default production theme
2. **Dark Professional** as the first alternate
3. **Emerald Command** as the strongest branded admin variant

## Decision needed before Step 5

Please select:

- Component architecture:
  - `B` Shadcn/Radix (recommended)
  - `A` Headless UI + Tailwind
  - `C` your preferred stack

- Default launch theme:
  - `Light Professional` (recommended)
  - `Dark Professional`
  - `High Contrast`
  - `Emerald Command`
  - `Slate Executive`

## STOP checkpoint

Awaiting user theme and architecture approval before Step 5.
