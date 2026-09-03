# Magnetic engines

The project ships four selectable magnetic engines, switched by
`magEngine` in `js/state.js`. The four values are unique; the dispatch
in `js/electric.js` is an explicit 4-way switch, and the UI
`<select id="magEngineSel">` in `index.html` exposes all four.

| Value       | Module                     | Default | Has back-EMF? | File comment header              |
|-------------|----------------------------|---------|---------------|----------------------------------|
| `'diffusion'` | `js/magfield_diffusion.js` | ✓       | no            | "Visual-relaxation magnetic …"   |
| `'tapered'`   | `js/electric.js` (inline)  |         | yes           | (inline; see `magApplyEmfDiffusion`, `magSolveDiffusion`) |
| `'hy3'`       | `js/magBzPoissonHy3.js`    |         | no            | "Hy3 screened-Poisson …"         |
| `'direct'`    | `js/electric.js` (inline)  |         | yes (legacy)  | (inline; see `magApplyEmfDirect`, `magSolveDirect`) |

Only the two engines that inject back-EMF (`'tapered'`, `'direct'`)
participate in the closed-loop energy identity `Σ E·I + Σ F·v = 0`.
`'hy3'` and `'diffusion'` are field-only; a magnet under them in a
closed circuit with a battery accelerates freely. The status bar shows
this in the engine label.

## `'diffusion'` — explicit forward-Euler relaxation (default)

`js/magfield_diffusion.js`.

```
Bz ← Bz + α · (Bx⁺ + Bx⁻ + By⁺ + By⁻ − 4·Bz) + S
```

run for `MAG_SWEEPS_PER_FRAME = 50` iterations per frame.

- **Source** `S` is the discrete curl of the edge currents, computed
  in-file by iterating `fieldEdges` and skipping magnet self-edges via
  `edgeIsSelf` (sign convention matches `'hy3'` so `m.lastFcoil` has
  the same sign across engine switches).
- **Tuning**: `MAG_DIFFUSION_ALPHA = 0.20` (slider range `[0.02, 0.25]`,
  CFL `4·α < 1`; the engine clamps and warns on entry if violated).
- **Behaviour**: the field actually spreads cell-to-cell over
  successive iterations. Higher `α` diffuses energy to neighbours
  faster per sweep, so the peak decays faster; a smoke test on the
  rail scene with 40 sweeps gives peak `|Bz| ≈ 23.1` at `α=0.05` but
  only `≈ 5.8` at `α=0.20` — the proof of true cell-to-cell diffusion
  rather than an instant solve.
- **Boundary**: zero Dirichlet on the grid edge and on `blocked`
  cells; blocked neighbours contribute `0` to the per-cell Laplacian
  sum. This is a *truncated* Dirichlet (per-cell stencil weights are
  not corrected for the count of valid neighbours), so the field is
  slightly over-damped near irregular boundaries. Not a no-flux
  (Neumann) condition — that would require mirroring the cell's own
  value.
- **Buffers** (engine-local to avoid name collisions with Hy3):
  `fieldBzDiff` (the engine's Bz), `fieldBzDiffScratch` (swap
  buffer for the Euler step), `magSrcDiff` (curl-J source).

## `'tapered'` — analytic-tapered diffusion (was `'ar'`)

Inlined in `js/electric.js`. Source: the discrete Laplacian of the
`MAG_RANGE`-windowed Biot–Savart field (built by `magBuildCoilSource`).
Relaxation: red-black Gauss–Seidel on `∇² Bz = S`, warm-started, run
for `MAG_SWEEPS_PER_FRAME = 50` sweeps per frame. The Dirichlet border
is the grid edge plus `blocked` cells (same treatment as `'hy3'`).

The coupling that drives `m.lastFcoil` and the motional EMF is the
*analytic* windowed-kernel gradient (`magBuildCoupling`), not a
finite difference of the relaxed grid — the relaxed grid carries
field values, the analytic kernel carries the derivatives. This is
why the closed-loop energy identity closes algebraically under
`'tapered'` but not under `'hy3'` or `'diffusion'`.

- **Tuning**: `MAG_RANGE = 8` cells (slider `[2, 16]`). Larger →
  longer reach; smaller → tighter, more 2D-looking coupling but
  weaker net force on centred magnets (the net force is a small
  residue of large cancelling near-field terms and flips sign below
  `~7` cells).
- **Per-magnet dipole emission**: when `magEmitAll` is on (or the
  piston's `emit` flag), every magnet also injects its own dipole,
  so magnets push on each other and the B-field view shows their
  dipoles. The action = reaction residual is strict to the last
  bit in this engine.
- **Back-EMF**: yes — `magApplyEmfDiffusion` writes `e.E` on
  `fieldEdges` from the same analytic kernel that drives force.

## `'hy3'` — Hy3 screened-Poisson

`js/magBzPoissonHy3.js` (file renamed from `js/magfield_diffusion.js`
in this plan; the old name is now used by the `'diffusion'` engine).

```
(∇² − λ²) Bz = S
```

relaxed by red-black Gauss–Seidel
`Bz[n] = (Σ_nbr Bz_nbr − S[n]) / (4 + λ²)` for `MAG_SWEEPS_PER_FRAME`
sweeps per frame, warm-started.

- **Source** `S` is the discrete curl of the edge currents (`+I` at
  one endpoint, `−I` at the other, skipping magnet self-edges). A
  `MAG_SRC_GAIN_HY3 = 20` scalar compensates the small
  Stokes-formulation normalization so the field is in the same
  ballpark as `'tapered'` at the same `K_B`.
- **Self-field cancellation**: when `MAG_DIPOLES` is on, each magnet
  also injects its own dipole as two opposite point sources, and
  `magBzPoissonHy3Publish` subtracts that magnet's own dipole field
  (re-solved from a cold start with `MAG_SWEEPS * 6 = 240` sweeps)
  from the gradient it samples, so a dipole exerts no net force on
  itself but still feels wires and other magnets. The action =
  reaction residual is bounded but not strict (Phase 2 tuning item).
- **Tuning**: `MAG_LAMBDA = 0.15` (slider `[0.02, 1]`). Smaller `λ` =
  longer decay length.
- **Back-EMF**: no. Hy3 Phase 1 ships without `e.E` injection.

## `'direct'` — legacy Biot–Savart (obsolete)

Inlined in `js/electric.js`. Per-frame Biot–Savart summation over
every current edge for every magnet, with a hard `MAG_RMAX = 8` cell
cutoff. No window, no warm-start, no power projection. Kept
selectable for regression / cross-engine comparison; no new
features planned.

- **Back-EMF**: yes — `magApplyEmfDirect` writes `e.E` on
  `fieldEdges` with the legacy hard-cutoff kernel.

## Boundary treatment, summarised

| Engine       | Stencil (interior)         | Blocked / out-of-bounds neighbour           | Self-force cancellation |
|--------------|----------------------------|----------------------------------------------|--------------------------|
| `'tapered'`  | Gauss–Seidel `Σ/4 + S/4`   | Dirichlet-0 (substituted)                    | n/a (analytic kernel)    |
| `'hy3'`      | Gauss–Seidel `(Σ − S)/(4+λ²)` | Dirichlet-0 (substituted)                 | yes, when `MAG_DIPOLES`  |
| `'diffusion'`| Forward-Euler `Δt·(Σ − 4·Bz)` | Dirichlet-0 (substituted)                 | n/a (no dipole source)   |
| `'direct'`   | n/a (per-edge sum)         | n/a (kernel hard-cut at `MAG_RMAX`)          | n/a (kernel hard-cut)    |

All three Poisson-like engines use the same Dirichlet convention
(substitute `0` for missing neighbours, keep the stencil weights
uniform) — a truncated discretization. Strict Dirichlet on an
irregular boundary would require a per-cell correction to the
stencil weights reflecting the count of valid neighbours; the
practical effect is a slight over-damping near walls.

`'direct'` is different: it does no relaxation at all, so the
"boundary" question reduces to where the kernel hard-cuts.

## Per-engine UI control

The same `#magRange` slider is re-bound per engine:

| Engine       | Slider range | Unit  | Binds to              |
|--------------|--------------|-------|-----------------------|
| `'tapered'`  | `[2, 16]` step 1 | cells | `MAG_RANGE`         |
| `'hy3'`      | `[0.02, 1]` step 0.01 | λ | `MAG_LAMBDA`        |
| `'diffusion'`| `[0.02, 0.25]` step 0.01 | α | `MAG_DIFFUSION_ALPHA` |
| `'direct'`   | hidden        | —     | —                     |

`#magEmitAll` ("Magnets emit B") is visible only under `'tapered'`.
`#magDipoles` (Hy3 dipole toggle) is visible only under `'hy3'`.
`'diffusion'` and `'direct'` show neither — they have no per-engine
toggles in this plan.

## Files

- `js/state.js` — engine selection, defaults, tuning constants,
  status-bar label.
- `js/electric.js` — EMF injection site (4-way switch, only
  `'tapered'` and `'direct'` write `e.E`) and field-advance site
  (4-way switch, one arm per engine). `magReset()` clears
  `fieldBz` and calls the engine-local reset (if exposed) via
  `typeof` guards.
- `js/magfield_diffusion.js` — `'diffusion'` engine.
- `js/magBzPoissonHy3.js` — `'hy3'` engine.
- `js/ui.js` — selector `<select>`, slider re-binding, telemetry.
- `index.html` — selector `<option>` list, `<script>` tags (load
  order: state → maze → network → render → electric → hy3 engine →
  diffusion engine → air → ui), `Magnetics` label title.
- `js/test_magdiff.js`, `js/test_solenoid.js` — engine cross-tests
  (use the same `getRef` / `runCode` / `clearBoard` / `railScene` /
  `step` helpers; `clearBoard()` resets the engine to `'tapered'` so
  the existing tests for the analytic engine still pass, and the
  new diffusion test block sets `'diffusion'` explicitly).
- `.kilo/plans/` — design history (see `1788383164355-add-diffusion-engine.md`).
