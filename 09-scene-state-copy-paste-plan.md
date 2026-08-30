# Plan: Copy Scene (Map) + Copy/Restore Full State

## Context
Repo: `/media/sf_1/mfix/maze-push`, branch `arena-v2` (last commit `fc0125c`). Two new clipboard buttons are needed:
1. **Copy Map** — geometry + items only (walls/air, metal, obstacles, wires, batteries, nodes, lamps, switches, pumps, pistons/solenoids, air/heat/pipe items). Round-trippable to rebuild a board.
2. **Copy State** — everything in *Copy Map* PLUS the live simulation fields, so a **Paste** restores a frozen, re-loadable snapshot.

Decision (confirmed with user): Paste of a full-state copy writes the primary fields (`temp`, `airN`, `airU`, `pressure`) **and** seeds the derived display overlays (`voltages` Map, `cellColor` Map, `fieldBz`) directly, then pauses the sim so all four non-net views (Heat / Pressure / Voltage / B-field) render the captured instant until the user resumes. Derived fields re-solve on resume.

Key code facts (verified):
- Grid `grid`, `blocked`, `obstacleKind`, `metalCells`, `temp`, `airN`, `airU`, `pressure`, `voltages` (Map), `cellColor` (Map) live in `js/state.js` (top-level globals).
- `fieldBz` (Float64Array) lives in `js/electric.js:351` (`let fieldBz = null`) — global, allocate if null.
- `sceneAddWire`, `loadScene`, `placeX`, `buildNetworks`, `seedAir`, `syncCellOpen`, `syncPistonOccupancy`, `recompute`, `startSimLoop`, `bus`, `render`, `setColorView`, `setActiveTool`, `renderProperties`, `renderInventory`, `refreshPauseBtn` are all top-level globals in `js/ui.js`/`state.js`/`network.js`/`air.js`.
- Simulation state semantics: `temp`/`airN`/`airU` are primary (persist/warm-start); `pressure` is derived from `airN`/`airU` (P=n·R·T_abs) but is a writable array we can set directly; `voltages`/`cellColor`/`fieldBz` are derived overlays recomputed each step.
- Ambient baseline constants (must match `seedAir`, `state.js:347`): `pAmb = N0 * R_SPEC * T_AMB * P_SCALE`; `N0 = AIR_RHO * CELL_VOL` (~1.2). Walls have `pressure=0`, `airN=0`; air cells have `pressure=pAmb`, `airN=N0`, `airU=0`, `temp=0` at rest.

## Design

### Shared helpers (add to `js/ui.js`)
- `parseXY(tok)` → `{x,y}`.
- `coordListFromIdx(arr)` / `idxOf(x,y)` helpers.
- `resetBoardForLoad()` — extract the `loadScene` preamble (`js/ui.js:127–160`): clear `circles`/`pathCells`/`pathEdges`/`connectedSets`; `blocked.fill(0)`, `obstacleKind.fill(0)`, `metalCells.fill(0)`; empty `manualWires`/`manualBatteries`/`lamps`/`switches`/`heatSinks`/`airSources`/`airSinks`/`pipeValves`/`pipePortals`/`pistons`/`pumps`; set `INV.*.count = 99` (keeps BUILD/limited semantics, fits any board); `seedWires()`; reset `pendingPlan/wireDrag/selectedManualWireLen/selectedItem`; `unlimited=false`.

### Serialize — Map (`serializeSceneMap`)
Same grammar as the prior approved design:
```
# Maze-Push scene v1
size 31 31
fill wall                       # majority base; tie -> wall
grid 3,15 4,15 ...              # MINORITY cells only
metal 10,4 ...                  # optional
obstacle 2,3:A 4,5:B 6,7:C      # optional
wire #22c55e 5,12 6,12 ...      # color + full cell path (emit BEFORE lamps/switches)
battery 5,12 #ff0000|#0000ff [E:20000]   # optional energy for faithful resume
node 5,12 #ff0000               # only circles with !n.manual
lamp 17,12 [U] [E:2000]
switch 9,12 closed|open [U]
pump 6,15 dir:1
piston 8,15 axis:h move:h pos:8 friction:50 [vel:0] [U]
solenoid 6,11 axis:h move:v pos:6 friction:20 mag:1 [vel:0] [U]
heatsink 8,8
airsrc 3,15 rate:0.4 temp:293
airsink 17,15
valve 4,11 open:1
portal 4,11 9,11 open:1
```
Rules: `grid` lists only minority cells; `node` exports only `!n.manual`; wires before lamps/switches so `placeLamp`/`placeSwitch` re-cut; `U` = GODMODE (unlimited); brackets are optional stored extras for faithful resume.

### Serialize — Full State (`serializeFullState`)
`serializeFullState()` = `serializeSceneMap()` output + the following numeric/derived blocks (always last). Each numeric block uses `fill + exceptions` with a per-field epsilon/precision so walls/ambient cost ~nothing:

```
field temp 0 <x,y:v>...            # baseline 0, eps 1e-4, toFixed(3)
field airU 0 <x,y:v>...            # baseline 0, eps 1e-2, toFixed(2)
field airN 1.2000 <x,y:v>...       # baseline N0 over AIR cells only, eps 1e-4, toFixed(4)
field pressure 101325.0 <x,y:v>... # baseline pAmb over AIR cells only, eps 1e-1, toFixed(1)
field voltage 0 <x,y:v>...         # from voltages Map, baseline 0, eps 1e-3, toFixed(3)
field bfield 0 <x,y:v>...          # from fieldBz, baseline 0, |Bz|>1e-9, toFixed(4)
color <x,y:#hex>...                # cellColor Map (voltage-view colors)
```
- `field airN`/`field pressure` iterate only `isAir(i)` cells; baseline per above; walls omitted (they are 0 / not-air).
- `field voltage` iterates `voltages` Map entries.
- `field bfield` iterates `fieldBz` (allocate if null, all zeros → block omitted).
- `color` iterates `cellColor` Map.
- Float formatting: `v.toFixed(n)`; strip to keep compact. Negative values preserved.

### Load — Map (`loadMapFromText(text)`)
1. `resetBoardForLoad()`.
2. Parse `fill`, apply `grid.fill(fillWall?1:0)` then flip minority cells; set `metalCells`/`blocked`/`obstacleKind` (A=1,B=2,C=3).
3. `buildNetworks(); seedAir(); syncCellOpen(); syncPistonOccupancy();`
4. Place in order (wires → batteries → nodes → lamps → switches → pumps → pistons/solenoids → heatsink/airsrc/airsink/valve/portal), toggling global `unlimited` around each call when `U` present. Apply optional extras: battery `E:`, lamp `E:`, pump `dir:`, piston/solenoid `axis/move/pos/friction/mag/vel`, airsrc `rate/temp`, airsink `rate`, valve/portal `open`. For portals push directly to `pipePortals` then `syncCellOpen()`.
5. Finalize (mirror `loadScene` tail, `js/ui.js:298–319`): delete overlapping `circles` on lamp/switch/battery-pole/pump cells; `setActiveTool('select',{unlimited:false})`; choose `setColorView` (voltage if lamps/switches else pressure if air/pump else net); `bus.emit('switch:placed')` if switches; `renderProperties(); renderInventory(); render();`.

### Load — Full State (`loadFullStateFromText(text)`)
1. Set `userPaused = true` (so any `startSimLoop()` triggered by `placeX` early-returns) — do this FIRST.
2. `loadMapFromText(text)` (restores geometry + items; fields not yet touched).
3. Parse `field`/`color` blocks and write directly:
   - `temp.fill(0)`; set exceptions.
   - `airU.fill(0)`; set exceptions.
   - `airN`: for each cell `airN[i] = isAir(i) ? N0 : 0`; then set exceptions.
   - `pressure`: for each cell `pressure[i] = isAir(i) ? pAmb : 0`; then set exceptions.
   - `voltages.clear()`; set `voltages` Map entries from `field voltage`.
   - `fieldBz`: if null or wrong length allocate `new Float64Array(N)`; `.fill(0)`; set exceptions.
   - `cellColor.clear()`; set entries from `color` block.
4. `refreshPauseBtn()`; `render();`
5. Logger: `Loaded full state (paused) — resume Play to recompute derived fields`.

### Paste (auto-detect)
One **Paste** button: if the pasted text contains a `field ` line → `loadFullStateFromText`, else → `loadMapFromText`.

### HTML (`index.html`, above the `Scenes` label at line 168)
```html
<div class="tool-row" style="margin-bottom:6px;">
  <button type="button" id="copyMapBtn" class="tool-btn" title="Copy scene map (geometry + items)">⧉ Copy Map</button>
  <button type="button" id="copyStateBtn" class="tool-btn" title="Copy full sim state (map + temp/pressure/voltage/Bz)">⧉ Copy State</button>
  <button type="button" id="pasteBtn" class="tool-btn" title="Paste a copied scene/state">⧉ Paste</button>
</div>
<div class="label">Scenes</div>
```

### Wiring (`js/ui.js`, near `copyPathsBtn` handler ~line 394)
Reuse the existing clipboard helper. `copyMapBtn.onclick` → `navigator.clipboard.writeText(serializeSceneMap())`. `copyStateBtn.onclick` → `writeText(serializeFullState())`. `pasteBtn.onclick` → `navigator.clipboard.readText().then(t => t && (t.includes('field ') ? loadFullStateFromText(t) : loadMapFromText(t)))`, with `window.prompt('Paste scene text:')` fallback when `readText` is unavailable/blocked.

## Edge cases / pitfalls
- **Wires before lamps/switches** — keep this order or `wired` cut state is lost.
- **`userPaused` first** in full load — otherwise `placePump`/`placeSolenoid` `startSimLoop()` mutates fields before we write them (we overwrite at the end anyway, but pausing keeps it clean and avoids transient recompute noise/visual fl…).
- **Do NOT `seedAir()` after writing fields** — it would clobber `airN`/`airU`/`temp`/`pressure`. Map-restore calls `seedAir`; full-restore relies on the written arrays.
- **`fieldBz` may be null** (no magnet placed) — allocate before filling.
- **Pressure/airN baselines are bimodal** (wall=0 vs air=pAmb/N0) — only iterate `isAir(i)` for those two blocks.
- **Inventory reset to 99**, not the scene-specific counts, so arbitrary pasted boards always fit while staying BUILD/limited.
- **Battery `E:` / lamp `E:`** optional; when absent, defaults (2000 / BATTERY_ENERGY) are used — fine for non-resume fidelity.
- **Piston `vel`** captured so frozen motion state matches; position already in map lines.

## Validation
- For each built-in scene (`electric-combo`, `tunnel-air`, `piston-pump`, `solenoid-lab`): load it, run the sim loop ~120 frames, then `Copy State` → `Paste`, and assert:
  - `grid`, `metalCells`, `blocked`, `obstacleKind` identical.
  - `manualWires.length`, `manualBatteries.length`, `lamps.length`, `switches.length`, `pumps.length`, `pistons.length` identical.
  - `temp`, `airN`, `airU`, `pressure` arrays equal within 1e-3.
  - `voltages` Map and `fieldBz` equal within 1e-3 (before resuming).
  - `userPaused === true` after full paste.
- Map-only round-trip: `Copy Map` → clear → `Paste` reproduces geometry + items (no fields).

## Files touched
- `index.html` — add the 3-button row above `Scenes`.
- `js/ui.js` — add `serializeSceneMap`, `serializeFullState`, `loadMapFromText`, `loadFullStateFromText`, `resetBoardForLoad`, `parseXY`, button wiring. (No edits required to `state.js`/`electric.js`; all target state is global.)
