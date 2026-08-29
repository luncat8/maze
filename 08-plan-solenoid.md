# Solenoid / Magnetic Coupling — Implementation Plan

Status: PLAN (not yet implemented). Author session notes 2026-08-29.

---

## 1. What the drawing asks for

Reference sketch (`solenoid.webp`), three numbered effects:

1. **Pressure** drives a magnet-fitted 2×1 piston in a tube (already works — the
   piston/pump feature).
2. **Moving solenoid magnet causes electric field** — a magnet moving through a
   coil induces an EMF → **generator** (Faraday/Lenz). This is *new*.
3. **Field causes force on solenoid magnet** — current in a coil pushes/pulls the
   magnet → **actuator/motor** (Lorentz). This is *new*.

So the feature is a **bidirectional electromechanical transducer** between the
existing two engines:

```
  air pressure ─► piston (magnet) ──motion──► coil ──EMF──► electric grid
  electric grid ──current──► coil ──Lorentz──► magnet piston ─► air pressure
```

Energy conserves by construction (same coupling constant `Kc` on both sides).

---

## 2. Hard constraints (must not break)

- Vanilla JS + `<canvas>`, **no build step**, must run from `file://`.
- `state.js` direction order is fixed: `0=Up(0,-1) 1=Right(1,0) 2=Down(0,1) 3=Left(-1,0)`
  (`dirs[]`). Pump/solenoid direction tables MUST use this same order.
- Keep the continuous, shader-friendly, mass-conserving piston model added for
  the jitter fix (chamber-integrated pressure + proportional redistribution in
  `air.js`). Do **not** revert to discrete offset-shift / manual mass moves.
- `isAir` stays decoupled from `blocked`; partial piston occupancy keeps reduced
  `airVol`; pressure stays `P = (n/airVol)·R·T`.
- Electricity consumes power like a lamp/pump (has R + efficiency), is **free in
  GODMODE**, and reports waste heat to the air.
- Field engine is the live engine (`activeEngine='field'`). Circuit engine is
  frozen/obsolete — add the coil to the **field** path only; do not extend
  circuit engine.
- Piston typical speed stays ~0.1–5 cells/s.

---

## 3. Physics model (shader-friendly, continuous)

### 3.1 Coupling profile — one smooth scalar kernel

For a **magnet piston** `p` and a **coil** `c`, define the signed axial gap
`Δ`:

- horizontal coil (`c.axis='h'`), magnet travels in x:
  `Δ = magnetCenterX − coilCenterX = (p.pos + 1.0) − (c.x + 0.5)`
- vertical coil (`c.axis='v'`), magnet travels in y:
  `Δ = (p.pos + 1.0) − (c.y + 0.5)`

Only couple when the magnet and coil share the tube line (same `y` for h, same
`x` for v) and the *perpendicular* offset is small. Use a smooth Gaussian kernel
(no branchy discrete geometry, easy to port to a shader):

```
coupling profile:   φ(Δ)   = exp(−Δ² / (2 σ²))          // σ ≈ 0.9 cells
its spatial slope:  φ′(Δ)  = −(Δ/σ²) · φ(Δ)
```

- `φ` is the **flux linkage shape** (how much magnet flux threads the coil).
- `φ′` is the rate of change of linkage with magnet position.

### 3.2 Generator (effect 2): motion → EMF

Faraday: motional EMF in the coil =
```
EMF_gen = Kc · φ′(Δ) · v            [volts]
```
where `v = p.vel` (cells/s), `Kc` = coupling constant (V·s/cell per magnet
strength), tuned in the GUI. Sign of `φ′` handles approach vs. leave and
direction automatically.

In the **field diffusion engine** this becomes a Norton current injection — the
*same mechanism already used for batteries* in `electric.js`
(`g_int = 1/R`, `I_n = V/R` injected at + terminal, `−I_n` at − terminal):

- Coil self-resistance `c.R` → internal conductance `g_c = 1/c.R`.
- Injected current `I_n = EMF_gen / c.R` at the coil's + terminal and `−I_n` at
  its − terminal (terminal polarity = `c.dir`; winding sign via `c.winding ±1`).
- Coil must be a finite-resistance conductor node in the component DSU so its
  terminals are part of a closed loop; if there is no external load the coil's
  own `g_c` simply recirculates the current (no energy delivered — open circuit).
- Delivered electrical power (read out like pump `lastPower`):
  `P_elec = EMF_gen · I_ext`, where `I_ext = I_n − g_c·(V+ − V−)`.

### 3.3 Actuator (effect 3): current → force

Lorentz force on the magnet from coil current:
```
F_coil = Kc · φ′(Δ) · I_coil        [newtons, along tube axis]
```
where `I_coil` = the current actually flowing through the coil. This is read
straight from the field solution: the coil is a finite-R node, so its current is
`I_coil = dV / c.R` using the same two-terminal `dV` readout the pump uses
(`fieldPublish` pump branch). Sign: `φ′` already carries approach/leave; the
current sign (which terminal is higher V) sets push vs. pull — exactly the
`+` / `−` drawn beside the piston in the sketch.

Waste heat (Joule) into the air at the coil cell, like the pump:
`heatSource[c.idx] += I_coil²·c.R + P_elec·(1−η)` where η is an efficiency
slider (like the pump). The inductor stores/releases a little energy; for a
steady-state field solve we treat it as dissipative + coupled, no explicit L
dynamics needed (field already relaxes over frames).

### 3.4 Energy consistency (why the signs are exact)

Mechanical power extracted by a moving magnet (Lenz drag) =
`F_coil·v = Kc·φ′·I_coil·v = EMF_gen·I_coil`.
So mechanical power out == electrical power generated, with the **same `Kc` and
the same `φ′`** — the two effects share one kernel, guaranteeing energy
conservation and that "generator drag" and "motor push" are one reciprocal
coupling. The piston force in `air.js` therefore gains one extra term:
```
F_net = F_pressure + F_friction/damping  +  Σ_coils F_coil(p,c)
```
(plus the spring `F_spring` below). Reuse the existing static-friction lock and
±6 clamp.

### 3.5 Return spring (solenoid feel)

Real solenoids spring back when de-energised. Add a light centering spring so an
unpowered actuator piston doesn't drift forever:
```
F_spring = −k_spring · (p.pos − p.restPos) − c_spring · v
```
`restPos` = the piston's placed position (captured on placement). Sliders for
`k_spring` (N/cell), default small (e.g. 30 N/cell) so pressure can still
overcome it. Generator mode benefits too: magnet slows and recentres after a
pressure pulse, giving a clean EMF spike-and-decay.

---

## 4. Data model / state (`js/state.js`)

New item registry (mirror `pumps`/`pistons`):

```js
const solenoids = [];   // coils:  { id, x, y, idx, axis:'h'|'v', dir:0..3, winding:1|-1,
                        //           R, efficiency, Kc, turns, limited,
                        //           dV, lastPower, lastEMF, lastCurrent, lastHeat }
let solenoidIdSeq = 0;
```
- `axis` = coil axis / tube axis (parallel to the magnet travel). `dir` picks
  which conductor neighbour is the **+ terminal** (opposite neighbour is −).
  Reuse `PUMP_DIRS` (identical 0=N,1=E,2=S,3=W ordering) — rename/share as
  `DIR4` if convenient, but keep order.

Extend each piston (only when it carries a magnet):
```js
// on piston object:
p.magnet     = true/false;   // toggle in GUI; default false so plain pistons unchanged
p.magStrength= 1.0;          // scales Kc for this magnet
p.kSpring    = 30;           // N/cell return spring
p.restPos    = <pos on placement>;
p.lastFcoil  = 0;            // readout: net coil force this frame
```

Add to `INV` and `GOD_ITEMS`: `solenoid: { type:'solenoid', count:1, label:'Solenoid Coil' }`.
`INV.solenoid`, GOD item `{ id:'solenoid', label:'Solenoid Coil', tool:'solenoid' }`.

Include coils in occupancy (`cellOccupied`), eraser/return, scene reset/clear
lists, and `seedAir`/`heatAirActive` gating (`|| solenoids.length > 0`).

**Placement model (simple, grid-friendly):** a solenoid coil is placed **like an
air pump** — on a corridor cell of the tube the magnet slides in. It is a
sealed-for-the-magnet but **electrically conductive** cell:
- Air: coil cell is NOT air (wall to flow), same as pump → add to `isAir`
  exclusion and wall-clamp lists, and treat as obstacle in piston chamber scans
  (mirror every `pumps.some(...)` site with `solenoids.some(...)`).
- Electric: coil cell IS a conductor (finite `c.R`), exactly like a pump cell is
  a conductor today in `cellR`. Its two terminals are the two conductor
  neighbours along/normal as for a lamp/pump dV readout.
- Magnetism: a magnet piston couples to a coil cell when it slides *through/past*
  it on the same tube line, with `Δ` measured between magnet centre and coil
  centre. The piston chamber/wall logic already stops the solid piston at the
  coil cell, so the magnet sweeps `|Δ|` from ~1.5 down to ~0.5 — squarely within
  the Gaussian — before contact. (Strong coupling region; tune σ.)

---

## 5. Electric integration (`js/electric.js`, FIELD engine only)

1. `fieldSimulate()`:
   - Add `fieldCoilByIdx = new Map(solenoids.map(c=>[c.idx,c]))`.
   - `cellR`: coil cell returns `c.limited ? c.R : R_wire` (same pattern as pump).
   - Coil is a component member (conductor) — no forbidden edge needed (it is a
     single cell, unlike a 1×2 battery).
   - When building each battery-fed component's relaxation system, ALSO include
     generator coils that belong to the component as **Norton sources**:
     for each active generator coil compute `EMF = Kc·magStrength·Σ φ′(Δ)·v`
     (sum over magnet pistons on its line), `I_n = EMF/c.R`, add internal
     conductance edge between its two terminals `g_c=1/c.R`, and inject
     `+winding·I_n` / `−winding·I_n`. Coil-only components (no battery, but a
     closed loop with a load) also need to form a relaxation **system**: extend
     the "one system per source component" pass to treat a generator coil with a
     closed external loop as a source root (ground its − terminal).
   - Important: `EMF` depends on piston velocity which is produced by the AIR
     step. Read piston `vel`/`pos` as of the previous frame (coupling is one
     frame lagged — stable, and the field already relaxes over many frames).
2. `fieldPublish()`:
   - Reset coil readouts; for each coil in a component compute terminal `dV`
     (same two-neighbour readout as pump), `lastCurrent = dV/c.R`,
     `lastPower = dV²/c.R` (Joule draw for actuator/load), and
     `lastEMF` (generator open-voltage estimate). GODMODE coils are free
     (`lastPower` not drawn from any battery) but still produce force/EMF.
3. `computeHeatSource()`: add `cellR` coil branch (`r = c.limited ? c.R : R_wire`)
   so Joule heat flows; then add explicit waste heat
   `for (const c of solenoids) if (c.lastHeat) heatSource[c.idx] += c.lastHeat;`
   mirroring the pump line.

Pump readout/heat sites are the exact templates to copy.

---

## 6. Mechanical / air integration (`js/air.js`)

In the piston loop `(3.5)`, after computing `F_press` and friction, add:

1. **Coil force + spring** for magnet pistons:
   ```
   let F_coil = 0;
   if (p.magnet) {
     F_coil += -p.kSpring*(p.pos - p.restPos);            // centering spring
     for (const c of solenoids) {
       if (!sameTubeLine(p,c)) continue;
       const d = axialGap(p,c);                           // signed Δ (§3.1)
       const phip = -(d/SIGMA2)*Math.exp(-d*d/(2*SIGMA2));// φ′
       const I = c.lastCurrent || 0;                      // from field solve
       F_coil += p.magStrength * c.Kc * phip * I;         // actuator push/pull
     }
   }
   p.lastFcoil = F_coil;
   F_net = F_press + F_fric(...) + F_coil;
   ```
   Keep the existing static-lock test (use `|F_press + F_coil|` vs `F_static`)
   and the ±6 velocity clamp and wall clamp. Coil cells are added to every
   `pumps.some(pmp=>pmp.idx===idx)` wall/obstacle test so a magnet stops at a
   coil just like at a pump/wall.
2. `isAir()`: exclude coil cells (like pumps).
3. `syncPistonOccupancy()` unchanged (already generic over `pistons`).
4. `heatAirActive()`: add `|| solenoids.length > 0`.

No change to the chamber redistribution — the coil is a fixed wall boundary like
a pump, already handled by the wall clamping.

**Ordering note:** electric (`fieldRelax/publish`, producing `lastCurrent`) runs
before air in the unified tick, or the coil uses last frame's current. Confirm
the tick order in `ui.js`/`electric.js` sim loop and, if air runs first, just use
the previous frame's `lastCurrent` (one-frame lag, stable).

---

## 7. Rendering (`js/render.js`)

- `drawSolenoid(c)`: draw a coil cell — a sealed block (like pump body) wrapped
  with a copper-coil motif (stacked arcs / a solenoid helix in `#d97706`), plus a
  small `+ / −` polarity tick on the two terminal neighbours and a direction/
  winding marker. Energised coils glow (use `energized.has(idx)` / `c.lastPower`).
- Magnet piston: when `p.magnet`, render the classic gold/amber striped magnet
  (as in the sketch) with red `+`/blue `−` pole caps on the two ends; non-magnet
  pistons keep the current blue/steel look. Add a small force arrow for
  `lastFcoil` (yellow) similar to the existing velocity arrow.
- Call `solenoids.forEach(drawSolenoid)` next to `pumps.forEach(drawPump)`.
- Property binder maps (already keyed by kind): add `solenoid:` rows for
  R (Ω), efficiency (%), Kc / turns, winding (±), axis; and piston rows for
  magnet (checkbox), magStrength, kSpring.

---

## 8. UI (`js/ui.js` + `index.html`)

- GOD item + inventory row `solenoid`; `placeSolenoid(idx)` / `returnSolenoid(c)`
  cloned from pump placement (corridor cell, not on battery pole, wirePassable,
  wire-cut → junction like pump, inventory decrement, select-on-reclick).
- Eraser, pickUnder, double-click select, scene clear/reset lists: add solenoids
  alongside pumps at every site.
- `index.html`:
  - `<template id="prop-tpl-solenoid">` (R, efficiency, Kc/turns, winding flip,
    axis) and piston template gets magnet checkbox + magStrength + kSpring.
  - Scene button row already has "Piston & Pump"; add a **"Solenoid Lab"** scene.
- GUI must show (per the project's "show the physics" convention): coil current,
  EMF, force on magnet, and piston friction/spring.

---

## 9. New preset scene: "solenoid-lab"

Two rigs in one maze (mirrors the sketch):

- **Rig A — generator:** air pump pressurises a tube → magnet piston slides
  through a coil → coil wired to a lamp (and optional meter). Moving magnet lights
  the lamp (motion → electricity). Spring returns the magnet; opening a valve
  cycles it. Demonstrates effects **1 → 2**.
- **Rig B — actuator/motor:** battery + switch + coil wrapped around a tube with
  a magnet piston; closing the switch drives current → Lorentz force yanks/pushes
  the piston, compressing the spring and pushing air (pressure gauge / particles
  at the far end). Demonstrates effect **3** (and back-pressure).

Wire both coils into the manual-wire / field network the same way the pump scene
wires its pump (`js/ui.js` scene loader around line 202 is the template).

---

## 10. Tests (`js/test_solenoid.js`, new; headless VM loader copied from test_piston_pump.js)

1. **dirs/PUMP_DIRS ordering** unchanged (0=N,1=E,2=S,3=W) and solenoid axis/dir
   tables match.
2. **Coil is sealed to air but conductive:** `isAir(coilIdx)===false`; piston
   wall-clamp treats coil as obstacle; `cellR(coilIdx)` finite.
3. **Generator EMF sign & magnitude:** move a magnet piston through a coil at
   known `v`; assert `|EMF|` peaks near `Δ≈σ`, flips sign before vs after
   centring, and is ~0 when `v=0`; assert a wired lamp receives `dV > DV_LIT`
   and `lastPower > 0`.
4. **Lenz drag opposes motion:** with a loaded coil, piston decelerates faster
   than with open coil (mechanical energy removed); total energy (mech + Joule)
   conserved to tolerance.
5. **Actuator force:** energised coil (battery loop) with stationary magnet
   offset at `Δ≈σ` produces `|F_coil|` in the expected direction; reversing
   winding/current reverses force; magnet accelerates from rest.
6. **Reciprocity/energy:** same `Kc, φ′` used both ways — assert
   `F_coil·v ≈ EMF·I` over a glide (energy bookkeeping closes).
7. **Spring return:** de-energised actuator magnet returns toward `restPos`
   (damped) and settles; pressure can still overcome spring (terminal speed in
   0.1–5 cells/s range).
8. **Jitter regression:** magnet piston gliding through a coil shows **0
   per-frame velocity reversals** (extend Test 9 of the piston suite).
9. **Waste heat:** powered coil raises `heatSource[coilIdx]`; GODMODE coil draws
   no battery energy but still couples.
10. **Scene smoke test:** `solenoid-lab` loads with expected counts (coils,
    magnet pistons, battery, switch, lamp, pump) and no exceptions.

Run: `node js/test_solenoid.js`. Target: all pass; keep `test_piston_pump.js`
(35) and `test_electric_demo.js` (17) green.

---

## 11. Calibration targets

- `Kc` default such that a magnet at piston terminal speed (~1–2 cells/s) through
  a coil produces a few volts (enough to light a lamp through the field network),
  and a battery-driven coil yields `F_coil` of the same order as pressure forces
  (tens–low-hundreds of N) so motion is visible but friction (10–100 N) is not
  trivially overwhelmed.
- σ ≈ 0.7–1.0 cell so the coupling is smooth across the integer-cell boundary
  (the whole reason the chamber model exists) — no per-frame force spikes.
- Expose Kc, turns (maps to Kc), R, efficiency, winding, kSpring as sliders so
  numbers can be tuned live.

---

## 12. Milestones (ship order)

1. **M1 – State + placement + render + property panels** for a coil and a
   magnet-flagged piston (no physics yet); coil sealed-to-air/conductive;
   scene loads. (Test 1,2,10-partial.)
2. **M2 – Actuator (effect 3):** field current → Lorentz force on magnet + spring
   + waste heat; "solenoid-lab" Rig B. (Tests 5,7,9.)
3. **M3 – Generator (effect 2):** motion → Norton EMF injection (new source-root
   component) → lamp lights; Lenz drag; Rig A. (Tests 3,4,6.)
4. **M4 – Polish:** jitter regression through coil, energy audit, GUI readouts,
   full scene + all suites green. (Test 8 + full pass.)

Each milestone is independently runnable from `file://` and keeps the existing
piston/pump/electric suites passing.
