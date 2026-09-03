# Plan 17 — Deferred work from the 15.5 pass (not yet implemented)

This plan collects everything from the 15.5 cleanup pass and the 15.5 external
review that was **identified but not implemented** in 15.5, plus the items that
the 15.5 plan itself explicitly punted on with the label "defer / out of scope."

It does **not** supersede `16.1-plan-add-diffusion-engine.md` — that file
already tracks T1–T6 for the diffusion engine (A, B, E, F from the 15.5 review).
Items that overlap with 16.1 are cross-referenced rather than duplicated.

## Source of every item

| Item | Origin | Where it is now |
|------|--------|-----------------|
| A. Test 11b can't discriminate transient vs steady-state | 15.5-review §A | Resolved via 16.1 T2 |
| B. `S` has no `dt`; α does double duty | 15.5-review §B | Resolved via 16.1 T1 |
| E. Diffusion has no dipole support | 15.5-review §E | Resolved via 16.1 T3 |
| F. 40-line duplicated publish block | 15.5-review §F | Resolved via 16.1 T4 |
| Per-magnet `edgeIsSelf` comment drift | 15.5-plan-fix §⚠️ Defer | **NEW — open** |
| Misleading energy residual under field-only engines | 15.5-plan-fix §⚠️ Defer | **NEW — open** |
| Plan 16 acceptance criteria unmet (Test 5d + new block) | 15.5-plan-fix §⚠️ Defer | 16.1 T6 covers Test 5d; the "new block" remains **open** |
| `magBzPoissonHy3.js` lazy globals (`magSrcSelfHy3`/`magBzSelfHy3`) | 15.5-plan-fix §⚠️ Defer | **NEW — open** |
| Naming drift (`MAG_SWEEPS_PER_FRAME` / `FIELD_SWEEPS_PER_FRAME` / `magLastDv`) | 15.5-plan-fix §⚠️ Defer | **NEW — open** |
| `state.js:402` 1-tab indent in 2-tab `\|\|` chain | 15.5-plan-fix §⚠️ Defer | **NEW — open** |

Closed review items (15.5-review §C, §D, §G and §H through §L) are **not**
re-listed here — they were either landed in 15.5 (C, D, G, I, K, L) or were
reviewer-side misreads (H) that 15.5 already rebutted in its preamble.

---

## Status at a glance

| Item | State |
|------|-------|
| A. Transient discrimination test (15.5-review §A) | ✅ in 16.1 T2 |
| B. `dt`-separated source + `MAG_SRC_GAIN_DIFF` (15.5-review §B) | ✅ in 16.1 T1 |
| E. Diffusion dipole decision (15.5-review §E) | ✅ in 16.1 T3 |
| F. Shared `magPublishTelemetry` (15.5-review §F) | ✅ in 16.1 T4 |
| Per-magnet `edgeIsSelf` comment drift | ❌ open (17-T1) |
| Energy residual honesty under field-only engines | ❌ open (17-T2) |
| Plan-16 "new block" in `test_magdiff.js` (beyond 5d) | ❌ open (17-T3) |
| Hy3 lazy-global cleanup (`magSrcSelfHy3`/`magBzSelfHy3`) | ❌ open (17-T4) |
| Naming-drift unification | ❌ open (17-T5) |
| `state.js:402` indent cosmetic | ❌ open (17-T6) |

---

## 17-T1 — `edgeIsSelf` per-magnet comment drift

**File:** `js/electric.js` (~line 467 area). The 15.5 plan flagged: the
comment claims Hy3 has no per-magnet variants; in fact Hy3 *does* use per-magnet
self-field buffers (`magSrcSelfHy3`, `magBzSelfHy3`). This is a pure-comment
fix, but the surrounding paragraph describes a subtle invariant (the legacy
"force comes from the rails, not the bridge" convention) and needs a careful
rewrite rather than a one-line replacement.

**Why now:** the 16.1 refactor (T4) moves the per-magnet scan into the shared
`telemetry` helper, so the wording about "no per-magnet variants" becomes
actively false. Cleaning the comment first lets T4 delete the paragraph cleanly.

## 17-T2 — Energy-residual honesty under field-only engines

**File:** `js/electric.js` (around the `residual` computation, near line 1480).

The 15.5 plan flagged: the energy residual is computed but does not close under
the field-only engines (`hy3`, `diffusion`) because **neither injects back-EMF
into `e.E`**. The number is misleading — it looks like a convergence
diagnostic but it is in fact a stale residual from the last time the active
solver was a closed-circuit engine.

**Decision options:**

1. **Gate the residual.** Only report `residual` when `activeEngine === 'field'` *and* the active `magEngine` injects back-EMF (today: none). When the gate is closed, either omit the value or print `"n/a (field-only engine)"`.
2. **Inject back-EMF into both engines** so the residual becomes meaningful again. Requires an analytic back-EMF helper (`magInjectEmfAnalytic`) and a Phase-2 plan; this is the same shape as the 16.1 "Out of scope" back-EMF note.

**Recommend option 1 for 17** (honest, small surface); promote option 2 to a
future plan.

**Why it can't regress:** the residual is already only a logged/sidebar
display value — no physics, no save-format, no assertion uses it. Verified by
grep.

## 17-T3 — Plan-16 "new block in `test_magdiff.js`"

The 15.5 plan listed "adding `Test 5d` (solenoid) **and** a new block in
`test_magdiff.js`" as part of Plan-16 acceptance. 16.1 covers Test 5d (T6) and
the 11a/b/c discrimination block (T2). The 15.5 plan's wording implies a
*separate* additional block beyond 11a/b/c — that is, a block exercising the
engine-switch round-trip and the `scheduleFieldRecompute()` wiring in `ui.js`.

**Concrete spec (proposed; confirm before executing):**

- **`test_magdiff` 11d — engine switch round-trip + K_B slider wiring.** With
  the rail scene from Test 10, drag `K_B` from `1.0` to `2.0` while
  `magEngine='diffusion'` and assert `lastFcoil` doubles to within tolerance
  (`<5%`). Then drag back to `1.0` and assert it returns. Same as the
  cross-engine round-trip (11c) but for the *non-magnet live circuit* branch
  the 15.5 #3 added (the `else if (electricActive()) scheduleFieldRecompute()`
  arm). Without a magnet, the field must still re-solve.

**Why it can't regress:** the K_B slider already has the call (15.5 #3
landed). This test only confirms the wiring fires.

## 17-T4 — Hy3 lazy-global cleanup

**File:** `js/magBzPoissonHy3.js`.

`magSrcSelfHy3` / `magBzSelfHy3` are declared with `let … = null` then
re-allocated inside `Publish`. Functional but cosmetic — re-reading the file
makes the lazy-init look like a bug (every call re-checks `!buf || buf.length
!== N` and possibly re-allocates). Move the allocation next to the existing
non-self buffers (`fieldBz`, `magSrcHy3`) so the lazy-init pattern is one
place per buffer, and document the lifetime (allocated once in `Reset`,
never freed for the session).

**Why it can't regress:** no behaviour change; only initialisation order and
comment text. Test 10b/c/11c cover the runtime behaviour.

## 17-T5 — Naming-drift unification

**Files:** `js/electric.js`, `js/state.js`, `js/ui.js`, `js/maze.js` (TBD by grep).

Three names for the same concept coexist:

- `MAG_SWEEPS_PER_FRAME`
- `FIELD_SWEEPS_PER_FRAME`
- `magLastDv` (the *one-step* voltage delta the field solver uses)

The 15.5 plan flagged this as cosmetic-only. Concrete proposal: pick
`FIELD_SWEEPS_PER_FRAME` (the most descriptive, matches the 4-way `field*`
naming introduced by the engine split), rename the others to match, and rename
`magLastDv` → `fieldLastDv` while we're in the area.

**Why it can't regress:** pure rename; the only risk is missing a usage site.
Mitigation: grep for all three names across the repo before editing, run the
full suite after.

## 17-T6 — `state.js:402` indent cosmetic

**File:** `js/state.js` line 402.

One line uses a 1-tab indent inside a 2-tab `||` chain — purely cosmetic.
Visual proof: re-indent the chain to the same 2-tab depth as the rest.


---

## Execution order (lowest risk first)

1. **17-T1** (`edgeIsSelf` comment) — prerequisite for the 16.1 T4 refactor
   not overwriting stale wording. Do before 16.1 T4 lands.
2. **17-T2** (energy-residual honesty) — pure logging change; do alongside
   16.1 T1/T4 because both touch `js/electric.js`.
3. **17-T4** (Hy3 lazy-global) — local, cosmetic; do at any time.
4. **17-T6** (indent) — trivial; bundle with T4 or any other `state.js` edit.
5. **17-T3** (11d test) — small test-authoring task; do with the 16.1 test
   work so the engine-switch coverage is committed together.
6. **17-T5** (naming) — last; largest blast radius (cross-file rename). Run
   the full suite before/after.

## Validation

For each task that touches code, run:

```
node js/test_solenoid.js
node js/test_magdiff.js
node js/test_piston_pump.js
node js/test_electric_demo.js
node js/test_scene_copy.js
node js/test_heat.js
node js/test_air.js
```

All existing assertion counts must stay green. 17-T3 adds 1 assertion block
(magdiff 11d). 17-T1, T2, T4, T5, T6 add zero.

## Out of scope (explicit non-goals)

- Back-EMF injection under field-only engines (option 2 of 17-T2) — needs its
  own plan because it requires an analytic helper and changes the closed-loop
  dynamics of the active solver.
- Diffusion dipole injector with self-subtraction — recorded in 16.1 T3 as
  Phase-2.
- A "diffusion speed" slider throttling `MAG_SWEEPS_PER_FRAME` — UX decision
  deferred.
- Benchmarking diffusion vs. the other three engines — needs a benchmark
  harness that doesn't exist yet.
- Closing the 15.5-review items C, D, G, H, I, J, K, L — all already handled
  in 15.5 (C, D, G, I, K, L) or rebutted in 15.5's preamble (H, J).