# Plan: rebalance magnetic vs pressure forces so the solenoid visibly moves

Status: The `bat-to-solenoid` scene and its
coupling test are already  `js/ui.js:321` (scene) / `js/ui.js:339` (magnet
tuning) and `js/test_solenoid.js:682` (Test 23, "force coupling only"). This plan covers the
*missing* piece: making the magnet actually **translate** under the rail field.

## Context

- Magnetic coupling constant is `K_B` at `js/state.js:149` (`= 40` today; solenoid-v2 used `0.5`,
  so arena is already 80× stronger — but still pressure-dominated, see below).
- Kernel: `SIGMA_B` (`js/state.js:150`, soft-core radius `0.5`), `MAG_RMAX` (`js/state.js:151`,
  cutoff `8` cells).
- Force + back-EMF are computed **inline in `fieldSimulate`** (arena has no separate
  `computeMagneticCoupling`):
  - Magnet force loop: `js/electric.js:752-786` (`F = magStrength · (dBx·ax + dBy·ay)` at
    `:784`, written to `mag.lastFcoil` at `:786`).
  - Back-EMF / induced edge EMF: `js/electric.js:499` (`E += -magStrength · K_B · dgda · vel`)
    lands in `fieldEdges[].E`; edge current `Ie = (Va - Vb + E)/Re`. This is the arena equivalent
    of solenoid-v2's `magEe` and is the **negative-damping** term.
- Air/pressure: `P_SCALE` (`js/state.js:302`, `=1`), `R_SPEC` (`js/state.js:298`, `287`),
  `AIR_CP` (`js/state.js:283`, `1005`). Pressure force on the body is `lastFpress`.

## Goal (acceptance)

- With the 10 V battery driving the `bat-to-solenoid` rails, the magnet piston translates
  **≥ 1 cell** down the channel from rest (within ~200–1000 frames).
- The magnetic force on the solenoid becomes **comparable to** the air-pressure force in the same
  geometry (within ~1 order of magnitude), so the field — not just pressure — decides motion.
- Regression guardrails: `|vel| < 6` and `lastFcoil` finite for the full scene run (no 1/r²
  singularity blow-up).
- All suites stay green: `test_solenoid.js`, `test_piston_pump.js`, `test_electric_demo.js`,
  `test_air.js`, `test_heat.js`. The energy-identity test (`test_solenoid.js` Test 21) must still
  close to ~1e-15.

## Why it fails today (measured)

Harness probe of `bat-to-solenoid` (magnet held fixed, `vel=0`, `friction=damping=1e9`):

```
arena K_B = 40, SIGMA_B = 0.5, MAG_RMAX = 8, loop current I ≈ 0.084 A
  mag=1  K_B=40   -> Fcoil = 0.131 N
  mag=5  K_B=40   -> Fcoil = 0.657 N
  mag=5  K_B=120  -> Fcoil = 1.970 N
  mag=10 K_B=120  -> Fcoil = 3.939 N
  mag=20 K_B=400  -> Fcoil = 26.26 N
  mag=10 K_B=400  -> Fcoil = 13.13 N
```

The scaling is clean and linear: **`F_coil ≈ 3.28e-3 · magStrength · K_B` (N)** for this geometry.
So to reach the ~40–60 N pressure scale (upstream doc's dynamic measurement for a *free* magnet in
the sealed channel; `lastFpress=0` only because the probe holds the magnet fixed and no compression
builds), we need `magStrength·K_B ≈ 1.2e4`, e.g. `K_B=1200 & magStrength=10` (≈39 N) or
`K_B=400 & magStrength=20` (≈26 N).

Two independent blockers remain even after scaling `K_B` up:
1. **Trap:** a symmetric closed loop has a field null/saddle where the magnet sits, so
   `∂Bz/∂x ≈ 0` at center ⇒ even a strong field mostly *holds* it, doesn't push. Must break
   symmetry (off-center start or asymmetric rails).
2. **Negative-damping blow-up:** back-EMF (`js/electric.js:499`) adds to current as the magnet
   moves ⇒ generator feedback. Near a wire the 1/r² kernel diverges ⇒ `vel` saturates at 6 and
   `F` runs away. Must be bounded by `damping` / a `vel` clamp / a kernel clamp.

## Investigation (do these first, in order)

1. **Quantify both force scales numerically (arena).**
   - Hold the magnet fixed (`vel=0`, huge `friction`/`damping`) and sweep
     `magStrength ∈ {1,3,5,10,20}` × `K_B ∈ {40,120,400,1200}`; record `lastFcoil` vs the loop
     current `lastCurrent`. Confirm the `F_coil ≈ 3.28e-3·magStrength·K_B` fit and find the
     factor to lift `F_coil` into the ~tens-of-N range.
   - Same geometry with the magnet **free** (low `friction`/`damping`): record `lastFpress` for
     the sealed channel to confirm the ~30× ratio and which term dominates (`P_SCALE`, `R_SPEC`,
     chamber volume split). (Upstream measured `lastFpress ≈ 40–60 N`.)
2. **Locate the magnetic scale constant.** `js/state.js:149` `K_B=40`. Decide how much to multiply
   it (×10–30 per upstream preferred option A) to make `F_coil ≈ pressure`. Note arena already
   starts at `K_B=40`, so the effective multiplier vs upstream is smaller.
3. **Locate the pressure scale constant.** `js/state.js:302` `P_SCALE=1`, `R_SPEC=287`
   (`js/state.js:298`), `AIR_CP=1005` (`js/state.js:283`). `js/air.js` computes
   `F_press = (pBack − pFront)·1.0`. Decide whether to *raise* `K_B` or *lower* `P_SCALE` (or
   both) — prefer the smaller, more local change; option B (lower pressure) risks
   `test_piston_pump` / air scenes.
4. **Confirm the blow-up mechanism.** In the magnet force/EMF code (`js/electric.js:499`, `:780-786`)
   the induced `E` feeds `Ie` and thus `F`. Verify the sign gives **negative damping** (generator)
   and measure the `magStrength`/`K_B` threshold where `vel` diverges for a given `damping`. This
   bounds how hard `K_B` can be pushed.

## Rebalance options (pick after step 1–4)

- **A (preferred): raise magnetic, keep trap-breaking geometry.** Increase `K_B` ×10–30 (or expose
  it on the GUI slider at `js/ui.js:398`) so `F_coil ≈ pressure`. Pair with enough air `damping`
  on the magnet (raise the `bodies[].damping` default, or cap `vel`) to kill the negative-damping
  instability. Then break the **trap** so it translates:
  - Make the field *asymmetric* along x: bias the rails (e.g. one rail closer, or a stronger return
    segment at one end) so `∂Bz/∂x` has a consistent sign down the channel ⇒ unidirectional push
    instead of a null.
  - OR shorten the loop so the magnet starts off-center (near the battery/return) where the gradient
    is non-zero, so it is pulled toward the far end.
- **B: lower pressure.** Reduce `P_SCALE` (`js/state.js:302`) or the pressure coefficient in
  `js/air.js` so the magnetic force dominates. Risk: `test_piston_pump` and other air scenes rely on
  pressure magnitude — re-tune those or keep the pressure change localized to the solenoid channel.
- **C: hybrid** — modest `K_B` boost + modest `P_SCALE` cut, chosen so the ratio lands ~1:1 and the
  magnet moves ~1 cell under 10 V without blow-up.

## Stability guardrails (must hold)

- Magnet `vel` must stay `< 6` and `F_coil` finite for the full scene run (no 1/r² singularity). The
  magnet already sits ≥1 cell from any wire (rails at y2/y4, magnet at y3); add a
  `min(K_B·SIGMA_B, …)` clamp on the kernel if needed, and a `vel` clamp in the body integrator.
- Generator back-EMF negative damping must be dominated by `damping` so the magnet reaches a finite
  terminal velocity. Add a regression check: step the scene ~2000 frames with `magStrength` at the
  chosen value and assert `|vel| < 6` and finite `lastFcoil`.

## Scene changes

- `js/ui.js` `bat-to-solenoid` (`:321`): once forces are balanced, set the magnet's
  `magStrength`/`mass`/`damping` (currently `:339`: `friction=0, damping=2, mass=2, magStrength=5`)
  so it translates ≥1 cell from rest under the 10 V battery, while staying stable (guardrails above).
  Confirm in the harness: `pos` changes by ≥1.0 over ~600–1500 frames with the battery on, and stays
  put with the loop open.

## Test changes

- **Test 23** (`js/test_solenoid.js:682`): upgrade from "force coupling only" to "field drives
  translation" — assert `|bOn.lastFcoil|` is large AND `bOn.pos − start ≥ 1.0` after stepping with
  the battery on; control (open loop) still asserts ≈0 force and no translation. Update any force
  thresholds to the rebalanced magnitude.
- Re-run **all five** suites; if `K_B`/`P_SCALE` changes shift existing asserts, re-baseline them.
  The energy-identity Test 21 must still close to ~1e-15.

## Next-session todo (ordered)

1. Harness: measure `F_coil` vs `magStrength`/`K_B` and `F_press` with a *free* magnet (step 1).
2. Choose lever (A/B/C) from the ratio.
3. Apply constant change + add `damping`/`vel` clamp; re-measure stability (step 4).
4. Break the trap (asymmetric rails / off-center start) so it translates.
5. Tune scene magnet params (`js/ui.js:339`); verify ≥1-cell motion from 10 V.
6. Update Test 23; run `test_solenoid`, `test_piston_pump`, `test_electric_demo`, `test_air`,
   `test_heat`.

