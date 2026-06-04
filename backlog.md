# Klassekart — backlog

Ideas and planned work, roughly in build order. Inspiration drawn from looking at
peer apps (e.g. klassekartet.no) — concepts only, our own implementations.

## Where we already stand (parity or ahead)
- Weighted **Må/Bør** rules (most peers are strict-only — we're ahead here)
- OR-set rules ("ved siden av én av"), editable rules
- Geometric cluster-aware adjacency (pairs/pods/rows/U + manual clusters)
- Lock seats, drag & drop, undo/redo, saved chart history
- Mix-gender, avoid-last-partner, room presets + manual desk editing

## Build order

### 1. Statistics (next major goal)
Cumulative, per-class data over the whole `state.history`, surfaced in a stats
view with **data visualizations** to surface patterns. Aim to be *more powerful
than peer apps'*. Research-grounded — see `docs/research.md`.

Two headline questions frame the dashboards:
- **"Is the classroom a good environment to be in?"** (relational/belonging climate)
- **"Are we actually getting work done?"** (engagement/productivity)

Decisions made:
- Track **adjacency AND co-group separately**, viewable combined or separate.
- **Saving a chart is required** (no auto-snapshot) — keeps capture intentional.
- Pursue the **full toolset** across the three data layers below.

Three data layers:
- **Derived (frictionless):** pairing matrix (adjacency + co-group), never-sat-
  together, social reach / isolates, most-least paired, coverage %, front/back
  equity, gender/tag balance over time.
- **Teacher input (opt-in):** per-chart rating on the two headline questions +
  notes ✅ (Phase 2 — rate in Historikk; surfaced as «Lærervurdering» indicators
  + a trend in stats).
  - Phase 2b student preference input ✅ (per-student ⚙︎ editor: sit-with &
    avoid wishes [soft in placement], quiet/space, belonging 1–5). Surfaced as
    «Elevtrivsel» + «Ønsker oppfylt nå» indicators.
  - Phase 2c tag-based grouping ✅ (per-student 🏷️ tags; «Spre merkelapper»
    pref spreads same-tag students across co-groups; «Merkelapp-klumping» stat).
  - ✅ PHASE 2 COMPLETE (ratings + student preferences + tag grouping).
- **Imported (sensitive):** teacher–student **Relationship Mapping** data
  (green/yellow/red/white, both directions) to flag students lacking a positive
  adult relationship and prompt staff mindfulness. ✅ PHASE 3 COMPLETE — see
  DATA-PROTECTION NOTE for the decisions taken.

Visualizations: pairing heatmap matrix, relationship/network graph, coverage &
climate trend lines, front/back equity bars, relationship-map grid.

### 1b. "Aims → tips" section (research-backed)
Teacher picks what they're aiming for (e.g. broaden relationships, reduce
disruption, support an isolated student, heterogeneous grouping, strengthen
belonging) → gets actionable, cited tips + concrete in-app actions (e.g. seat X
with someone new, rotate back-row forward). Content library keyed to aims,
decoupled from the data plumbing. Sourced from `docs/research.md`.

### DATA-PROTECTION NOTE (decisions taken — Phase 3)
Relationship-mapping data = sensitive personal data about minors (GDPR /
personopplysninger). Decisions and how they were built:
- **Full matrices**, both directions (lærer→elev and elev→lærer).
- **Encrypted at rest** with AES-GCM, key derived from a passcode via PBKDF2
  (150k iters, SHA-256). The passcode *is* the gate — it decrypts the data.
  Forgotten passcode = unrecoverable (by design). Implemented in `klassekart.js`
  (`relEncrypt`/`relDecrypt`/`relPersist`).
- **Separate localStorage key** `klassekart_rel`, independently wipeable
  («Slett alt» / «Glemt kode – slett alle data»).
- **Excluded from the JSON backup by default**; opt-in checkbox bundles it as
  *ciphertext* only (`klassekart_rel_inbackup`).
- **Both import paths**: bulk paste/CSV (tab/comma/semicolon, auto-adds teachers
  & matches students by name) + per-student manual editing (click matrix cells).
- Surfaced as the «Positiv voksenrelasjon» indicator in stats (lock-aware:
  shows 🔒 when locked, a setup prompt when no data). Support tool, not the
  system of record — stated in-modal.

Possible follow-ups: a dedicated relationship-grid visualization in the Mønstre
tab; auto-lock on idle; per-class passcodes (currently one passcode for all).

### 2. Two-tier avoid-repeat ✅ DONE
- Keep current **avoid last arrangement's neighbours** (`avoidRepeat`).
- ✅ Added **avoid ALL past neighbours** (`avoidAllRepeat`): counts how many saved
  charts each pair shared, penalty = count×10, so repeat partners are avoided
  more strongly and never-paired students are favoured. Checkbox in Regler.

### 3. One-time rules vs permanent rules — ❌ WON'T DO (decided)
Rejected: a rule that self-deletes on generation/session-end is a footgun — a
user error (regenerating, or a mis-timed session end) could silently wipe rules
the teacher meant to keep. Tweaking rules between sessions is cheap and visible,
which is safer. Revisit only if a concrete need appears.

### 4. Same-gender-together preference
- Inverse of mix-gender; group by gender. Small `prefs` addition + scorer term.

## Visual / UI polish (after the above, or bundled with a UI pass)
- **Chair / seat-orientation indicator** ✅ DONE: grey disc behind the desk, one
  edge poking out on the side the student sits. Auto-orientation (`seatChairDirs`):
  2-D tight clusters (pods, horseshoe) face the cluster centre → chairs outward;
  1-D runs (side-by-side pairs, columns) and lone desks face the board → chairs to
  the back. Mirrored in the PNG/PDF export. ✅ Manual rotate override: in
  desk-edit mode, click a chair to snap it to the next *free* edge
  (`rotateChair` / `chairAllowedEdges` — edges jammed tight against another desk
  are excluded; aisle/row gaps count as free). Override stored per-seat
  (`seat.chair`), survives save & room templates, and auto-reverts if a later
  desk move blocks that edge.
- **Coloured initial-avatars** per student (hashed from name) — identity cue,
  reusable as chips in always/never-with lists.
- Per-student **always/never-with** shown inline as avatar chips with quick-add.
- Rules button **count badge** (number of active rules).
- Per-desk **rotate** + **flip room** + grow grid from any side.

## UI approach (decided)
No full overhaul. Path:
1. **Light design audit / guardrails** — done, see `docs/design-notes.md`.
2. **Build the statistics view with the frontend-design skill** — biggest new
   surface; make it distinctive, built on the design-notes vocabulary.
3. **Harmonize older screens as features land** (avatars, badges, chair), then
   optionally one consolidation pass at the end.
