# Plan: Restore `magnetic-diffusion-hy3` as a third selectable magnetic engine

## Status (2026-09-02)

Pre-work for this plan is already done on `main`:

- `main` is now fast-forwarded to `4200e61` ("Integrate Ar-magnetic-diffusion engine").
  See `git log --oneline main -3` →
  `4200e61`, `134dccb`, `b3fc357`.
- Local branches `Ar-magnetic-diffusion`, `arena-v2`, `arena/01a06118-maze` deleted.
- The only non-`main` local branch is `magnetic-diffusion-hy3` at `75ea341`.
- `main` carries the Ar engine switch `magEngine ∈ {'diffusion','direct'}` and the
  Ar diffusion solver inlined in `js/electric.js`.

What this plan covers: bring Hy3 back as a **third selectable option** (Ar
diffusion, Hy3 screened-Poisson diffusion, and the unified legacy direct-sum)
without forking the work.

## Goal

Expose both diffusion engines (Ar and Hy3) side by side in the live UI and
test suite, behind a single `magEngine` selector with three values:
`'ar' | 'hy3' | 'direct'`. Engine switch must be hot, must not lose scene
state, and must not introduce flicker.

## Deduplication (resolving the previous plan's Ar-wins rule)

The previous plan (`13-plan-merge-magnetic-diffusion-branches.md`) forced a
single Ar-only diffusion engine on the basis that "Ar wins for any
line/file/feature that exists in both branches." That is too aggressive:
the two branches implement **different physics**.

- Ar: windowed analytic Biot–Savart kernel + per-piston `b.emit` dipole +
  Laplacian relaxation of the smooth field. Range = `MAG_RANGE` (cells).
- Hy3: screened-Poisson `(∇² − λ²) Bz = S` with warm-started red-black
  Gauss–Seidel, λ-decay range, and a `MAG_DIPOLES` global for magnet dipoles.

Both are useful: Ar's analytic kernel is byte-exact against the legacy sum
on a single point source; Hy3 is smooth across the whole grid and is
warm-started, so the field doesn't flicker frame to frame. They are not
"duplicates" — they are two valid choices the user asked to be able to
compare.

### Unified engine vocabulary (decision)

| Value     | Module                       | Physics                                            |
|-----------|------------------------------|----------------------------------------------------|
| `'ar'`    | inlined in `js/electric.js`  | Windowed analytic kernel + Laplacian relax, range `MAG_RANGE` |
| `'hy3'`   | `js/magfield_diffusion.js`   | Screened-Poisson `(∇² − λ²) Bz = S`, range `λ`     |
| `'direct'`| inlined in `js/electric.js`  | Per-frame Biot–Savart sum with `MAG_RMAX` cutoff (both legacy implementations are physically identical) |

Why merge the two legacy implementations into one `'direct'` value: the Ar
legacy path (`magApplyEmfDirect` in `js/electric.js:1001-1253`) and the Hy3
legacy path (`magLegacyPublish` in `js/magfield_legacy.js`) both compute the
same per-magnet sum over `fieldEdges` with the same `SIGMA_B` and `MAG_RMAX`
and the same `edgeIsSelf` self-edge filter. Keeping both is duplicate code.
The Ar inlined path is preferred because it sits next to its sister
`magApplyEmfDiffusion` and shares helper code; Hy3's `magfield_legacy.js` is
discarded.

## Source material to bring in from `magnetic-diffusion-hy3` (75ea341)

Files (from `git show 75ea341 --stat`):
- `js/magfield_diffusion.js` (new, 212 lines) — Hy3 screened-Poisson solver.
  **Keep as-is** under the new name `js/magfield_hy3.js` (or keep the name and
  document it; see "Naming" below).
- `js/magfield_legacy.js` (new, 71 lines) — **Discard** (subsumed by the
  Ar inlined legacy path).
- `js/electric.js`, `js/state.js`, `js/ui.js`, `index.html` — **Discard the
  Hy3 edits**; reconcile their intent into the Ar-shape files (next section).
- `js/test_electric_demo.js`, `js/test_piston_pump.js`, `js/test_scene_copy.js`
  — **Discard** the `+2` lines that load `magfield_*.js`; we'll re-add the
  new script tag to `files[]` in one place.
- `js/test_solenoid.js` — **Discard** the Hy3 `+7` lines (legacy-pinned);
  the existing Ar test_solenoid (Test 5a/5b) already covers both engines and
  will be extended to test `'hy3'`.
- `hy3-magnetic-diffusion-solver.md` (new, 91 lines) — Hy3's design doc.
  **Move to `docs/archive/hy3-magnetic-diffusion-solver.md`** for the
  historical record.

### Naming

The current file `js/magfield_diffusion.js` on the Hy3 branch literally
describes Hy3's solver. After the merge the file *is* the Hy3 engine, so
**keep the filename**. To avoid confusion with Ar's inlined "diffusion", the
file's top comment will be updated to call itself "the Hy3 screened-Poisson
magnetic engine — selectable via `magEngine === 'hy3'`".

## Engine integration (Ar-shape files)

### `js/state.js` (Ar-shape)

Replace the current `magEngine` / `MAG_RANGE` block with:

```js
// Magnetic engine selector. Three values:
//   'ar'     — Ar: windowed analytic kernel + Laplacian relax (default).
//   'hy3'    — Hy3: screened-Poisson (∇² − λ²) Bz = S, warm-started.
//   'direct' — legacy per-frame Biot–Savart with MAG_RMAX cutoff.
let magEngine = 'ar';

let MAG_RANGE = 8;        // Ar engine: window radius (cells).
let MAG_LAMBDA = 0.15;    // Hy3 engine: screened-Poisson decay (≈6–7 cells at default).
let MAG_DIPOLES = false;  // Hy3 engine: magnets also inject their own dipole field.
let magEmitAll = false;   // Ar engine: master switch for per-piston `b.emit`.
let MAG_EMIT_R = 3;       // Ar engine: dipole-pair offset for emitted dipoles.
const MAG_SWEEPS_PER_FRAME = 50; // Ar engine: relax sweeps per frame.
```

Keep the existing `MAG_RMAX = 8` (legacy cutoff) and `SIGMA_B = 0.5` (legacy
soft core) constants — the `'direct'` path still uses them.

### `js/electric.js`

Two surgical edits:

1. Replace the `magEngine === 'direct'` branches at `js/electric.js:1001`
   and `js/electric.js:1253` with a 3-way dispatch:
   ```js
   if (magEngine === 'direct') magApplyEmfDirect(mags);
   else if (magEngine === 'hy3') magApplyEmfHy3(mags); // thin wrapper
   else magApplyEmfDiffusion(mags);                    // Ar
   ```
   The wrapper delegates to the global functions exported by
   `js/magfield_diffusion.js` (`magDiffusionPublish`,
   `magDiffusionBuildSource`, `magRelaxInto`, `magDiffusionReset`,
   `magBuildSelfField`). Their names stay unchanged to keep the file's diff
   to Hy3 minimal.
2. In `updateStatus` (`js/state.js:498`), change the engine label:
   ```js
   const magName = magEngine === 'direct' ? 'Direct (legacy)'
                 : magEngine === 'hy3'     ? 'Diffusion-Hy3 (screened Poisson)'
                 :                           'Diffusion-Ar (analytic kernel)';
   ```

### `js/ui.js` (Ar-shape)

Extend the existing engine `<select>` binding at `js/ui.js:691-697` from
2 options to 3:

```html
<select id="magEngineSel">
  <option value="ar">Diffusion-Ar (analytic, recommended)</option>
  <option value="hy3">Diffusion-Hy3 (screened Poisson)</option>
  <option value="direct">Direct sum (legacy, obsolete)</option>
</select>
```

Update the `onchange` to:
```js
magEngineSel.onchange = () => {
  magEngine = magEngineSel.value;
  if (magEngine === 'hy3' && typeof magDiffusionReset === 'function') magDiffusionReset();
  if (magEngine !== 'direct') startSimLoop();
  logger('Magnetic engine: ' + magEngineSel.selectedOptions[0].text, 'sys');
};
```

**Reconcile the two range sliders.** Ar has `#magRange` (cells, default 8)
wired to `MAG_RANGE` (`js/ui.js:701-705`). Hy3 has `#magRange` wired to
`MAG_LAMBDA` (default 0.15). Conflict on the same `id`. Resolve by:

- Rename Ar's slider to `#magRangeAr` (Ar engine range in cells), keep its
  binding to `MAG_RANGE`.
- Rename Hy3's slider to `#magRangeHy3` (Hy3 engine λ), keep its binding
  to `MAG_LAMBDA`.
- Show only the slider that matches the current engine: in the
  `magEngineSel.onchange`, set
  `document.getElementById('magRangeArGroup').hidden = (magEngine !== 'ar')`,
  same for the Hy3 group.

**Reconcile the dipoles control.** Ar has `magEmitAll` master + per-piston
`b.emit`. Hy3 has a single `MAG_DIPOLES` global. Keep Ar's per-piston
mechanism for the Ar engine; add `#magDipoles` checkbox that drives
`MAG_DIPOLES` and is **only visible when `magEngine === 'hy3'`**. Default
`false` for both engines, matching the user-visible behaviour on `main`.

### `index.html`

Add the Hy3 engine script **once** at the bottom of the load order, right
after `js/electric.js` and before `js/air.js`:

```html
<script src="js/magfield_diffusion.js"></script>
```

(One file, no separate `magfield_legacy.js`.)

Add the Hy3 range slider and dipoles checkbox in the controls block, behind
`hidden` groups so the Ar UI looks identical by default. Match the existing
Ar `<label class="ctrl">` style for visual consistency.

### `js/test_solenoid.js`

Extend the existing Test 5a/5b block (around `js/test_solenoid.js:305-356`)
to also exercise `magEngine === 'hy3'`:

- Test 5c (Hy3, near a single rail): assert
  `|mag.lastBz − windowed analytic| < 0.10·|analytic| + 1e-9` (looser than
  Ar because the screened-Poisson solution is smooth not analytic, but
  tighter than the legacy test). Set `MAG_LAMBDA = 0.15`, `MAG_DIPOLES = false`.
- Test 5d (Hy3, full grid): assert `max|Bz|` across the grid is finite
  and the field is monotone outside the rail to within 1% noise.
- Reuse the Ar code path for Test 5a/5b unchanged.

### `js/test_magdiff.js`

The Ar suite (`test_magdiff.js`) currently asserts `magEngine === 'diffusion'`
as the default at `js/test_magdiff.js:132`. Update:

- `getRef('magEngine')` should now be `'ar'`.
- Existing tests that do `magEngine = 'diffusion'; magReset(); …` should
  become `magEngine = 'ar'; magReset(); …`.
- Add a new section "Hy3 engine" with three tests: 6a (`'hy3'` is selectable
  and produces finite Bz), 6b (`'hy3'` matches the Ar solution to 10% at
  `λ = 0.15, MAG_RANGE = 8` for a single rail at the centre, since both
  are continuous extensions of the same analytic field), 6c (`'hy3'`
  with `MAG_DIPOLES = true` flips a closed-loop solenoid force
  measurement, as Test 4 in `test_solenoid.js` does for the Ar path).

### `js/test_electric_demo.js`, `js/test_piston_pump.js`, `js/test_scene_copy.js`

Update the `files` array in each so `js/magfield_diffusion.js` is loaded
alongside the other `js/*.js` files. One line per file, no other change.

## Validation (must pass before merge)

```
node js/test_solenoid.js    # 74 + 2 (Test 5c, 5d) — all PASS
node js/test_magdiff.js     # 39 + 3 (Hy3 6a/6b/6c) — all PASS
node js/test_piston_pump.js # 35
node js/test_electric_demo.js # 17
node js/test_scene_copy.js  # 24 + 1 (emit token still round-trips under 'ar' and 'hy3')
node js/test_heat.js        # air/heat PASS
```

Spot checks:

- `magEngine === 'ar'` is the default (`js/test_magdiff.js` updated).
- Test 4 of `test_magdiff`: `ar.lr ≈ 1`; `direct.lr << 1`; `hy3.lr` is
  between them (~0.7 — Hy3's screened tail is smoother than Ar's hard
  window).
- Test 6b (Hy3↔Ar agreement on a single rail): both engines are
  continuous extensions of the analytic field and should agree to ~10%
  near the rail and ~1% away from it.
- Status bar shows one of the three labels above depending on selection.
- Toggling the engine dropdown in the browser at runtime does not log any
  `ReferenceError` for `magDiffusionReset`, `magRelaxInto`, or
  `magDiffusionPublish`.

## Manual browser smoke (one page-load per engine)

For each of `'ar'`, `'hy3'`, `'direct'`:

- Status bar shows the matching label.
- No console errors during a 5-second run.
- The `solenoid-lab` scene's magnet force readout is non-zero and bounded.

For the engine-switch transitions:

- `ar → hy3`: warm-start of the Hy3 field from the Ar field is not
  required; `magDiffusionReset()` is called on switch. Expect a 1-frame
  visual settle.
- `hy3 → ar`: no warm-start needed; the Ar relax starts from the analytic
  kernel and converges within `MAG_SWEEPS_PER_FRAME` sweeps.
- `* → direct`: `direct` ignores `MAG_RANGE`, `MAG_LAMBDA`, `MAG_DIPOLES`,
  `b.emit`; the UI hides the irrelevant controls. No console errors.

## Risks and mitigations

- **`#magRange` id collision** (Ar and Hy3 both used the same `id`):
  resolved by renaming Ar's slider to `magRangeAr` and Hy3's to `magRangeHy3`.
- **Two `magSrc` globals** (Ar declares one at `js/electric.js:412`; Hy3
  declares one at `js/magfield_diffusion.js:32`): they are in different
  scripts and operate on different sources, but the names collide if a
  future script tries to read `globalThis.magSrc`. Rename Hy3's
  internal to `magHy3Src` to make the namespace explicit. Ar's `magSrc`
  keeps its name.
- **Two different "screened" interpretations**: the user asked for both,
  and the dropdown makes the choice explicit. Document the difference in
  the status bar label.
- **Hy3 `magLegacyPublish` lost**: Ar's `magApplyEmfDirect` is a direct
  re-implementation of the same algorithm. Verified by reading
  `js/electric.js:1001-1253` and `js/magfield_legacy.js:1-71` — both
  iterate `fieldEdges`, filter `edgeIsSelf`, accumulate
  `(hat, dy, dx)` with `SIGMA_B`, `MAG_RMAX`. Functionally identical.
- **Scene save format unchanged**: `emit` token is still the only
  magnetic field parameter in the scene text format. `MAG_RANGE`,
  `MAG_LAMBDA`, `MAG_DIPOLES` are not serialised.

## Out of scope

- Numerical comparison of Ar vs Hy3 wall-clock performance (separate
  benchmark plan).
- Removing `'direct'` once the diffusion engines are validated
  long-term.
- Changing `K_B`, `SIGMA_B`, or `MAG_RMAX` constants.

## Execution steps (mutating; the implementer is the next agent)

1. `git checkout main && git pull --ff-only` (assumes the user has pushed
   the new `main` per the post-merge section of the previous plan).
2. `git checkout -b feature/hy3-engine`.
3. Bring Hy3's solver back: `git checkout magnetic-diffusion-hy3 -- js/magfield_diffusion.js`.
4. Move Hy3's design doc:
   `mkdir -p docs/archive && git mv hy3-magnetic-diffusion-solver.md docs/archive/`
   (the file is in Hy3's tree; if not present on `main`, just write a
   short pointer doc at `docs/archive/hy3-magnetic-diffusion-solver.md`
   noting that the original was lost and the implementation lives in
   `js/magfield_diffusion.js`).
5. Edit `js/state.js`, `js/electric.js`, `js/ui.js`, `index.html`,
   `js/test_solenoid.js`, `js/test_magdiff.js`,
   `js/test_electric_demo.js`, `js/test_piston_pump.js`,
   `js/test_scene_copy.js` per the **Engine integration** section above.
6. Run all validations; fix and commit on `feature/hy3-engine`.
7. `git checkout main && git merge --no-ff feature/hy3-engine -m
   "Add Hy3 screened-Poisson engine as a third selectable magnetic
   option"`.
8. `git branch -d magnetic-diffusion-hy3 feature/hy3-engine` after merge.
9. Push `main`; the user does the final `git push --delete origin Ar-magnetic-diffusion origin/arena/01a06118-maze` themselves.

## Post-merge tasks (user's backlog)

- Add a perf benchmark: `js/test_magdiff_bench.js` runs the
  `solenoid-lab` scene 60 frames under each of `'ar'`, `'hy3'`, `'direct'`
  and reports mean ms/frame. Useful when deprecating `'direct'`.
- Decide whether to grey out the `'direct'` option in the UI once a
  release ships with only the diffusion engines in active use.
