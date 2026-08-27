function setMazeType(t) {
	mazeType = t;
	document.getElementById('btnTypeConnected').classList.toggle('active', t === 'connected');
	document.getElementById('btnTypeRandom').classList.toggle('active', t === 'random');
	document.getElementById('btnTypeDivision').classList.toggle('active', t === 'division');
}

document.getElementById('btnTypeConnected').onclick = () => { setMazeType('connected'); buildMaze(); };
document.getElementById('btnTypeRandom').onclick = () => { setMazeType('random'); buildMaze(); };
document.getElementById('btnTypeDivision').onclick = () => { setMazeType('division'); buildMaze(); };
document.getElementById('btnSelect').onclick = () => setActiveTool('select');
document.querySelectorAll('.strat-btn').forEach(b => {
	b.onclick = () => setWireStrategy(b.dataset.strat);
});
function setColorView(v) {
	colorView = v;
	document.getElementById('btnViewNet').classList.toggle('active', v === 'net');
	document.getElementById('btnViewElectric').classList.toggle('active', v === 'electric');
	document.getElementById('btnViewLight').classList.toggle('active', v === 'light');
	document.getElementById('btnViewVoltage').classList.toggle('active', v === 'voltage');
	document.getElementById('btnViewHeat').classList.toggle('active', v === 'heat');
	document.getElementById('btnViewPressure').classList.toggle('active', v === 'pressure');
	render();
	updateStatus();
}
document.getElementById('btnViewNet').onclick = () => setColorView('net');
document.getElementById('btnViewNet').addEventListener('mouseenter', () => setColorView('net'));
document.getElementById('btnViewElectric').onclick = () => setColorView('electric');
document.getElementById('btnViewElectric').addEventListener('mouseenter', () => setColorView('electric'));
document.getElementById('btnViewLight').onclick = () => setColorView('light');
document.getElementById('btnViewLight').addEventListener('mouseenter', () => setColorView('light'));
	document.getElementById('btnViewVoltage').onclick = () => setColorView('voltage');
	document.getElementById('btnViewVoltage').addEventListener('mouseenter', () => setColorView('voltage'));
	document.getElementById('btnViewHeat').onclick = () => setColorView('heat');
	document.getElementById('btnViewHeat').addEventListener('mouseenter', () => setColorView('heat'));
	document.getElementById('btnViewPressure').onclick = () => setColorView('pressure');
	document.getElementById('btnViewPressure').addEventListener('mouseenter', () => setColorView('pressure'));
function setWireStrategy(s) {
	wireStrategy = s;
	if (s !== 'c') selectedManualWireLen = null;
	document.querySelectorAll('.strat-btn').forEach(b => b.classList.toggle('active', b.dataset.strat === s));
	renderInventory(); updateStatus();
}
window.addEventListener('keydown', (e) => {
	const k = e.key.toLowerCase();
	if (pendingPortal) {
		const tag = (document.activeElement && document.activeElement.tagName) || '';
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'RANGE') return;
		if (e.key === 'Escape') { e.preventDefault(); cancelPendingPortal(); return; }
	}
	if (pendingPlan) {
		const tag = (document.activeElement && document.activeElement.tagName) || '';
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'RANGE') return;
		if (e.key === 'Enter') { e.preventDefault(); applyPendingPlan(); return; }
		if (e.key === 'Escape') { e.preventDefault(); cancelPendingPlan(); return; }
	}
	if (k === 'n') selectGod('node');
	else if (k === 'e') selectGod('eraser');
	else if (k === 'w') selectGod('wall');
	else if (k === 's') setActiveTool('select', { unlimited: false });
	else if (k === 'b') selectGod('battery');
	else if (k === 'o') selectGod('obsA');
	else if (k === 'p') selectGod('switch');
	else if (k === 'm') selectGod('metal');
});
els.autoConnect.onchange = buildNetworks;
els.autoSpawnNodes.onchange = buildNetworks;
els.autoSpawnTurns.onchange = buildNetworks;
document.getElementById('clearBtn').onclick = () => {
	circles.clear();
	pathCells.clear();
	pathEdges.clear();
	connectedSets.clear();
		blocked.fill(0);
		obstacleKind.fill(0);
		metalCells.fill(0);
		manualWires.length = 0;
		manualBatteries.length = 0;
		INV.battery.count = 1; seedWires();
	lamps.length = 0; INV.lamp.count = 1;
	switches.length = 0; INV.switch.count = 1;
	heatSinks.length = 0; INV.heatsink.count = 1;
	airSources.length = 0; INV.airsrc.count = 1;
	airSinks.length = 0; INV.airsink.count = 1;
	pipeValves.length = 0; INV.pipevalve.count = 1;
	pipePortals.length = 0; INV.pipeportal.count = 1;
	pendingPortal = null;
	syncCellOpen();
	seedAir();
	pendingPlan = null; wireDrag = null; selectedManualWireLen = null; selectedItem = null;
	buildNetworks();
	renderInventory();
		logger('Cleared all nodes');
	};

	// Push a single straight (already-routed) manual wire without touching the
	// segment pool — used by scenes to lay a fixed conductor.
	function sceneAddWire(cells, color) {
		if (!cells || cells.length < 2) return;
		const nodes = [cells[0], cells[cells.length - 1]];
		manualWires.push({ color, cells: cells.slice(), nodes, segs: [cells.length - 1] });
		nodes.forEach(nidx => { if (!circles.has(nidx)) circles.set(nidx, { color, small: false, manual: true }); });
	}

	// Scene loader: clears the board, opens the grid to bare corridors, then
	// drops a ready-made component layout. BUILD parts are placed as limited
	// (real charge), so the lamp carries its own battery that the network
	// battery charges/discharges through the switch.
	function loadScene(name) {
		circles.clear();
		pathCells.clear();
		pathEdges.clear();
		connectedSets.clear();
		blocked.fill(0);
		obstacleKind.fill(0);
		metalCells.fill(0);
		manualWires.length = 0;
		manualBatteries.length = 0;
		lamps.length = 0;
		switches.length = 0;
		heatSinks.length = 0;
		airSources.length = 0;
		airSinks.length = 0;
		pipeValves.length = 0;
		pipePortals.length = 0;
		pendingPortal = null;
		// Scenes are built from the BUILD (limited) inventory, so make sure
		// there are enough items for the largest scene (2 lamps / 2 switches
		// / 1 battery) — otherwise a placement fails with "No X left" and the
		// scene is only partially built.
		INV.battery.count = 1; INV.lamp.count = 2; INV.switch.count = 2; seedWires();
		INV.airsrc.count = 1; INV.airsink.count = 1;
		INV.pipevalve.count = 1; INV.pipeportal.count = 1;
		pendingPlan = null; wireDrag = null; selectedManualWireLen = null; selectedItem = null;
		unlimited = false;
		grid.fill(0);
		buildNetworks();
		seedAir();   // scenes start from ambient air (no accumulated pressure)
		syncCellOpen();

		// A closed rectangular loop is required: a single straight wire is an
		// open circuit and never lights. Battery at (10,15): + (10,15), −
		// (10,16). The four sides are laid as ONE continuous wire so that
		// cutting the lamp/switch in the middle leaves a 2-neighbour junction
		// (a dead-end corner would isolate the lamp). Lighting is ΔV-driven.
		const loopCells = (topRightX) => {
			const c = [];
			for (let x = 10; x <= topRightX; x++) c.push(x + 15 * GRID_W);      // top (incl + at 10,15)
			for (let y = 16; y <= 17; y++) c.push(topRightX + y * GRID_W);      // right col
			for (let x = topRightX - 1; x >= 10; x--) c.push(x + 17 * GRID_W);  // bottom
			c.push(10 + 16 * GRID_W);                                           // left col down to −
			return c;
		};
		const row = (xa, xb, y) => {
			const a = [], step = xa <= xb ? 1 : -1;
			for (let x = xa; step > 0 ? x <= xb : x >= xb; x += step) a.push(x + y * GRID_W);
			return a;
		};
		if (name === 'electric-combo') {
			// Combined board: 2 series batteries → 2 series switches → 1 lamp
			// → 2 parallel lamps (each with its own switch). Needs 2 batteries,
			// 3 lamps and 4 switches from the BUILD inventory.
			INV.battery.count = 2; INV.lamp.count = 3; INV.switch.count = 4;
			const rc = (x, y) => y * GRID_W + x;
			// Wires (each run shares cells with neighbours / battery poles).
			sceneAddWire([rc(5,12), rc(5,13), rc(5,14), rc(5,15), rc(5,16), rc(5,17)], '#22c55e'); // left battery + bridge
			const topRail = []; for (let x = 5; x <= 26; x++) topRail.push(rc(x, 12)); sceneAddWire(topRail, '#22c55e');
			const rightRail = []; for (let y = 12; y <= 17; y++) rightRail.push(rc(26, y)); sceneAddWire(rightRail, '#22c55e');
			const botRail = []; for (let x = 5; x <= 26; x++) botRail.push(rc(x, 17)); sceneAddWire(botRail, '#22c55e');
			const branchA = []; for (let y = 12; y <= 17; y++) branchA.push(rc(14, y)); sceneAddWire(branchA, '#22c55e');
			const branchB = []; for (let y = 12; y <= 17; y++) branchB.push(rc(20, y)); sceneAddWire(branchB, '#22c55e');
			// Components (placed after wires; each cuts its run into a junction
			// and re-links its two conductor neighbours by 4-adjacency).
			placeBattery(5, 12);   // Bat1: poles (5,12)+(5,13)
			placeBattery(5, 15);   // Bat2: poles (5,15)+(5,16)
			placeSwitch(9, 12);    // Sw1  (series, on top rail)
			placeSwitch(13, 12);   // Sw2  (series, on top rail)
			placeLamp(17, 12);     // Lseries (series load, on top rail)
			placeSwitch(14, 13);   // SwB  (branch A)
			placeLamp(14, 16);     // LampB (branch A; bridges to bottom rail)
			placeSwitch(20, 13);   // SwC  (branch B)
			placeLamp(20, 16);     // LampC (branch B; bridges to bottom rail)
			logger('Scene: Electricity — 2 batteries in series → 2 switches in series → 1 lamp → 2 parallel lamps (each with its own switch). Close all series switches; toggle branch switches.', 'sys');
		} else if (name === 'tunnel-air') {
			// 20×1 sealed tunnel (y=15, x=0..19): everything else is wall, so the
			// only air path runs source(3,15) → sink(17,15). The end pockets
			// equalize to the source/sink pressure. Shows PV=nRT mass flow.
			grid.fill(1);
			for (let x = 0; x <= 19; x++) grid[15 * GRID_W + x] = 0;
			buildNetworks();
			seedAir();
			placeAirSource(3, 15);
			placeAirSink(17, 15);
			logger('Scene: 20×1 Air tunnel — source(3,15) → sink(17,15). Use the Air/Pressure views to watch the gradient form.', 'sys');
		}
		// Stray junction nodes left on lamp/switch/battery-pole cells would
		// overlap their own glyphs; drop them so they draw cleanly.
		lamps.forEach(l => { if (circles.has(l.idx)) circles.delete(l.idx); });
		switches.forEach(s => { if (circles.has(s.idx)) circles.delete(s.idx); });
		manualBatteries.forEach(b => b.poles.forEach(p => { if (circles.has(p)) circles.delete(p); }));
		setActiveTool('select', { unlimited: false });
		// Surface the new closed-circuit model: select the lamp (so its ΔV /
		// Lit state shows) and jump to the Voltages view once the solve runs.
		const demoLamp = lamps[lamps.length - 1];
		if (demoLamp) selectedItem = { kind: 'lamp', ref: demoLamp };
		setColorView(name === 'tunnel-air' ? 'pressure' : 'voltage');
		bus.emit('switch:placed'); // recompute() -> simulate() sets lamp dV
		if (selectedItem) renderProperties(); // refresh panel (lamp dV, or the air source)
		renderInventory();
	}

	document.querySelectorAll('[data-scene]').forEach(b => {
		b.onclick = () => loadScene(b.dataset.scene);
	});

els.preserveWiring.onchange = buildNetworks;

let pathLimitTimer = null;
els.pathLimit.oninput = (e) => {
	document.getElementById('pathLimitVal').textContent = e.target.value === '0' ? '∞' : e.target.value;
	if (pathLimitTimer) clearTimeout(pathLimitTimer);
	pathLimitTimer = setTimeout(() => { buildNetworks(); }, 50);
};
els.pathLimit.onchange = () => {
	logger('Path/Cell limit = ' + els.pathLimit.value, 'sys');
};
els.showCellX.onchange = render;
els.stableColorLanes.onchange = render;
els.cooling.onchange = () => { coolingEnabled = els.cooling.checked; startSimLoop(); updateStatus(); };

// Engine selector (Field diffusion vs Circuit nodal) and the Metal/Ground
// medium resistance slider.
const engineSel = document.getElementById('engineSel');
if (engineSel) engineSel.onchange = () => { activeEngine = engineSel.value; recompute(); updateStatus(); };
const metalRSlider = document.getElementById('metalR');
  const metalRVal = document.getElementById('metalRVal');
  if (metalRSlider) metalRSlider.oninput = () => {
  	R_metal = +metalRSlider.value;
  	if (metalRVal) metalRVal.textContent = metalRSlider.value;
  	if (anyMetal()) scheduleFieldRecompute();
  };
  const batRSlider = document.getElementById('batR');
  const batRVal = document.getElementById('batRVal');
  if (batRSlider) batRSlider.oninput = () => {
  	R_bat = +batRSlider.value;
  	if (batRVal) batRVal.textContent = batRSlider.value;
  	recompute();
  };

// Simulation speed (TIME_SCALE): how many simulated seconds run per real
// second. Higher = faster warm-up / quicker gradient formation; the heat
// loop keeps running so the field stays live while speed > 0.
	const timeScaleSlider = document.getElementById('timeScale');
	const timeScaleVal = document.getElementById('timeScaleVal');
	if (timeScaleSlider) timeScaleSlider.oninput = () => {
		TIME_SCALE = +timeScaleSlider.value;
		if (timeScaleVal) timeScaleVal.textContent = timeScaleSlider.value;
		startSimLoop();
	};

	// Manual Play/Pause. Pause sets userPaused (startSimLoop() then early-returns
	// so edits don't auto-resume) and stops the loop; Play clears the flag and
	// restarts. While active, the loop evolves continuously until the user pauses.
	const pauseBtn = document.getElementById('pauseBtn');
	function refreshPauseBtn() {
		if (!pauseBtn) return;
		pauseBtn.textContent = userPaused ? '▶ Play' : '⏸ Pause';
		pauseBtn.classList.toggle('active', userPaused);
	}
	if (pauseBtn) pauseBtn.onclick = () => {
		userPaused = !userPaused;
		refreshPauseBtn();
		if (userPaused) { simRunning = false; render(); }
		else { startSimLoop(); }
	};
	refreshPauseBtn();

document.getElementById('copyPathsBtn').onclick = () => {
	const text = exportNetwork();
	const copyFallback = () => {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.select();
		let ok = false;
		try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
		document.body.removeChild(ta);
		return ok;
	};
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text)
			.then(() => logger('Copied nodes & links to clipboard', 'sys'))
			.catch(() => {
				if (copyFallback()) logger('Copied nodes & links to clipboard', 'sys');
				else logger('Copy failed (clipboard blocked)', 'err');
			});
	} else if (copyFallback()) {
		logger('Copied nodes & links to clipboard', 'sys');
	} else {
		logger('Copy failed (clipboard unavailable)', 'err');
	}
};

document.querySelectorAll('.card-head').forEach(head => {
	head.addEventListener('click', (e) => {
		if (e.target.id === 'copyPathsBtn') return;
		const card = document.getElementById(head.dataset.target);
		card.classList.toggle('collapsed');
		head.querySelector('.fold').textContent = card.classList.contains('collapsed') ? '▸' : '▾';
	});
});
document.getElementById('copyPathsBtn').addEventListener('click', (e) => e.stopPropagation());

// Shared screen→backing mapper (used by cell mapping, wheel, touch). The
// canvas fills #map-area with `object-fit: contain`, so the square bitmap is
// letterboxed inside the element's content box. Map the pointer into that
// contained square before scaling up to backing-store pixels.
function clientToBacking(clientX, clientY) {
	const rect = canvas.getBoundingClientRect();
	const cw = canvas.clientWidth, ch = canvas.clientHeight;
	const borderX = (rect.width - cw) / 2, borderY = (rect.height - ch) / 2;
	const side = Math.min(cw, ch);
	const offX = (cw - side) / 2, offY = (ch - side) / 2;
	const px = clientX - rect.left - borderX - offX;
	const py = clientY - rect.top - borderY - offY;
	const bx = px * (canvas.width / side);
	const by = py * (canvas.height / side);
	return [bx, by];
}

function cellFromEvent(e) {
	const [bx, by] = clientToBacking(e.clientX, e.clientY);
	const wx = (bx - view.offsetX) / view.scale;
	const wy = (by - view.offsetY) / view.scale;
	return [Math.floor(wx / CELL_SIZE), Math.floor(wy / CELL_SIZE)];
}

// Node tool: place / remove colored node, or clear an obstacle.
function nodeClick(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	if (circles.has(idx)) {
		circles.delete(idx);
		purgeManualRefs(idx);
		bus.emit('component:removed');
		if (els.preserveWiring.checked) {
			pathEdges.forEach((edges, key) => {
				const toDelete = [];
				for (const edge of edges) {
					if (edge.startsWith(idx + ':') || edge.endsWith(':' + idx)) toDelete.push(edge);
				}
				toDelete.forEach(e => edges.delete(e));
			});
			connectedSets.forEach((connected) => connected.delete(idx));
			pathCells.forEach((set, key) => {
				if (!set.has(idx)) return;
				const edges = pathEdges.get(key);
				const connected = connectedSets.get(key);
				set.clear();
				edges.forEach(e => { const [a, b] = e.split(':').map(Number); set.add(a); set.add(b); });
				connected.forEach(c => set.add(c));
			});
			cellUsage.delete(idx);
			rebuildCellUsage();
		}
		logger(`Removed node at ${x},${y}`);
	} else if (blocked[idx]) {
		blocked[idx] = 0; obstacleKind[idx] = 0;
		logger(`Cleared obstacle at ${x},${y}`);
		bus.emit('obstacle:changed', { idx });
	} else {
		circles.set(idx, { color: selectedColor, small: false });
		logger(`Placed ${selectedColor} node at ${x},${y}`);
	}
	buildNetworks();
}

// Obstacle tool: place / remove an obstacle of the selected A/B/C type.
function obstacleClick(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
		if (blocked[idx]) {
		blocked[idx] = 0; obstacleKind[idx] = 0;
		logger(`Removed obstacle at ${x},${y} (A/B cuts are not restored)`);
		buildNetworks();
		bus.emit('obstacle:changed', { idx });
		bus.emit('air:changed');
	} else {
		applyObstacle(idx, selectedObstacleType);
		logger(`Placed ${selectedObstacleType} obstacle at ${x},${y}`);
		bus.emit('air:changed');
	}
}

// Wall tool: true toggle of a single cell (fixes the editor's add-only bug).
function applyWall(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	grid[idx] = grid[idx] === 1 ? 0 : 1;
	circles.delete(idx);
	blocked[idx] = 0; obstacleKind[idx] = 0;
	bus.emit('obstacle:changed', { idx });
	bus.emit('air:changed');
	render();
}

// Eraser tool: remove node / obstacle from a cell.
function applyEraser(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	if (circles.has(idx)) { circles.delete(idx); purgeManualRefs(idx); logger(`Removed node at ${x},${y}`); bus.emit('component:removed'); }
	else if (blocked[idx]) { blocked[idx] = 0; obstacleKind[idx] = 0; logger(`Cleared obstacle at ${x},${y}`); bus.emit('obstacle:changed', { idx }); bus.emit('air:changed'); }
	render();
}

// Whether any cell has been painted as Metal/Ground.
function anyMetal() {
	for (let i = 0; i < metalCells.length; i++) if (metalCells[i]) return true;
	return false;
}

// Debounced full recompute. Painting or dragging the Metal medium can fire
// many times per second (one solve per cell), and each recompute runs the
// field solve. We only run the solver after the user pauses; render() above
// already gives instant paint feedback, so interaction stays smooth even on
// a large conductive array.
let fieldRecomputeTimer = null;
function scheduleFieldRecompute() {
	if (fieldRecomputeTimer) clearTimeout(fieldRecomputeTimer);
	fieldRecomputeTimer = setTimeout(() => { fieldRecomputeTimer = null; recompute(); }, 60);
}

// Metal/Ground tool: toggle a paintable conductive medium on a free
// (non-blocked) cell. Mirrors the Wall tool's toggle-on-drag behaviour.
function applyMetal(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	if (blocked[idx]) return;
	metalCells[idx] = metalCells[idx] ? 0 : 1;
	render();
	scheduleFieldRecompute();
}

// Drop a 1x2 battery (red top terminal, blue bottom). In scarce BUILD
// mode it consumes one unit from the inventory; in unlimited GODMODE the
// count guard and decrement are skipped (still validates space/overlap).
function placeBattery(x, y) {
	const it = INV.battery;
	if (!unlimited && it.count <= 0) { logger('No battery left', 'err'); return; }
	if (y + 1 >= GRID_H) { logger('Battery needs a 1x2 space', 'err'); return; }
	const top = y * GRID_W + x, bot = (y + 1) * GRID_W + x;
	if (blocked[top] || blocked[bot]) { logger('Battery blocked', 'err'); return; }
	if (manualBatteries.some(b => b.poles.includes(top) || b.poles.includes(bot))) { logger('Battery already there', 'err'); return; }
	if (!unlimited) it.count--;
	const maxE = unlimited ? INFINITE_ENERGY : BATTERY_ENERGY;
	const bat = { x, y, term: it.term.slice(), poles: [top, bot], limited: !unlimited, energy: maxE, maxEnergy: maxE };
	manualBatteries.push(bat);
	circles.set(top, { color: it.term[0], small: false, manual: true, battery: true });
	circles.set(bot, { color: it.term[1], small: false, manual: true, battery: true });
	selectedItem = { kind: 'battery', ref: bat };
	logger(`Placed battery at ${x},${y}`);
	bus.emit('battery:placed');
	renderProperties();
}

// Route a wire through passable (non-blocked) cells via BFS to the target,
// then cut it at `maxLen` cells — "max fit length", leftover is cut off.
// A cell is routable for a wire when it is part of the maze path
// (corridor), or a battery terminal (so a wire can leave/enter a
// battery even if the terminal sits on a wall). Walls and obstacles are
// impassable — the wire respects the maze structure as it is laid.
function wirePassable(nid) {
	if (blocked[nid]) return false;
	if (pipeValves.some(v => v.idx === nid)) return false;
	if (pipePortals.some(p => p.a === nid || p.b === nid)) return false;
	if (grid[nid] === 0) return true;
	for (let i = 0; i < manualBatteries.length; i++) {
		if (manualBatteries[i].poles.includes(nid)) return true;
	}
	return false;
}

// Route a wire along the maze, dynamically from the start toward the
// cursor, then cut it at `maxLen` cells (max fit length; leftover cut).
function findWirePath(startIdx, targetIdx, maxLen) {
	if (startIdx === targetIdx) return [startIdx];
	if (!wirePassable(targetIdx)) return [startIdx]; // can't land on a wall/obstacle
	const prev = new Int32Array(BFS_N).fill(-1);
	const seen = new Uint8Array(BFS_N);
	const q = [startIdx]; seen[startIdx] = 1;
	let found = false;
	while (q.length) {
		const curr = q.shift();
		if (curr === targetIdx) { found = true; break; }
		const cx = curr % GRID_W, cy = (curr / GRID_W) | 0;
		for (let i = 0; i < 4; i++) {
			const nx = cx + dirs[i].dx, ny = cy + dirs[i].dy;
			if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
			const nid = ny * GRID_W + nx;
			if (seen[nid] || !wirePassable(nid)) continue;
			seen[nid] = 1; prev[nid] = curr; q.push(nid);
		}
	}
	if (!found) return [startIdx];
	const path = [];
	for (let c = targetIdx; c !== -1; c = prev[c]) path.push(c);
	path.reverse();
	return path.length > maxLen ? path.slice(0, maxLen) : path;
}

// Compare two candidate DP states that cover the SAME length.
// Primary objective: minimize cut leftover (avoid cutting). Then the
// documented per-strategy tie-break:
//   a (biggest):    fewer pieces (fewer junctions), then prefer larger pieces
//   b (smallest):   more pieces (more junctions),   then prefer smaller pieces
//   c (manual, no explicit len): same as 'a' (fewer junctions)
function isBetterPlan(a, b, strategy) {
	if (!b) return true;
	if (a.leftover !== b.leftover) return a.leftover < b.leftover;
	const tieBigger = (strategy === 'a' || strategy === 'c');
	if (a.pieceCount !== b.pieceCount) return tieBigger ? a.pieceCount < b.pieceCount : a.pieceCount > b.pieceCount;
	const as = [...a.used].sort((x, y) => tieBigger ? y - x : x - y);
	const bs = [...b.used].sort((x, y) => tieBigger ? y - x : x - y);
	for (let i = 0; i < as.length; i++) {
		if (as[i] !== bs[i]) return tieBigger ? as[i] > bs[i] : as[i] < bs[i];
	}
	return false;
}

// Allocate pool pieces to cover the route `path` (N cells). Objective:
// minimize total leftover (avoid cutting); tie-break by `strategy`.
// Returns { ok, segs:[cover lens summing to N], consume:[full lens used],
//           returnBack:[leftovers], cut:bool } or { ok:false }.
function planAllocation(path, strategy) {
	// Wire length = number of edges = cells - 1 (a 2-cell wire is 1 length).
	const N = path.length - 1;
	if (N < 1) return { ok: false };
	if (poolTotal() === 0) return { ok: false };
	// Strategy c with an explicit chosen length: use exactly that piece,
	// cut it down to the route (single-piece, a cut unless L==N).
	if (strategy === 'c' && selectedManualWireLen != null) {
		const L = selectedManualWireLen;
		if (L < N) return { ok: false };
		if (!WIRES.has(L) || WIRES.get(L) <= 0) return { ok: false };
		const leftover = L - N;
		return { ok: true, segs: [N], consume: [L], returnBack: leftover > 0 ? [leftover] : [], cut: leftover > 0 };
	}
	// Build the multiset of available pieces.
	const avail = [];
	WIRES.forEach((c, l) => { for (let i = 0; i < c; i++) avail.push(l); });
	// dp[n] = best { leftover, pieceCount, used:[full lens], contrib:[covers] }.
	const dp = new Array(N + 1).fill(null);
	dp[0] = { leftover: 0, pieceCount: 0, used: [], contrib: [] };
	for (const c of avail) {
		for (let n = N; n >= 0; n--) {
			const st = dp[n];
			if (!st) continue;
			// whole piece
			if (n + c <= N) {
				const t = n + c;
				const cand = { leftover: st.leftover, pieceCount: st.pieceCount + 1, used: st.used.concat(c), contrib: st.contrib.concat(c) };
				if (isBetterPlan(cand, dp[t], strategy)) dp[t] = cand;
			}
			// cut piece to cover r (1..c-1)
			for (let r = 1; r < c; r++) {
				if (n + r > N) continue;
				const t = n + r;
				const cand = { leftover: st.leftover + (c - r), pieceCount: st.pieceCount + 1, used: st.used.concat(c), contrib: st.contrib.concat(r) };
				if (isBetterPlan(cand, dp[t], strategy)) dp[t] = cand;
			}
		}
	}
	const best = dp[N];
	if (!best) return { ok: false };
	const returnBack = [];
	for (let i = 0; i < best.used.length; i++) {
		const lb = best.used[i] - best.contrib[i];
		if (lb > 0) returnBack.push(lb);
	}
	return { ok: true, segs: best.contrib.slice(), consume: best.used.slice(), returnBack, cut: returnBack.length > 0 };
}

function startWire(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const start = y * GRID_W + x;
	wireDrag = { start, target: start, path: [start], plan: null };
}

// Unlimited (GODMODE) wire: a single full-length piece, no pool.
function planUnlimited(path) {
	const N = path.length - 1;
	if (N < 1) return { ok: false };
	return { ok: true, segs: [N], consume: [], returnBack: [], cut: false, path };
}

function updateWire(x, y) {
	if (!wireDrag || x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	wireDrag.target = y * GRID_W + x;
	if (unlimited) {
		wireDrag.path = findWirePath(wireDrag.start, wireDrag.target, GRID_W * GRID_H);
		wireDrag.plan = planUnlimited(wireDrag.path);
	} else {
		wireDrag.path = findWirePath(wireDrag.start, wireDrag.target, poolTotal() + 1);
		const p = planAllocation(wireDrag.path, wireStrategy);
		wireDrag.plan = p.ok ? Object.assign({}, p, { path: wireDrag.path }) : p;
	}
}

// Commit a validated plan: consume the pool pieces, return leftovers, and
// record the wire with its segment multiset + junction nodes at every
// segment boundary (and the two ends). The wire carries the active net
// color; electric.js recolors it from any battery it connects to.
function commitWire(plan) {
	if (!plan || !plan.ok) return false;
	const path = plan.path;
	if (path.length < 2) return false;
	if (!unlimited) {
		poolTake(plan.consume);
		if (plan.returnBack.length) poolReturn(plan.returnBack);
	}
	let acc = 0;
	const nodeIdx = [0];
	for (const s of plan.segs) { acc += s; nodeIdx.push(acc); }
	const nodes = nodeIdx.map(i => path[i]);
	const wire = { color: selectedColor, cells: path.slice(), nodes, segs: plan.segs.slice() };
	manualWires.push(wire);
	nodes.forEach(nidx => {
		if (!circles.has(nidx)) circles.set(nidx, { color: selectedColor, small: false, manual: true });
	});
	selectedItem = { kind: 'wire', ref: wire };
	logger(`Laid wire ${plan.segs.join('+')}${plan.cut ? ' (cut)' : ''}: ${path.length} cells, ${nodes.length} nodes`);
	wireDrag = null; pendingPlan = null;
	bus.emit('wire:placed');
	renderProperties();
	return true;
}

function sameMultiset(a, b) {
	if (a.length !== b.length) return false;
	const m = new Map();
	a.forEach(v => m.set(v, (m.get(v) || 0) + 1));
	for (const v of b) { const c = m.get(v) || 0; if (c <= 0) return false; m.set(v, c - 1); }
	return true;
}

function cancelPendingPlan() {
	pendingPlan = null; wireDrag = null;
	render(); updateStatus();
}

function applyPendingPlan() {
	if (!pendingPlan) return;
	const fresh = planAllocation(pendingPlan.path, wireStrategy);
	if (!fresh.ok || !sameMultiset(fresh.consume, pendingPlan.consume)) {
		logger('Inventory changed — plan no longer valid', 'err');
		cancelPendingPlan();
		return;
	}
	commitWire(Object.assign({}, fresh, { path: pendingPlan.path }));
	updateStatus();
}

// Handle a wire release: plan mode (a/b) awaits Enter/Esc; manual (c)
// commits instantly.
function releaseWire() {
	const d = wireDrag;
	if (!d) return;
	if (d.path.length < 2) { wireDrag = null; render(); return; }
	const plan = d.plan;
	if (!plan || !plan.ok) {
		logger('Not enough wire in inventory', 'err');
		wireDrag = null; render(); return;
	}
	// Unlimited GODMODE wire always commits directly on mouse-up.
	if (unlimited) {
		commitWire(plan);
		updateStatus();
		return;
	}
	if (wireStrategy === 'c') {
		commitWire(plan);
		updateStatus();
	} else {
		pendingPlan = plan;
		wireDrag = null;
		render(); updateStatus();
	}
}

// Remove BUILD-mode wires/batteries that reference a deleted cell.
function purgeManualRefs(idx) {
	for (let i = manualWires.length - 1; i >= 0; i--) {
		if (manualWires[i].cells.includes(idx)) {
			poolReturn(manualWires[i].segs);
			manualWires.splice(i, 1);
		}
	}
	for (let i = manualBatteries.length - 1; i >= 0; i--) {
		const b = manualBatteries[i];
		if (b.x === (idx % GRID_W) && (b.y === ((idx / GRID_W) | 0) || b.y + 1 === ((idx / GRID_W) | 0))) manualBatteries.splice(i, 1);
	}
}

// Whether the item occupying `idx` can be returned to inventory.
// Obstacles (blocked cells) are never inventory items, and any item
// sitting under an obstacle cannot be retrieved either.
function canReturnToInventory(idx) {
	if (blocked[idx]) return false;
	const bat = manualBatteries.find(b => b.poles.includes(idx));
	if (bat) return !bat.poles.some(p => blocked[p]);
	const wire = manualWires.find(w => w.cells.includes(idx));
	if (wire) return !wire.cells.some(c => blocked[c]);
	return false;
}

// Return a placed battery to inventory (restores its count).
function returnBattery(b) {
	const i = manualBatteries.indexOf(b);
	if (i < 0) return;
	if (!canReturnToInventory(b.poles[0])) { logger('Battery blocked by obstacle — cannot return', 'err'); return; }
	manualBatteries.splice(i, 1);
	if (b.limited) INV.battery.count++;
	b.poles.forEach(p => circles.delete(p));
	// restore any manual-wire junction node that shared a pole cell
	manualWires.forEach(w => w.nodes.forEach(nidx => {
		if (!circles.has(nidx)) circles.set(nidx, { color: w.color, small: false, manual: true });
	}));
	logger('Returned battery to inventory (count ' + INV.battery.count + ')', 'sys');
	bus.emit('battery:placed');
}

// Return a placed manual wire to the segment pool.
function returnWire(w) {
	const i = manualWires.indexOf(w);
	if (i < 0) return;
	if (!canReturnToInventory(w.cells[0])) { logger('Wire blocked by obstacle — cannot return', 'err'); return; }
	poolReturn(w.segs);
	manualWires.splice(i, 1);
	// drop the wire's manual junction nodes unless another item still uses the cell
	w.nodes.forEach(nidx => {
		const stillUsed = manualWires.some(o => o !== w && o.cells.includes(nidx)) ||
			manualBatteries.some(b => b.poles.includes(nidx));
		if (!stillUsed) circles.delete(nidx);
	});
	logger('Returned wire to inventory: ' + w.segs.join('+'), 'sys');
	bus.emit('wire:placed');
}

// Place or select a lamp. Clicking an existing lamp selects it (its
// properties show in the Properties panel). A new lamp carries a built-in
// battery (2000 J, drains 1 J/s per lm); one placed on a wire is cut into
// a junction and runs at 300 lm. GODMODE lamps have unlimited charge. No
// `circles` entry — the lamp is drawn separately in render().
function placeLamp(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = lamps.find(l => l.idx === idx);
	if (existing) { selectedItem = { kind: 'lamp', ref: existing }; renderProperties(); return; }
	if (!unlimited && INV.lamp.count <= 0) { logger('No lamp left', 'err'); return; }
	if (!wirePassable(idx)) { logger('Lamp needs a corridor or battery pole', 'err'); return; }
	if (pipeValves.some(v => v.idx === idx) || pipePortals.some(p => p.a === idx || p.b === idx)) { logger('Pipe item here', 'err'); return; }
	if (manualBatteries.some(b => b.poles.includes(idx))) { logger('Lamp cannot sit on a battery pole', 'err'); return; }
	if (!unlimited) INV.lamp.count--;
	let cut = false;
	for (const w of manualWires.slice()) {
		const k = w.cells.indexOf(idx);
		if (k < 0) continue;
		cut = true;
		const parts = [];
		if (k > 0) parts.push(w.cells.slice(0, k));
		if (k < w.cells.length - 1) parts.push(w.cells.slice(k + 1));
		const i = manualWires.indexOf(w);
		if (i >= 0) manualWires.splice(i, 1);
		for (const part of parts) {
			if (part.length < 2) continue;
			const nodes = [part[0], part[part.length - 1]];
			manualWires.push({ color: w.color, cells: part.slice(), nodes, segs: [part.length - 1] });
		}
		if (k > 0 && !circles.has(w.cells[k - 1])) circles.set(w.cells[k - 1], { color: w.color, small: false, manual: true });
		if (k < w.cells.length - 1 && !circles.has(w.cells[k + 1])) circles.set(w.cells[k + 1], { color: w.color, small: false, manual: true });
	}
	const eff = cut ? lampCutEff : lampBaseEff;
	const lumen = eff * P_REF;       // backwards-compat field for GODMODE/serialized scenes
	const maxE = unlimited ? INFINITE_ENERGY : 2000;
	const lamp = { x, y, idx, limited: !unlimited, energy: maxE, maxEnergy: maxE, lumen, efficiency: eff, wired: cut, color: '#ffffff', R: R_lamp };
	lamps.push(lamp);
	selectedItem = { kind: 'lamp', ref: lamp };
	bus.emit('lamp:placed');
	renderProperties();
	logger(`Placed lamp at ${x},${y}` + (cut ? ` (cut wire → junction, ${eff} lm/W)` : ` (${eff} lm/W)`));
}

function returnLamp(l) {
	const i = lamps.indexOf(l);
	if (i < 0) return;
	lamps.splice(i, 1);
	if (selectedItem && selectedItem.kind === 'lamp' && selectedItem.ref === l) selectedItem = null;
	if (l.limited) INV.lamp.count++;
	bus.emit('lamp:placed');
	logger('Returned lamp', 'sys');
}

// Place or select a switch. Clicking an existing switch selects it (its
// properties show in the Properties panel, including the closed/open
// toggle). A new switch placed on a wire is cut into a junction like a
// lamp; it conducts into neighbouring conductors while value = true
// (closed) and breaks the circuit when value = false (open). GODMODE
// switches are unlimited. No `circles` entry — drawn separately in render().
function placeSwitch(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = switches.find(s => s.idx === idx);
	if (existing) { selectedItem = { kind: 'switch', ref: existing }; renderProperties(); return; }
	if (!unlimited && INV.switch.count <= 0) { logger('No switch left', 'err'); return; }
	if (!wirePassable(idx)) { logger('Switch needs a corridor or battery pole', 'err'); return; }
	if (manualBatteries.some(b => b.poles.includes(idx))) { logger('Switch cannot sit on a battery pole', 'err'); return; }
	if (!unlimited) INV.switch.count--;
	let cut = false;
	for (const w of manualWires.slice()) {
		const k = w.cells.indexOf(idx);
		if (k < 0) continue;
		cut = true;
		const parts = [];
		if (k > 0) parts.push(w.cells.slice(0, k));
		if (k < w.cells.length - 1) parts.push(w.cells.slice(k + 1));
		const i = manualWires.indexOf(w);
		if (i >= 0) manualWires.splice(i, 1);
		for (const part of parts) {
			if (part.length < 2) continue;
			const nodes = [part[0], part[part.length - 1]];
			manualWires.push({ color: w.color, cells: part.slice(), nodes, segs: [part.length - 1] });
		}
		if (k > 0 && !circles.has(w.cells[k - 1])) circles.set(w.cells[k - 1], { color: w.color, small: false, manual: true });
		if (k < w.cells.length - 1 && !circles.has(w.cells[k + 1])) circles.set(w.cells[k + 1], { color: w.color, small: false, manual: true });
	}
	const sw = { x, y, idx, limited: !unlimited, value: true, wired: cut };
	switches.push(sw);
	selectedItem = { kind: 'switch', ref: sw };
	bus.emit('switch:placed');
	renderProperties();
	logger(`Placed switch at ${x},${y}` + (cut ? ' (cut wire → junction)' : ' (standalone)'));
}

function returnSwitch(sw) {
	const i = switches.indexOf(sw);
	if (i < 0) return;
	switches.splice(i, 1);
	if (selectedItem && selectedItem.kind === 'switch' && selectedItem.ref === sw) selectedItem = null;
	if (sw.limited) INV.switch.count++;
	bus.emit('switch:placed');
	logger('Returned switch', 'sys');
}

// Place or select a Heat Sink. A sink is a passive radiator: it draws excess
// air heat out of its cell (see airRelax's G_SINK term) so neighbours conduct
// heat into it and cool. GODMODE sinks are unlimited. No `circles` entry.
function placeHeatSink(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = heatSinks.find(s => s.idx === idx);
	if (existing) { selectedItem = { kind: 'heatsink', ref: existing }; renderProperties(); return; }
	if (!unlimited && INV.heatsink.count <= 0) { logger('No heat sink left', 'err'); return; }
	if (blocked[idx] || grid[idx] !== 0) { logger('Heat sink needs a corridor', 'err'); return; }
	if (!unlimited) INV.heatsink.count--;
	const hs = { x, y, idx, limited: !unlimited };
	heatSinks.push(hs);
	selectedItem = { kind: 'heatsink', ref: hs };
	bus.emit('heatsink:placed');
	renderProperties();
	logger(`Placed heat sink at ${x},${y}`);
}

function returnHeatSink(s) {
	const i = heatSinks.indexOf(s);
	if (i < 0) return;
	heatSinks.splice(i, 1);
	if (selectedItem && selectedItem.kind === 'heatsink' && selectedItem.ref === s) selectedItem = null;
	if (s.limited) INV.heatsink.count++;
	bus.emit('heatsink:placed');
	logger('Returned heat sink', 'sys');
}

// Place or select an Air Pressure Source: it injects air mass at a set
// temperature (see airRelax), driving a PV=nRT mass flow toward lower pressure.
function placeAirSource(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = airSources.find(s => s.idx === idx);
	if (existing) { selectedItem = { kind: 'airsrc', ref: existing }; renderProperties(); return; }
	if (!unlimited && INV.airsrc.count <= 0) { logger('No air source left', 'err'); return; }
	if (blocked[idx] || grid[idx] !== 0) { logger('Air source needs a corridor', 'err'); return; }
	if (!unlimited) INV.airsrc.count--;
	const s = { x, y, idx, limited: !unlimited, temp: SRC_T_DEF, rate: SRC_RATE_DEF };
	airSources.push(s);
	selectedItem = { kind: 'airsrc', ref: s };
	bus.emit('air:changed');
	renderProperties();
	logger(`Placed air source at ${x},${y}`);
}
function returnAirSource(s) {
	const i = airSources.indexOf(s);
	if (i < 0) return;
	airSources.splice(i, 1);
	if (selectedItem && selectedItem.kind === 'airsrc' && selectedItem.ref === s) selectedItem = null;
	if (s.limited) INV.airsrc.count++;
	bus.emit('air:changed');
	logger('Returned air source', 'sys');
}

// Place or select an Air Pressure Sink: it removes air mass (and its
// proportional energy), drawing flow toward it from higher pressure.
function placeAirSink(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = airSinks.find(s => s.idx === idx);
	if (existing) { selectedItem = { kind: 'airsink', ref: existing }; renderProperties(); return; }
	if (!unlimited && INV.airsink.count <= 0) { logger('No air sink left', 'err'); return; }
	if (blocked[idx] || grid[idx] !== 0) { logger('Air sink needs a corridor', 'err'); return; }
	if (!unlimited) INV.airsink.count--;
	const s = { x, y, idx, limited: !unlimited, rate: SINK_RATE_DEF };
	airSinks.push(s);
	selectedItem = { kind: 'airsink', ref: s };
	bus.emit('air:changed');
	renderProperties();
	logger(`Placed air sink at ${x},${y}`);
}
function returnAirSink(s) {
	const i = airSinks.indexOf(s);
	if (i < 0) return;
	airSinks.splice(i, 1);
	if (selectedItem && selectedItem.kind === 'airsink' && selectedItem.ref === s) selectedItem = null;
	if (s.limited) INV.airsink.count++;
	bus.emit('air:changed');
	logger('Returned air sink', 'sys');
}

// Place or select a Pipe Valve: a 1-cell air item that throttles the
// per-face G_FLOW and G_COND by `min(open_i, open_j)`. Default open=1.
function placePipeValve(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = pipeValves.find(v => v.idx === idx);
	if (existing) { selectedItem = { kind: 'pipevalve', ref: existing }; renderProperties(); return; }
	if (!unlimited && INV.pipevalve.count <= 0) { logger('No pipe valve left', 'err'); return; }
	if (blocked[idx] || grid[idx] !== 0) { logger('Pipe valve needs a corridor', 'err'); return; }
	if (cellOccupied(idx)) { logger('Cell already occupied', 'err'); return; }
	if (!unlimited) INV.pipevalve.count--;
	const v = { x, y, idx, limited: !unlimited, open: 1 };
	pipeValves.push(v);
	selectedItem = { kind: 'pipevalve', ref: v };
	syncCellOpen();
	bus.emit('air:changed');
	renderProperties();
	logger(`Placed pipe valve at ${x},${y}`);
}
function returnPipeValve(v) {
	const i = pipeValves.indexOf(v);
	if (i < 0) return;
	pipeValves.splice(i, 1);
	if (selectedItem && selectedItem.kind === 'pipevalve' && selectedItem.ref === v) selectedItem = null;
	if (v.limited) INV.pipevalve.count++;
	syncCellOpen();
	bus.emit('air:changed');
	renderProperties();
	logger('Returned pipe valve', 'sys');
}

// Place a Pipe Portal: two paired corridor cells linked by a
// pressure-driven air+energy flux. First click sets a ghost (pendingPortal);
// second click commits the pair. Clicking an existing portal endpoint
// selects it. ESC refunds the ghost without touching physics.
function placePipePortal(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = pipePortals.find(p => p.a === idx || p.b === idx);
	if (existing) { selectedItem = { kind: 'pipeportal', ref: existing, endpoint: idx }; renderProperties(); return; }
	if (pendingPortal == null) {
		if (!unlimited && INV.pipeportal.count <= 0) { logger('No pipe portal left', 'err'); return; }
		if (blocked[idx] || grid[idx] !== 0) { logger('Pipe portal needs a corridor', 'err'); return; }
		if (cellOccupied(idx)) { logger('Cell already occupied', 'err'); return; }
		if (!unlimited) INV.pipeportal.count--;
		pendingPortal = { a: idx };
		statusBar.textContent = 'Portal: click second cell (ESC to cancel)';
		render();
		logger(`Pipe portal stub placed at ${x},${y}`, 'sys');
		return;
	}
	if (idx === pendingPortal.a) { logger('Pick a different cell for the second endpoint', 'err'); return; }
	if (blocked[idx] || grid[idx] !== 0) { logger('Pipe portal needs a corridor', 'err'); return; }
	if (cellOccupied(idx)) { logger('Cell already occupied', 'err'); return; }
	const p = { a: pendingPortal.a, b: idx, limited: !unlimited, open: 1 };
	pipePortals.push(p);
	pendingPortal = null;
	syncCellOpen();
	bus.emit('air:changed');
	selectedItem = { kind: 'pipeportal', ref: p, endpoint: idx };
	renderProperties();
	logger(`Paired pipe portal at ${(p.a % GRID_W)},${(p.a / GRID_W) | 0} ↔ ${x},${y}`);
}
function returnPipePortal(p) {
	const i = pipePortals.indexOf(p);
	if (i < 0) return;
	pipePortals.splice(i, 1);
	if (selectedItem && selectedItem.kind === 'pipeportal' && selectedItem.ref === p) selectedItem = null;
	if (p.limited) INV.pipeportal.count++;
	syncCellOpen();
	bus.emit('air:changed');
	renderProperties();
	logger('Returned pipe portal', 'sys');
}
function cancelPendingPortal() {
	if (!pendingPortal) return;
	pendingPortal = null;
	INV.pipeportal.count++;
	render();
	updateStatus();
	logger('Portal cancelled', 'sys');
}

// Double-click handler: return the battery/wire/lamp under the cursor.
// While a plan is pending (a/b strategies awaiting Enter/Esc) a
// double-click must not discard or return anything. Obstacle cells only
// emit the "cannot return" error under the Select tool, so double-clicks
// with a GODMODE tool stay silent.
function handleReturnAt(x, y) {
	if (pendingPlan) return;
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	if (blocked[idx]) {
		if (activeTool === 'select') logger('Obstacles cannot be returned to inventory', 'err');
		return;
	}
	const bat = manualBatteries.find(b => b.poles.includes(idx) || (b.x === x && (b.y === y || b.y + 1 === y)));
	if (bat) { if (selectedItem && selectedItem.kind === 'battery' && selectedItem.ref === bat) selectedItem = null; returnBattery(bat); return; }
	const wire = manualWires.find(w => w.cells.includes(idx));
	if (wire) { if (selectedItem && selectedItem.kind === 'wire' && selectedItem.ref === wire) selectedItem = null; returnWire(wire); return; }
	const lamp = lamps.find(l => l.idx === idx);
	if (lamp) { if (selectedItem && selectedItem.kind === 'lamp' && selectedItem.ref === lamp) selectedItem = null; returnLamp(lamp); return; }
	const sw = switches.find(s => s.idx === idx);
	if (sw) { if (selectedItem && selectedItem.kind === 'switch' && selectedItem.ref === sw) selectedItem = null; returnSwitch(sw); return; }
	const hs = heatSinks.find(s => s.idx === idx);
	if (hs) { if (selectedItem && selectedItem.kind === 'heatsink' && selectedItem.ref === hs) selectedItem = null; returnHeatSink(hs); return; }
	const as = airSources.find(s => s.idx === idx);
	if (as) { if (selectedItem && selectedItem.kind === 'airsrc' && selectedItem.ref === as) selectedItem = null; returnAirSource(as); return; }
	const ak = airSinks.find(s => s.idx === idx);
	if (ak) { if (selectedItem && selectedItem.kind === 'airsink' && selectedItem.ref === ak) selectedItem = null; returnAirSink(ak); return; }
	const valve = pipeValves.find(v => v.idx === idx);
	if (valve) { if (selectedItem && selectedItem.kind === 'pipevalve' && selectedItem.ref === valve) selectedItem = null; returnPipeValve(valve); return; }
	const portal = pipePortals.find(p => p.a === idx || p.b === idx);
	if (portal) { if (selectedItem && selectedItem.kind === 'pipeportal' && selectedItem.ref === portal) selectedItem = null; returnPipePortal(portal); return; }
	logger('Nothing to return here', 'sys');
}

function pickItemAt(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return null;
	const idx = y * GRID_W + x;
	const lamp = lamps.find(l => l.idx === idx);
	if (lamp) return { kind: 'lamp', ref: lamp };
	const sw = switches.find(s => s.idx === idx);
	if (sw) return { kind: 'switch', ref: sw };
	const hs = heatSinks.find(s => s.idx === idx);
	if (hs) return { kind: 'heatsink', ref: hs };
	const as = airSources.find(s => s.idx === idx);
	if (as) return { kind: 'airsrc', ref: as };
	const ak = airSinks.find(s => s.idx === idx);
	if (ak) return { kind: 'airsink', ref: ak };
	const valve = pipeValves.find(v => v.idx === idx);
	if (valve) return { kind: 'pipevalve', ref: valve };
	const portal = pipePortals.find(p => p.a === idx || p.b === idx);
	if (portal) return { kind: 'pipeportal', ref: portal, endpoint: idx };
	const bat = manualBatteries.find(b => b.poles.includes(idx));
	if (bat) return { kind: 'battery', ref: bat };
	const wire = manualWires.find(w => w.cells.includes(idx));
	if (wire) return { kind: 'wire', ref: wire };
	if (circles.has(idx)) return { kind: 'node', ref: idx };
	return null;
}

canvas.onmousedown = (e) => {
	if (performance.now() - lastTouch < 500) return; // suppress emulated touch events
	if (e.button === 1) {                       // middle = pan
		e.preventDefault();
		mousePanning = true;
		panStart = { cx: e.clientX, cy: e.clientY, ox: view.offsetX, oy: view.offsetY };
		return;
	}
	if (e.button !== 0) return;
	const [x, y] = cellFromEvent(e);
	pointerDown(x, y);
};

// Pointer press on a cell: the shared editing entry point reused by both
// mouse (left button) and touch (1-finger tap).
function pointerDown(x, y) {
	if (activeTool === 'wall') {
		dragging = true; dirty = true; lastCell = x + ',' + y; applyWall(x, y);
	} else if (activeTool === 'eraser') {
		dragging = true; dirty = true; lastCell = x + ',' + y; applyEraser(x, y);
	} else if (activeTool === 'obstacle') {
		dragging = true; lastCell = x + ',' + y; obstacleClick(x, y);
	} else if (activeTool === 'metal') {
		dragging = true; lastCell = x + ',' + y; applyMetal(x, y);
	} else if (activeTool === 'wire') {
		if (selectedInv === 'battery') { pendingPlan = null; placeBattery(x, y); }
		else { pendingPlan = null; dragging = true; lastCell = x + ',' + y; startWire(x, y); render(); }
	} else if (activeTool === 'lamp') {
		placeLamp(x, y);
	} else if (activeTool === 'switch') {
		placeSwitch(x, y);
	} else if (activeTool === 'heatsink') {
		placeHeatSink(x, y);
	} else if (activeTool === 'airsrc') {
		placeAirSource(x, y);
	} else if (activeTool === 'airsink') {
		placeAirSink(x, y);
	} else if (activeTool === 'pipevalve') {
		placePipeValve(x, y);
	} else if (activeTool === 'pipeportal') {
		placePipePortal(x, y);
	} else if (activeTool === 'select') {
		selectedItem = pickItemAt(x, y);
		renderProperties();
	} else {
		nodeClick(x, y);
	}
}

// Pointer release: ends a drag or commits a wire; shared by mouse + touch.
function pointerUp() {
	if (dragging) {
		dragging = false;
		if (activeTool === 'wire') releaseWire();
		else if (dirty) { buildNetworks(); dirty = false; }
	}
}

canvas.onmousemove = (e) => {
	if (mousePanning) return;
	const [x, y] = cellFromEvent(e);
	if (!hoverCell || hoverCell[0] !== x || hoverCell[1] !== y) {
		hoverCell = [x, y];
		render();
		updateStatus(x, y);
	}
	if (dragging) {
		const key = x + ',' + y;
		if (key !== lastCell) {
			lastCell = key;
			if (activeTool === 'wall') applyWall(x, y);
			else if (activeTool === 'eraser') applyEraser(x, y);
			else if (activeTool === 'obstacle') obstacleClick(x, y);
			else if (activeTool === 'metal') applyMetal(x, y);
			else if (activeTool === 'wire') { updateWire(x, y); render(); }
		}
	}
};
let mousePanning = false, panStart = null;
window.addEventListener('mousemove', (e) => {
	if (!mousePanning) return;
	const k = canvas.width / canvas.clientWidth;
	view.offsetX = panStart.ox + (e.clientX - panStart.cx) * k;
	view.offsetY = panStart.oy + (e.clientY - panStart.cy) * k;
	render();
});
window.addEventListener('mouseup', (e) => {
	if (mousePanning) { if (e.button === 1) mousePanning = false; return; }
	if (performance.now() - lastTouch < 500) return; // suppress emulated touch events
	pointerUp();
});
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); }); // kill MMB autoscroll
canvas.onmouseleave = () => { hoverCell = null; render(); };

// ---- Mouse wheel zoom (anchored to the pointer) ----
canvas.addEventListener('wheel', (e) => {
	e.preventDefault();
	const [bx, by] = clientToBacking(e.clientX, e.clientY);
	const wx = (bx - view.offsetX) / view.scale;
	const wy = (by - view.offsetY) / view.scale;
	const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
	const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
	view.offsetX = bx - wx * ns;
	view.offsetY = by - wy * ns;
	view.scale = ns;
	render(); updateZoomLabel();
}, { passive: false });

// ---- Touch: 1-finger pan/tap-edit, 2-finger pinch-zoom ----
let lastTouch = 0;
let touchMode = null;          // 'one' | 'two'
let touchStart = null;         // { cx, cy, vx, vy, t }
let touchPanned = false;
let pinchStart = null;         // { scale, dist, worldX, worldY }

function touchMid(t0, t1) {
	return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
}
canvas.addEventListener('touchstart', (e) => {
	e.preventDefault();
	lastTouch = performance.now();
	if (e.touches.length >= 2) {
		touchMode = 'two';
		const m = touchMid(e.touches[0], e.touches[1]);
		const [bx, by] = clientToBacking(m.x, m.y);
		const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
		pinchStart = { scale: view.scale, dist, worldX: (bx - view.offsetX) / view.scale, worldY: (by - view.offsetY) / view.scale };
	} else {
		const t = e.touches[0];
		touchMode = 'one';
		touchPanned = false;
		touchStart = { cx: t.clientX, cy: t.clientY, vx: view.offsetX, vy: view.offsetY, t: performance.now() };
	}
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
	e.preventDefault();
	lastTouch = performance.now();
	if (e.touches.length >= 2) {
		const m = touchMid(e.touches[0], e.touches[1]);
		const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
		const [bx, by] = clientToBacking(m.x, m.y);
		const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStart.scale * dist / pinchStart.dist));
		view.scale = ns;
		view.offsetX = bx - pinchStart.worldX * ns;
		view.offsetY = by - pinchStart.worldY * ns;
		render();
	} else if (e.touches.length === 1) {
		const t = e.touches[0];
		if (touchMode === 'two') {      // lifted one finger mid-pinch: resume as pan
			touchMode = 'one'; touchPanned = true;
			touchStart = { cx: t.clientX, cy: t.clientY, vx: view.offsetX, vy: view.offsetY, t: performance.now() };
			return;
		}
		const dx = t.clientX - touchStart.cx, dy = t.clientY - touchStart.cy;
		if (Math.hypot(dx, dy) > 6) touchPanned = true;
		if (touchPanned) {
			const k = canvas.width / canvas.clientWidth;
			view.offsetX = touchStart.vx + dx * k;
			view.offsetY = touchStart.vy + dy * k;
			render();
		}
	}
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
	lastTouch = performance.now();
	if (e.touches.length === 0) {
		if (touchMode === 'one' && !touchPanned && performance.now() - touchStart.t < 400) {
			const [x, y] = cellFromEvent({ clientX: touchStart.cx, clientY: touchStart.cy });
			pointerDown(x, y);
			pointerUp();
		}
		touchMode = null;
	} else if (e.touches.length === 1) {
		const t = e.touches[0];
		touchMode = 'one'; touchPanned = true;
		touchStart = { cx: t.clientX, cy: t.clientY, vx: view.offsetX, vy: view.offsetY, t: performance.now() };
	}
}, { passive: false });

function updateZoomLabel() {
	const b = document.getElementById('btnResetView');
	if (b) b.textContent = Math.round(view.scale * 100) + '%';
}
document.getElementById('btnResetView').onclick = () => {
	view.scale = 1; view.offsetX = 0; view.offsetY = 0;
	render(); updateZoomLabel();
};
canvas.ondblclick = (e) => {
	if (performance.now() - lastTouch < 500) return; // suppress emulated touch events
	const [x, y] = cellFromEvent(e);
	if (pendingPlan) return;
	handleReturnAt(x, y);
};

selectGod('node');
updateStatus();
buildMaze();
updateZoomLabel();
