# Plan: diffusion magnetic-field solver (legacy direct sum kept, GUI-selectable)

Status: implemented — see "What landed" at the bottom. Baseline before this change:
commit `b3fc357`.

## Context (verified against code)

The electric potential is a **living diffusion**: a persistent `fieldV`
(`js/electric.js:344`) relaxed by red-black Gauss–Seidel every frame
(`fieldRelax`, `js/electric.js:642`), warm-started across edits, published
continuously (`fieldPublish`, `js/electric.js:677`).

Magnetism is *not*. It is a **per-frame direct Biot–Savart summation**:

- `fieldBz` is zeroed and recomputed from scratch on every publish
  (`js/electric.js:741`, `:796-806`) — no persistent B state.
- Magnet force / back-EMF readouts come from instantaneous, not-yet-converged
  edge currents `e.I` (`js/electric.js:745-751`, force loop `:752-793`).
- Hard kernel cutoff at `r² > MAG_RMAX² = 64` (`js/electric.js:771`,
  `:802`; `MAG_RMAX` at `js/state.js:162`) → B and F **jump discontinuously**
  when a magnet crosses the 8-cell boundary.
- Cost is `O(edges × magnets)` per frame for the readouts
  (`js/electric.js:756-783`) **plus** `O(cells × edges)` for the B-field
  overlay when the B view is on (`js/electric.js:796-806`).
- Kernel is `~1/r` (`magKernelG`, `js/electric.js:354`) with `K_B = 40`
  (`js/state.js:160`), so the field is still strong 8 cells away — reads as
  "action at a distance" for a 2D sandbox.

The legacy engine stays (like `circuitSimulate` for electricity): selectable
from the GUI, no new features, covered by regression tests.

## Goal (acceptance)

1. **Persistent, relaxed B.** `fieldBz` becomes solver *state*: warm-started,
   advanced a fixed number of sweeps per frame, never zero-and-recomputed.
   The B-field view reads the solver state (so the `O(cells × edges)` overlay
   fill disappears).
2. **No discontinuity.** No hard `MAG_RMAX` cut in the new engine: the field
   decays smoothly and a magnet crossing any radius sees a continuous B and F.
3. **Cheaper.** Per-frame magnetic work is `O(edges)` (source assembly, ~4
   cells/edge after de-duplication) `+ O(cells)` per sweep, independent of the
   magnet count. Readouts become `O(magnets)`.
4. **Shorter range, tunable.** A screening length `MAG_RANGE` (GUI slider,
   default 6 cells) replaces the fixed 8-cell cutoff.
5. **Both engines selectable** from Advanced → *Magnetics*: `diffusion`
   (default) and `direct` (legacy, obsolete). Status bar shows which is live.
6. **Optional magnet self-field.** A magnet can emit its own dipole field
   (per-item `Emit B` checkbox + a global "Magnets emit B" master), so
   magnet↔magnet forces and the dipole pattern in the B view appear.
7. **Invariants preserved** in the new engine: polarity flip, `no current ⇒
   B = 0, F = 0`, generator/Lenz drag, motor back-EMF, and the **exact**
   energy identity `Σ_e E_e·I_e + Σ_b F_b·v_b = 0`.
8. All suites stay green: `node js/test_solenoid.js`, `test_electric_demo.js`,
   `test_piston_pump.js`, `test_air.js`, `test_scene_copy.js`, plus the new
   `node js/test_magdiff.js`. (`test_heat.js` already FAILs on the baseline
   commit — unrelated, see "Pre-existing".)

## Physics / numerics

For in-plane current elements the Biot–Savart field is purely out-of-plane,
`Bz(r) = K Σ_e I_e (dl_e × r)/(|r|²+σ²)`, and (σ→0) that kernel is *harmonic*
away from the filament: with `G = -(1/2π)ln r`,
`Bz = -2πK (∇×Φ)_z`, `Φ = Σ I_e dl_e G`, `∇²Φ = -J` ⇒

```
∇²Bz = 2πK (∇×J)_z
```

So Bz is the solution of a **Poisson (diffusion) problem** whose source is
local to the current filaments — exactly the same shape as the electric
relaxation, so it can reuse the red-black Gauss–Seidel machinery.

**How the source is built (this is what makes it exact rather than
approximate).** Take the windowed analytic field
`ψ(x) = Σ_e K_B I_e w(|x-m_e|) g_σ(x-m_e)` — the same kernel the legacy engine
sums, multiplied by a compact C¹ window `w` that is 1 near the filament and 0
at `MAG_RANGE`. Then assemble `S = -∇²_h ψ` on the grid and relax

```
∇²_h Bz = S = -∇²_h ψ ,   Bz = 0 on the grid border
```

Because `ψ` itself vanishes at the border (the window is compact), the discrete
solution is `Bz = ψ` up to the relaxation residual: **the relaxed field is the
analytic Biot–Savart field, smoothly tapered to zero at `MAG_RANGE`** — not an
approximation of it, and with no `1/r` tail to leak across the board. Measured
on a live rail scene (`js/test_magdiff.js` test 2): worst deviation over the
whole channel **1.98 %**, and `lastBz` 16.482 vs analytic 16.411 (0.4 %).

Two implementation details that cost an afternoon each, recorded so they are
not re-derived:

1. `∇²_h` must be applied **once per cell** to the *summed* ψ, not per edge.
   Per-edge Laplacians triple-count the stencil neighbours (measured 3.9× too
   large).
2. The window must be applied to the **source**, not only to the coupling. An
   unwindowed (or differently windowed) source spreads over the whole grid and
   the solve drifts ~4× off the analytic value.

**Why screening (`κ`) was dropped.** The first design added `κ² = 1/MAG_RANGE²`
to the relax diagonal to shorten the range. It does shorten it, but it also
makes the relaxed field disagree with the analytic kernel that the force and
the EMF are computed from, so the two sides of the energy identity drift apart
and a per-frame projection factor `λ` is needed to patch it back. Windowing the
source achieves the same shortening *and* keeps the field, the force and the
EMF all derived from one kernel — so `κ` and `λ` are both gone. `MAG_RANGE` is
now purely the window radius.

**Range default.** `MAG_RANGE = 8`, i.e. the same radius as the legacy
`MAG_RMAX`. Measured on the motor scene (`F` vs window radius, same currents):

| `MAG_RANGE` | 5 | 6 | 7 | 8 | 10 | 12 | legacy (hard cut at 8) |
|---|---|---|---|---|---|---|---|
| `F_coil` (N) | +9.7e-4 | +1.1e-3 | -4.5e-2 | **-7.7e-2** | -6.4e-2 | -1.4e-2 | -4.9e-2 |

The net force on a *centred* magnet is a small residue of large cancelling
near-field terms, so it changes **sign** below ~7 cells. Shortening the default
would silently reverse the demo scenes; the taper does the shortening instead
(`w(6) ≈ 0.19` at `MAG_RANGE = 8`), and the slider still exposes 2..16.

### Magnet readouts in the new engine

- `lastBz` = bilinear sample of the relaxed field at `bodyCenter` — this is the
  *state* half of the fix: persistent, warm-started, no flicker, no cutoff jump.
- `F_coil` and the motional EMF stay **analytic**, computed from the *same*
  windowed coupling `β_e = ∂(w·g_σ)/∂a` at the body centre:
  `F = m K_B Σ_e β_e I_e`, `E_e = -m K_B (v·β_e)`.
  **Why the force is not read off the relaxed grid.** The grid reproduces the
  analytic *values* closely, but a force needs `∂Bz/∂a`, and in a near-symmetric
  geometry the true gradient is a small residue of large cancelling terms, so a
  1-cell stencil's truncation error swamps it. Measured by
  `js/test_magdiff.js` test 10 (magnet centred between two opposite rails —
  reproducible with `node js/test_magdiff.js`):

  | quantity | exact analytic | relaxed grid |
  |---|---|---|
  | `Bz` | 16.4114 | 16.4817 (**0.43 %** off) |
  | `∂Bz/∂x` | 2.154e-8 | 1.734e-3 (**5 orders** off) |
  | `∂Bz/∂y` | -8.685e-7 | +1.329e-4 (**opposite sign**) |

  At the symmetry point the true gradient is essentially zero and the stencil
  error is the whole answer. The same experiment on the solenoid-loop geometry
  gave `∂Bz/∂y` = -1.413e-2 analytic vs **+3.183e-2** from the grid, and showed
  the deeper trap: `magGradAt`'s bilinear estimator is *provably identical* to
  the 4-cell-averaged central difference of the analytic field (both
  3.183474512276696), so x and y are sampled inconsistently depending on where
  the body centre falls. Higher-order stencils do not remove that. The grid
  therefore owns the field state (overlay, `lastBz`, dipole emission, smooth
  range) and the analytic kernel owns the derivative quantities; `magGradAt` is
  kept only as the diagnostic that test 10 measures.
- Because force and EMF share one `β`, `Σ_e E_e I_e = -F·v` holds
  **algebraically** — no projection factor, no convergence requirement.
  Measured at a non-trivial power level: `ΣE·I = +6.4588 W`, `ΣF·v = -6.4588 W`,
  residual `1.8e-15`.
- Self-exclusion: the Case-A armature *bridge* edge is dropped from the source
  entirely (the diffused field has no per-magnet variants, and a body must not
  push on its own armature current). `lastCurrent` still reads it.
- Snap-to-zero: when no source cell remains (circuit opened, battery removed)
  the steady state is exactly 0, so the buffer is snapped instead of decaying
  for ~1000 sweeps. This is the one discontinuity left, and it is exactly where
  the legacy engine is discontinuous too.

### Magnet self-field (optional)

A magnet is a dipole **normal to the plane** — that is what the ⊙/⊗ glyph at
`js/render.js:1039` already draws. Its in-plane field is
`Bz_dip = -K_B·G·m·a³/(r²+a²)^{3/2}`, which is *not* 2D-harmonic, so it is
injected the same way as the current sources: `S += -∇²_h(Bz_dip)` over a
compact window (`MAG_EMIT_R = 3` cells) around the body, into a **separate
buffer** `magBzDip`. Two buffers, not one: a single buffer would let a magnet
feel its own emission as a spurious self-force. Dipole↔dipole force is analytic
(`magDipGrad`), so action = reaction is exact and a lone emitter pushes on
nothing. Off by default; per-magnet `Emit B` checkbox plus a `magEmitAll`
master switch.

## Implementation

1. `js/state.js`
   - `let magEngine = 'diffusion'` (`'direct'` = legacy), `let MAG_RANGE = 8`,
     `let magEmitAll = false`, `const MAG_SWEEPS_PER_FRAME = 50`,
     `const MAG_EMIT_R = 3`.
   - `createMechanicalBody` gains `emit` (default off).
   - `updateStatus` prints the magnetic engine next to the electric one.
2. `js/electric.js`
   - Extract the legacy magnetic block of `fieldPublish` verbatim into
     `magSolveDirect()`; keep it byte-identical in behaviour.
   - New: `magWindow` / `magWindowGrad` (C¹ taper + its derivative),
     `magEmits`, `magDipBz` / `magDipGrad`, `magSelfEdge`, `magBuildEdgeCells`
     (per-cell edge index, built once per `fieldSimulate`),
     `magBuildCoupling` (β = exact gradient of the *windowed* kernel, cached on
     the body and de-duplicated by stamp), `magBuildCoilSource` /
     `magBuildDipSource` (ψ accumulation + one `∇²_h` pass), `magBuildChecker`,
     `magRelax` (red-black Gauss–Seidel, plain Poisson), `magBzAt`, `magGradAt`,
     `magSolveDiffusion`, `magDipDirty`, `magReset`.
   - `fieldSimulate`: EMF loop uses the same windowed β as the force (both
     engines; `MAG_RMAX` cutoff for `direct`).
   - `fieldPublish`: dispatch `magSolveDiffusion()` / `magSolveDirect()`;
     the diffusion branch owns `fieldBz` (no per-frame zeroing) and snaps the
     field to exactly 0 when there are no sources (keeps
     `no current ⇒ B = 0` exact).
   - `simTick`: relax B in the same tick as V.
   - `simulate()`: reset the magnetic state when the engine is switched.
3. `index.html`: *Magnetics* `<select>`, *B range* slider, *Magnets emit B*
   checkbox, and an `Emit B` checkbox in the piston property template.
4. `js/ui.js`: wire those controls; `emit:1` token in scene copy/paste.
5. `js/render.js`: `emit` in `INPUT_FNS` + `makeInputHandler`.
6. Tests: `js/test_solenoid.js` Test 5 is split — 5a asserts the diffused
   `lastBz` against the *windowed* analytic kernel on the default engine, 5b
   pins `magEngine='direct'` for the exact `< 1e-8` raw-kernel equality (that
   assertion *is* the legacy contract, mirroring how `test_electric_demo.js`
   pins `activeEngine='circuit'`). Everything else runs on the default engine.
   New `js/test_magdiff.js` (39 assertions) covers: engine selection, accuracy
   against the windowed kernel, warm start / living relaxation,
   `no source ⇒ exactly 0`, continuity across the old cutoff (compared head to
   head with the legacy engine), the energy identity at a non-trivial power
   level, a cost guard (magnetic work independent of magnet count), dipole
   emission (repulsion, action = reaction, no self-force, master switch),
   engine-switch round-trip, the B-range slider, and the value-vs-gradient
   measurement that justifies keeping the force analytic.

## Risks / guardrails

- **Force scale shifts** (0.7–1.3×): acceptable, `K_B` slider unchanged; all
  `|F| > 1e-4` style assertions re-measured.
- **Slow tail decay**: `no current ⇒ F < 1e-8` needs the exact-zero snap, not
  relaxation alone (measured: ~1000+ sweeps to 1e-9 from B≈500).
- **Feedback instability** (EMF → I → B → F → v): force and EMF come from one
  kernel, so the loop is lossless by construction; the existing `test_solenoid`
  stability assertions (`|vel| < 6`, finite F) still guard it.
- **`test_heat.js`**: FAILs on the baseline commit `b3fc357` before any of
  this work (source T 8.3 K, "max rate of change = 0.97 K/s (target ~5)").
  Pre-existing, unrelated to magnetism — not touched here.

## What landed

`js/state.js`, `js/electric.js`, `index.html`, `js/ui.js`, `js/render.js`,
`js/test_solenoid.js`, `js/test_magdiff.js`.

Suite results after the change (baseline in brackets, all on this branch):

| suite | result |
|---|---|
| `js/test_magdiff.js` (new) | **39 pass, 0 fail** |
| `js/test_solenoid.js` | **74 pass, 0 fail** [72 pass at baseline; +2 from the Test 5 split] |
| `js/test_electric_demo.js` | 17 pass, 0 fail [17] |
| `js/test_piston_pump.js` | 35 pass, 0 fail [35] |
| `js/test_scene_copy.js` | 21 passed, 0 failed [21] |
| `js/test_air.js` | PASS [PASS] |
| `js/test_heat.js` | FAIL — **pre-existing at `b3fc357`**, unrelated (swing 7.4 K) |

Headline measurements from the new suite:

- Relaxed field vs windowed analytic kernel: worst **1.98 %** over a whole
  channel; `lastBz` 16.482 vs 16.411 analytic.
- Cutoff discontinuity, magnet walking perpendicular to a rail: the legacy
  engine still steps **100 %** of the local field in one cell (2.13 → 0.00 →
  2.13) and its field dies completely in the mid-gap; the diffusion engine's
  worst step is **38.5 %** and it keeps a smooth tail (min 0.68).
- Energy identity: `ΣE·I = +6.4588 W`, `ΣF·v = -6.4588 W`, residual `1.8e-15`
  (algebraic, not converged-to).
- Cost: coil source assembly is per-edge — **597 source cells with 1 magnet and
  597 with 5** (it scales with wire length only); coupling is local at
  **28 (edge, magnet) pairs per magnet** instead of one pass over every edge.
- Dipole emission: off by default (field identically 0), on ⇒ equal dipoles
  repel with `F_left + F_right = 0` to the bit, and a lone emitter radiates
  without pushing itself.
