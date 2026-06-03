# Klassekart — design notes

Guardrails so new surfaces (statistics view, avatars, badges, chair indicator)
cohere with the existing app instead of drifting. This is a *light* design
vocabulary, not a rulebook. Source of truth for values is `:root` in
`klassekart.css` — reference tokens, don't hard-code hexes.

## Tokens (already defined)
| Token | Value | Use |
|---|---|---|
| `--primary` | `#4f46e5` (indigo) | brand, primary actions, selection |
| `--primary-dark` | `#4338ca` | primary hover |
| `--primary-soft` | `#eef0fe` | selected fills, soft chips, focus ring |
| `--accent` | `#f59e0b` (amber) | sparing emphasis only |
| `--danger` | `#e11d48` | destructive / "never" |
| `--ok` | `#16a34a` | success / "always" |
| `--ink` / `--ink-soft` | `#1f2233` / `#5b6072` | text / muted text |
| `--line` | `#e4e6f0` | borders, separators |
| `--surface` / `--bg` | `#fff` / `#f4f5fb` | cards / page |
| `--radius` / `--radius-sm` | 14 / 9 px | cards & modals / controls |
| `--shadow` / `--shadow-lg` | — | resting / modal elevation |
| gender boy / girl | `#60a5fa` / `#f472b6` | gender accent (left border / inset) |

## Component vocabulary (reuse these; don't reinvent)
- **Buttons** — `.btn` (neutral, 1px line, radius-sm, 600 weight), `.btn-primary`
  (indigo), `.btn-lg`. Icon-only: `.icon-btn` (38px square).
- **Chips** — `.chip` (pool student), `.member-chip` (checkbox pill, fills
  `--primary` when checked), `.rule-chip` (`.must` solid indigo / `.should` soft).
- **List rows** — `.rule-row` / `.history-row` (flex, `#f7f8fc` fill, 1px line,
  9px radius). `.rule-row.editing` = indigo border + soft ring. New list rows
  (e.g. stats rows) should match this shape.
- **Badges** — `.tok-badge` (front/back/lock/must) on seat tokens.
- **Modals** — `.modal` (520px) / `.modal-wide` (640px) with `.modal-head` /
  `.modal-body` / `.modal-foot`. **Stats should use `.modal-wide`** (or a new
  full-screen variant if it outgrows that).
- **Toasts** — `.toast` `.ok` / `.err`.
- **Selection ring convention** — `box-shadow: 0 0 0 3px var(--primary-soft)` +
  `border-color: var(--primary)`. Reuse for any new selected state.

## New systems to add (specs)

### Avatar (hashed initial)
Reusable identity cue — roster, stats, and always/never chips.
- Circle, initial of name, colour chosen deterministically from the name
  (stable hash → fixed palette index) so a student always reads the same colour.
- Palette: a fixed set of ~8 accessible fills with matching readable text
  colour (define as a small CSS/JS table; keep WCAG-legible).
- Sizes: ~28px (lists/chips) and a larger token variant if used on the board.
- Keep the existing **gender accent** (left border / inset bar) — avatar colour
  is identity, the accent stays gender. Don't overload colour to mean both.

### Stats view (built next, with the frontend-design skill)
- Live in a `.modal-wide` (or dedicated full screen) using the tokens above.
- Charts/matrix derive their palette from `--primary` (sequential scale) with
  `--danger`/`--ok` reserved for "never/always paired" emphasis.
- Reuse `.rule-row`-style rows for ranked lists (most/least paired).
- Aim distinctive, not the generic shadcn/Radix look peers share.

### Badge count
- Small count pill (e.g. on the rules button): solid `--primary`, white text,
  ~18–20px, top-right. One utility class, reused.

## Conventions
- Reference tokens, never raw hexes, in new CSS.
- BEM-ish flat class names matching existing style (`.block`, `.block-part`,
  `.block.state`). No utility-class soup.
- Norwegian UI copy (Bokmål), matching existing labels.
