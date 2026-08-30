# Drag Items on Map (pointer) + Godmode Move Master Toggle

## Context
Repo: `/media/sf_1/mfix/maze-push` (single-page app: `index.html` + `js/{state,ui,render,electric,network,air}.js`).
Two related goals:

1. **Universal pointer drag** for placed items. Grab any placed item with the pointer and move it. For **wires**, dragging moves a **wire end node** (and re-routes the wire through the maze).
2. **Godmode improvement**: a **master checkbox** above the GODMODE list that turns item-dragging **on/off** ("godmove").

Confirmed decisions (with user):
- **Scope**: all placed items are movable *except* base map features (wall, eraser, metal floor, obstacle). Architecture works with any item kind.
- **Godmode re-route**: BFS through corridors (`wirePassable`/`findWirePath`), exactly like laying a wire — "free" means no inventory cost, not "snap anywhere".
- **BUILD accept**: plan + `Enter`=apply / `Esc`=cancel (reuse the existing `pendingPlan` flow).

## Behavior model (free vs plan)
- Move is enabled only when the master **Move** checkbox is ON (`moveMode`).
- When an existing item is grabbed, **free** vs **plan** is decided by `unlimited` (`js/state.js:88`):
  - `unlimited === true` (a GODMODE item is the active selection) → **free move**, applied immediately on release, no inventory.
  - `unlimited === false` (BUILD/Select) → **plan move**, awaits `Enter`/`Esc`.
- **Ergonomics note**: to free-move an existing item you must have a GODMODE item selected (e.g. pick "Wire" in the GODMODE panel) — this is what "in godmode" means. In `select` (limited) tool, grabbing an item produces a plan. This is the intended split; document it in the UI hint.
- Move is **universal across all tools**: if `moveMode` is ON and `pickItemAt` returns a movable item, that grab starts a drag regardless of the active tool. To paint *over* an item's cell, turn **Move** OFF. (No special-casing of wall/eraser/metal tools.)
- A grab with **no movement** (release on the same cell) is treated as a **select**, not a move/plan.

## Key existing machinery (verified)
- `pickItemAt(x,y)` (`js/ui.js:1711`) → `{kind, ref, ...}` for lamp/switch/heatsink/airsrc/airsink/valve/portal/pump/piston/battery/wire/node.
- Wire model: `manualWires` entries `{ color, cells:[idx...], nodes:[idx...], segs:[len...] }` (`js/state.js:134`). `nodes` are the segment-boundary (junction) indices; the two ends are `nodes[0]` and `nodes[nodes.length-1]`.
- `findWirePath(start, target, maxLen)` (`js/ui.js:967`) BFS over `wirePassable` (respects walls/obstacles/battery poles).
- `planAllocation(path, strategy)` (`js/ui.js:1016`) → `{ok, segs, consume, returnBack, cut}` over the BUILD pool. `planUnlimited(path)` (`js/ui.js:1072`) → godmode plan (no pool).
- `commitWire(plan)` (`js/ui.js:1095`) consumes pool, pushes wire, sets `circles`, emits `wire:placed`. `returnWire(w)` (`js/ui.js:1215`) returns `w.segs` to pool, removes wire, cleans `circles`.
- `pendingPlan` + `Enter`/`Esc` (`js/ui.js:58-79`, `applyPendingPlan`/`cancelPendingPlan` at `:1133`/`:1128`). Render preview at `js/render.js:1128-1141` (`drawWireCells` + `drawPlanJunctions`).
- GODMODE panel: `#godmodeList` at `index.html:146`, rendered by `renderGodmode()` (`js/render.js:1335`).

## Design

### 1. Master checkbox (godmove on/off)
- `index.html`: add a checkbox **above** `#godmodeList` (before line 146):
  ```html
  <label class="ctrl"><input type="checkbox" id="moveModeChk"> Move items (drag on map)</label>
  ```
- `js/state.js`: add `let moveMode = false;`.
- `js/ui.js`: `document.getElementById('moveModeChk').onchange = e => { moveMode = e.target.checked; updateStatus(); }`. Status hint: when ON, show *"Move: ON — grab an item to drag (godmode=free, BUILD=plan)"*.

### 2. Global drag state (`js/state.js`)
```js
let dragMove = null;     // active drag: { kind, ref, grabEnd/*0|last*/, fixedEndIdx, grabbedIdx, grabOffset, originCell, moved, path, plan, free, toCell, valid }
let pendingMove = null;  // awaiting Enter/Esc: { kind, ref, path?, plan?, toCell? }
```
Add `isMovableKind(kind)` → true for lamp/switch/battery/heatsink/airsrc/airsink/pipevalve/pump/piston/solenoid/wire/node; **false** for wall/eraser/metal/obstacle.

### 3. Pointer handlers (modify `pointerDown`/`pointerUp`/`onmousemove`)
- **`pointerDown(x,y)`** (`js/ui.js:1759`): after `cellFromEvent`, if `moveMode` is ON and `pickItemAt(x,y)` returns a movable item → `beginItemDrag(item, x, y); return;` (skip normal tool action). Else unchanged.
- **`beginItemDrag(item, x, y)`**:
  - Clear any in-progress placement first: `pendingPlan = null; wireDrag = null;`.
  - `free = unlimited`; `originCell = y*GRID_W + x`.
  - Compute an anchor offset so the item's **primary cell** tracks the pointer correctly even when a non-anchor sub-cell is grabbed:
    - Wire: `grabEnd` = the end (`nodes[0]` or `nodes[last]`) whose cell == `originCell`, else nearest end; `fixedEndIdx` = the *other* end's cell; `grabOffset` unused.
    - Battery: `anchor = poles[0]` (top); `grabOffset = originCell - anchor`. (If the bottom pole was grabbed, `grabOffset = GRID_W` so the battery doesn't flip on move.)
    - Piston/solenoid: `anchor = y0*GRID_W + x0`; `grabOffset = originCell - anchor` (handles grabbing the 2nd cell of a 2-wide body).
    - Portal: `grabbedIdx = item.endpoint`; delta computed at apply time.
    - Single-cell / node: `grabOffset = 0`.
  - Init `dragMove` (`moved=false`) and call `updateItemDrag(x,y)` once; `render()`.
- **`updateItemDrag(x,y)`** (from `onmousemove` when `dragMove` set):
  - Set `dragMove.moved = (y*GRID_W+x !== dragMove.originCell)` (for wires, compare target to original end cell).
  - Wire: `target = y*GRID_W+x`; `path = findWirePath(dragMove.fixedEndIdx, target, unlimited ? GRID_W*GRID_H : poolTotal()+1)`. If `path.length<2` → `valid=false` (keep last good). Else `plan = unlimited ? planUnlimited(path) : planAllocation(path, wireStrategy)`; store `path`, `plan`, `valid = plan.ok`.
  - Other kinds: `toCell = y*GRID_W+x`; `valid = itemTargetFree(ref, kind, toCell)`.
- **`pointerUp()`** (`js/ui.js:1800`): if `dragMove`:
  - If `!dragMove.moved` → `selectedItem = pickItemAt(originCell); renderProperties(); dragMove=null; render(); return;` (a click = select).
  - Wire: if `!valid` → cancel (keep original). If `free` → `rerouteWire(ref, path, plan)` (no inventory). Else `pendingMove = { kind:'wire', ref, path, plan }`, status *"Move plan ready — Apply (Enter) · Cancel (Esc)"*.
  - Other kinds: if `!valid` → cancel. If `free` → `applyItemMove(ref, kind, toCell)`. Else `pendingMove = { kind, ref, toCell }`.
  - `dragMove=null; render();`
- **`onmousemove`** (`js/ui.js:1808`): add `if (dragMove) { updateItemDrag(x,y); render(); return; }` before the paint-`dragging` block.

### 4. Apply / cancel (BUILD plan)
- Reuse `Enter`/`Esc` in `js/ui.js:58-79`: add a `pendingMove` branch (after `pendingPlan`) guarded by the existing INPUT-focus check:
  - `Enter` → `applyItemMovePlan()`; `Esc` → `cancelItemMove()`.
- **`applyItemMovePlan()`**:
  - Wire: `returnWire(pendingMove.ref)` (returns old `segs` to pool). **Guard**: if `pendingMove.ref` is still in `manualWires` afterwards (return was blocked by an obstacle), log *"Cannot move — wire blocked"* and abort (do NOT `commitWire`, or you'd duplicate). Otherwise **preserve color** by setting `selectedColor = pendingMove.ref.color` (save/restore), then `commitWire(Object.assign({}, pendingMove.plan, { path: pendingMove.path }))`. Net = **cut** (leftover returned) or **place** (extra consumed) from inventory. Clean `pendingMove`, `buildNetworks()`, `render()`, `renderInventory()`.
  - Other kinds: `applyItemMove(ref, kind, pendingMove.toCell)` — **relocate, no inventory change** (the item is already placed; only wires touch inventory). If `!itemTargetFree` (blocked/occupied) the move is **cancelled**: log *"Move blocked — destination occupied"* and clear `pendingMove`. Clean `pendingMove` otherwise.
- **`cancelItemMove()`**: `pendingMove=null; render(); updateStatus();`.
- `ondblclick` (`js/ui.js:1937`) and `handleReturnAt` (`js/ui.js:1678`): add `if (pendingMove) return;` next to the existing `if (pendingPlan) return;`.

### 5. Relocate helpers (`js/ui.js`)
- `itemCells(ref, kind)` → occupied cells: single-cell `[idx]`; battery `[poles[0], poles[1]]`; piston/solenoid 2 cells by `axis`/`pos` (h: `x,x+1` at `y`; v: `x` at `y,y+1`); pump/valve `[idx]`; portal `[a,b]`.
- `itemTargetFree(ref, kind, toCell)` → compute the candidate cells via the same anchoring used by `applyItemMove` (`newAnchor = toCell - grabOffset`, then `itemCells` at that anchor); reject if any candidate is **out of bounds**, `blocked`, a pipe valve/portal cell, or occupied by a *different* item (compare against `lamps/switches/heatSinks/airSources/airSinks/pipeValves/pipePortals/pumps/pistons/manualBatteries/manualWires`, excluding `ref` and its own cells). Reuse the per-kind validity already in `placeX`/layout checks where possible.
- `applyItemMove(ref, kind, toCell)`:
  - `newAnchor = toCell - dragMove.grabOffset` (for battery/piston/portal/node the offset keeps the grabbed sub-cell under the cursor).
  - Single-cell (lamp/switch/heatsink/airsrc/airsink/valve/pump): set `ref.x, ref.y, ref.idx = newAnchor`.
  - Battery: delete `circles` at old poles, set `ref.y = newAnchor/GRID_W|0`, `ref.poles = [newAnchor, newAnchor+GRID_W]`, re-add `circles` at new poles (`manual:true, battery:true`).
  - Piston/solenoid: set `ref.x = newAnchor%GRID_W`, `ref.y = newAnchor/GRID_W|0`, `ref.pos = (axis==='h' ? ref.x : ref.y)`; `syncPistonOccupancy()`.
  - Portal: `delta = toCell - grabbedIdx`; `newA = a+delta, newB = b+delta`; if both free → set `ref.a, ref.b`; else log + skip.
  - Node (free `circles` marker only; wire cells resolve to `kind:'wire'` in `pickItemAt` so they never reach here): `circles.delete(oldIdx); circles.set(toCell, oldVal)`.
  - Then `buildNetworks(); syncCellOpen(); syncPistonOccupancy(); renderProperties();`.
- `rerouteWire(wire, path, plan)` (godmode free): recompute `nodes` from `plan.segs` over `path`; remove old wire's `circles` unless used by another wire/battery (mirror `returnWire`); set `wire.cells=path`, `wire.nodes`, `wire.segs=plan.segs`, `wire.color` unchanged; re-add `circles` for new nodes; `buildNetworks(); bus.emit('wire:placed'); render();`.

### 6. Render preview (`js/render.js`, near `:1128`)
- Extend the existing preview block (currently it only checks `wireDrag`/`pendingPlan`) to also handle moves. Resolve a single `{path, plan, valid, color}` source in priority: live `dragMove` (wire) → `pendingMove` (wire) → live `dragMove` (non-wire) → `pendingMove` (non-wire).
- Wire preview: draw `drawWireCells(path, color)` at alpha 0.55 (use `dragMove.ref.color` / `pendingMove.ref.color`, not `selectedColor`, so the preview matches the wire) + `drawPlanJunctions(path, plan.segs)`; when `!valid`, draw a dashed red ring at the end cell.
- Non-wire preview: draw a highlight rect over `itemCells(ref,kind)` target cells (white outline; red dashed if `!valid`).
- Keep the original wire drawn underneath during BUILD `pendingMove` (before/after view).

## Edge cases / pitfalls
- **End-node only** in v1: re-route the *whole* wire from the fixed opposite end (internal junctions recomputed, not preserved). Acceptable per "move end nodes".
- **Target is a wall/obstacle** → `findWirePath` returns `[fixedEnd]` (`length<2`) → `valid=false`; release cancels (godmode) / plan rejected (BUILD).
- **Multi-cell items** (battery 1×2, piston/solenoid 2×1): validate both cells; reject if OOB/blocked/occupied.
- **Pipe portal**: translate both endpoints by delta only if both free; else cancel.
- **`unlimited` branch**: free uses `planUnlimited` (no pool); BUILD uses `returnWire`+`commitWire` so inventory is correctly cut/placed.
- **Color preservation**: BUILD wire move must keep `wire.color` (set `selectedColor` around `commitWire`).
- **Free-node only**: `kind:'node'` drags only re-key a *standalone* circle. Any cell that belongs to a wire resolves to `kind:'wire'` in `pickItemAt` (wire is checked before node), so wire junction nodes are never independently moved — they move with their wire.
- **Bounds**: `itemTargetFree` must reject battery `poles[1] >= N` and piston `x+1 >= GRID_W` (h-axis) / `y+1 >= GRID_H` (v-axis).
- **returnWire guard**: if the BUILD wire apply can't return the old wire (obstacle now blocks it, `returnWire` bails), abort without `commitWire` so a duplicate wire isn't created.
- **Click vs drag**: no-move release = select, not plan.
- **Occupied/blocked destination cancels** the move for every kind (godmode: discarded on release; BUILD: plan rejected on `Enter`). `itemTargetFree` is the single gate; `findWirePath` returning `length<2` is the wire equivalent.
- **Enter/Esc guard**: reuse existing `tag==='INPUT'...` focus guard.
- **`pendingPlan` vs `pendingMove`**: clear one when starting the other; double-click/return bail on either.
- **Touch drag**: mouse drag is implemented now. Touch (`touchmove`/`touchend`) currently only supports tap (immediate down+up). Extending touch to drive `updateItemDrag`/`pointerUp` drag is a **follow-up** (or route via Pointer Events) — mark out of scope for v1 if not required.

## Resolved decisions (product)
- **BUILD non-wire move inventory**: *relocate, no inventory change* (item already placed). User-confirmed.
- **Occupied/blocked destination**: cancels the move (rejected on release in godmode, or plan rejected on `Enter` in BUILD). Applies to all kinds, including wires (`findWirePath` returns length<2) and multi-cell items.

## Validation
- Enable **Move**; select GODMODE Wire; grab a wire end, drag along a corridor, release → re-routes, **inventory unchanged**, circuit still conducts.
- BUILD (`select`): grab a wire end, drag **shorter** → `Enter` returns leftover (cut); drag **longer** → `Enter` consumes extra (place); `Esc` leaves wire + inventory untouched; color preserved.
- Drag a lamp (godmode) → relocates, no inventory; BUILD lamp drag → `Enter` relocates (no inventory), `Esc` cancels.
- Drag battery/piston → both cells move together; invalid target cancels; `syncPistonOccupancy`/`buildNetworks` re-run.
- Plain click on an item (no drag) → selects it (Properties panel updates), no plan opened.
- `npm run lint`/`tsc` (if configured) + a scene load to confirm no regressions in `commitWire`/`returnWire`/`buildNetworks`.

## Files touched
- `index.html` — master checkbox above `#godmodeList`.
- `js/state.js` — `moveMode`, `dragMove`, `pendingMove`, `isMovableKind`.
- `js/ui.js` — `beginItemDrag`, `updateItemDrag`, `applyItemMove`, `applyItemMovePlan`, `cancelItemMove`, `rerouteWire`, `itemCells`, `itemTargetFree`; extend `pointerDown`/`pointerUp`/`onmousemove`/keydown/`ondblclick`/`handleReturnAt`; checkbox handler.
- `js/render.js` — drag/pending-move preview drawing.
- (No changes to `electric.js`/`network.js`/`air.js`; all state is global.)
