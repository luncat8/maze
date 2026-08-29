# Solenoid / Magnetic DC Machine — Implementation Plan

Status: PLAN (not yet implemented). Author session notes 2026-08-29.

**Rev 3 — proper field-based magneto-electric model.** What changed vs Rev 2:

- **No more "coil detection".** The magnet does NOT scan neighbouring lines and
  pattern-match a pair of conductors. Instead we compute the **magnetic field
  over the whole grid from the actual currents** flowing in every conductor
  (wires, metal floor, loads, the moving armature bridge). The magnet responds
  to that field directly: its force comes from **B and ∇B at its own
  location**.
- **"A coil" is therefore anything that carries current** — a single wire, a
  loop, two rails, a painted metal strip, an arbitrary L-shaped wire run.
  Whatever the shape, the same kernel produces the field, the force, and the
  back-EMF. No fixed-geometry special cases.
- **Energy is conserved exactly by construction:** force and back-EMF are
  derived from the **same per-conductor kernel** (reciprocity), so
  `Σ_e EMF_e·I_e + F·v = 0` per frame, automatically. Lenz drag and motor
  back-EMF both *emerge*; they are not added as separate terms.
- Case A (magnet rides on the rails, loop closes through the body) and
  Case B (magnet between conductors, loop closes elsewhere) are **emergent
  configurations** — one code path, no branch on geometry.

---

## 1. What the sketch asks for

Reference sketch (`08-plan-solenoid.webp`), three numbered effects:

1. **Pressure** drives a magnet-fitted 2×1 piston in a tube (exists).
2. **Moving magnet produces electricity** in the conductors around it
   (Faraday; generator).
3. **Current produces force on the magnet** (Lorentz; actuator).

The feature is a **bidirectional electromechanical transducer** between the
air engine and the electric engine, with a single coupling constant and a
single kernel so energy is kept in both directions.

---

## 2. The physical model (core)

### 2.1 Convention for the 2D top view

- Conductors (wires, metal floor, loads, battery poles) are cells with a
  voltage from the field solve; **currents flow in the board plane** along the
  grid edges between adjacent conductor cells (this is already exactly what
  `js/electric.js` computes — see `computeHeatSource`, which already
  evaluates per-edge `dV` and `Re = heatR[i]+heatR[j]`).
- In-plane currents create a magnetic field **perpendicular to the board**:
  one scalar field `Bz(x, y)` (sign = direction out of / into the board,
  standard right-hand rule). This is what makes the hand rule work: current →
  `Bz` → force on the magnet, all deterministic.
- A magnet body is modelled as a **magnetic dipole with out-of-plane moment
  `m`** (game convention; think of a magnetized puck: S face down / N face up
  on the board). `m` is a signed slider (`magStrength`, ±) — its sign is the
  polarity / "winding". The red/blue pole caps drawn on the body ends are the
  ± rail contacts (Case A) and the visual polarity of the equivalent loop
  current; the ⊙/⊗ symbols on the body show the **moment direction** `m`
  (out of / into the board).

### 2.2 Currents are taken from the field solution

For every conductive edge `e = (a→b)` in every active field system:

```
Re(e) = R[a] + R[b]                      // exactly as today (edgeR / gOf)
I_e   = (V[a] − V[b] + E_e) / Re(e)      // signed, positive a→b
```

where `E_e` is the magnet-induced back-EMF in that edge (§2.4; zero when no
magnet is moving). Edges are stored with a **fixed orientation** (low cell
index → high cell index, row-major) so `I_e` and the kernel are unambiguous.

`I_e ≠ 0` **only where cells are at different voltage** — which is exactly the
draft's rule ("force in the cell between different voltage"). A bare wire
carrying no current produces no field; the moment current appears, the field,
the force, and the EMF follow from one kernel.

### 2.3 Magnetic field from actual currents (Biot–Savart, one kernel)

Each conductive edge is a small current element at its midpoint
`r_e = ((a+b)/2 cell coords)`, direction `dl_e` = unit vector along the edge
(±x or ±y). The field at any point `x`:

```
r        = x − r_e
g_e(x)   = (dl_e × r)_z / (|r|² + σ_B²)
         = (dl_x·r_y − dl_y·r_x) / (r_x² + r_y² + σ_B²)

Bz(x)    = K_B · Σ_e  I_e · g_e(x)
```

- `K_B` = global magnetic constant (in-game "permeability" gain, GUI slider) —
  the single knob that replaces the old `Kc`.
- `σ_B ≈ 0.5 cell` soft core: regularizes the kernel where the magnet touches a
  conductor (Case A rides ON the rails) and keeps forces smooth across cell
  boundaries (same jitter requirement as the piston model).
- **Cutoff radius** `r_max ≈ 8 cells`: beyond it the 1/r kernel is negligible;
  a spatial hash on cells keeps `O(edges × near-magnets)` cheap. Both the
  force and the EMF use the identical kernel so the truncation cannot break
  energy (nothing outside the cutoff is coupled at all).

### 2.4 Force and back-EMF — one kernel, two directions (reciprocity)

For magnet `b` with moment `m_b`, position `x_b`, velocity `v_b` along its
motion axis `â`:

```math
force (Lorentz/Laplace, motor + generator-return):
F_b   = m_b · (∂Bz/∂x · â) = m_b · K_B · Σ_e I_e · (∂g_e/∂x · â)

back-EMF per conductor edge (Faraday, induced by motion):
E_e,b = −m_b · K_B · (∂g_e/∂x · â) · v_b        [V, positive a→b]
```

- `∇B` is taken as the **analytic derivative of the same soft-core kernel**
  (no grid differencing, no pattern matching): a single wire attracts/repels
  the magnet and pulls toward its current; two opposite-current rails create a
  strong `Bz` between them with gradients at the ends (the classic "pull into
  the solenoid" behaviour); a metal floor with an eddy-like current pattern
  pushes the magnet along its gradient. All of this is *output*, not code
  paths.
- Each magnet contributes `E_e,b` to every edge in range; the field solve
  receives `E_e = Σ_b E_e,b` (multiple magnets simply superpose — two magnets
  can drive one loop, which is exactly the demo scene).

### 2.5 Energy identity (why signs are exact)

With `F_b = m_b K_B Σ_e I_e ∂_x g_e` and `E_e,b = −m_b K_B v_b ∂_x g_e` (both
from the same `g_e`), summing over edges and magnets:

```math
Σ_b F_b · v_b  =  Σ_b m_b K_B v_b Σ_e I_e ∂_x g_e
               = −Σ_e (Σ_b E_e,b) I_e
               = −Σ_e E_e · I_e
```

So **mechanical power + all induced-EMF sources' electrical power = 0** every
frame, exactly, for any conductor geometry and any number of magnets:

- **Generator** (magnet pushed by gas): induced `E_e` drives current in its own
  direction → `Σ E_e I_e > 0` (power delivered to the circuit) → `F·v < 0`:
  the magnet decelerates — **Lenz drag**.
- **Motor** (battery drives current): current flows against the induced EMF →
  `Σ E_e I_e < 0` → `F·v > 0`: the field pushes the magnet — and as `v` grows,
  the induced EMF opposes the battery and **limits the current** (back-EMF).

Nothing extra is coded for Lenz or back-EMF: they are the same term seen from
each side. `ΣE·I = −F·v` is enforced by construction, so an energy audit closes
to round-off for any wiring (single wire, loop, rails, floor, Case A, Case B).

### 2.6 No detection, no special geometry (hard rule)

- The magnet is coupled to **every edge within `r_max` that carries current**.
  There is no code path that asks "is this a coil?" or matches a shape.
- Placement only decides *what the body is* (Case A armature bridge is a
  conductor; Case B body is not) — it never decides *what it couples to*.
- `cellOccupied`/air/`cellR` never treat a magnet as "finding" conductors; the
  field solve is the single source of truth.

---

## 3. Hard constraints (must not break)

- Vanilla JS + `<canvas>`, no build step, `file://`-runnable.
- `state.js` dir order fixed: `0=Up(0,-1) 1=Right(1,0) 2=Down(0,1) 3=Left(-1,0)`;
  every new table (edge orientation, kernel cross-product, pole mapping) uses it.
- Keep the continuous, mass-conserving piston model in `air.js`; no discrete
  offset shifts or manual mass moves; `isAir` vs `blocked`, `airVol`,
  `P = (n/airVol)·R·T` unchanged.
- Field engine only (`activeEngine='field'`); circuit engine frozen.
- **No shape recognition / no fixed-coil geometry** anywhere in the magnetic
  coupling (constraint for review, not just a guideline).
- Electricity consumes power like a lamp/pump (GODMODE free), reports waste
  heat to the air.
- Body speeds stay ~0.1–5 cells/s (solenoid drives included).
- Energy audit: `Σ E_e·I_e + Σ F_b·v_b = 0` to floating-point tolerance every
  frame in tests.

---

## 4. The two cases (both emergent, no special-casing)

### 4.1 Case A — magnet rides on the rails (loop closes through the body)

```
      battery
      +  −
      │  │
+++++[x+]++++         ← + rail row
----- [x-] ----       ← − rail row
```

- The body is placed **perpendicular to its motion** (1×2, long axis across
  the two rail rows); its pole cells sit on the two conductor rows. The rail
  cells stay conductive (wires/metal are air-passable; a body overlapping
  them does not change `cellR` of the rail cells themselves).
- The **moving bridge through the body** is a conductor: while the body
  occupies two adjacent conductor cells, the edge between them carries the
  armature resistance `R_arm` (acting on the generic edge the solver already
  builds; see §6.4). Battery → + rail → body bridge → − rail → battery is then
  just a normal circuit. **The loop closes through the moving body — the two
  rail ends need not be connected anywhere else.**
- The magnet feels `F = m∇Bz` from the *rail* currents (the self bridge edge is
  excluded from its own `Bz`; its own back-EMF is ~0 by the symmetric
  soft-core kernel — see §6.5). Pushed by gas → rail currents are induced →
  Lenz drag; driven by battery → the field pulls/torques it along.

### 4.2 Case B — magnet between conductors (loop closes elsewhere)

```
+++++          ← + rail row
 xx            ← 2×1 magnet piston, axis along the tube
-----          ← − rail row
```

- The magnet is a normal axial piston between the two conductor rows; the
  wires never overlap it. Nothing in placement differs from a plain piston
  except `magnet:true`.
- If the rails (or any other conductors) form a closed loop elsewhere, the
  field solve sees the loop; a moving magnet induces per-edge EMF on **all**
  edges of the loop (rails **and** external wires and the battery/lamp branch
  — the kernel attribute each edge by its own distance/gradient), so current
  flows and the magnet feels the reaction force. **If the loop is open, there
  is no current, no force, no energy** — nothing is invented.
- Direction is deterministic: `fieldV` → `I_e` → `Bz`/`∇Bz` → `F`; reversing
  the magnet polarity or the battery polarity reverses the force.

### 4.3 What differs in code

| | Case A | Case B |
|---|---|---|
| body orientation | `axis ≠ moveAxis` | `axis = moveAxis` |
| moving bridge edge | yes (`R_arm`) | no |
| conductor participation | body cells replace edge R by `R_arm` | none |
| force / EMF paths | identical (§2.4 kernel) | identical |

Both cases are covered by the same `fieldSimulate` → `fieldRelax` →
`fieldPublish` → `airRelax` pipeline; only the mechanical body (`moveAxis`)
and one edge-resistance rule differ.

---

## 5. Data model / state (`js/state.js`)

Keep the Rev 2 **`createMechanicalBody()`** factory (composition, shared by
piston and solenoid):

```js
function createMechanicalBody(spec) {
  return {
    id: ++bodyIdSeq,
    kind: spec.kind,                 // 'piston' | 'solenoid'
    x, y, axis, moveAxis,            // axis = long axis, moveAxis = motion axis
    pos, vel: 0,
    friction: 50, damping: 200, mass: 100,
    limited: !unlimited,
    magnet: !!spec.magnet,           // plain pistons stay magnet:false
    magStrength: spec.magStrength ?? 1,   // signed dipole moment m (±)
    R_arm: spec.R_arm ?? 2,          // Ω armature bridge (Case A)
    efficiency: spec.efficiency ?? 0.85,
    lastFpress: 0, lastFfric: 0, lastFcoil: 0,
    lastBz: 0, lastEMF: 0, lastCurrent: 0, lastPower: 0, lastHeat: 0,
    blockedWall: false
  };
}
```

- `bodies[]` replaces `pistons[]` (keep `const pistons = bodies` alias for
  existing sites/tests); `INV.solenoid` = "Magnet Piston (Solenoid)" calling
  the factory with `{kind:'solenoid', magnet:true}`.
- **No `solenoids[]`, no `coil` fields, no poles stored on the body** — the
  "coil" is whatever carries current near it (§2.6).
- Occupancy/eraser/clear/seed gating: `bodies` everywhere `pistons` is today.
- Mode A placement: needs a 2-cell corridor *across* two conductor rows/cols
  (use `cellR`/wire/metal state, not a pattern); Mode B: like today's piston.
- Readouts on the body: `lastBz` (field at body), `lastEMF` (signed
  equivalent EMF = `lastPower / |lastCurrent|`, §6.6), `lastCurrent`
  (armature / loop current), `lastFcoil`, `lastHeat`, `lastPower`
  (signed conversion power: >0 generator, <0 motor).

---

## 6. Electric integration (`js/electric.js`, field engine only)

### 6.1 Per-edge current + kernel registry

In `fieldSimulate()`:

- Collect a flat **edge list** per system: `{ a, b, Re, dl }`, `a<b`
  (row-major), `dl` 1×2 vector in `dirs`-consistent orientation, `Re =
  R[a]+R[b]`, with the existing forbidden-pairs (battery poles) skipped —
  identical to what `computeHeatSource` already iterates (forward dirs only).
- Keep the map keyed `min:max` so `fieldPublish` can write `I_e` back.
- Build a **cell → edge indices** spatial hash for the kernel loops, and a
  magnet list of **all** magnets (`bodies.filter(b => b.magnet)`). A magnet
  contributes to `E_e` only while `|v_b| > tol`, but it contributes to `Bz`/
  `F` **even at rest** — a stationary magnet inside an energized coil must
  still be pushed (that is the motor case).

### 6.2 Systems (extend the source-root rule)

A relaxation system is built for a connected conductor component if it
contains:

- a battery (existing rule), **or**
- a magnet-induced EMF — i.e. a moving magnet within coupling range **and** the
  component has at least one cycle (closed loop, or a battery feeding it,
  in which case the battery rule already applies).

Ground: first battery `−` pole if any, else the first system node. A short
open conductor run with no loop and no battery still forms no system (no
current can flow; nothing to solve). Cycle check is free: in a connected
component with `n` nodes, a cycle exists iff `edges > n − 1`.

### 6.3 Per-edge EMF source (the "battery whose EMF varies with velocity")

For every active system, before relaxation:

```
E_e = Σ_b E_e,b = −Σ_b m_b · K_B · (∂g_e(x_b)/∂x · â_b) · v_b
```

Injected as a **Norton source on the edge itself** (an edge EMF is exactly a
Thevenin source in series with the edge's own resistance):

```
I_n(e) = E_e / Re(e)
inj[b] += I_n(e)      // EMF pushes current a→b
inj[a] −= I_n(e)
```

- The edge's `g_e = 1/Re` stays in `Ga` — the source and its internal
  resistance share the edge, exactly like a battery's `g_int` + `I_n`, and
  the back-EMF/current limiting then **emerges from the solve** (no special
  motor formula).
- `E_e` uses the body velocity from the **previous** air step (one-frame lag,
  same as the draft's ordering note; stable, and the field already relaxes
  over many frames). `E_e` is recomputed every frame while any magnet moves;
  `fieldV` is warm-started so nothing pops.
- When a magnet moves, `fieldSimulate()` is re-run (it must be, because the
  Case A bridge edge moves); N=961 so it is cheap. If no magnet moved, reuse
  the previous systems.

### 6.4 Case A armature edge

While a body with a Case-A bridge is present (`axis ≠ moveAxis`), the generic
edge between its two pole cells gets `Re = R_arm` (instead of `R_wire+R_wire`).
Implement as a small `edgeR(u,v)` override consulted by `gOf`/heat:
```
if (bridgeEdge.has(min:max)) return b.R_arm;
```
The bridge edge is a *normal* conductor edge — current through the body is
solved for, its `I²R` heat is counted, and it magnetically couples to *other*
magnets (it is not excluded from their kernels — only from its own body's).

### 6.5 Self-exclusion (no fictitious self-force)

For magnet `b`, edges that belong to the body itself (the Case-A bridge and
any conductor cell the body overlaps) are excluded from `Bz_b` and `F_b` —
a conductor cannot exert a net force on itself. The corresponding
back-EMF contributions are symmetric about the moving body and integrate to
~0 (soft core), so energy is unaffected; still exclude them from `E_e,b` for
symmetry and robustness.

### 6.6 `fieldPublish()` — B, force, readouts, heat

After relaxation (currents now known):

```
for each system edge: I_e = (V[a] − V[b] + E_e) / Re(e)
for each magnet b:
  Bz_b = K_B Σ_e I_e · g_e(x_b)                     // self edges excluded
  ∇Bz_b = K_B Σ_e I_e · ∇g_e(x_b)                   // analytic gradient
  F_b = m_b · (∇Bz_b · â_b)                         // axial projection
  b.lastBz = Bz_b; b.lastFcoil = F_b
  b.lastPower = Σ_e E_e,b · I_e                     // >0 generator, <0 motor
  b.lastCurrent = Case A ? bridge current : max|I_e| over coupled edges (loop current)
  b.lastEMF = b.lastPower / max(|b.lastCurrent|,ε)  // signed equivalent EMF (V)
  b.lastHeat = (Σ_e E_e,b·I_e)·(1−η) + I_bridge²·R_arm
```

Then in `computeHeatSource()`:

- Per-edge Joule heat for the magnet-induced currents is **already computed by
  the existing generic loop** (`P = dV²/Re` from `heatR`) — update its `dV`
  to the EMF-aware `V[a]−V[b]+E_e` so generator currents heat the wires
  correctly.
- Add `b.lastHeat` to the body's two cells (mirror the pump line).
- GODMODE: no battery draw changes; magnet coupling and heat stay physical.

### 6.7 Loop gating

`electricActive()`: add `|| bodies.some(b => b.magnet)` so a live magnet keeps
the unified loop running (it must, to inject EMF and read force).

---

## 7. Mechanical / air integration (`js/air.js`)

Unchanged from Rev 2 except the force source:

- Piston loop iterates `bodies`; after `F_press`/friction:
  ```
  F_coil = b.lastFcoil || 0          // published by fieldPublish this frame
  F_net  = F_press + F_fric(...) + F_coil
  ```
  Static lock uses `|F_press + F_coil|`; ±6 clamp and wall clamp unchanged.
- Mode A cross-axis chamber (2-row carriage): occupancy, `getChamber`,
  `faceBlocked` generalized over `(axis, moveAxis)`; `axis===moveAxis` reduces
  to today's code bit-for-bit.
- `isAir`/`syncPistonOccupancy`/`heatAirActive`: `bodies` in place of
  `pistons`; coil/wire/metal cells are **never** air obstacles (a magnet is
  hermetic, a wire is not a wall).
- **No spring on the body** (deferred, §11).

---

## 8. Gas engine: real work + temperature change

(Unchanged from Rev 2 — the field model does not affect it.)

- Switch energy bookkeeping to `AIR_CV = AIR_CP − R_SPEC` (≈718 J/kg·K,
  γ≈1.40); all `T↔U` conversions use `cv`.
- Advect **enthalpy** `h = u + P/ρ = cp·T` with mass flux (flow work is
  accounted where gas crosses faces; pump/source/sink lines updated).
- Piston P–V work each move:
  ```
  dV = (newPos − pos)·A
  uRear  −= pBack·dV       // expansion does work on gas (gas cools)
  uFront += pFront·dV      // compression work done on gas (gas heats)
  ```
  then the existing proportional redistribution. Clamp `u ≥ 0`; apply only
  when `|dPos| > 1e-7`. **Never** add the work term as a force (no feedback
  into `F_net`) — heat only, so the jitter regression stays green.
- Verify: closed adiabatic chamber satisfies `P·V^γ ≈ const`; compression
  heats, expansion cools; no-heat/no-friction piston conserves
  `U + ½mv²`.

---

## 9. Rendering (`js/render.js`)

- **Magnet body**: gold/amber with red `+` / blue `−` rail-contact caps on the
  ends (Case A) and a ⊙/⊗ symbol for the moment `m` (out of/into board);
  plain pistons unchanged. Case A draws the perpendicular orientation.
- **Field overlay** (the "show the physics" convention): draw `Bz` as a
  subtle blue/red tint over conductor cells (or a `Bz` view mode), plus small
  current arrows on every edge from `I_e` — the user can *see* that force
  comes from actual currents, and verify the hand rule by eye.
- **Force arrow** for `lastFcoil` (amber) beside the velocity arrow; a small
  `Bz`/EMF/current readout on selection.
- `bodies.forEach(drawBody)`; property binder rows for magnet (checkbox),
  magStrength (± slider), `R_arm`, efficiency, friction/damping/mass (shared
  `prop-tpl-body`), readouts.

---

## 10. UI + demo scene

- `solenoid` = "Magnet Piston" inventory/GOD item; placement A/B by corridor
  shape + conductor presence; eraser/pick/clear/reset alongside pistons.
- Wire + metal tools unchanged — conductors are built with existing tools.
- `index.html`: `prop-tpl-solenoid`, shared `prop-tpl-body`, scene button
  **"Solenoid Lab"**.
- GUI readouts: `Bz` at magnet, `E_e·I_e` total (signed), armature current,
  force, waste heat.

**Scene `solenoid-lab`** (draft's test: gas moves magnet → wires produce
electricity → electricity moves another magnet):

```
Rig A (generator):  air source + valve → tube → magnet piston (Case B)
                    → rails → wires ─────────┐
                                            │ one wire network
Rig B (motor):      magnet piston (Case A) ←─┘ ← rails + battery + switch
                    → tube with valve (pressure gauge at the far end)
```

Gas moves Rig A's magnet → currents are induced in the loop → Rig B's magnet
is pushed → air moves at Rig B's end. Fully closed energy chain
(gas → electricity → gas), measurable with the audit readouts. A third,
optional rig shows a **single energized wire** pushing a magnet (the simplest
possible "coil").

---

## 11. Deferred: return spring (separate object)

Unchanged from Rev 2: a free-standing 1×2 object (stopper cell + spring cell,
air passes through, force `−k(x−rest)` on any pressing piston), placeable
anywhere, independent of the magnet body. Not part of `createMechanicalBody`.

---

## 12. Tests (`js/test_solenoid.js`, new; headless VM loader from
`test_piston_pump.js`)

1. **dirs ordering** unchanged; edge orientation / kernel cross-product match
   `dirs` for `±x` and `±y` edges.
2. **Body factory/composition**: piston vs solenoid share fields; Mode A body
   has `axis ≠ moveAxis`; plain piston default unchanged; hermetic cross-axis
   chamber conserves mass and seals both rows (no leak).
3. **Field from a single wire:** one battery + one straight wire; magnet
   beside it feels `F` toward/away from the wire per polarity; no current →
   `Bz = 0, F = 0`; reversing current reverses `Bz` and `F`.
4. **Rails/loop (solenoid):** two opposite-current rails → `Bz` strong and
   near-uniform between them; magnet at the end is pulled toward the middle;
   at center `∇Bz ≈ 0`. Works for wire rails **and** painted metal rails and
   mixed.
5. **Arbitrary geometry (no pattern matching):** an L-shaped wire run, a
   zig-zag loop, a wide metal sheet with a diagonal-ish current path — each
   produces a well-defined `Bz`/`F` via the kernel (asserts against the
   analytic sum, not against a "coil" shape).
6. **Case A:** body on rails, open rail ends: battery → rails → bridge →
   battery is a closed circuit; current flows through the bridge; force from
   rail field per hand rule; open battery → no current → no force.
7. **Case B:** body between rails, loop closed elsewhere: gas pushes body →
   lamp in the loop receives `dV > DV_LIT`, `lastPower > 0`; open the loop →
   no current, no force, no lamp.
8. **Back-EMF:** battery-driven motor: `|I_coil|` falls as `|v|` rises and
   approaches zero at no-load speed; motor input power ≥ mechanical output.
9. **Lenz drag:** closed loop + moving magnet decelerates faster than open
   loop (energy audit: Δmech + Δelec + Joule + waste closes to tolerance).
10. **Energy identity:** `Σ E_e I_e + Σ F_b v_b ≈ 0` every frame (round-off),
    for single wire, rails, floor, Case A, Case B, and the two-magnet scene.
11. **Metal floor:** painted metal rails/sheet behave identically; magnet
    moving over a metal sheet with a closed external loop induces distributed
    currents and drag.
12. **Waste heat:** `heatSource` rises on the body cells and on the wires
    carrying induced currents; GODMODE magnet couples without battery drain.
13. **Gas work:** adiabatic compression heats (`T↑`, `P·V^γ ≈ const`);
    expansion cools; `ΔU ≈ ∫P dV`; enthalpy advection conserves energy.
14. **Jitter regression:** magnet gliding over/through any conductor shows 0
    per-frame velocity reversals (extends the piston suite's test 9).
15. **Scene smoke test:** `solenoid-lab` loads, expected counts, no exceptions.

Run: `node js/test_solenoid.js`; keep `test_piston_pump.js` (35) and
`test_electric_demo.js` (17) green.

---

## 13. Calibration targets

- `K_B` such that: a magnet at 1–2 cells/s induces a few volts across a
  1-cell-long rail pair (lamp lights); a battery-driven rail pair yields
  `F` of tens–low hundreds of N (visible, but friction 10–100 N is not
  trivially overwhelmed).
- `σ_B ≈ 0.5 cell` soft core, `r_max ≈ 8 cells` cutoff. Kernel smoothness is
  the jitter guarantee — no per-frame force steps anywhere.
- `magStrength` default ±1 (slider 0.2–5), `R_arm` 2 Ω, `η` 0.85; expose
  `K_B, magStrength, R_arm, η, σ_B` as sliders.
- Case A: a short fed rail span moves the carriage at ~0.1–5 cells/s;
  Case B generator: lamp lights and the magnet visibly decelerates.

---

## 14. Milestones (ship order)

1. **M1 – Mechanical body refactor:** `createMechanicalBody()`, `bodies[]`,
   Mode A cross-axis chamber, render both orientations; all existing suites
   green. (Tests 1, 2.)
2. **M2 – Field core:** per-edge current registry, `Bz`/`∇Bz` kernel, magnet
   force, Case A armature bridge (edge R override), readouts + `Bz` view.
   (Tests 3, 4, 5, 6.)
3. **M3 – Back-EMF + generators:** per-edge Norton EMF injection, source-root
   systems without batteries, Lenz drag, lamp lights, Case B rig, full
   `solenoid-lab` network. (Tests 7, 8, 9, 10, 11, 15.)
4. **M4 – Gas work:** cv/enthalpy + piston P–V work, comp/expansion
   temperature, energy audit, jitter regression. (Tests 12–14.)
5. **M5 (deferred) – Spring object** per §11.

Each milestone runs from `file://` and keeps the existing suites passing.
