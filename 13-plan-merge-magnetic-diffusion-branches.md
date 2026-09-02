# Plan: Merge `magnetic-diffusion-hy3` + `Ar-magnetic-diffusion` → `main`

## Implementation status (2026-09-02)

IMPORTANT: The review found the actual task plan and implemented it on the
session branch `arena/01a06118-maze` (instead of the wrong `.kilo` plan).

- All `Ar-magnetic-diffusion` changes are integrated (engine selector,
  `magEngine`/`MAG_RANGE`/`magEmitAll`/`b.emit`, `mag*` solver in
  `js/electric.js`, UI controls, status bar, scene save/load `emit` token,
  `js/test_magdiff.js`).
- The old `magnetic-diffusion-hy3` branch is **gone from origin** (verified via
  `git ls-remote` and GitHub API; `MAG_LAMBDA`/`MAG_DIPOLES` are not merged and
  there are no references to `magfield_*.js` in any code file). Its
  `hy3-magnetic-diffusion-solver.md` is therefore not available locally, so it
  is documented here instead of being moved into `docs/archive/`.
- Review improvement kept: `test_solenoid.js` Test 4 now uses a real closed
  loop and asserts non-zero `Bz`/`F` (the original Ar test was
  `Number.isFinite`-only and silently measured `0`).
- Review improvement added: `test_scene_copy.js` now round-trips the `emit`
  token and verifies old scenes without it load `emit:false`.
- Validation: `test_solenoid` 74/74, `test_magdiff` 39/39, `test_piston_pump`
  35/35, `test_electric_demo` 17/17, `test_air` PASS, `test_heat` PASS,
  `test_scene_copy` 24/24.
- The plan's main-merge/delete-branch steps were intentionally **not run**:
  this session is fixed to `arena/01a06118-maze` and only pushes there. The
  user can review the branch and do `git merge`/`git branch -d` on a local
  working copy using the rest of this plan.

## draft

merge both to main. use magEngine switch to select engine. deduplicate. if similar - use Ar bench - it is better code quality usual.

What happens to the two old branches after the merge?
Delete both (Recommended)


## Goal

Fold both magnetic-diffusion solver experiments into a single integrated `main`
that keeps the runtime `magEngine` selector (`'diffusion' | 'direct'`). Where
the two branches diverge, take the Ar variant (better code quality, analytic
force/EMF, gradient-correct, energy-exact). Delete both old branches after
`main` is updated. Do **not** push to `origin/main`.

## Verified branch state

```
* f9dc467  Ar-magnetic-diffusion    (rooted at b3fc357, no hy3 work in it)
| * 75ea341 magnetic-diffusion-hy3  (rooted at b3fc357, owns magfield_*.js)
|/
* b3fc357  main / origin/main
```

Per-branch diff vs `b3fc357`:

| File                          | hy3        | Ar          | Conflict zone? |
|-------------------------------|------------|-------------|----------------|
| `12-plan-magnetic-diffusion.md` | —          | +266        | no             |
| `hy3-magnetic-diffusion-solver.md` | +91     | —           | no (hy3-only)  |
| `index.html`                  | +13        | +14         | yes (lines 193, 415-417) |
| `js/electric.js`              | rewrite + extract | rewrite + inline | yes (full rewrite of fieldPublish) |
| `js/magfield_diffusion.js`    | **+212 (new)** | —        | no (hy3-only, never on main) |
| `js/magfield_legacy.js`       | **+71 (new)**  | —        | no (hy3-only, never on main) |
| `js/state.js`                 | +12        | +30         | yes (MAG_LAMBDA vs MAG_RANGE block) |
| `js/render.js`                | —          | +3          | no (Ar-only)   |
| `js/test_electric_demo.js`    | +2 (loads 2 extra scripts) | — | yes (file list line) |
| `js/test_piston_pump.js`      | +2 (same)  | —           | yes            |
| `js/test_scene_copy.js`       | +2 (same)  | —           | yes            |
| `js/test_solenoid.js`         | +7 (legacy-pinned) | +40 (mixed engine) | yes (large overlap) |
| `js/test_magdiff.js`          | —          | **+457 (new)** | no (Ar-only) |
| `js/ui.js`                    | +21        | +29         | yes (engine + range + dipoles) |

Verified via `git ls-tree`:
- `js/magfield_*.js` exist on `magnetic-diffusion-hy3` only. They are **not** on
  `b3fc357`/`origin/main` and not on `Ar-magnetic-diffusion`. The integration
  branch starts from `b3fc357` so these files never enter the merge — there is
  nothing to delete. (The earlier draft of this plan said "delete from the
  index"; that was wrong.)
- The two `<script>` lines for those files exist only on
  `magnetic-diffusion-hy3`. Main never had them. Nothing to remove.

## Deduplication rules (decided by user)

1. **Ar wins** for any line/file/feature that exists in both branches.
2. **hy3-only files:** `js/magfield_diffusion.js`, `js/magfield_legacy.js` —
   dropped (never reach `main` because integration starts at `b3fc357`).
   `hy3-magnetic-diffusion-solver.md` — moved to `docs/archive/` as a historical
   record.
3. **hy3-only edits to other test files** (`test_electric_demo.js`,
   `test_piston_pump.js`, `test_scene_copy.js` — adding `magfield_*.js` to the
   `files` load list) — dropped. Ar doesn't reference the deleted files.
4. **API rename** `magFieldEngine` (hy3) → `magEngine` (Ar) and `'legacy'` →
   `'direct'`. All code follows Ar's names; hy3's old name is only present in
   its own `test_solenoid.js` which is dropped.

## Final file list on `main` after merge

New files (none existed on `b3fc357`):
- `12-plan-magnetic-diffusion.md`           (from Ar)
- `js/test_magdiff.js`                      (from Ar)
- `docs/archive/hy3-magnetic-diffusion-solver.md` (moved from root)

Modified files (take from Ar):
- `index.html`               — engine `<select>`, range slider, emit
  checkboxes, per-piston Emit B control
- `js/electric.js`           — `magEngine` switch, all `mag*` helpers
  (`magBuildCoilSource`, `magBuildDipSource`, `magRelax`, `magBuildEdgeCells`,
  `magBuildCoupling`, `magApplyEmfDirect`, `magApplyEmfDiffusion`,
  `magSolveDiffusion`, `magSolveDirect`, `magDipBz`, `magDipGrad`, `magWindow`,
  `magBzAt`, `magGradAt`, `magEmits`, `magSelfEdge`, `magReset`)
- `js/state.js`              — `magEngine`, `MAG_RANGE`, `MAG_SWEEPS_PER_FRAME`,
  `magEmitAll`, `MAG_EMIT_R`, `b.emit`
- `js/render.js`             — `emit` input binding in `INPUT_FNS.piston` and
  handler
- `js/ui.js`                 — engine selector wiring, range slider wiring,
  `magEmitAll` checkbox, status-bar `Mag:` field, scene paste `emit` token,
  scene text save `emit` token
- `js/test_solenoid.js`      — Test 5a (diffusion Bz ≈ windowed analytic) and
  Test 5b (legacy Bz = analytic to 1e-8); reuses base 7-file sandbox

Deleted from working tree relative to `magnetic-diffusion-hy3` (not from main):
- `js/magfield_diffusion.js`
- `js/magfield_legacy.js`

## API surface (final, post-merge)

| Symbol                      | Where              | Type   | Default      |
|-----------------------------|--------------------|--------|--------------|
| `magEngine`                 | `js/state.js:173`  | `let`  | `'diffusion'`|
| `MAG_RMAX`                  | `js/state.js:162`  | `const`| `8` (legacy only) |
| `MAG_RANGE`                 | `js/state.js`      | `let`  | `8` (cells)  |
| `MAG_SWEEPS_PER_FRAME`      | `js/state.js:180`  | `const`| `50`         |
| `magEmitAll`                | `js/state.js:181`  | `let`  | `false`      |
| `MAG_EMIT_R`                | `js/state.js:182`  | `const`| `3`          |
| `MAG_DIP_A`                 | `js/electric.js:421` | `const`| `1.25`     |
| `MAG_DIP_GAIN`              | `js/electric.js:422` | `const`| `0.5`      |
| `b.emit`                    | per-piston         | bool   | `false`      |

`MAG_DIP_A` and `MAG_DIP_GAIN` live in `js/electric.js` (not `js/state.js` as
the earlier draft claimed — verified at lines 421-422).

## Open design decisions resolved

- **Range param:** `MAG_RANGE` (cells), Ar's. Drop hy3's `MAG_LAMBDA`. The
  default `8` matches the legacy `MAG_RMAX`, preserving user-visible behaviour.
- **Per-piston `emit`:** keep Ar's (more flexible than hy3's global
  `MAG_DIPOLES`). Per-item override plus `magEmitAll` master switch.
- **Integration base:** `b3fc357`, **not** `75ea341`. Ar's branch already
  supersedes hy3's solver content.
- **No push to `origin/main`.** User will review and push manually.
- **Old branches:** delete after the merge commit lands on `main`.
- **Plan doc:** `hy3-magnetic-diffusion-solver.md` → `docs/archive/`.

## Execution steps (read-only for the implementer; mutating for the agent)

1. `git checkout b3fc357`
2. `git checkout -b integration/magnetic-diffusion`
3. Apply the Ar tip as a single squashed patch by checking out files:
   ```
   git checkout Ar-magnetic-diffusion -- \
     index.html \
     js/electric.js \
     js/state.js \
     js/render.js \
     js/ui.js \
     js/test_solenoid.js \
     js/test_magdiff.js \
     12-plan-magnetic-diffusion.md
   ```
4. `mkdir -p docs/archive && git mv hy3-magnetic-diffusion-solver.md docs/archive/`
5. Create `docs/archive/README.md` with a one-liner: "Historical design
   documents for completed experiments."
6. Verify no remaining references to dropped symbols or files:
   - `grep -rn "magFieldEngine\|MAG_LAMBDA\|MAG_DIPOLES\b\|magfield_diffusion\|magfield_legacy" .` must return zero results.
   - `grep -rn "magEmit\b" .` — should be zero (we use `magEmitAll` only).
7. `git add -A && git commit -m "Integrate magnetic-diffusion engine (Ar-priority)"`
8. `git checkout main && git merge --no-ff integration/magnetic-diffusion -m "Merge integrated magnetic-diffusion engine into main"`
9. Run validation (next section). All pass → continue. Any fail → fix on
   `integration/magnetic-diffusion` and re-merge.
10. `git branch -d magnetic-diffusion-hy3 Ar-magnetic-diffusion`
11. **Do not push.** Print the local result to the user; the user pushes
    manually.

## Validation (must pass before step 10)

```
node js/test_solenoid.js   # all tests pass
node js/test_magdiff.js    # all 10 tests pass
```

Specific assertions to spot-check (use the runner's PASS/FAIL output, not
re-implement):

- `magEngine === 'diffusion'` is the default
  (`js/test_magdiff.js:132`).
- Test 4 (`Smooth across the old MAG_RMAX cutoff`):
  `diff.lr ≈ 1`; `direct.lr << 1`.
- Test 5a (diffusion): `|Bz − windowed analytic| < 0.05·|analytic| + 1e-9`.
- Test 5b (legacy/direct): `|Bz − analytic| < 1e-8` (byte-equality).
- Test 9 (energy residual): `|Σ E·I + F·v| < 1e-6` on the diffusion engine.
- Solenoid test suite: all `assert(...)` lines PASS; the legacy-bridge, Case A,
  battery/lamp, generator tests in particular.

Manual browser smoke (one page-load):
- Status bar shows `Engine: Field  |  Mag: Diffusion  |  …`.
- Switching the Magnetics dropdown to `B direct sum (obsolete)` re-runs the
  sim under the legacy path without console errors.
- Toggling `Magnets emit B` flips behaviour for `>=2` magnets in the
  `solenoid-lab` scene (force magnitude changes visibly).
- Copying a scene with `emit:1` to clipboard and pasting round-trips
  (`b.emit` preserved).
- `b3fc357` scenes without `emit` token load with `b.emit = false` (verified
  by `createMechanicalBody` default at `js/state.js:241`).

## Risks and mitigations

- **Test_solenoid.js overlap (lines 305-340 area):** Ar's block is a strict
  superset of hy3's block plus an engine toggle. Ar wins, no functional loss.
- **Scene save format regression:** Old scenes without `emit` must still load
  with `b.emit = false`. Verified by `createMechanicalBody` default. Add a
  test if absent.
- **Hidden hy3 unique value:** hy3's `MAG_LAMBDA = 0.15` slider and the
  `MAG_DIPOLES` global are dropped silently. If a user had a `MAG_LAMBDA` value
  saved to a scene file (it isn't — only `magStrength`, `pos`, `friction` are
  in the scene text format), nothing breaks. No scene file uses
  `MAG_LAMBDA`.
- **Lost coverage:** hy3's `test_solenoid.js` was legacy-only and is fully
  replaced by Ar's mixed-engine test (5a diffusion, 5b legacy). The legacy
  engine still gets covered.
- **`tests/test_electric_demo.js` etc.:** the `files` array revert is safe —
  Ar's tree never references `magfield_*.js`. If a future test references
  them, it must be re-pointed.

## Out of scope

- Selecting which engine wins long-term (both stay selectable).
- The `air sink` removal work item (separate).
- Non-magnetic engine cleanup (`activeEngine`).
- Any change to the live `MAG_RMAX = 8` constant — preserved as the legacy
  cutoff.

## Post-merge tasks (not part of this plan, for the user's backlog)

- Add a scene-save test for `emit` round-trip.
- Decide whether to deprecate the legacy engine UI (grey it out) once a
  release ships with only the diffusion engine in use.
- Decide on the long-term home for `docs/archive/` content.
