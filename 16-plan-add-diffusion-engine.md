# Plan 15: Add a fourth selectable magnetic engine — `diffusion`

## Context

`main` currently exposes three selectable magnetic engines via
`magEngine` in `js/state.js`:

| Value          | Module                       | Notes                                                         |
|----------------|------------------------------|---------------------------------------------------------------|
| `'tapered'`    | `js/electric.js` (inline)    | Analytic-tapered diffusion. Source = discrete Laplacian of the MAG_RANGE-windowed Biot–Savart field. Relaxed by red-black Gauss–Seidel. **Was internally called `'diffusion'` / `'ar'` — being renamed to `'tapered'` in this plan.** |
| `'hy3'`        | `js/magBzPoissonHy3.js`      | Hy3 screened-Poisson (∇² − λ²) Bz = S, with self-field cancellation. **File being renamed from `js/magfield_diffusion.js`.** |
| `'direct'`     | `js/electric.js` (inline)    | Legacy Biot–Savart sum, hard `MAG_RMAX=8` cutoff. Obsolete, kept for regression. |

There is a hidden naming conflict: the analytic engine is *currently*
reached by setting `magEngine = 'diffusion'` (or `'ar'`), because
`electric.js:1258` only branches on `'direct'` and `'hy3'` and falls
through to the Ar solver for everything else. The two
`magEngine = 'diffusion'` assignments in `js/test_solenoid.js` (lines
356 and 370) exploit that fallthrough. **This plan resolves the
collision by renaming the Ar engine to `'tapered'` and reserving
`'diffusion'` for the new engine.**

The new engine is a true transient cell-to-cell magnetic diffusion:
it advances `∂Bz/∂t = α · ∇² Bz + S` with an explicit forward-Euler
update, so the field actually spreads between cells over successive
iterations rather than converging silently to a steady-state
solution.

## Goal

A fourth engine value, **`magEngine = 'diffusion'`**, selectable from
the UI alongside `'tapered'`, `'hy3'`, and `'direct'`. When selected:

1. Source term `S` is the **discrete curl of the edge currents**,
   computed in the new file by iterating over `fieldEdges` (same
   approach Hy3 uses for its own source). No reuse of Ar's
   `magSrc` / `magSrcCells` (which hold the *Laplacian of the
   analytic field*, not the curl of J).
2. The Bz grid is advanced by **explicit forward-Euler diffusion**:
   ```
   Bz'[i,j] = Bz[i,j] + α · (Bz[i-1,j] + Bz[i+1,j] + Bz[i,j-1] + Bz[i,j+1] − 4·Bz[i,j]) + S[i,j]
   ```
   `MAG_SWEEPS_PER_FRAME` iterations per frame, like the other
   engines. Each iteration is exactly one diffusion step; no
   `while` / `until-converged` loops.
3. The user-tunable knob **α** (diffusion rate) binds to the
   existing `#magRange` slider under `diffusion`. Range
   `0.02 ≤ α ≤ 0.25`, step `0.01`. Default `α = 0.20` (CFL-safe
   for 2D explicit diffusion: `4·α < 1`).
4. The new engine becomes the **default** on page load.
5. No back-EMF under this engine in this plan (mirrors Hy3 Phase 1).
6. Engine-switch resets clear the engine's Bz buffer, like the
   others.

## Renames performed in this plan (precondition for the new engine)

These are required to clear the name collision so `'diffusion'` is
free. They are mechanical, behavior-preserving changes.

- `js/magfield_diffusion.js` → **`js/magBzPoissonHy3.js`**.
  All exported functions renamed:
  - `magDiffusionBuildSource` → `magBzPoissonHy3BuildSource`
  - `magDiffusionRelax`      → `magBzPoissonHy3Relax`
  - `magDiffusionPublish`    → `magBzPoissonHy3Publish`
  - `magDiffusionReset`      → `magBzPoissonHy3Reset`
  All references updated in `js/electric.js`, `js/ui.js`,
  `js/test_magdiff.js`, `js/test_solenoid.js`, the test-sandbox
  `files` arrays, and the `<script>` tag in `index.html`.

- Ar engine value: `magEngine = 'ar'` (and the fallthrough for
  `'diffusion'`) → **`magEngine = 'tapered'`** in `js/state.js`.
  All callers in `js/ui.js`, `js/test_magdiff.js`,
  `js/test_solenoid.js` updated. The two legacy
  `magEngine = 'diffusion';` lines in `js/test_solenoid.js` (356
  and 370) become `magEngine = 'tapered';`.

After the renames, the four engine values are unique and the
dispatch can be a clean 4-way switch.

## Non-goals

- Not a refactor of any existing engine's math.
- No back-EMF (`e.E`) injection on the new engine in this plan.
- No `magInjectEmfAnalytic` shared-helper extraction (Phase-2 work,
  prerequisite for adding back-EMF to either `hy3` or `diffusion`).
- No benchmark or perf comparisons.
- No removal of `'tapered'`, `'hy3'`, or `'direct'`.

## Tasks (ordered)

1. **Rename Hy3 file + exports** (mechanical, behavior-preserving).
   - `git mv js/magfield_diffusion.js js/magBzPoissonHy3.js`.
   - Inside the file: rename the four `function magDiffusionX`
     declarations to `magBzPoissonHy3X`. Update the top-of-file
     comment to use the new module name.
   - In `js/electric.js:1266-1268`: call
     `magBzPoissonHy3BuildSource / Relax / Publish` instead of the
     old names.
   - In `js/electric.js` `magReset()` and the `typeof` guard
     (around line 882): update the guard to
     `typeof magBzPoissonHy3Reset === 'function'`.
   - In `js/ui.js` slider `oninput` (line 745): same rename.
   - In `index.html`: `<script src="js/magBzPoissonHy3.js">`.
   - In `js/test_magdiff.js`: rename calls in Test 10a/b/c and
     the new Test 11.
   - In `js/test_solenoid.js` Test 5c: rename calls.
   - In test sandbox `files` arrays: replace
     `'js/magfield_diffusion.js'` with `'js/magBzPoissonHy3.js'`.
   - Spot check: `rg 'magDiffusion(Reset|Relax|Build|Publish)\b' js/`
     must return **zero** matches after the rename.

2. **Rename Ar engine value `'ar'` → `'tapered'`**.
   - `js/state.js:178`: `let magEngine = 'tapered';`. Update the
     three-bullet comment block above it to use the new name.
   - `js/state.js` `magName` ternary (line 507-509): rewrite to
     match the four-engine world (see task 5).
   - `js/ui.js:700-734`: replace the `'ar'` branch in
     `magEngineOnChange` and the `logger` ternary with
     `'tapered'`.
   - `js/electric.js:1004-1012` (EMF site) and
     `js/electric.js:1258-1273` (field-advance site): replace
     the implicit `else` (which is Ar) with an explicit
     `else if (magEngine === 'tapered')` branch. See task 5.
   - `js/test_magdiff.js` Test 1 + the `~7 'ar'`/`'diffusion'`
     literals: change to `'tapered'` where the test is using
     "the Ar engine" and to `'diffusion'` only when the test
     is testing the new engine.
   - `js/test_solenoid.js` Test 1 (default-assertion) and
     Tests 5a/5b: change `'ar'`/`'diffusion'` to `'tapered'`.
   - Spot check: `rg "'ar'|'diffusion'" js/test_` must return
     zero matches in tests (other than the new Test 11).

3. **Create the new engine module** — new file
   `js/magfield_diffusion.js` (reclaiming the original name now
   that Hy3 has moved out):
   - Top-of-file comment identifying it as the `diffusion`
     engine and contrasting it with `tapered` (steady-state
     analytic) and `hy3` (screened-Poisson).
   - Allocate per-instance buffers, namespaced to avoid
     collisions with Hy3's `fieldBz` and Ar's `fieldBz`:
     - `let fieldBzDiff = null;`        // the engine's Bz
     - `let fieldBzDiffScratch = null;` // swap buffer
     - `let magSrcDiff = null;`         // curl-J source
   - Export the four dispatch functions:
     - `magDiffusionBuildSource()` — clears `magSrcDiff`, then
       iterates `fieldEdges` to compute the discrete curl of
       each edge's current at its two endpoint cells. The
       curl for a horizontal edge `(a,b)` with `dlx, dly`
       and current `I` injects at `a` and `b`:
       `S[ny * W + nx] += K_B * I * dlx` (or `dly`,
       matching the sign convention of Hy3's
       `magBzPoissonHy3BuildSource` to keep the force
       polarity consistent). Magnet self-edges are skipped
       via `edgeIsSelf(e, mags[mi])`, matching Hy3.
     - `magDiffusionRelax(sweeps)` — runs `sweeps` iterations
       of:
         ```
         for each (i,j) interior cell:
             nb = Bz[i-1,j] + Bz[i+1,j] + Bz[i,j-1] + Bz[i,j+1]
             scratch = Bz + α·(nb − 4·Bz) + S
         swap(scratch, Bz)
         ```
       Uses the inner-cell loop skipping the Dirichlet border
       (cells on row 0/col 0/last row/last col stay 0), same
       boundary convention as Ar's relaxation. **No
       convergence check, no `while`-loop** — exactly
       `sweeps` iterations per frame.
     - `magDiffusionPublish(mags)` — copies `fieldBzDiff` into
       the shared `fieldBz` (so the renderer and status bar
       see it) and updates magnet telemetry
       (`m.lastBz`, `m.lastFcoil`, etc.) by sampling
       `fieldBzDiff[bodyCenter cell]`. Telemetry readback
       matches Hy3's `magBzPoissonHy3Publish` so
       `m.lastBz` is meaningful under any engine.
     - `magDiffusionReset()` — zeros `fieldBzDiff`,
       `fieldBzDiffScratch`, `magSrcDiff`.
   - Tune constants at the top:
     ```js
     let MAG_DIFFUSION_ALPHA = 0.20;   // 0.02–0.25; CFL: 4·α < 1
     ```
   - Clamp `α ≤ 0.25` on entry to `magDiffusionRelax` and
     `console.warn` (don't throw) if a caller sets it higher.
     Defense in depth — the slider cap is the primary guard.

4. **Wire it into `index.html`** — add `<script
   src="js/magfield_diffusion.js"></script>` immediately after
   `<script src="js/magBzPoissonHy3.js"></script>` so the
   dependency order is: state → electric → hy3 engine →
   diffusion engine → air/network/render.

5. **Add a tuning constant to `js/state.js`** alongside the
   existing `MAG_LAMBDA` / `MAG_DIPOLES` block:
   ```js
   let MAG_DIFFUSION_ALPHA = 0.20;     // 'diffusion' engine: per-step diffusion rate
   ```
   Add a fourth bullet to the engine-selection comment block
   describing the new engine.

6. **Change the default engine to `'diffusion'`** in
   `js/state.js`:
   ```js
   let magEngine = 'diffusion';
   ```
   Update the `magName` status-bar label to a 4-way ternary
   (drop the `magEngine === 'ar'` branch, add
   `magEngine === 'diffusion'`):
   ```js
   const magName = magEngine === 'direct' ? 'Direct (obsolete)'
                 : magEngine === 'hy3'     ? 'Diffusion-Hy3 (screened)'
                 : magEngine === 'tapered' ? 'Diffusion-Ar (tapered)'
                 :                           'Diffusion (visual relaxation)';
   ```

7. **Restructure the dispatch in `js/electric.js`** — replace
   the two implicit `else` branches with full 4-way switches:
   - **EMF site (~line 1004-1012)**: only `direct` and
     `tapered` inject back-EMF; `hy3` and `diffusion` get
     no `e.E` write. The cleanest restructure is:
     ```js
     if (mags.length) {
         if (magEngine === 'tapered') {
             magBuildEdgeCells();
             magBuildCoupling(mags);
             magApplyEmfDiffusion(mags);   // Ar's analytic-EMF (now only on 'tapered')
         } else if (magEngine === 'direct') {
             magApplyEmfDirect(mags);
         }
         // 'hy3' and 'diffusion': no back-EMF in this plan
     }
     ```
   - **Field-advance site (~line 1258-1273)**: full 4-way:
     ```js
     if (magEngine === 'direct') {
         magSolveDirect(mags, Ngrid);
     } else if (magEngine === 'tapered' && (mags.length || colorView === 'bfield')) {
         magSolveDiffusion(mags, MAG_SWEEPS_PER_FRAME);
     } else if (magEngine === 'hy3' && (mags.length || colorView === 'bfield')) {
         magBzPoissonHy3BuildSource();
         magBzPoissonHy3Relax(MAG_SWEEPS_PER_FRAME);
         magBzPoissonHy3Publish(mags);
     } else if (magEngine === 'diffusion' && (mags.length || colorView === 'bfield')) {
         magDiffusionBuildSource();
         magDiffusionRelax(MAG_SWEEPS_PER_FRAME);
         magDiffusionPublish(mags);
     }
     ```
   - **Reset** — extend `magReset()` to clear the new
     engine's buffers:
     ```js
     if (typeof magBzPoissonHy3Reset === 'function') magBzPoissonHy3Reset();
     if (typeof magDiffusionReset === 'function') magDiffusionReset();
     ```

8. **Extend the UI selector and slider** in `index.html` and
   `js/ui.js`:
   - In the existing `<select id="magEngineSel">` replace
     the `ar` option with `tapered` (`<option value="tapered">Diffusion-Ar (tapered)</option>`)
     and add a new
     `<option value="diffusion" selected>Diffusion (visual relaxation)</option>`.
     `selected` matches the new default. Keep `hy3` and
     `direct` as they are.
   - In `magEngineOnChange`:
     - Replace the existing `'ar'` branch with
       `'tapered'` (slider `min=2`, `max=16`, `step=1`;
       bind to `MAG_RANGE`; `#magEmitAll` visible,
       `#magDipoles` hidden; no engine reset other than
       `magReset()`).
     - Add the `'diffusion'` branch: slider
       `min=0.02`, `max=0.25`, `step=0.01`, bind to
       `MAG_DIFFUSION_ALPHA`; hide BOTH `#magEmitAll`
       AND `#magDipoles` labels (this engine has neither
       a dipole toggle nor an emit-all toggle); call
       `magDiffusionReset()` on change.
   - In `#magRange`'s `oninput` handler:
     ```js
     if (magEngine === 'hy3')       { MAG_LAMBDA = v; if (typeof magBzPoissonHy3Reset === 'function') magBzPoissonHy3Reset(); }
     else if (magEngine === 'diffusion') { MAG_DIFFUSION_ALPHA = v; magDiffusionReset(); }
     else if (magEngine === 'tapered')   { MAG_RANGE = v; }
     else                           { /* 'direct' — slider is disabled/hidden */ }
     ```
   - Update the `logger` tag ternary to use `'tapered'`
     and add `'diffusion'`.

9. **Update tests** — three buckets of changes:
   - **Default-assertion flips** (since default is now
     `'diffusion'`):
     - `js/test_magdiff.js` Test 1:
       `assert(getRef('magEngine') === 'diffusion', ...)`;
       and the rest of Test 1's cross-engine probes use
       `'tapered'` instead of `'ar'`.
     - `js/test_solenoid.js` Test 1: same.
   - **`'ar'` → `'tapered'` literal replacement** in
     `js/test_magdiff.js` and `js/test_solenoid.js` (the
     tests that previously pinned "Ar" to `'ar'`).
   - **Hy3 function-rename updates** in `js/test_magdiff.js`
     Test 10a/b/c and `js/test_solenoid.js` Test 5c
     (`magDiffusionX` → `magBzPoissonHy3X`).
   - **Add a new Test 11** in `js/test_magdiff.js` titled
     `== 11. Diffusion visual-relaxation engine ==` with
     three subtests:
     - **11a** — rail scene, `magEngine = 'diffusion'`,
       `MAG_DIFFUSION_ALPHA = 0.20`, run `fieldSimulate()`
       once. Assert `pistons[0].lastBz` is finite and
       non-zero, `fieldBz` has non-zero peak.
     - **11b** — `MAG_DIFFUSION_ALPHA = 0.20` vs `0.05` on
       the same rail scene. After the same number of
       sweeps, the **peak under α=0.20 should be LOWER
       than the peak under α=0.05** (higher α spreads
       energy faster, so the peak decays faster per
       iteration). This is the test that proves the
       diffusion is real: an instant Poisson solve would
       give equal peaks.
     - **11c** — round-trip back to `'tapered'` cleanly
       (`magReset()` succeeds, next `fieldSimulate()`
       produces a finite force). The default test
       scaffolding already round-trips, this just
       confirms the new engine's buffers don't leak into
       the `tapered` engine.
   - **Add a Test 5d** in `js/test_solenoid.js` after
     Test 5c: L-loop scene, `magEngine = 'diffusion'`,
     `MAG_DIFFUSION_ALPHA = 0.20`, settle 40 frames,
     assert force is finite and same-sign as `tapered`'s.
     Do **not** assert byte-equality.

10. **Update sandbox `files` arrays** in
    `js/test_electric_demo.js`, `js/test_piston_pump.js`,
    `js/test_scene_copy.js`: replace
    `'js/magfield_diffusion.js'` with
    `'js/magBzPoissonHy3.js'` and add
    `'js/magfield_diffusion.js'` (the new engine) after
    the Hy3 file in the list.

11. **Validation** — all must pass before merge:
    ```
    node js/test_solenoid.js
    node js/test_magdiff.js
    node js/test_piston_pump.js
    node js/test_electric_demo.js
    node js/test_scene_copy.js
    node js/test_heat.js
    ```
    Spot checks:
    - `getRef('magEngine') === 'diffusion'` is the default
      on a fresh sandbox.
    - `rg "'ar'|'diffusion'" js/test_` returns zero matches
      in test literals other than the new Test 11.
    - `rg "magDiffusion(Build|Relax|Publish|Reset)\b" js/`
      returns matches **only** in the new engine file
      `js/magfield_diffusion.js` and its test in
      `js/test_magdiff.js` Test 11. Zero matches in
      `js/electric.js`, `js/ui.js`, `js/state.js`, or
      `js/test_solenoid.js` (those should use the renamed
      Hy3 names or no Hy3 calls at all).
    - Engine switches
      `tapered → diffusion → hy3 → direct → diffusion` in
      the browser do not throw `ReferenceError`.
    - Under `diffusion`, dragging `#magRange` between
      `0.02` and `0.25` visibly changes how fast the
      field spreads into empty cells in the B-field view.

12. **Document the engines** — `docs/magnetic-engines.md`
    (DONE in the prep pass). One entry per engine with the
    formula, tuning constants, buffer names, boundary
    treatment, and a summary table. The doc cross-links to
    the source files and explicitly notes the truncated
    Dirichlet discretization (not no-flux Neumann) shared
    by `'tapered'`, `'hy3'`, and `'diffusion'`.

13. **Merge** — feature branch `feature/diffusion-engine`
    + `--no-ff` merge to `main`. No source-branch
    deletions.

## Decisions

- **Reclaim `js/magfield_diffusion.js` for the new engine**
  and move Hy3 to `js/magBzPoissonHy3.js`. The original
  name is now *more* accurate (it really is a diffusion
  engine). Renaming the file requires renaming the
  exported functions, which is mechanical but must be
  done consistently across `electric.js`, `ui.js`,
  `test_magdiff.js`, `test_solenoid.js`, the sandbox
  `files` arrays, and `index.html`. Doing the rename
  now is a one-time cost; leaving both engines to share
  the namespace would be a permanent source of bugs.

- **Rename the Ar engine value to `'tapered'`.** The
  current `magEngine = 'ar'` (or implicit `'diffusion'`)
  is ambiguous: it conflates "an analytic-tapered
  Poisson solve" with the broader "diffusion" idea. The
  new value `tapered` is descriptive and doesn't
  collide with the new `diffusion` engine.

- **Explicit forward-Euler, not Jacobi-Poisson.** The
  user explicitly asked for true cell-to-cell diffusion
  rather than an instant steady-state solve. With
  `α ≤ 0.25` the scheme is unconditionally stable for
  the 2D heat equation on a unit-stencil grid, and
  `MAG_SWEEPS_PER_FRAME = 50` × 60 fps gives
  `α·50 = 10` effective time units per second —
  visually obvious diffusion between frames. The new
  engine does NOT add a source term to every sweep
  beyond what's needed to seed the field; the
  per-iteration update is purely Bz-spreading, so the
  field's total energy is bounded by the initial
  curl-J source (no fictitious energy injection).

- **Source is discrete curl of J, computed in-file.** The
  Hy3 engine does the same (see
  `magBzPoissonHy3BuildSource`): iterate `fieldEdges`,
  accumulate ±K_B·I·dlx/dly at the edge's two endpoint
  cells, skip magnet self-edges via `edgeIsSelf`. This
  keeps the new engine self-contained — no dependency
  on `magBuildEdgeCells`, `magSrc`, or `magSrcCells`
  (which hold *Ar's* source = the discrete Laplacian
  of the analytic field, not the curl of J).

- **Engine name is `diffusion`, label is
  "Diffusion (visual relaxation)".** "Jacobi" or "FDM"
  would mean nothing to the user; "diffusion" is the
  right physical word, and "(visual relaxation)"
  signals that this engine is meant to *show* the
  field spreading frame-by-frame rather than
  converging silently.

- **Default flips from `tapered` to `diffusion`.** The
  user asked for this. Tests that pinned `tapered` (or
  the legacy `ar`) as the default are updated.

- **Full 4-way switch in both dispatch sites.** The
  current 2-way `if/else` (direct vs Ar-everything-else)
  would silently route the new engine through Ar's
  back-EMF path. Splitting the dispatch into four
  explicit arms prevents that and makes the engine
  contract clear in code.

- **No back-EMF in this plan.** Mirrors Hy3 Phase 1.
  Adding back-EMF to either `hy3` or `diffusion`
  requires extracting a shared `magInjectEmfAnalytic`
  helper, which is out of scope here and depends on
  Phase-2 work for Ar.

- **One slider, re-bound on engine change.** Same
  pattern as the existing Hy3/Ar re-binding. Three
  distinct units (`MAG_LAMBDA`, `MAG_DIFFUSION_ALPHA`,
  `MAG_RANGE`); the slider's `min/max/step` swap makes
  this invisible to the user. Under `direct` the slider
  is hidden (the existing behavior).

- **No `MAG_SWEEPS_PER_FRAME` slider.** A speed control
  is a follow-up concern (the existing Hy3/Ar plans
  already defer it). The new engine inherits the
  existing default.

## Risks

- **Test breakage from default flip and two renames.**
  Mitigated by tasks 2, 9, 11. Validation in task 11
  catches any missed site. Three separate sweeps
  required: `'ar'` → `'tapered'`, `magDiffusionX` →
  `magBzPoissonHy3X`, and default `'tapered'` →
  `'diffusion'`.

- **`fieldBz` collision.** Mitigated by using
  `fieldBzDiff` (and a scratch `fieldBzDiffScratch`)
  as the engine-local buffers. The publish step copies
  into the shared `fieldBz` only at the end of the
  relax loop, same pattern as Hy3.

- **CFL blow-up if `α > 0.25`.** Slider cap is the
  user-facing mitigation; the engine additionally
  clamps + warns on entry to `magDiffusionRelax`. Same
  hardening Hy3 applies to its `MAG_SWEEPS`.

- **Energy identity.** Like Hy3 Phase 1, this engine
  has no back-EMF. The Σ E·I + F·v ≈ 0 test (Test 5 in
  `test_solenoid.js`) is **not** added for the new
  engine in this plan. Phase 2 follow-up.

- **Source term sign convention must match Hy3.** If
  `magDiffusionBuildSource` uses a different sign than
  `magBzPoissonHy3BuildSource`, magnet telemetry
  (`lastFcoil`) will flip sign under engine switches.
  Mitigated by copying Hy3's exact edge-injection
  block (lines ~88-127 of
  `js/magBzPoissonHy3.js`) and adjusting only the
  per-iteration update. Test 11c round-trip catches a
  sign flip.

- **Massive scope of tasks 1+2+9+10.** Three
  mechanical renames plus a new engine plus UI plus
  tests is a lot of diff. Mitigation: the renames are
  pure find-and-replace and can be done in any order
  as long as the new engine code isn't exercised until
  all three are in place. Implementation order in
  tasks 1, 2, 3, 9 is deliberate.

## Out of scope

- Back-EMF injection on the new engine (Phase 2,
  depends on the shared `magInjectEmfAnalytic` helper
  from the Ar/Hy3 follow-up).
- A "diffusion speed" slider that throttles
  `MAG_SWEEPS_PER_FRAME` (Phase 2).
- Wall-clock benchmark vs the other three engines.
- Removing or deprecating `'tapered'`, `'hy3'`, or
  `'direct'`.

## Validation (must all pass before merge)

```
node js/test_solenoid.js     # existing + 1 (Test 5d)
node js/test_magdiff.js      # existing + 3 (Test 11a/b/c) — NOTE: Test 11 is
                             # already taken by "Grid owns values, analytic
                             # kernel owns derivatives" — either renumber the
                             # existing Test 11 to 12, or insert the diffusion
                             # block before it (between Test 10 and Test 11).
node js/test_piston_pump.js  # 35
node js/test_electric_demo.js# 17
node js/test_scene_copy.js   # 24
node js/test_heat.js         # PASS
```

## Progress — what's been done in this prep pass

The following have been completed in code; tests pass for the renames
and the new engine is verified by a smoke script (4/4 assertions):

- ✅ Task 1 — `js/magfield_diffusion.js` → `js/magBzPoissonHy3.js`,
  all four exports renamed (`magBzPoissonHy3BuildSource`/`Relax`/
  `Publish`/`Reset`), `index.html` updated, electric.js / ui.js
  call sites updated, file header comment updated.
- ✅ Task 2 — `magEngine = 'ar'` → `magEngine = 'tapered'`
  everywhere in `state.js`, `electric.js`, `ui.js`,
  `test_magdiff.js`, `test_solenoid.js`. The two stray
  `magEngine = 'diffusion';` lines in test_solenoid.js (which
  silently routed to Ar via fallthrough) are now
  `magEngine = 'tapered';`.
- ✅ Task 3 — New `js/magfield_diffusion.js` written:
  `magDiffusionReset`, `magDiffusionBuildSource` (discrete
  curl-J from `fieldEdges`, signs match Hy3), `magDiffusionRelax`
  (explicit forward-Euler with `α ≤ 0.25` clamp + warn), and
  `magDiffusionPublish` (copies `fieldBzDiff` → `fieldBz` and
  writes magnet telemetry with the same fields Hy3 writes).
  Engine-local buffers are `fieldBzDiff` / `fieldBzDiffScratch`
  / `magSrcDiff` to avoid name collisions.
- ✅ Task 4 — `<script src="js/magfield_diffusion.js">` added
  in `index.html` after `<script src="js/magBzPoissonHy3.js">`.
- ✅ Task 5 — `MAG_DIFFUSION_ALPHA` added to `state.js`.
- ✅ Task 6 — Default flipped to `'diffusion'` in `state.js`;
  `magName` status-bar label now has 4 arms.
- ✅ Task 7 — Full 4-way switch in `electric.js`: EMF site
  injects only for `'tapered'` and `'direct'`; field-advance
  site has four explicit arms (`'direct'`, `'tapered'`,
  `'hy3'`, `'diffusion'`). `magReset()` clears both Hy3
  and the new diffusion buffers via `typeof` guards.
- ✅ Task 8 — UI: `<option value="tapered">`, `<option
  value="diffusion" selected>`, `<option value="hy3">`,
  `<option value="direct">`. `magEngineOnChange` has a
  `'diffusion'` arm (slider `min=0.02 max=0.25 step=0.01`,
  binds to `MAG_DIFFUSION_ALPHA`, hides both `#magEmitAll`
  and `#magDipoles`). Slider `oninput` handles all four
  engines. Logger tag ternary includes all four.
- ✅ Task 10 — Sandbox `files` arrays in all 4 test files
  updated to include both engine files in the right order.
- ✅ Tests 2, 7, 10 (existing) pass after rename. Total:
  `test_magdiff.js` 47/47, `test_solenoid.js` 78/78,
  `test_piston_pump.js` 35/35, `test_electric_demo.js` 17/17,
  `test_scene_copy.js` 24/24, `test_heat.js` PASS.
- ✅ Smoke proof: `α=0.05` peak (23.09) > `α=0.20` peak (5.78)
  on the rail scene — confirms true cell-to-cell diffusion.

## What's left for the powerful agent

These items are deliberately deferred because they require the
agent to write substantial new test code (not a mechanical rename):

- **Task 9 — new test code.** Add a Test 5d to
  `js/test_solenoid.js` (L-loop under `diffusion`, finite
  + same-sign as `tapered`) and a new diffusion block to
  `js/test_magdiff.js` (the plan's Test 11a/b/c; insert
  between Test 10 and the existing Test 11). The tests must
  use the same `getRef`/`runCode`/`clearBoard`/`railScene`/
  `step` helpers used elsewhere. **Critical detail:** the
  `clearBoard()` helper currently sets `magEngine = 'tapered'`
  to make Tests 2-11 work; either keep that and have the
  new test explicitly set `magEngine = 'diffusion'` at the
  top of its own block, or split into two helpers.
- **Manual browser smoke** (one page-load per engine).
  Verify status bar labels, no console errors, `#magRange`
  slider visibly throttles diffusion under `diffusion`.
- **Final merge** (Task 13): `feature/diffusion-engine`
  branch + `--no-ff` merge to `main`.

## Implementation notes for the agent

- The diffusion engine's source build is intentionally
  mirror of Hy3's `magBzPoissonHy3BuildSource`: iterate
  `fieldEdges`, skip magnet-self via `edgeIsSelf`, and
  inject `+I` at one endpoint and `−I` at the other
  depending on `e.dlx`. The `K_B` scalar is applied at
  the end. This guarantees `m.lastFcoil` has the same
  sign under `diffusion` as under `hy3`.
- The `clearBoard()` in `test_magdiff.js` now sets
  `magEngine = 'tapered'` so the existing tests 2-9 (which
  exercise the analytic-tapered engine) still pass. The
  new diffusion test block must explicitly switch to
  `'diffusion'` itself.
- Test 5a in `test_solenoid.js` was previously labeled
  "default (diffusion) engine"; that label is now
  "default (tapered) engine" — and the test explicitly
  sets `magEngine = 'tapered'` at the top of the Test 5
  block. The new Test 5d should mirror that pattern.
- The pre-existing Test 11 ("Grid owns values, analytic
  kernel owns derivatives") must keep its number. The
  new diffusion test block should be inserted BEFORE it,
  as the plan's "Test 11a/b/c" — which means either
  renaming the existing Test 11 to Test 12, or treating
  the new block as "Test 10d" (continuation of the
  Hy3 block) and renaming accordingly. Pick whatever is
  least disruptive.

Spot checks:
- `getRef('magEngine') === 'diffusion'` on a fresh
  sandbox.
- `#magRange` slider under `diffusion` clamps to
  `[0.02, 0.25]`.
- Engine switches
  `tapered ↔ diffusion ↔ hy3 ↔ direct ↔ diffusion`
  leave `fieldBz` finite (no NaN, no
  `ReferenceError`).
- 11b's `α=0.20` peak < `α=0.05` peak after the same
  sweep count (proof of true diffusion, not an
  instant Poisson solve).
- Telemetry `pistons[0].lastFcoil` has the same sign
  under `tapered` and `diffusion` on the rail scene
  (sign convention preserved).

## Manual browser smoke (one page-load per engine)

For each of `'tapered'`, `'hy3'`, `'direct'`,
`'diffusion'`:
- Status bar shows the matching label.
- No console errors during a 5-second run.
- The `solenoid-lab` scene's magnet force readout is
  non-zero.
- Engine switches do not throw.
- Under `diffusion`: dragging `#magRange` between
  `0.02` and `0.25` visibly changes how fast the
  field spreads into empty cells in the B-field view.
- Under `diffusion`: a closed circuit with a battery
  accelerates the magnet (no back-EMF ⇒ unbounded
  acceleration; expected and documented).
  
  
# other opinions


динамическую модель магнитного поля , где пользователь видит распространение поля во времени


## Основная схема

Для сетки с шагом \(h=1\):

```js
next[i] =
	bz[i] +
	alpha * (left + right + up + down - 4 * bz[i]) +
	source[i];
```

Это можно реализовать in-place, но надёжнее использовать два буфера и менять их местами после каждого шага. Если обновлять `Bz` прямо во время прохода по сетке, получится уже не явный Euler, а вариант Gauss–Seidel-релаксации.

```js
for (let step = 0; step < MAG_SWEEPS_PER_FRAME; step++) {
	for (let i = 0; i < N; i++) {
		if (blocked[i]) {
			next[i] = 0;
			continue;
		}

		const lap =
			bz[left(i)] +
			bz[right(i)] +
			bz[up(i)] +
			bz[down(i)] -
			4 * bz[i];

		next[i] = bz[i] + alpha * lap + src[i];
	}

	[bz, next] = [next, bz];
}
```

## Важная ошибка в диапазоне α

Для двумерной схемы с четырьмя соседями условие устойчивости:

\[
0 < \alpha \leq \frac14.
\]

Но при \(\alpha=0.25\) это уже граничный случай. Поэтому комментарий:

> `4·α < 1`

не согласуется с диапазоном, заканчивающимся на `0.25`.

Лучше выбрать один из вариантов:

```text
0.02 ≤ α ≤ 0.24
```

или оставить `0.25`, но написать:

```text
4 · α ≤ 1
```

Практически я бы поставил максимум `0.24`, особенно если есть шум, особая обработка стен или дополнительные источники.

## Что означает добавление S

В формуле:

```js
Bz += alpha * laplacian + S
```

`S` — это не просто стационарный источник уравнения Пуассона. Это **приращение поля за один временной шаг**.

То есть источник должен иметь размерность:

\[
S = \Delta t \cdot \text{physical source}.
\]

Если источник вычисляется как:

```js
curlJ * K_B
```

и прибавляется на каждой итерации, поле будет накапливаться до тех пор, пока диффузия не создаст компенсирующий градиент. Это нормально для диффузионной модели, но нужно понимать, что итоговая амплитуда зависит от:

- `MAG_SWEEPS_PER_FRAME`;
- `alpha`;
- масштаба источника;
- граничных условий.

При увеличении числа шагов на кадр источник будет действовать большее эффективное время, и поле станет сильнее. Поэтому лучше явно определить:

```js
const dt = 1 / MAG_SWEEPS_PER_FRAME;
next[i] = bz[i] + alpha * lap + dt * physicalSource[i];
```

Либо считать каждый внутренний шаг полноценным физическим временем и осознанно оставить `S` без деления. Главное — не получить случайную зависимость силы от количества итераций.

Для первой игровой/визуальной версии можно оставить:

```js
next[i] = bz[i] + alpha * lap + src[i];
```

но тогда `MAG_SRC_GAIN_DIFFUSION` придётся калибровать отдельно от `MAG_SRC_GAIN_HY3`.

## Границы и blocked-клетки

Нужно заранее выбрать, что происходит около стен.

Если отсутствующий или blocked-сосед считается нулём:

```js
const left = cx > 0 && !blocked[i - 1] ? bz[i - 1] : 0;
```

то это приближает условие Дирихле:

\[
B_z=0
\]

на границе.

Это создаёт утечку поля в стены, но зато даёт устойчивый стационарный режим.

Если же нужна физическая «непроницаемая» граница, нужно использовать условие Неймана:

\[
\frac{\partial B_z}{\partial n}=0,
\]

то есть вместо нулевого соседа подставлять текущее значение центра:

```js
const left = cx > 0 && !blocked[i - 1] ? bz[i - 1] : bz[i];
```

Для симуляции с экранами и стенами я бы начал с нулевых blocked-клеток, но комментарий назвал бы явно:

```js
// Blocked and out-of-bounds neighbours use Bz = 0
// (zero-value Dirichlet boundary).
```

Также blocked-клетки нужно принудительно обнулять **после каждого шага**, иначе старые значения могут остаться в буфере.

## Источник curl J

Переиспользовать логику Hy3 — правильное решение. Источник можно вынести в общую функцию:

```js
function magBuildDiscreteCurlSource(dst) {
	dst.fill(0);

	for (const e of fieldEdges) {
		const I = e.I || 0;
		if (!I || edgeIsSelfForAnyMagnet(e)) continue;

		// Та же ориентация знаков, что в Hy3.
		if (e.dlx === 1) {
			dst[e.a] += I;
			dst[e.b] -= I;
		} else {
			dst[e.a] += I;
			dst[e.b] -= I;
		}
	}
}
```

Затем отдельные движки могут масштабировать один и тот же curl по-разному:

```js
src[i] = curl[i] * K_B * MAG_SRC_GAIN_DIFFUSION;
```

Важно не использовать для этого `Ar`-источники: если они являются лапласианом уже построенного аналитического поля, они не эквивалентны curl тока.

## Сколько шагов нужно

При `α = 0.20` один шаг диффундирует информацию примерно на несколько ячеек, а `40` шагов дают эффективное диффузионное время:

\[
t_{\text{eff}} \approx 40 \cdot 0.20 = 8.
\]

Это заметно, но не означает полного установления поля. Поэтому:

- warm start нужен;
- при смене источника поле будет догонять новое состояние постепенно;
- при большом `MAG_SWEEPS_PER_FRAME` поле будет выглядеть почти мгновенным;
- при малом значении появится настоящий временной лаг.

Это как раз главное отличие от `hy3`: `hy3` ищет стационарное решение, а `diffusion` моделирует эволюцию поля.

## Сброс движка

Сброс должен очищать оба буфера:

```js
function magDiffusionReset() {
	if (magDiffusionBz) magDiffusionBz.fill(0);
	if (magDiffusionNext) magDiffusionNext.fill(0);
}
```

Одного `fieldBz.fill(0)` недостаточно, если следующий буфер содержит старые значения.

При смене:

- движка;
- значения `alpha`;
- режима диполей;
- размеров сетки

лучше очищать оба буфера.

## Итоговая рекомендация

План хороший, но я бы немного уточнил его так:

1. `diffusion` — настоящий explicit forward-Euler solver.
2. Использовать два буфера, без in-place обновления.
3. Диапазон сделать `0.02–0.24`, либо исправить условие CFL на `≤`.
4. Явно решить, является ли `S` источником за физический шаг или уже готовым приращением.
5. Для blocked-клеток явно выбрать Dirichlet или Neumann; не называть нулевого соседа `no-flux`.
6. Сбрасывать оба Bz-буфера.
7. Не применять self-field subtraction и back-EMF, если это действительно часть Phase 1.
8. Сделать отдельный `MAG_SRC_GAIN_DIFFUSION`, потому что масштаб поля у диффузионного движка будет зависеть от числа шагов и `alpha`.





---




Нужно добавить и проработать отдельный магнитный движок:

```js
magEngine === 'diffusion'
```

Он должен отличаться от `direct`, `tapered` и `hy3` не только численным решателем, но и поведением во времени: при изменении токов магнитное поле не должно мгновенно перестраиваться по всей сетке, а должно распространяться по клеткам постепенно и быть наблюдаемым как анимация.

Перед реализацией изучи существующую архитектуру электрического и магнитного решателей. Не предполагай, что `fieldEdges` — это нарисованные пользователем геометрические линии: в текущей модели они строятся из соседних проводящих клеток и представляют соединения между клетками. Сохрани эту архитектуру, если она подходит, но выбери более удачное внутреннее представление, если оно даст более корректную или устойчивую реализацию.

### Цель

Реализовать динамическое двумерное поле `Bz`, связанное с токами в клеточной резистивной сети:

- пользователь рисует проводящие клетки;
- электрический решатель вычисляет потенциалы и токи между соседними клетками;
- токи формируют источник магнитного поля;
- магнитное поле распространяется по сетке во времени;
- сила на магнитах и визуализация используют текущее, возможно ещё не установившееся поле;
- при изменении токов пользователь видит переходный процесс, а не мгновенный пересчёт всего поля.

Модель может быть физически упрощённой, но поведение должно быть устойчивым, понятным и энергетически согласованным настолько, насколько это возможно в рамках текущей симуляции.

### Источник магнитного поля

Источником должен быть дискретный curl токов, вычисленный из токов между соседними проводящими клетками.

Не использовать для этого `Ar`-массивы `magSrc` или `magSrcCells`, если они содержат лапласиан заранее построенного аналитического поля. Это другая величина.

Можно переиспользовать логику Hy3:

- для каждого проводящего соединения между клетками взять ток `e.I`;
- добавить его с положительным знаком к одной стороне ячейки;
- добавить с отрицательным знаком к соседней стороне;
- сохранить согласованную ориентацию для горизонтальных и вертикальных переходов;
- исключить собственное armature/bridge-соединение магнита, если это соответствует текущей модели сил.

Желательно вынести построение дискретного curl в общую функцию, чтобы `hy3` и `diffusion` использовали одну и ту же топологическую логику, но могли по-разному масштабировать источник.

Нужно отдельно решить, как включаются дипольные магниты:

- как дополнительные локальные источники;
- как источник, зависящий от положения магнита;
- или как отдельное поле с последующим сложением.

Предпочтительно сохранять возможность раздельно видеть coil-field и dipole-field, если это уже поддерживается архитектурой.

### Динамическое обновление поля

Реализовать настоящее временное обновление магнитного поля, а не релаксацию до сходимости:

\[
B_z^{n+1}
=
B_z^n
+
\Delta t
\left(
D\nabla^2 B_z^n+S^n
\right).
\]

В простейшем варианте допустима явная схема:

```js
next[i] =
	bz[i] +
	alpha * laplacian(bz, i) +
	source[i];
```

с фиксированным числом шагов на кадр.

Однако не привязывай реализацию жёстко к конкретному варианту. Выбери подход, который лучше согласуется с существующим кодом:

- два ping-pong-буфера для явного Euler;
- фиксированное число подшагов;
- полунеявную схему, если она существенно устойчивее;
- экранное слагаемое `-lambda² * Bz`, если нужно ограничить дальность;
- отдельные скорости распространения для разных материалов, если это уже естественно поддерживается моделью.

Не использовать `while (until converged)` внутри этого движка: число магнитных подшагов должно быть ограничено и контролируемо, чтобы переходный процесс оставался видимым.

### Параметры

Использовать существующий пользовательский контрол `#magRange` для режима `diffusion`, но его смысл должен быть адаптирован к динамике. Это может быть:

- коэффициент диффузии;
- шаг диффузии `alpha`;
- эффективная скорость распространения;
- или параметр дальности/экранирования, если агент сочтёт это более понятным для пользователя.

Если параметр называется `alpha`, необходимо соблюдать устойчивость выбранной схемы. Для простой двумерной явной схемы:

\[
0 < \alpha \leq \frac14.
\]

Необходимо учитывать, что фактическая скорость анимации зависит одновременно от:

- значения `alpha`;
- количества магнитных подшагов на кадр;
- масштаба источника;
- масштаба времени симуляции.

Поэтому пользовательский параметр должен вести себя предсказуемо: увеличение значения должно заметно ускорять распространение, но не вызывать взрыв поля или мерцание.

Если текущий `#magRange` семантически плохо подходит для `alpha`, разрешается изменить подпись, tooltip или внутреннее преобразование значения, не ломая интерфейс других движков.

### Связь с электрическим решателем

Текущий электрический решатель работает с клеточными потенциалами `fieldV` и соединениями `fieldEdges`. В нём уже есть механизм ЭДС:

```js
e.E
```

и ток вычисляется примерно как:

```js
e.I = (Va - Vb + e.E) / e.Re;
```

Сохрани совместимость с этой схемой.

Важно различать:

- `e.E` — ЭДС на переходе между двумя соседними клетками;
- `fieldV[i]` — потенциал клетки;
- `e.I` — ток через границу между клетками.

Если реализуется back-EMF, вводить её следует как ориентированную добавку к `e.E`, а не как прямое изменение магнитного поля.

Текущая функция:

```js
magApplyEmfDirect(mags)
```

вычисляет ЭДС через аналитический градиент ядра, а:

```js
magApplyEmfDiffusion(mags)
```

использует предварительно построенные коэффициенты `mag._couple`.

Проверь, соответствует ли это реальному направлению движения и топологии клеточной сети. Не добавляй новую модель back-EMF автоматически, если она конфликтует с существующей энергетикой. Для первой версии разрешается оставить back-EMF выключенной в `diffusion`, но архитектура не должна закрывать возможность включить её позднее.

Если back-EMF включается, она должна:

- распределяться по конкретным соседним клеточным переходам;
- иметь согласованную ориентацию;
- проходить через существующий `injectEMF`;
- влиять на `fieldV`, а затем на `e.I`;
- давать силу, которая в генераторном режиме противодействует движению.

Проверь знак по энергетическому балансу:

\[
P_{\text{mech}}=Fv,
\qquad
P_{\text{emf}}=\sum_e e.E\,e.I.
\]

При тормозящем генераторном режиме механическая мощность должна уменьшаться, а электрическая энергия — переходить в сеть и тепло.

### Граничные условия

Явно определить поведение:

- за пределами текстуры;
- внутри `blocked`;
- между проводящими и непроводящими областями;
- около стен;
- около источников и магнитов.

Для blocked-клеток возможны разные варианты:

- нулевое поле как условие Дирихле;
- отсутствие потока как условие Неймана;
- отдельная маска диффузии;
- материал с собственной проводимостью/проницаемостью.

Выбери вариант, который лучше соответствует текущей визуальной модели. Главное — не смешивать в комментариях «zero-value Dirichlet» и «no-flux Neumann»: это разные условия.

### Сброс и переключение движков

При смене:

- `magEngine`;
- параметров diffusion;
- размеров сетки;
- режима диполей;
- топологии проводников;

необходимо корректно сбрасывать или перестраивать динамическое состояние магнитного поля.

Если используется ping-pong-схема, очищать нужно оба буфера. При переключении на другой движок не допускай, чтобы старое диффузионное поле влияло на `direct`, `tapered` или `hy3`.

Сохрани существующую публикацию телеметрии:

```js
mag.lastBz
mag.lastFcoil
mag.lastPower
mag.lastCurrent
mag.lastEMF
mag.lastHeat
```

Но не притворяйся, что переходное поле уже является стационарным решением. При необходимости добавь диагностические значения:

```js
magDiffusionTime
magDiffusionResidual
magDiffusionMaxDelta
```

### Визуализация

Режим `bfield` должен отображать текущее состояние `fieldBz` после последнего магнитного подшага.

Не пересчитывать визуализацию напрямую из источника или аналитического ядра. Пользователь должен видеть именно динамику:

- поле возникает около токов;
- распространяется наружу;
- меняет знак при изменении направления тока;
- затухает после исчезновения источника;
- реагирует на движение магнитов с конечной задержкой.

Предпочтительно, чтобы при остановке токов поле не исчезало мгновенно, а затухало согласно выбранной модели. Если используется экранирование или затухание, это должно быть объяснимо параметрами модели.

### Что требуется от реализации

Сначала проанализируй существующие:

```js
fieldSimulate
fieldRelax
fieldPublish
magApplyEmfDirect
magApplyEmfDiffusion
injectEMF
magBuildEdgeCells
magBuildCoupling
magSolveDiffusion
```

Определи фактический порядок:

1. построение клеточной сети;
2. вычисление потенциалов;
3. вычисление токов;
4. построение магнитного источника;
5. обновление магнитного поля;
6. вычисление силы;
7. применение back-EMF;
8. визуализация.

Затем предложи и реализуй наиболее согласованный вариант. Не копируй Hy3 механически: Hy3 может оставаться стационарным screened-Poisson-решателем, а `diffusion` должен иметь собственное сохраняемое во времени состояние.

Главный критерий результата:

> При изменении токов или движении магнита поле `Bz` должно распространяться по клеточной сетке постепенно и наблюдаемым образом, при этом силы, токи, EMF и тепловыделение должны оставаться согласованными с существующей моделью.

---

Ключевое архитектурное решение здесь такое: **клетки остаются основной моделью, `fieldEdges` — производными соединениями между соседними клетками, а `fieldBz` — независимым динамическим состоянием**. `fieldEdges` нужны для токов, curl и EMF; `fieldBz` не следует каждый кадр заменять результатом стационарного Poisson-решения.
