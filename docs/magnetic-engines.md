# Magnetic engines

The project ships four selectable magnetic engines, switched by
`magEngine` in `js/state.js`. The four values are unique; the dispatch
in `js/electric.js` is an explicit 4-way switch, and the UI
`<select id="magEngineSel">` in `index.html` exposes all four.

| Value       | Module                     | Default | Has back-EMF? | Dipoles? | File comment header              |
|-------------|----------------------------|---------|---------------|----------|----------------------------------|
| `'diffusion'` | `js/magfield_diffusion.js` | ✓       | no            | no       | "Visual-relaxation magnetic …"   |
| `'tapered'`   | `js/electric.js` (inline)  |         | yes           | yes (`magEmitAll`) | (inline; see `magApplyEmfDiffusion`, `magSolveDiffusion`) |
| `'hy3'`       | `js/magBzPoissonHy3.js`    |         | no            | yes (`MAG_DIPOLES`) | "Hy3 screened-Poisson …"         |
| `'direct'`    | `js/electric.js` (inline)  |         | yes (legacy)  | no       | (inline; see `magApplyEmfDirect`, `magSolveDirect`) |

Only the two engines that inject back-EMF (`'tapered'`, `'direct'`)
participate in the closed-loop energy identity `Σ E·I + Σ F·v = 0`.
`'hy3'` and `'diffusion'` are field-only; a magnet under them in a
closed circuit with a battery accelerates freely.

That is now said in three places so it cannot look like a bug:

- the status bar label carries a ` · field-only` suffix (from the
  shared `MAG_ENGINE_UI` table in `js/state.js`);
- the panel shows a `#magEngineNote` caveat line for the selected
  engine (`js/ui.js`, `magEngineOnChange`);
- the energy residual itself is **gated**: `magEngineInjectsEmf()` in
  `js/electric.js` decides whether `magEnergyResidual` is computed at
  all. When the active engine injects no back-EMF, `Σ E·I ≡ 0` and the
  "residual" would degenerate to `Σ F·v` — a number that reads like a
  convergence diagnostic but is not one. In that case
  `magEnergyResidualValid` is `false` and the value is `NaN`, so an
  assertion like `|residual| < 1e-9` fails loudly instead of passing on
  a meaningless zero; `magEnergyResidualText()` renders
  `n/a (field-only engine '…' injects no back-EMF)`. Injecting back-EMF
  under the field-only engines is Phase-2 work (it changes the
  closed-loop dynamics) and is recorded as out of scope.

## `'diffusion'` — explicit forward-Euler relaxation (default)

`js/magfield_diffusion.js`.

```
Bz ← Bz + α · (Bx⁺ + Bx⁻ + By⁺ + By⁻ − 4·Bz − S)
```

i.e. `∂Bz/∂t = α·(∇²Bz − S)`, run for
`FIELD_SWEEPS_PER_FRAME = 50` iterations per frame. The settled state is
the Poisson problem

```
∇²Bz = S,     S = K_B · MAG_SRC_GAIN_DIFF · curl J
```

— the same equation and the same source sign convention as `'hy3'` at
`λ = 0`, which is what keeps `m.lastFcoil`'s sign stable across an
engine switch.

- **Source** `S` is the discrete curl of the edge currents, computed
  in-file by iterating `fieldEdges` and skipping magnet self-edges via
  `edgeIsSelf` (sign convention matches `'hy3'` so `m.lastFcoil` has
  the same sign across engine switches). `MAG_SRC_GAIN_DIFF = 20`
  (in `js/state.js`, so tests/console can retune it) mirrors Hy3's
  `MAG_SRC_GAIN_HY3`, compensating the small Stokes-formulation
  normalization so the field is in the same ballpark at the same `K_B`.
- **Tuning**: `MAG_DIFFUSION_ALPHA = 0.20` (slider range `[0.02, 0.24]`,
  CFL stability `4·α ≤ 1`; α = 0.25 is exactly marginal — the
  amplification factor at the Nyquist mode is `g = 1 − 8α = −1`, a
  neutrally-stable checkerboard that never damps, so the slider caps at
  0.24, giving `g = −0.92`). The engine clamps **locally**
  (`const alpha = Math.min(MAG_DIFFUSION_ALPHA, 0.24)`) and warns; it
  does **not** rewrite `MAG_DIFFUSION_ALPHA`, so the slider readout
  never desyncs from the live value.
- **α is a speed knob, not a gain.** The source sits *inside* the α
  bracket, so α sets only the relaxation time constant (≈ `1/α` sweeps
  per frame) and the settled amplitude is α-independent. This was the
  16.1 T1 fix: with the old form (`Bz += α·∇²Bz + S`) the settled peak
  scaled as `1/α`, i.e. the *force* would swing ~12× across the slider —
  and, worse, an instant Poisson solve produced the same two peaks, so
  the old "proof of diffusion" smoke test proved nothing.
  `test_magdiff.js` 11a now varies the **sweep budget** at fixed α
  (the only variable a steady-state solve cannot respond to) and 11b
  asserts the settled amplitude is α-independent while the transient is
  not.
- **Behaviour**: the field genuinely spreads cell-to-cell over
  successive iterations. Measured on the rail scene at α = 0.20 with a
  converged circuit: peak `|Bz|` = 21.49 at a 5-sweep budget, 22.94 at
  50, 23.08 at 500, and 23.096 (the asymptote) by 2000.
- **Boundary**: zero Dirichlet on the grid edge and on `blocked`
  cells; blocked neighbours contribute `0` to the per-cell Laplacian
  sum. This is a *truncated* Dirichlet (per-cell stencil weights are
  not corrected for the count of valid neighbours), so the field is
  slightly over-damped near irregular boundaries. Not a no-flux
  (Neumann) condition — that would require mirroring the cell's own
  value.
- **No dipole support** (16.1 T3). The engine injects only the wire
  curl source, so with `MAG_DIPOLES` on a switch to `'diffusion'`
  silently drops the magnet↔magnet interaction. The fix is honesty, not
  math: the `#magDipoles` toggle stays hidden under this engine **and**
  selecting it logs a warning when `MAG_DIPOLES` is on (`MAG_DIPOLES`
  keeps its value, so switching back to `'hy3'` restores what the user
  had). A dipole injector here needs Hy3's self-field cancellation
  machinery and is Phase-2 scope.
- **Buffers** (engine-local to avoid name collisions with Hy3):
  `fieldBzDiff` (the engine's Bz), `fieldBzDiffScratch` (swap
  buffer for the Euler step), `magSrcDiff` (curl-J source).
- **Telemetry** is published through the shared
  `magPublishTelemetry(mags, bzAt, opts)` (`js/electric.js`); this
  engine passes no `selfGrad` because it has no self-field to cancel.

## `'tapered'` — analytic-tapered diffusion (was `'ar'`)

Inlined in `js/electric.js`. Source: the discrete Laplacian of the
`MAG_RANGE`-windowed Biot–Savart field (built by `magBuildCoilSource`).
Relaxation: red-black Gauss–Seidel on `∇² Bz = S`, warm-started, run
for `FIELD_SWEEPS_PER_FRAME = 50` sweeps per frame. The Dirichlet border
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

`js/magBzPoissonHy3.js`.

```
(∇² − λ²) Bz = S
```

relaxed by red-black Gauss–Seidel
`Bz[n] = (Σ_nbr Bz_nbr − S[n]) / (4 + λ²)` for
`FIELD_SWEEPS_PER_FRAME` sweeps per frame, warm-started.

- **Source** `S` is the discrete curl of the edge currents (`+I` at
  one endpoint, `−I` at the other, skipping magnet self-edges). A
  `MAG_SRC_GAIN_HY3 = 20` scalar compensates the small
  Stokes-formulation normalization so the field is in the same
  ballpark as `'tapered'` at the same `K_B`.
- **Self-field cancellation**: when `MAG_DIPOLES` is on, each magnet
  also injects its own dipole as two opposite point sources, and
  `magBzPoissonHy3Publish` subtracts that magnet's own dipole field
  (re-solved from a cold start with `MAG_SWEEPS * 6 = 240` sweeps —
  `hy3SelfGrad`) from the gradient it samples, so a dipole exerts no net
  force on itself but still feels wires and other magnets. The action =
  reaction residual is bounded but not strict (Phase 2 tuning item).
- **Buffers** are all lazily allocated in one place,
  `hy3EnsureBuffers()`: `magSrcHy3`, `magSrcSelfHy3`, `magBzSelfHy3`
  (plus the shared `fieldBz` overlay). Allocated on first use, never
  freed for the session; the grid is a fixed `GRID_W × GRID_H`.
- **Tuning**: `MAG_LAMBDA = 0.15` (slider `[0.02, 1]`). Smaller `λ` =
  longer decay length.
- **Back-EMF**: no. Hy3 Phase 1 ships without `e.E` injection.
- **Telemetry** goes through the shared
  `magPublishTelemetry(mags, bzAt, opts)`, with `opts.selfGrad =
  hy3SelfGrad` when `MAG_DIPOLES` is on.

## `'direct'` — legacy Biot–Savart (obsolete)

Inlined in `js/electric.js`. Per-frame Biot–Savart summation over
every current edge for every magnet, with a hard `MAG_RMAX = 8` cell
cutoff. No window, no warm-start, no power projection. Kept
selectable for regression / cross-engine comparison; no new
features planned.

- **Back-EMF**: yes — `magApplyEmfDirect` writes `e.E` on
  `fieldEdges` with the legacy hard-cutoff kernel.
- **Telemetry** is computed inline (it uses the analytic kernel rather
  than a grid sample), so it does not use `magPublishTelemetry`.

## Shared magnet self-edge rule

A body is never pushed by its **own armature current** — the Case-A
motor force comes from the rails, not from the bridge. Only the bridge
edge itself is excluded; edges merely *adjacent* to the body cells are
kept on purpose (a magnet legitimately feels nearby current, including
its own driving coil).

| Engine      | Mechanism                                                       |
|-------------|-----------------------------------------------------------------|
| `'tapered'` | `magSelfEdge(mag)` pre-computed in `magBuildCoupling` / `magBuildCoilSource` |
| `'hy3'`     | inline `edgeIsSelf(e, mag)` in `magBzPoissonHy3BuildSource`       |
| `'diffusion'`| inline `edgeIsSelf(e, mag)` in `magDiffusionBuildSource`         |
| `'direct'`  | inline `edgeIsSelf(e, mag)` in `magSolveDirect`                   |

Do not confuse this with Hy3's per-magnet self-**field** buffers
(`magSrcSelfHy3` / `magBzSelfHy3`): those cancel a magnet's own *dipole*
field when `MAG_DIPOLES` is on, which is a different mechanism that
merely happens to be per-magnet as well.

## Boundary treatment, summarised

| Engine       | Stencil (interior)         | Blocked / out-of-bounds neighbour           | Self-force cancellation |
|--------------|----------------------------|----------------------------------------------|--------------------------|
| `'tapered'`  | Gauss–Seidel `Σ/4 + S/4`   | Dirichlet-0 (substituted)                    | n/a (analytic kernel)    |
| `'hy3'`      | Gauss–Seidel `(Σ − S)/(4+λ²)` | Dirichlet-0 (substituted)                 | yes, when `MAG_DIPOLES`  |
| `'diffusion'`| Forward-Euler `α·(Σ − 4·Bz − S)` | Dirichlet-0 (substituted)              | n/a (no dipole source)   |
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

Everything below comes from the shared `MAG_ENGINE_UI` table in
`js/state.js` (`magEngineUi()`), which both `js/ui.js`
(`magEngineOnChange`) and `updateStatus()` read — the status-bar label
and the panel can no longer drift apart, and the label carries the
` · field-only` suffix for engines with `emf: false`.

The same `#magRange` slider is re-bound per engine:

| Engine       | Slider range | Unit  | Binds to              | Caveat note (`#magEngineNote`) |
|--------------|--------------|-------|-----------------------|-------------------------------|
| `'tapered'`  | `[2, 16]` step 1 | cells | `MAG_RANGE`        | —                             |
| `'hy3'`      | `[0.02, 1]` step 0.01 | λ | `MAG_LAMBDA`        | field-only (no back-EMF)      |
| `'diffusion'`| `[0.02, 0.24]` step 0.01 | α | `MAG_DIFFUSION_ALPHA` | field-only · dipoles unsupported |
| `'direct'`   | hidden        | —     | —                     | —                             |

`#magEmitAll` ("Magnets emit B") is visible only under `'tapered'`.
`#magDipoles` ("Magnets inject dipoles") is visible only under `'hy3'`.

Both labels are shown/hidden with the `hidden` property, which only
works because `index.html` carries `[hidden] { display: none !important }`
— the author rule `.ctrl { display: flex }` otherwise beats the UA
`[hidden]` rule, and an inline `style="display:none"` (what
`#magDipolesLbl` used to carry) cannot be undone by `hidden = false` at
all. Without that CSS rule the two toggles were respectively always
visible and never visible, whichever engine was selected.

## Files

- `js/state.js` — engine selection, defaults, tuning constants
  (including `MAG_SRC_GAIN_DIFF`), the `MAG_ENGINE_UI` table, status-bar
  label.
- `js/electric.js` — EMF injection site (4-way switch, only `'tapered'`
  and `'direct'` write `e.E`, gated by `magEngineInjectsEmf()`), the
  field-advance site (4-way switch, one arm per engine), the shared
  `magPublishTelemetry`, and `magReset()` (clears `fieldBz` and calls
  the engine-local reset via `typeof` guards). `FIELD_SWEEPS_PER_FRAME`
  lives here and is the single per-frame relaxation budget for both the
  V solve and the Bz advance.
- `js/magfield_diffusion.js` — `'diffusion'` engine.
- `js/magBzPoissonHy3.js` — `'hy3'` engine.
- `js/ui.js` — selector `<select>`, slider re-binding, telemetry.
- `index.html` — selector `<option>` list, `<script>` tags (load
  order: state → maze → network → render → electric → hy3 engine →
  diffusion engine → air → ui), `Magnetics` label title, the
  `[hidden]` CSS fix and `#magEngineNote`.
- `js/test_magdiff.js`, `js/test_solenoid.js` — engine cross-tests
  (same `getRef` / `runCode` / `clearBoard` / `railScene` / `step`
  helpers; `clearBoard()` resets the engine to `'tapered'` so the
  analytic-engine tests keep working, and the diffusion blocks set
  `'diffusion'` explicitly). `test_magdiff.js` test 11 covers the
  diffusion engine (11a transient growth vs sweep budget, 11b
  α-independence of the settled amplitude, 11c cross-engine sign +
  round-trip, 11d `K_B` slider wiring with and without a magnet);
  `test_solenoid.js` test 5d covers the L-loop sign contract.
- `01-plan.md`, `16.1-plan-add-diffusion-engine.md`, `17-plan.md` —
  design history for these engines and the open/closed work items.
