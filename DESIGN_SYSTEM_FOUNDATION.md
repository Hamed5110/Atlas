# Design System Foundation

Date: 2026-07-09  
Step: 4  
Stack assumption: React + Next.js App Router

## 4.1 Selected component architecture

Approved option: **Option A - Headless UI + Tailwind-style token architecture**

Implementation direction:
- Keep the current React + Next.js structure
- Use Headless UI interaction patterns where helpful
- Keep styling token-driven and debuggable
- Preserve the existing CSS-variable backbone already present in legacy and `/v2`
- Avoid replacing backend-connected workflow logic during this phase

Why this fits the app:
- gives us full layout control for dense ERP/HCM screens
- keeps clickability debugging straightforward
- works well with the existing custom field and modal logic
- lets us build a polished admin shell without hiding behavior inside a heavy component abstraction

## 4.2 Approved theme variants

All themes remain available for user selection.  
Default production theme: **Light Professional**

### Theme 1 - Light Professional
- Role: default enterprise day mode
- Usage: finance, HR, registers, daily admin work
- Background: cool white to pale slate gradient
- Surface tone: white glass / low-noise layering
- Accent family: ATLAS blue

Preview values:
- App background: `linear-gradient(180deg, #fbfdff 0%, #f3f7fb 100%)`
- Surface: `rgba(255, 255, 255, 0.92)`
- Primary text: `#0f172a`
- Accent: `#0b63f6`
- Danger: `#e11d48`

### Theme 2 - Dark Professional
- Role: low-glare admin mode
- Usage: long sessions, monitoring, after-hours review
- Background: ink navy to deep slate
- Surface tone: layered dark glass
- Accent family: cool electric blue

Preview values:
- App background: `linear-gradient(180deg, #081120 0%, #10192b 100%)`
- Surface: `rgba(15, 23, 42, 0.92)`
- Primary text: `#e6edf8`
- Accent: `#5aa2ff`
- Danger: `#fb7185`

### Theme 3 - High Contrast
- Role: accessibility-first mode
- Usage: high-separation reading, validation, QA
- Background: white to light neutral
- Surface tone: sharp edge definition
- Accent family: cobalt

Preview values:
- App background: `linear-gradient(180deg, #ffffff 0%, #f6f6f6 100%)`
- Surface: `rgba(255, 255, 255, 0.98)`
- Primary text: `#000000`
- Accent: `#0047ff`
- Border: `rgba(0, 0, 0, 0.88)`

### Theme 4 - Emerald Command
- Role: branded operational mode
- Usage: approvals, workflow screens, admin control areas
- Background: cool mint neutral
- Surface tone: clean white with emerald framing
- Accent family: emerald / teal

Preview values:
- App background: `linear-gradient(180deg, #f4fcf9 0%, #edf7f3 100%)`
- Surface: `rgba(255, 255, 255, 0.94)`
- Primary text: `#0d1720`
- Accent: `#047857`
- Support accent: `#0f766e`

### Theme 5 - Slate Executive
- Role: neutral executive review mode
- Usage: reporting, company admin, maintenance screens
- Background: pale slate
- Surface tone: bright professional cards
- Accent family: slate / indigo

Preview values:
- App background: `linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)`
- Surface: `rgba(255, 255, 255, 0.94)`
- Primary text: `#111827`
- Accent: `#334155`
- Support accent: `#4f46e5`

## 4.3 Design token foundation

### Approved visual token contract
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

### Current `/v2` token backbone already present
- `--v2-bg-app`
- `--v2-surface`
- `--v2-surface-strong`
- `--v2-surface-muted`
- `--v2-text`
- `--v2-text-muted`
- `--v2-border`
- `--v2-border-strong`
- `--v2-accent`
- `--v2-accent-strong`
- `--v2-danger`
- `--v2-shadow`
- `--v2-shadow-raised`
- `--v2-ring`

Conclusion:
- We are not inventing a new theme engine from scratch.
- We are formalizing and extending the token system already in production and `/v2`.

## 4.4 Spacing scale

| Token | Size | Primary use |
|---|---:|---|
| `space-1` | 4px | inline icon/text micro gaps |
| `space-2` | 8px | chip spacing, tight row gaps |
| `space-3` | 12px | default control gaps |
| `space-4` | 16px | card padding baseline |
| `space-5` | 20px | grouped controls |
| `space-6` | 24px | section spacing |
| `space-7` | 32px | panel separation |
| `space-8` | 40px | page band spacing |
| `space-9` | 48px | large desktop breathing room |

Supporting layout constants:
- sidebar width target: `248px`
- topbar minimum touch height: `64px`
- desktop shell outer gap: `12px` to `16px`
- standard control height: `42px`

## 4.5 Typography scale

| Token | Size | Weight | Use |
|---|---:|---:|---|
| `text-xs` | 12px | 600 | pills, helper labels, metadata |
| `text-sm` | 14px | 400/500 | table body, form body |
| `text-md` | 16px | 500/600 | controls, primary body text |
| `text-lg` | 18px | 600 | compact card titles |
| `text-xl` | 22px | 700 | section headings |
| `text-2xl` | 30px | 800 | page titles |
| `text-3xl` | 42px | 800 | hero-only summary surfaces |

Language support:
- English UI: Inter / Segoe UI / system sans
- Arabic UI: Cairo for interface text
- Formal print output: Amiri where document tone requires it

## 4.6 Elevation scale

| Token | Use | Character |
|---|---|---|
| `elevation-0` | embedded rows / flat register zones | no lift |
| `elevation-1` | standard cards | soft shadow |
| `elevation-2` | sticky bars / active surfaces | raised |
| `elevation-3` | dialogs / menus / drawers | strongest overlay |
| `elevation-press` | pressed buttons | compressed tactile depth |

Interaction guidance:
- primary actions use accent fill plus shallow tactile depth
- secondary actions stay outlined and quiet
- danger actions stay restrained, never oversized
- sticky bars must not overlap content hit areas
- footer cards must not sit on top of nav items
- modals must preserve full action visibility on mobile and desktop

## 4.7 Theme preview matrix

| Theme | Best fit | Contrast mood | Default status |
|---|---|---|---|
| Light Professional | daily operations | bright / balanced | **Default** |
| Dark Professional | long admin sessions | low-glare | Optional |
| High Contrast | accessibility / QA | sharp | Optional |
| Emerald Command | branded approvals | calm operational | Optional |
| Slate Executive | reporting / admin | neutral premium | Optional |

Live preview routes already available:
- `/v2/theme/light-professional`
- `/v2/theme/dark-professional`
- `/v2/theme/high-contrast`
- `/v2/theme/emerald-command`
- `/v2/theme/slate-executive`

## Step 4 outcome

Approved and locked for Step 5:
- Architecture: **Option A**
- Default theme: **Light Professional**
- User-selectable alternatives: all five themes remain enabled

## STOP checkpoint

Awaiting user approval before Step 5 shell work continues.
