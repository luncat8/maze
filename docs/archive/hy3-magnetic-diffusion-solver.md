# Plan: Diffusion magnetic-field solver (+ legacy kept, GUI-selectable)

## Context
Today the magnetic field is computed in `fieldPublish` (`js/electric.js:738–812`) by a **direct per-frame Biot–Savart summation** over current edges for every magnet, plus a `fieldBz` overlay summed the same way. This is *not* a diffusion/living solve like the electric potential (`fieldV`, relaxed via `fieldRelax`, `electric.js:640–674`).

Problems with the current (legacy) approach, confirmed against code:
- **Flicker**: no persistent B state — `fieldBz` is zeroed and recomputed every frame (`electric.js:741`); forces come from instantaneous, not-yet-converged edge currents `e.I` (`electric.js:750`), and a **hard cutoff at `r² > MAG_RMAX²=64`** (`electric.js:772,803`) causes discontinuous jumps as magnets cross the boundary.
- **Cost**: `O(edges × magnets)` per frame — grows with both wire count and magnet count.
- **Long range**: kernel `~1/r` (`magKernelG`, `electric.js:354–357`) with `K_B=40` (`js/state.js:160`) reaches ~8 cells, reading as "too far" for 2D.

The electric engine already proved the diffusion style works well (smooth, warm-started, `O(active cells)`). The goal: give magnetism the same treatment, keep the old engine working, and make magnets optionally emit their own dipole field.

## Decisions (confirmed with user)
1. **Decay model**: Screened Poisson `(∇² − λ²)Bz = S`, λ sets range (exponential-ish falloff). Removes the hard `MAG_RMAX` cutoff → no boundary ring/flicker, range is one tunable parameter.
2. **Dipole extension**: unified grid — when `MAG_DIPOLES` toggle ON, magnets also inject dipole sources into `S`; magnets then interact with each other and with wire fields automatically. Default **OFF** (preserves current behavior: magnets do not emit B).
3. **Keep both engines**: do NOT delete the legacy solver. Extract it to its own JS file, mark **obsolete**, and let the GUI choose which engine runs. Default = `diffusion`.
4. **Motional EMF** (moving magnet → wire, `electric.js:488–500`) is unchanged — it is magnet→wire coupling, not part of the B field, and works under both engines.
5. **UI defaults** (resolved): `magFieldEngine` default = **`diffusion`** (it is the improvement being shipped; legacy stays one click away for rollback/comparison). `MAG_LAMBDA` exposed as a user slider (default `0.15`, mapped to a friendly "B range" ~6–7 cells). `MAG_DIPOLES` default **OFF**.

## Current code map (anchors)
- Electric diffusion: `fieldV` (`electric.js:341`), `fieldRelax` (`640–674`, red-black Gauss–Seidel), dispatch in `simTick` (`906–934`: `fieldSimulate` 913 → `fieldRelax` 914 → `fieldPublish` 915).
- Magnetic force/EMF block to extract: `electric.js:752–792` (per-magnet `Bz/dBx/dBy/F/Eb`).
- Magnetic overlay: `electric.js:796–807` (`fieldBz[i]` summed from edges; gated on `colorView==='bfield'`).
- Per-edge current (keep, engine-agnostic): `electric.js:746–751` (`e.I = (Va−Vb+E)/Re`).
- Energy residual (keep, engine-agnostic): `electric.js:809–812`.
- Kernels: `magKernelG`/`magKernelGrad` (`354–366`).
- Constants: `K_B=40`, `SIGMA_B=0.5`, `MAG_RMAX=8` (`js/state.js:160–162`).
- Engine dropdown precedent: `index.html:190–195` (`#engineSel`, Field/Circuit), `js/ui.js` wires it.
- Script load order: `index.html:399–405` (global scripts, no modules).

## Target architecture
- **Shared, engine-agnostic** (stays in `electric.js` `fieldPublish`): compute `e.I` (746–751) and `magEnergyResidual` (809–812); then **dispatch** to the selected magnetic engine.
- **New file `js/magfield_diffusion.js`** (default engine):
  - Persistent `fieldBz` (reuse the existing `fieldBz` Float64Array, repurposed as the relaxed state — NOT reset each frame).
  - `magDiffusionBuildSource()`: build source `S` over the grid as the discrete curl of the current density. Use a staggered (MAC) layout:
    - For each `fieldEdge` `e` with signed current `I_e` and unit `dl=(dlx,dly)`, the edge sits on a face between two cells. If `dlx=1` (horizontal edge) it carries `Jx = I_e` on the vertical face; if `dly=1` (vertical edge) it carries `Jy = I_e` on the horizontal face. Accumulate face currents into two `Float64Array` of size `N` (`JxFace`, `JyFace`).
    - For each cell `n=(i,j)`: `S[n] = K_B * ( (JyFace[right] − JyFace[left]) − (JxFace[top] − JxFace[bottom]) )`, where right/left are the vertical faces at `i+1`/`i−1` and top/bottom the horizontal faces at `j+1`/`j−1`. (Centered finite differences, unit spacing → this is `K_B·curl J_z`.) This is the screened-Poisson RHS; `K_B` (`js/state.js:160`) is the scale factor, so legacy gain carries over.
    - If `MAG_DIPOLES` ON: inject each magnet's intrinsic dipole as **two opposite point sources offset just outside the magnet body** along its `hat` axis — `+m` at `bodyCell + round(hat)` and `−m` at `bodyCell − round(hat)` (or split between the two flank cells if non-integer) — added into `S`. Offsetting outside the body keeps the sample point smooth and naturally avoids the self-singularity (a dipole does not exert net force on itself).
  - `magDiffusionRelax(sweeps)`: red-black Gauss–Seidel of the screened Poisson
    `Bz[n] = (Σ_nbr Bz_nbr − S[n]) / (4 + λ²)` (uniform unit conductance, 4-neighbour; `λ = MAG_LAMBDA`). Warm-started across frames like `fieldRelax`. If it diverges in testing, flip the sign of `S[n]` (sign is the only ambiguity).
   - `magDiffusionPublish(mags)`: for each magnet sample `Bz` and its gradient via finite differences at the magnet cell (using neighbour cells, not the singular source cell when dipoles are on) → `F = m·(∇B·hat)`, `Eb` for EMF; write `mag.lastBz/lastFcoil/lastPower/lastCurrent/lastEMF/lastHeat` (same fields the legacy engine writes, `electric.js:785–791`). The armature `edgeIsSelf` bridge-edge exclusion (`electric.js:767–770`) is preserved inside `magDiffusionBuildSource`: when accumulating face currents into `S`, skip any edge where `edgeIsSelf(e, mag)` is true for some magnet, so a magnet's own armature (bridge) current does not feed the global field — matching legacy's "force comes from the rails, not the bridge".
  - `fieldBz` is now always maintained → B-field view reads it directly (drop the `colorView==='bfield'` gate at `electric.js:796`).
- **New file `js/magfield_legacy.js`** (obsolete, extracted): move the exact bodies of `electric.js:752–792` and `796–807` into `magLegacyPublish(mags)` / `magLegacyOverlay()`, marked `// OBSOLETE — kept for comparison; use magfield_diffusion.js`. At top: `/* eslint-disable */` not needed; just a clear obsolete banner.
- **GUI** (`index.html` `#advanced`, ~line 195; wired in `js/ui.js`):
  - `<select id="magEngineSel">` with `<option value="diffusion">Diffusion (recommended)</option>` and `<option value="legacy">Legacy sum (obsolete)</option>`. Default `diffusion`.
  - Optional `<input type="range" id="magRange">` bound to λ (field range). Default tuned (e.g. λ≈0.15 → range ~6–7 cells, replacing `MAG_RMAX`).
  - Optional `<input type="checkbox" id="magDipoles">` → `MAG_DIPOLES`, default unchecked.
  - On engine change or λ/dipole change: **reset `fieldBz` warm-start** (reallocate/zero) so stale cross-engine state can't bleed in.
- **State** (`js/state.js`): add `let magFieldEngine = 'diffusion';`, `let MAG_DIPOLES = false;`, `let MAG_LAMBDA = 0.15;` (replaces reliance on `MAG_RMAX` for range; keep `MAG_RMAX` only as a soft perf cap if needed).

## Implementation steps (ordered)
1. Add state vars in `js/state.js` (`magFieldEngine`, `MAG_DIPOLES`, `MAG_LAMBDA`); keep `K_B`, `SIGMA_B`, `MAG_RMAX`.
2. Create `js/magfield_legacy.js`: move `752–792` → `magLegacyPublish(mags)`, `796–807` → `magLegacyOverlay()`; add obsolete banner. No logic change.
3. Create `js/magfield_diffusion.js`: source build, relax, publish as specified above. Reuse `GRID_W/H`, `fieldBz`, `fieldEdges`, `magnetList`, `K_B` globals.
4. In `electric.js` `fieldPublish`: keep `e.I` (746–751) + residual (809–812); replace the magnetic block (752–807) with dispatch:
   `if (magFieldEngine === 'legacy') { magLegacyPublish(mags); if (colorView==='bfield') magLegacyOverlay(); } else { magDiffusionBuildSource(); magDiffusionRelax(MAG_SWEEPS); magDiffusionPublish(mags); }`
   (`mags` already computed at 752.)
5. Add `MAG_SWEEPS` constant (start = `FIELD_SWEEPS_PER_FRAME` or tuned down since B is smooth).
6. Wire GUI in `js/ui.js`: `#magEngineSel`, `#magRange`, `#magDipoles`; on change update state and reset `fieldBz`. Add `<script>` tags in `index.html` after `electric.js` for both new files.
7. Verify `fieldBz` overlay still rendered (B-field view, `index.html:234`) — diffusion keeps it populated always.

## Risks / calibration
- **Scale**: screened-Poisson B magnitude ≠ legacy `1/r` magnitude; `K_B` (and/or a new normalisation) must be recalibrated so magnet forces/EMF feel comparable. Validate by matching a single-wire Bz at a reference distance between engines (they won't be identical due to different decay, but should be within a sane factor).
- **λ sign/source sign**: verify relaxation converges (positive λ², correct sign in `−S[n]`); if it diverges, flip source sign.
- **Self-force in dipole mode**: handled by injecting dipole sources **outside** the magnet body (`bodyCell ± round(hat)`), so the sample point sees a smooth field and the dipole does not exert net force on itself — no explicit subtraction needed. Verify in Validation (two-magnet test).
- **Warm-start on engine switch**: always re-zero `fieldBz` on switch to avoid ghost fields.
- **Performance**: diffusion is `O(N)`/sweep — fine, but pick `MAG_SWEEPS` so convergence is adequate at the chosen λ (smaller λ ⇒ longer range ⇒ needs more sweeps).

## Validation
- Scenes: `solenoid-lab`, `solenoid-loop`, `bat-to-solenoid` (`index.html:179–181`) — confirm motor/generator forces still drive pistons under `diffusion`.
- B-field view (`index.html:234`): visually compare field shape between engines on: single straight wire, rectangular loop (interior cancel / exterior reinforce), two parallel opposite-current wires, two perpendicular wires. Confirm smooth, no flicker, no cutoff ring under diffusion.
- Toggle `MAG_DIPOLES` ON: place two magnets near each other → they should attract/repel via the grid; a magnet should also deflect nearby wire currents' field.
- Force direction: a magnet near a current loop should feel a force consistent with `F = m·∇(B·hat)`.
- Energy identity: `magEnergyResidual` (`electric.js:812`) stays ≈0 under both engines.
- Switch engine mid-sim via GUI → no crash, no ghost field, behavior continues.

## Data flow
- `simTick` (`electric.js:906–934`): `fieldSimulate()` rebuilds `fieldEdges` (+ motional `E`), `fieldRelax()` updates `fieldV`, then `fieldPublish()` computes `e.I` (`746–751`) and `magEnergyResidual` (`809–812`), then dispatches to the magnetic engine.
- **Diffusion path**: `magDiffusionBuildSource` (face currents → `S`, + optional dipole sources) → `magDiffusionRelax(MAG_SWEEPS)` updates persistent `fieldBz` → `magDiffusionPublish(mags)` samples `fieldBz` + gradient for force/EMF and writes magnet telemetry; B-field view reads `fieldBz`.
- **Legacy path**: `magLegacyPublish(mags)` (per-magnet `O(E)` sum) + `magLegacyOverlay()` (gated on `colorView==='bfield'`).
- Shared inputs both engines read: `fieldEdges[].I/.E/.mx/.my/.dlx/.dly`, `magnetList()`, `K_B`, `GRID_W/H`. Output both write: `mag.lastBz/lastFcoil/lastPower/lastCurrent/lastEMF/lastHeat` and `fieldBz`.

## Failure modes / rollout
- **Silent divergence**: if the relaxation sign is wrong, `fieldBz` blows up → guard with a clamp/`isFinite` check during `magDiffusionRelax`; if NaN/Inf, skip the publish that frame and log once.
- **Wrong scale**: forces too strong/weak → tune `K_B` or a `MAG_FORCE_SCALE` multiplier; covered by the single-wire Validation step.
- **Ghost field on switch**: engine/λ/dipole change must re-zero `fieldBz` (warm-start invalid). Handle in the `#magEngineSel`/`#magRange`/`#magDipoles` handlers.
- **Rollout**: ship `diffusion` as default; `legacy` selectable and marked obsolete. No deletion — `js/magfield_legacy.js` is the reference if `diffusion` regresses.

## Resolved open questions
- Default engine = `diffusion` (recommended; legacy kept for rollback).
- `MAG_LAMBDA` exposed as a user slider, default `0.15` (≈6–7 cell range).
