# Plan: arena-v2 fixes + pick features from solenoid-v2

Status: IMPLEMENTED on `arena/01a06118-maze`. All six suites pass
(`test_solenoid` 72/72, `test_piston_pump` 35/35, `test_electric_demo` 17/17,
`test_air`, `test_heat`, `test_scene_copy` 21/21).

Review results vs the plan:

- Tasks 1–3 (B-field live in idle+view, button handlers, two new scenes) are in
  place (`js/electric.js`, `js/ui.js`, `js/render.js`, `index.html`).
- Task 4 tests are ported and strengthened. **Test 4 was strengthened again in
  review:** the old 2-rail rig left the battery connected to only one rail, so
  all edge currents were zero and the assertion only checked `Number.isFinite`.
  It now uses a closed rectangular loop (`loopWire` + `placeBattery`) and asserts
  `|Bmid| > 1e-3` and `|Fend| > 1e-4` (actual `Bmid≈40.2`, `Fend≈0.73 N`).
- `test_heat` was re-baselined to the live constants (`G_COND=200`, `G_SINK=400`
  from `state.js`), so the standalone heat mirror passes again.
- Duplicated `index.html` tail is gone (file ends at one `</html>`), the
  contact-edge self-force decision is commented in `js/electric.js`, and the
  translate acceptance criterion is documented (not asserted) in
  `js/test_solenoid.js`.
- Optional `fieldCellEdges` spatial hash: intentionally left on the current
  brute-force `fieldEdges` path. It is the only higher-risk refactor in the
  plan and at this grid size (≤~1k cells, tens of edges) it buys little; the
  plan explicitly allows keeping this path if the hash risks destabilizing the
  field kernel.

Branch: `arena-v2` @ `08268db`. Source branch: `solenoid-v2` @ `de67e9d`.
Run headless tests with `node js/<file>.js` (they use a VM + DOM stub).

## Context
arena-v2 already has the field-based magneto-electric model, the B-field view, and a
complex `solenoid-lab` scene. solenoid-v2 adds a cleaner rectangular-loop `solenoid-lab`,
a new `bat-to-solenoid` scene, and more *assertive* physics tests. Four tasks were
requested (1 B-field sim, 2 B-field button, 3 two scenes, 4 good tests), plus a set of
LLM review suggestions. This plan folds the suggestions into the four tasks.

Decisions confirmed with user:
- **Scenes (#3):** ADD both solenoid-v2 scenes, KEEP arena's `solenoid-lab`. The cleaner
  solenoid-v2 `solenoid-lab` is added under a NEW name `solenoid-loop` (avoids clashing
  with arena's existing scene id). `bat-to-solenoid` is added as-is.
- **Translate acceptance test:** DOCUMENT only (do not add a hard/failing assertion), since
  current physics has pressure ~30× magnetic and the test would fail without a force
  rebalance (out of scope for these 4 tasks).

## Task 1 — `fieldSimulate()` must also run in B-field view
The Bz overlay (`fieldBz`) is computed inside `fieldSimulate` (js/electric.js:787-796) and
only drawn when `colorView === 'bfield'` (js/render.js:1067). But the sim loop only rebuilds
edges/field when a magnet exists:
- js/electric.js:902 `if (magnetList().length) fieldSimulate();`
  → change to `if (magnetList().length || colorView === 'bfield') fieldSimulate();`
  (so pure wire-current Bz shows even with no magnet).
- js/ui.js `setColorView` (line 15-27): when `v === 'bfield'`, ensure the overlay is
  populated even if the sim loop is idle. Do a one-shot
  `fieldRelax(FIELD_SWEEPS_PER_FRAME); fieldSimulate();` (guarded by
  `magnetList().length || electricActive()`, both exist in electric.js/state.js) BEFORE the
  existing `render()`. This refreshes `fieldV` → edge currents `e.I` (electric.js:746-751)
  → `fieldBz` (electric.js:787-796) so a static circuit/loop shows its Bz immediately.
  (In the running loop the guard added at line 902 already keeps it live.)
- Perf guard (LLM suggestion): wrap the fieldBz fill loop js/electric.js:787-796 under
  `if (colorView === 'bfield')` so the O(N·E) overlay is not recomputed every frame in
  other views. Correctness is preserved because switching to B-field triggers a recompute.

## Task 2 — `btnViewBField` click/mouseover handler
js/ui.js wires every other view button (lines 28-39) but omits B-field. Add after line 39:
```js
document.getElementById('btnViewBField').onclick = () => setColorView('bfield');
document.getElementById('btnViewBField').addEventListener('mouseenter', () => setColorView('bfield'));
```
(`setColorView` already toggles the `active` class for `btnViewBField` at lines 23-24.)

## Task 3 — Add two solenoid-v2 scenes (keep arena's `solenoid-lab`)
1. Port solenoid-v2's cleaner rectangular-loop scene (sol_ui.js:242-265) into arena's
   `loadScene` as a NEW case `name === 'solenoid-loop'` (do NOT overwrite arena's
   `solenoid-lab`). It uses `sceneAddWire` / `placeBattery` / `placeLamp` / `placeSolenoid`
   (all exist: ui.js:103,553,860,1254).
2. Port `bat-to-solenoid` verbatim (sol_ui.js:266-286) as `name === 'bat-to-solenoid'`.
3. Register both as buttons inside `#sceneRow` in index.html (after line 173):
   ```html
   <button type="button" class="otype-btn" data-scene="solenoid-loop" ...>Solenoid Loop</button>
   <button type="button" class="otype-btn" data-scene="bat-to-solenoid" ...>Bat→Solenoid</button>
   ```
   (The generic `[data-scene]` click handler at ui.js:309-311 already calls `loadScene`.)
4. Add a smoke assertion for each new scene in js/test_solenoid.js (mirror arena Test 15):
   `loadScene('solenoid-loop')` / `loadScene('bat-to-solenoid')` run without exception and
   place exactly one magnet piston.

## Task 4 — Pick assertive tests from solenoid-v2 (replace tautological asserts)
arena's js/test_solenoid.js has genuinely tautological / weak asserts. Fix precisely:
- **arena Test 4 (line 251)** `Math.abs(rails.Fend) >= 0` is tautological (always true).
  REPLACE with `Number.isFinite(rails.Fend) && Math.abs(rails.Fend) > 1e-4` (energized loop).
- **arena Test 15 (line 500)** `assert(true, ...)` is tautological. REPLACE with a real
  check: after loadScene + simulate, assert the magnet's `lastFcoil` is finite and
  `fieldEdges.length > 0` (proves no NaN / no-exception, not a constant-true pass).
- **arena Test 3 (line 210)** weak `sign(B1)!=sign(B2) || sign(F1)!=sign(F2)`. STRENGTHEN to
  `Math.sign(F1) === -Math.sign(F2)` with `|F1|,|F2| > 1e-4` (uses `lastFcoil`).

ADD the assertive solenoid-v2 tests (adapt — do NOT copy verbatim). They use only globals
that ALSO exist in arena: `createMechanicalBody`, `sceneAddWire`, `placeBattery/placeLamp`,
`DV_LIT` (state.js:244), `fieldEdges`/`fieldEdgeMap` (electric.js:473,350),
`magEnergyResidual` (electric.js:352), and magnet readouts `lastFcoil/lastBz/lastPower/
lastCurrent/lastEMF` (electric.js:779-783). Port:
- **Polarity sign-flip + zero-current** (sol Test 2): force flips sign when `magStrength`
  flips; `|F|→0` when the battery is removed.
- **Generator lamp-lights + Lenz drag** (sol Test 3): a dedicated controlled setup asserting
  `|lamp.dV| > DV_LIT`, `lastPower > 0`, and `lastFcoil * vel < 0`; battery-less loop still
  injects EMF; open loop ⇒ `lastPower ≈ 0`. (Do NOT merely tighten arena Test 7's OR-assert;
  add this controlled test so thresholds are reliable.)
- **Motor drive + back-EMF identity** (sol Test 4): `lastCurrent>0` at rest, `lastEMF>0`
  when moving, and `|lastPower + lastFcoil*vel| < 1e-6` (exact P = −F·v).
- **Energy identity** (sol Test 5): compute `Σ_e E_e·I_e + Σ_b F_b·v_b` by iterating arena's
  `fieldEdges` (each edge exposes `E` and `I`) and `bodies`; assert ≈0. Do NOT depend on
  solenoid-v2's `magEdges`/`magEe` (arena lacks them); cross-check against `magEnergyResidual`.
- **Lenz drag closed vs open** (sol Test 6): `lastFcoil*vel < 0` in a closed loop; `≈0` when
  no conductors present.
- **bat-to-solenoid coupling** (sol Test 8) using the new scene: battery ON ⇒
  `|lastFcoil| > 1e-4`; remove wires+battery + `buildNetworks()` ⇒ `|lastFcoil| < 1e-4`.

**Test-harness adaptation (critical to avoid breakage):** arena's `runCode` wraps code in
`(function(){ ... })()` while solenoid-v2's runs raw and relies on `return` values. Therefore
ported tests must (a) add helpers `buildLoopSetup(opts)` and `simulate(steps)`
(`fieldSimulate()` + `fieldRelax(FIELD_SWEEPS_PER_FRAME)` loop + `fieldPublish()`) mirroring
solenoid-v2, and (b) read results via the existing `globalThis.__x` + `getRef()` pattern,
NOT via `runCode` return values. Re-baseline any threshold that drifts; the energy identity
must still close to ~1e-15.

## LLM review items (folded in)
- **Delete duplicated index.html tail:** the file is 426 lines but should end at line 398
  (`</html>`). Lines 399-426 are a stray duplicated tail (beginning mid-line, e.g. `n" title=…`)
  that repeats the panel/scripts. Remove 399-426 so the file ends at line 398. Confirm no
  `<script>`/closing tags are lost.
- **Cell→edge spatial hash (perf, optional but recommended):** solenoid-v2 builds
  `magCellEdges` (cellIdx → [edgeIndex]) to limit kernel inner loops. In arena, build an
  equivalent `fieldCellEdges` Map while populating `fieldEdges` (electric.js:475-503). Use it
  in the magnet-force loop (752-786) and Bz-overlay loop (787-796) so each cell/magnet only
  scans nearby edges. MUST preserve results — validate by asserting `fieldBz` identical
  before/after (add a tiny VM test comparing brute-force vs hashed, or rely on existing
  Test 3/5 passing). If risky, ship behind the existing `fieldEdges` path unchanged.
- **Case-A contact-edge self-force:** current code excludes only the armature bridge edge via
  `edgeIsSelf` (electric.js:492,761); edges merely *adjacent* to body cells still contribute
  to the magnet's own force. Decision: KEEP this as intended; add a short code comment in
  `fieldSimulate` documenting that contact edges are intentionally included (no behavior
  change). Do not "fix" without a physics justification.
- **Translate acceptance test:** record in a comment / the plan file (NOT an asserting test)
  the criteria from 09-plan-solenoid-force-rebalance.md: battery ON ⇒ magnet translates ≥1
  cell, `|vel| < 6`, `F_coil` finite over ~2000 frames. Mark as a tracked future
  acceptance goal requiring a separate force-rebalance pass (out of scope here).

## Validation
1. `node js/test_solenoid.js` — all pass (new + strengthened asserts).
2. `node js/test_piston_pump.js`, `node js/test_electric_demo.js`, `node js/test_air.js`,
   `node js/test_heat.js` — re-run because arena's `AIR_CP`/`AIR_CV` (state.js:283-285)
   calibration may shift air-scene numbers; re-baseline any threshold that drifts.
3. Manual: open index.html, click `btnViewBField` (onclick + mouse-enter) → Bz overlay +
   current arrows appear; switch to a circuit with no magnet → Bz still renders; the
   duplicated-tail removal did not break layout.
4. `git diff --stat` review; confirm index.html ends at one `</html>`.

## Open questions / risks
- Spatial-hash port is the only higher-risk refactor; if it destabilizes, drop it and keep
  brute-force `fieldEdges` (B-field still works via Task 1).
- Force rebalance (magnetic vs pressure) is explicitly deferred per user decision.
- AIR_CV calibration: watch the four air/heat/pump suites for threshold drift after the
  `AIR_CP→AIR_CV` derivation already present in state.js.
