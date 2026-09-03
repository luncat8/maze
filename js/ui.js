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
const moveModeChk = document.getElementById('moveModeChk');
if (moveModeChk) moveModeChk.onchange = (e) => { moveMode = e.target.checked; updateStatus(); };
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
	const bf = document.getElementById('btnViewBField');
	if (bf) bf.classList.toggle('active', v === 'bfield');
	if (v === 'bfield') {
		// Populate the Bz overlay immediately, even if the unified sim loop is
		// idle: rebuild edges/systems, relax the current field, then publish so
		// the overlay reflects the live current (wire Bz shows with no magnet).
		if (magnetList().length || electricActive()) {
			fieldSimulate();
			fieldRelax(FIELD_SWEEPS_PER_FRAME);
			fieldPublish();
		}
	}
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
	document.getElementById('btnViewBField').onclick = () => setColorView('bfield');
	document.getElementById('btnViewBField').addEventListener('mouseenter', () => setColorView('bfield'));
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
	if (pendingMove) {
		const tag = (document.activeElement && document.activeElement.tagName) || '';
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'RANGE') return;
		if (e.key === 'Enter') { e.preventDefault(); applyItemMovePlan(); return; }
		if (e.key === 'Escape') { e.preventDefault(); cancelItemMove(); return; }
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
	pistons.length = 0; INV.piston.count = 1; INV.solenoid.count = 1;
	pumps.length = 0; INV.pump.count = 1;
	pendingPortal = null;
	syncCellOpen();
	syncPistonOccupancy();
	seedAir();
	pendingPlan = null; wireDrag = null; dragMove = null; pendingMove = null; selectedManualWireLen = null; selectedItem = null;
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
		pistons.length = 0;
		pumps.length = 0;
		pendingPortal = null;
		// Scenes are built from the BUILD (limited) inventory, so make sure
		// there are enough items for the largest scene (2 lamps / 2 switches
		// / 1 battery) — otherwise a placement fails with "No X left" and the
		// scene is only partially built.
		INV.battery.count = 1; INV.lamp.count = 2; INV.switch.count = 2; seedWires();
		INV.airsrc.count = 1; INV.airsink.count = 1;
		INV.pipevalve.count = 1; INV.pipeportal.count = 1;
		INV.piston.count = 1; INV.solenoid.count = 1; INV.pump.count = 1;
		pendingPlan = null; wireDrag = null; dragMove = null; pendingMove = null; selectedManualWireLen = null; selectedItem = null;
		unlimited = false;
		grid.fill(0);
		buildNetworks();
		seedAir();   // scenes start from ambient air (no accumulated pressure)
		syncCellOpen();
		syncPistonOccupancy();

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
		} else if (name === 'piston-pump') {
			// Sealed tunnel with electric pump pushing air to move a 2x1 piston
			INV.battery.count = 2; INV.switch.count = 2;
			INV.pump.count = 2; INV.piston.count = 2;
			grid.fill(1);
			// Air tunnel along row 15: x = 5..22 (x=4 and x=23 are walls)
			for (let x = 5; x <= 22; x++) grid[15 * GRID_W + x] = 0;
			// Corridors for electric circuit:
			// Battery at (5, 11) - poles are (5, 11) and (5, 12)
			grid[11 * GRID_W + 5] = 0;
			grid[12 * GRID_W + 5] = 0;
			// Positive rail: (5, 11) -> (6, 11) -> (7, 11)[switch] -> (8, 11..14) -> (7, 14) -> (6, 14) -> (6, 15)[pump]
			grid[11 * GRID_W + 6] = 0;
			grid[11 * GRID_W + 7] = 0;
			grid[11 * GRID_W + 8] = 0; grid[12 * GRID_W + 8] = 0; grid[13 * GRID_W + 8] = 0; grid[14 * GRID_W + 8] = 0;
			grid[14 * GRID_W + 7] = 0; grid[14 * GRID_W + 6] = 0;
			// Negative rail: (6, 15)[pump] -> (6, 16..17) -> (5..2, 17) -> (2, 16..12) -> (3..5, 12)[battery -]
			grid[16 * GRID_W + 6] = 0; grid[17 * GRID_W + 6] = 0;
			for (let x = 2; x <= 6; x++) grid[17 * GRID_W + x] = 0;
			for (let y = 12; y <= 16; y++) grid[y * GRID_W + 2] = 0;
			grid[12 * GRID_W + 3] = 0; grid[12 * GRID_W + 4] = 0;

			buildNetworks();
			seedAir();
			const rc = (x, y) => y * GRID_W + x;
			placeBattery(5, 11);
			placeSwitch(7, 11);
			sceneAddWire([rc(5, 11), rc(6, 11), rc(7, 11)], '#ef4444');
			sceneAddWire([rc(7, 11), rc(8, 11), rc(8, 12), rc(8, 13), rc(8, 14), rc(7, 14), rc(6, 14), rc(6, 15)], '#ef4444');
			sceneAddWire([rc(6, 15), rc(6, 16), rc(6, 17), rc(5, 17), rc(4, 17), rc(3, 17), rc(2, 17), rc(2, 16), rc(2, 15), rc(2, 14), rc(2, 13), rc(2, 12), rc(3, 12), rc(4, 12), rc(5, 12)], '#3b82f6');
			const sw = switches[switches.length - 1];
			if (sw) sw.value = true;
			placePump(6, 15);
			const pmp = pumps[pumps.length - 1];
			if (pmp) pmp.dir = 1;
			placePiston(8, 15);
			logger('Scene: Piston & Pump — electric pump builds pressure behind the 2×1 piston, sliding it eastward.', 'sys');
		} else if (name === 'solenoid-lab') {
			// Gas → electricity → gas: Case B generator on the left, Case A motor on the right,
			// sharing one wire loop. Rails sit on opposite sides of each magnet (no 4-connect short).
			INV.battery.count = 2; INV.switch.count = 2; INV.lamp.count = 2;
			INV.solenoid.count = 4; INV.piston.count = 2; INV.airsrc.count = 2;
			INV.pipevalve.count = 2;
			grid.fill(1);
			const rc = (x, y) => y * GRID_W + x;
			// Generator tube (Case B): row 11, x=2..14, walls above/below painted metal
			for (let x = 2; x <= 14; x++) grid[11 * GRID_W + x] = 0;
			for (let x = 4; x <= 12; x++) { metalCells[10 * GRID_W + x] = 1; metalCells[12 * GRID_W + x] = 1; }
			// Motor shaft (Case A): 2-wide vertical corridor x=21..22, metal rails on x=20 and x=23
			for (let y = 6; y <= 18; y++) { grid[y * GRID_W + 21] = 0; grid[y * GRID_W + 22] = 0; }
			for (let y = 8; y <= 16; y++) { metalCells[y * GRID_W + 20] = 1; metalCells[y * GRID_W + 23] = 1; }
			// Wire corridors linking the two metal U's
			for (let x = 12; x <= 21; x++) grid[8 * GRID_W + x] = 0;
			for (let x = 12; x <= 21; x++) grid[16 * GRID_W + x] = 0;
			grid[10 * GRID_W + 12] = 0; grid[12 * GRID_W + 12] = 0;
			grid[8 * GRID_W + 21] = 0; grid[16 * GRID_W + 21] = 0;
			grid[8 * GRID_W + 23] = 0; grid[16 * GRID_W + 23] = 0;
			// Battery + switch + lamp on the top link
			grid[7 * GRID_W + 16] = 0; grid[8 * GRID_W + 16] = 0; grid[9 * GRID_W + 16] = 0;
			buildNetworks();
			seedAir();
			// Close the loop through metal: paint connecting metal at the U ends
			metalCells[10 * GRID_W + 4] = 1; metalCells[11 * GRID_W + 4] = 1; metalCells[12 * GRID_W + 4] = 1;
			metalCells[rc(12, 10)] = 1; metalCells[rc(12, 8)] = 1;
			metalCells[rc(12, 12)] = 1; metalCells[rc(12, 16)] = 1;
			for (let x = 12; x <= 21; x++) { metalCells[rc(x, 8)] = 1; metalCells[rc(x, 16)] = 1; }
			metalCells[rc(20, 8)] = 1; metalCells[rc(23, 8)] = 1;
			metalCells[rc(20, 16)] = 1; metalCells[rc(23, 16)] = 1;
			placeBattery(16, 7);
			placeSwitch(16, 9);
			if (switches[0]) switches[0].value = true;
			placeLamp(18, 8);
			placeAirSource(3, 11);
			if (airSources[0]) airSources[0].rate = 0.4;
			placePipeValve(4, 11);
			if (pipeValves[0]) pipeValves[0].open = 1;
			placeSolenoid(6, 11); // Case B in the generator tube
			if (pistons[0]) { pistons[0].friction = 20; }
			placeSolenoid(22, 12); // Case A in the motor shaft if conductors on both sides
			if (pistons[1]) { pistons[1].friction = 20; }
			logger('Scene: Solenoid Lab — gas drives the left magnet (generator); current in the loop pushes the right magnet (motor).', 'sys');
		} else if (name === 'solenoid-loop') {
			// Generator demo: the Air Source pushes the magnet piston (solenoid)
			// around a closed wire loop; the moving magnet induces an EMF that
			// lights the lamp (Lenz drag).
			const rc = (x, y) => y * GRID_W + x;
			const row = (xa, xb, y) => { const a = []; for (let x = xa; x <= xb; x++) a.push(rc(x, y)); return a; };
			const col = (x, ya, yb) => { const a = []; for (let y = ya; y <= yb; y++) a.push(rc(x, y)); return a; };
			grid.fill(1);
			for (let y = 14; y <= 16; y++) for (let x = 4; x <= 26; x++) grid[rc(x, y)] = 0;
			buildNetworks();
			seedAir();
			sceneAddWire(row(6, 14, 14), '#f59e0b');  // top-left rail (amber)
			sceneAddWire(row(16, 26, 14), '#ff0000'); // top-right rail
			sceneAddWire(col(26, 14, 16), '#ff0000'); // right return
			sceneAddWire(row(6, 26, 16), '#ff0000');  // bottom rail
			sceneAddWire(col(6, 14, 16), '#ff0000');  // left return
			placeLamp(15, 14);
			const lp = lamps[lamps.length - 1];
			if (lp) lp.energy = 2000;
			placeSolenoid(7, 15);
			const ms = pistons[pistons.length - 1];
			if (ms) { ms.axis = 'h'; ms.moveAxis = 'h'; ms.pos = 7; ms.friction = 50; ms.magStrength = 1; ms.vel = -6; }
			placeAirSource(5, 15);
			const as = airSources[airSources.length - 1];
			if (as) { as.rate = 0.35; as.temp = 293; }
			setColorView('voltage');
			logger('Scene: Solenoid Loop — the Air Source pushes the magnet piston around the wire loop; the moving magnet lights the lamp (Lenz drag).', 'sys');
		} else if (name === 'bat-to-solenoid') {
			// Battery → linear solenoid. A single battery feeds two parallel current
			// rails that bound a horizontal air channel; the magnet piston (solenoid)
			// rides the channel between the rails. The rail currents build a field
			// that acts on the magnet — the wire field drives the solenoid.
			const rc = (x, y) => y * GRID_W + x;
			grid.fill(1);
			for (let y = 2; y <= 4; y++)
				for (let x = 2; x <= 30; x++) grid[y * GRID_W + x] = 0;
			buildNetworks();
			seedAir();
			const topRail = []; for (let x = 2; x <= 30; x++) topRail.push(rc(x, 2)); sceneAddWire(topRail, '#f59e0b');
			const botRail = []; for (let x = 2; x <= 30; x++) botRail.push(rc(x, 4)); sceneAddWire(botRail, '#f59e0b');
			sceneAddWire([rc(30, 2), rc(30, 3), rc(30, 4)], '#f59e0b');   // right return
			sceneAddWire([rc(2, 3), rc(2, 4)], '#f59e0b');                // battery → bottom rail
			placeBattery(2, 2);                                          // poles (2,2) top rail, (2,3) link
			placeSolenoid(5, 3);                                         // magnet at x5..6, y3 (between rails)
			const ms = bodies[bodies.length - 1];
			ms.friction = 0; ms.damping = 2; ms.mass = 2; ms.magStrength = 5; // free, lightly-damped magnet so the wire field drives it
			logger('Scene: Battery → Solenoid — the battery feeds the rails, whose field acts on the magnet. Watch the solenoid respond to the coil field.', 'sys');
		} else if (name === 'empty') {
			// Two bare 1-wide air chambers (rows 15 and 21). The 2nd chamber
			// carries a pressure gradient — 100 kPa on the left half, 1 kPa on
			// the right half — so air flows left→right once the sim runs.
			// Pressure is derived from mass each step (P = n·R·T/V), so we seed
			// airN proportionally to pAmb at ambient T to realize the target P.
			grid.fill(1);
			const rc = (x, y) => y * GRID_W + x;
			for (let x = 2; x <= 28; x++) { grid[rc(x, 15)] = 0; grid[rc(x, 21)] = 0; }
			buildNetworks();
			seedAir();
			const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;
			for (let x = 2; x <= 28; x++) {
				const i = rc(x, 21);
				const targetP = (x <= 15) ? 100000 : 1000;   // 100 kPa left, 1 kPa right
				airN[i] = N0 * (targetP / pAmb);
				pressure[i] = targetP;                       // seed pressure directly too (air loop won't run until a gradient exists)
			}
			userPaused = false;
			startSimLoop();                                  // the seeded gradient makes heatAirActive() true, so it dam-breaks then auto-idles
			logger('Scene: Empty — two air chambers; the lower one is seeded 100 kPa → 1 kPa and flows left→right.', 'sys');
		}
		// Stray junction nodes left on lamp/switch/battery-pole cells would
		// overlap their own glyphs; drop them so they draw cleanly.
		lamps.forEach(l => { if (circles.has(l.idx)) circles.delete(l.idx); });
		switches.forEach(s => { if (circles.has(s.idx)) circles.delete(s.idx); });
		manualBatteries.forEach(b => b.poles.forEach(p => { if (circles.has(p)) circles.delete(p); }));
		pumps.forEach(p => { if (circles.has(p.idx)) circles.delete(p.idx); });
		setActiveTool('select', { unlimited: false });
		if (name === 'piston-pump') {
			if (pistons.length > 0) selectedItem = { kind: 'piston', ref: pistons[0] };
			setColorView('pressure');
		} else if (name === 'tunnel-air') {
			if (airSources.length > 0) selectedItem = { kind: 'airsrc', ref: airSources[0] };
			setColorView('pressure');
		} else if (name === 'empty') {
			setColorView('pressure');
		} else {
			const demoLamp = lamps[lamps.length - 1];
			if (demoLamp) selectedItem = { kind: 'lamp', ref: demoLamp };
			setColorView('voltage');
		}
		bus.emit('switch:placed'); // recompute() -> simulate() sets lamp dV
		if (selectedItem) renderProperties(); // refresh panel (lamp dV, or the air source)
		renderInventory();
	}

	// ---- Scene copy / paste (compact, fill + exceptions) ----------------
	function parseXY(tok) { const a = tok.split(','); return { x: +a[0], y: +a[1] }; }

	function resetBoardForLoad() {
		circles.clear();
		pathCells.clear(); pathEdges.clear(); connectedSets.clear();
		blocked.fill(0); obstacleKind.fill(0); metalCells.fill(0);
		manualWires.length = 0; manualBatteries.length = 0;
		lamps.length = 0; switches.length = 0; heatSinks.length = 0;
		airSources.length = 0; airSinks.length = 0;
		pipeValves.length = 0; pipePortals.length = 0;
		pistons.length = 0; pumps.length = 0;
		pendingPortal = null;
		INV.battery.count = 99; INV.lamp.count = 99; INV.switch.count = 99;
		INV.heatsink.count = 99; INV.airsrc.count = 99; INV.airsink.count = 99;
		INV.pipevalve.count = 99; INV.pipeportal.count = 99;
		INV.piston.count = 99; INV.solenoid.count = 99; INV.pump.count = 99;
		seedWires();
		pendingPlan = null; wireDrag = null; dragMove = null; pendingMove = null; selectedManualWireLen = null; selectedItem = null;
		unlimited = false;
	}

	function parseSceneText(text) {
		const meta = { fill: 'wall' };
		const buckets = {};
		for (const raw of text.split('\n')) {
			const line = raw.trim();
			if (!line || line[0] === '#') continue;
			const sp = line.split(/\s+/);
			const k = sp[0], toks = sp.slice(1);
		if (k === 'size') { meta.w = +toks[0]; meta.h = +toks[1]; continue; }
		if (k === 'fill') { meta.fill = toks[0]; continue; }
		// View mode: accept both `view voltage` (matches size/fill style) and
		// the `view:voltage` shorthand suggested by the user.
		if (k === 'view' || k.startsWith('view:')) { meta.view = k.startsWith('view:') ? k.slice(5) : toks[0]; continue; }
		(buckets[k] = buckets[k] || []).push(toks);
		}
		return { meta, buckets };
	}

	function applyMap(parsed) {
		const { meta, buckets } = parsed;
		const fillWall = meta.fill !== 'air';
		grid.fill(fillWall ? 1 : 0);
		(buckets.grid || []).forEach(toks => toks.forEach(t => {
			const { x, y } = parseXY(t); grid[y * GRID_W + x] = fillWall ? 0 : 1;
		}));
		(buckets.metal || []).forEach(toks => toks.forEach(t => {
			const { x, y } = parseXY(t); metalCells[y * GRID_W + x] = 1;
		}));
		(buckets.obstacle || []).forEach(toks => toks.forEach(t => {
			const [xy, kind] = t.split(':'); const { x, y } = parseXY(xy);
			blocked[y * GRID_W + x] = 1;
			obstacleKind[y * GRID_W + x] = kind === 'A' ? 1 : kind === 'B' ? 2 : 3;
		}));
		buildNetworks(); seedAir(); syncCellOpen(); syncPistonOccupancy();
		const withUnl = (fn) => { const prev = unlimited; unlimited = false; fn(); unlimited = prev; };
		// Place items that can cut wires (lamp/switch/pump) BEFORE wires so the
		// captured wire cut-state is reproduced exactly and connectivity is
		// preserved by overlap/bridging (built-in scenes place switches first).
		(buckets.node || []).forEach(toks => {
			const { x, y } = parseXY(toks[0]); const color = toks[1] || '#ffffff';
			circles.set(y * GRID_W + x, { color, small: false });
		});
		(buckets.battery || []).forEach(toks => {
			const { x, y } = parseXY(toks[0]);
			const term = toks[1] ? toks[1].split('|') : null;
			const E = toks.find(t => t.startsWith('E:'));
			if (term) INV.battery.term = term;
			withUnl(() => placeBattery(x, y));
			if (E) { const b = manualBatteries[manualBatteries.length - 1]; if (b) b.energy = +E.slice(2); }
		});
		(buckets.lamp || []).forEach(toks => {
			const { x, y } = parseXY(toks[0]); const u = toks.includes('U');
			const E = toks.find(t => t.startsWith('E:'));
			const prev = unlimited; unlimited = u; placeLamp(x, y); unlimited = prev;
			if (E) { const l = lamps[lamps.length - 1]; if (l) l.energy = +E.slice(2); }
		});
		(buckets.switch || []).forEach(toks => {
			const { x, y } = parseXY(toks[0]); const open = toks[1] === 'open'; const u = toks.includes('U');
			const prev = unlimited; unlimited = u; placeSwitch(x, y); unlimited = prev;
			const sw = switches[switches.length - 1]; if (sw) sw.value = !open;
		});
		(buckets.pump || []).forEach(toks => {
			const { x, y } = parseXY(toks[0]);
			const dir = (toks.find(t => t.startsWith('dir:')) || '').slice(4);
			withUnl(() => placePump(x, y));
			const p = pumps[pumps.length - 1]; if (p && dir) p.dir = +dir;
		});
		(buckets.wire || []).forEach(toks => {
			const color = toks[0];
			const cells = toks.slice(1).map(parseXY).map(c => c.y * GRID_W + c.x);
			sceneAddWire(cells, color);
		});
		const placeBody = (toks, magnet) => {
			const { x, y } = parseXY(toks[0]); const u = toks.includes('U');
			const prev = unlimited; unlimited = u;
			if (magnet) placeSolenoid(x, y); else placePiston(x, y);
			unlimited = prev;
			const b = pistons[pistons.length - 1]; if (!b) return;
			for (const t of toks.slice(1)) {
				if (t.startsWith('axis:')) b.axis = t.slice(5);
				else if (t.startsWith('move:')) b.moveAxis = t.slice(5);
				else if (t.startsWith('pos:')) b.pos = +t.slice(4);
				else if (t.startsWith('friction:')) b.friction = +t.slice(9);
				else if (t.startsWith('mag:')) b.magStrength = +t.slice(4);
				else if (t === 'emit') b.emit = true;
				else if (t.startsWith('vel:')) b.vel = +t.slice(4);
			}
		};
		(buckets.piston || []).forEach(t => placeBody(t, false));
		(buckets.solenoid || []).forEach(t => placeBody(t, true));
		(buckets.heatsink || []).forEach(t => { const { x, y } = parseXY(t[0]); withUnl(() => placeHeatSink(x, y)); });
		(buckets.airsrc || []).forEach(t => {
			const { x, y } = parseXY(t[0]); withUnl(() => placeAirSource(x, y));
			const s = airSources[airSources.length - 1];
			if (s) t.forEach(p => { if (p.startsWith('rate:')) s.rate = +p.slice(5); else if (p.startsWith('temp:')) s.temp = +p.slice(5); });
		});
		(buckets.airsink || []).forEach(t => {
			const { x, y } = parseXY(t[0]); withUnl(() => placeAirSink(x, y));
			const s = airSinks[airSinks.length - 1];
			if (s) t.forEach(p => { if (p.startsWith('rate:')) s.rate = +p.slice(5); });
		});
		(buckets.valve || []).forEach(t => {
			const { x, y } = parseXY(t[0]); withUnl(() => placePipeValve(x, y));
			const v = pipeValves[pipeValves.length - 1];
			if (v) { const o = t.find(p => p.startsWith('open:')); if (o) v.open = +o.slice(5); }
			syncCellOpen();
		});
		(buckets.portal || []).forEach(t => {
			const a = parseXY(t[0]), b = parseXY(t[1]);
			const open = t.find(p => p.startsWith('open:'));
			pipePortals.push({ a: a.y * GRID_W + a.x, b: b.y * GRID_W + b.x, limited: !unlimited, open: open ? +open.slice(5) : 1 });
			syncCellOpen();
		});
	}

	function finalizeSceneLoad(meta) {
		lamps.forEach(l => { if (circles.has(l.idx)) circles.delete(l.idx); });
		switches.forEach(s => { if (circles.has(s.idx)) circles.delete(s.idx); });
		manualBatteries.forEach(b => b.poles.forEach(p => { if (circles.has(p)) circles.delete(p); }));
		pumps.forEach(p => { if (circles.has(p.idx)) circles.delete(p.idx); });
		setActiveTool('select', { unlimited: false });
		const hasElectric = lamps.length || switches.length || manualBatteries.length;
		const hasAir = airSources.length || airSinks.length || pumps.length;
		// An explicit `view:` in the scene overrides the auto selection.
		if (meta && meta.view) setColorView(meta.view);
		else if (hasElectric) setColorView('voltage');
		else if (hasAir) setColorView('pressure');
		else setColorView('net');
		if (switches.length) bus.emit('switch:placed');
		if (selectedItem) renderProperties();
		renderInventory(); render();
	}

	function serializeSceneMap() {
		const W = GRID_W, H = GRID_H, N = W * H;
		let walls = 0, air = 0;
		for (let i = 0; i < N; i++) (grid[i] ? walls++ : air++);
		const fillWall = walls >= air;
		const L = ['# Maze-Push scene v1', `size ${W} ${H}`, `fill ${fillWall ? 'wall' : 'air'}`, `view ${colorView}`];
		const exc = [];
		for (let i = 0; i < N; i++) if (!!grid[i] !== fillWall) exc.push((i % W) + ',' + ((i / W) | 0));
		L.push('grid ' + exc.join(' '));
		const metal = [];
		for (let i = 0; i < N; i++) if (metalCells[i]) metal.push((i % W) + ',' + ((i / W) | 0));
		if (metal.length) L.push('metal ' + metal.join(' '));
		const obs = [];
		for (let i = 0; i < N; i++) if (blocked[i]) { const k = obstacleKind[i] === 1 ? 'A' : obstacleKind[i] === 2 ? 'B' : 'C'; obs.push((i % W) + ',' + ((i / W) | 0) + ':' + k); }
		if (obs.length) L.push('obstacle ' + obs.join(' '));
		manualWires.forEach(w => { const seg = w.cells.map(i => (i % W) + ',' + ((i / W) | 0)).join(' '); L.push('wire ' + w.color + ' ' + seg); });
		manualBatteries.forEach(b => L.push('battery ' + b.x + ',' + b.y + ' ' + b.term[0] + '|' + b.term[1] + ' E:' + Math.round(b.energy)));
		circles.forEach((n, idx) => { if (!n.manual) L.push('node ' + (idx % W) + ',' + ((idx / W) | 0) + ' ' + n.color); });
		lamps.forEach(l => L.push('lamp ' + l.x + ',' + l.y + (l.limited ? '' : ' U') + ' E:' + Math.round(l.energy)));
		switches.forEach(s => L.push('switch ' + s.x + ',' + s.y + ' ' + (s.value ? 'closed' : 'open') + (s.limited ? '' : ' U')));
		pumps.forEach(p => L.push('pump ' + p.x + ',' + p.y + ' dir:' + p.dir));
		pistons.forEach(p => L.push((p.magnet ? 'solenoid ' : 'piston ') + p.x + ',' + p.y + ' axis:' + p.axis + ' move:' + p.moveAxis + ' pos:' + p.pos + ' friction:' + p.friction + (p.magStrength != null ? ' mag:' + p.magStrength : '') + (p.emit ? ' emit' : '') + ' vel:' + p.vel + (p.limited ? '' : ' U')));
		heatSinks.forEach(h => L.push('heatsink ' + h.x + ',' + h.y));
		airSources.forEach(s => L.push('airsrc ' + s.x + ',' + s.y + ' rate:' + s.rate + ' temp:' + s.temp));
		airSinks.forEach(s => L.push('airsink ' + s.x + ',' + s.y + ' rate:' + s.rate));
		pipeValves.forEach(v => L.push('valve ' + v.x + ',' + v.y + ' open:' + v.open));
		pipePortals.forEach(p => L.push('portal ' + (p.a % W) + ',' + ((p.a / W) | 0) + ' ' + (p.b % W) + ',' + ((p.b / W) | 0) + ' open:' + p.open));
		return L.join('\n');
	}

	function serializeFullState() {
		const L = [serializeSceneMap()];
		const W = GRID_W, H = GRID_H, N = W * H;
		const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;
		const pushField = (name, baseline, arr, overAirOnly, eps, digits) => {
			const exc = [];
			for (let i = 0; i < N; i++) {
				if (overAirOnly && !isAir(i)) continue;
				if (Math.abs(arr[i] - baseline) > eps) exc.push((i % W) + ',' + ((i / W) | 0) + ':' + arr[i].toFixed(digits));
			}
			if (exc.length) L.push('field ' + name + ' ' + baseline + ' ' + exc.join(' '));
		};
		pushField('temp', 0, temp, false, 1e-4, 3);
		pushField('airU', 0, airU, false, 1e-2, 2);
		pushField('airN', N0, airN, false, 1e-4, 4);
		pushField('pressure', pAmb, pressure, true, 1e-1, 1);
		const vExc = [];
		voltages.forEach((v, idx) => { if (Math.abs(v) > 1e-3) vExc.push((idx % W) + ',' + ((idx / W) | 0) + ':' + v.toFixed(3)); });
		if (vExc.length) L.push('field voltage 0 ' + vExc.join(' '));
		const bExc = [];
		if (fieldBz) for (let i = 0; i < N; i++) { const v = fieldBz[i]; if (Math.abs(v) > 1e-9) bExc.push((i % W) + ',' + ((i / W) | 0) + ':' + v.toFixed(4)); }
		if (bExc.length) L.push('field bfield 0 ' + bExc.join(' '));
		const cExc = [];
		cellColor.forEach((c, idx) => cExc.push((idx % W) + ',' + ((idx / W) | 0) + ':' + c));
		if (cExc.length) L.push('color ' + cExc.join(' '));
		return L.join('\n');
	}

	function applyStateFields(parsed) {
		const { buckets } = parsed;
		const N = GRID_W * GRID_H;
		// Pressure is intentionally left as set by seedAir() in applyMap, which
		// runs before pumps/pistons are placed; air cells that later become
		// pump/piston bodies therefore keep pAmb (matching the original scene's
		// behavior). Re-deriving pressure from isAir here would zero those cells,
		// breaking round-trip. Field pressure exceptions below still apply on top.
		temp.fill(0); airU.fill(0); airN.fill(N0);
		if (!fieldBz || fieldBz.length !== N) fieldBz = new Float64Array(N);
		fieldBz.fill(0);
		const setArr = (arr, t) => { const [xy, v] = t.split(':'); const { x, y } = parseXY(xy); arr[y * GRID_W + x] = +v; };
		(buckets.field || []).forEach(toks => {
			const name = toks[0];
			const rest = toks.slice(2);
			if (name === 'temp') rest.forEach(t => setArr(temp, t));
			else if (name === 'airU') rest.forEach(t => setArr(airU, t));
			else if (name === 'airN') rest.forEach(t => setArr(airN, t));
			else if (name === 'pressure') rest.forEach(t => setArr(pressure, t));
			else if (name === 'voltage') rest.forEach(t => { const [xy, v] = t.split(':'); const { x, y } = parseXY(xy); voltages.set(y * GRID_W + x, +v); });
			else if (name === 'bfield') rest.forEach(t => setArr(fieldBz, t));
		});
		cellColor.clear();
		(buckets.color || []).forEach(toks => toks.forEach(t => { const [xy, c] = t.split(':'); const { x, y } = parseXY(xy); cellColor.set(y * GRID_W + x, c); }));
	}

	function loadMapFromText(text) {
		resetBoardForLoad();
		const parsed = parseSceneText(text);
		applyMap(parsed);
		finalizeSceneLoad(parsed.meta);
		logger('Loaded scene from clipboard', 'sys');
	}

	function loadFullStateFromText(text) {
		resetBoardForLoad();
		userPaused = true;
		const parsed = parseSceneText(text);
		applyMap(parsed);
		lamps.forEach(l => { if (circles.has(l.idx)) circles.delete(l.idx); });
		switches.forEach(s => { if (circles.has(s.idx)) circles.delete(s.idx); });
		manualBatteries.forEach(b => b.poles.forEach(p => { if (circles.has(p)) circles.delete(p); }));
		pumps.forEach(p => { if (circles.has(p.idx)) circles.delete(p.idx); });
		setActiveTool('select', { unlimited: false });
		applyStateFields(parsed);
		if (parsed.meta && parsed.meta.view) setColorView(parsed.meta.view);
		simRunning = false;
		refreshPauseBtn();
		renderInventory(); render();
		logger('Loaded full state (paused) — resume Play to recompute derived fields', 'sys');
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
// Magnetic engine selector: 'diffusion' (forward-Euler cell-to-cell
// relaxation, default; see js/state.js:184), 'tapered' (analytic-tapered
// diffusion), 'hy3' (screened-Poisson, separate file), 'direct' (legacy
// per-frame Biot–Savart sum). Switching drops the solver state so the
// engines never share a half-warm field. Also re-binds the B-range slider
// between MAG_RANGE ('tapered', cells), MAG_LAMBDA ('hy3', screened-Poisson
// decay), and MAG_DIFFUSION_ALPHA ('diffusion', per-step diffusion rate),
// and toggles the "Magnets emit B" ('tapered') vs "Magnets inject dipoles"
// ('hy3') controls.
const magEngineSel = document.getElementById('magEngineSel');
const magRangeUnit = document.getElementById('magRangeUnit');
const magEmitAllLbl = document.getElementById('magEmitAllLbl');
const magDipolesLbl = document.getElementById('magDipolesLbl');
const magDipolesChk = document.getElementById('magDipoles');

function magEngineOnChange() {
	magEngine = magEngineSel.value;
	const slider = document.getElementById('magRange');
	const readout = document.getElementById('magRangeVal');
	if (magEngine === 'hy3') {
		slider.min = 0.02; slider.max = 1; slider.step = 0.01;
		const v = +MAG_LAMBDA.toFixed(2);
		slider.value = v;
		if (readout) readout.textContent = v.toFixed(2);
		if (magRangeUnit) magRangeUnit.textContent = 'λ';
		if (magEmitAllLbl) magEmitAllLbl.hidden = true;
		if (magDipolesLbl) magDipolesLbl.hidden = false;
	} else if (magEngine === 'tapered') {
		slider.min = 2; slider.max = 16; slider.step = 1;
		slider.value = MAG_RANGE;
		if (readout) readout.textContent = MAG_RANGE;
		if (magRangeUnit) magRangeUnit.textContent = 'cells';
		if (magEmitAllLbl) magEmitAllLbl.hidden = false;
		if (magDipolesLbl) magDipolesLbl.hidden = true;
	} else if (magEngine === 'diffusion') {
		slider.min = 0.02; slider.max = 0.24; slider.step = 0.01;
		const v = +MAG_DIFFUSION_ALPHA.toFixed(2);
		slider.value = v;
		if (readout) readout.textContent = v.toFixed(2);
		if (magRangeUnit) magRangeUnit.textContent = 'α';
		if (magEmitAllLbl) magEmitAllLbl.hidden = true;
		if (magDipolesLbl) magDipolesLbl.hidden = true;
	} else { // 'direct'
		slider.min = 2; slider.max = 16; slider.step = 1;
		slider.value = MAG_RANGE;
		if (readout) readout.textContent = MAG_RANGE;
		if (magRangeUnit) magRangeUnit.textContent = 'cells';
		if (magEmitAllLbl) magEmitAllLbl.hidden = true;
		if (magDipolesLbl) magDipolesLbl.hidden = true;
	}
	magReset();
	recompute();
	updateStatus();
	const tag = magEngine === 'direct'    ? 'Direct (obsolete)'
	          : magEngine === 'hy3'        ? 'Diffusion-Hy3 (screened)'
	          : magEngine === 'tapered'    ? 'Diffusion-Ar (tapered)'
	          :                               'Diffusion (visual relaxation)';
	logger('Magnetic engine: ' + tag, 'sys');
}
if (magEngineSel) {
	magEngineSel.value = magEngine;
	magEngineSel.onchange = magEngineOnChange;
	magEngineOnChange(); // sync slider + control visibility to the current default
}
const magRangeSlider = document.getElementById('magRange');
const magRangeVal = document.getElementById('magRangeVal');
if (magRangeSlider) magRangeSlider.oninput = () => {
	const v = +magRangeSlider.value;
	if (magEngine === 'hy3') {
		MAG_LAMBDA = v;
		if (typeof magBzPoissonHy3Reset === 'function') magBzPoissonHy3Reset();
	} else if (magEngine === 'diffusion') {
		MAG_DIFFUSION_ALPHA = v;
		if (typeof magDiffusionReset === 'function') magDiffusionReset();
	} else {
		MAG_RANGE = v;
	}
	if (magRangeVal) magRangeVal.textContent = magEngine === 'hy3' || magEngine === 'diffusion' ? v.toFixed(2) : v;
	startSimLoop();
};
const magEmitChk = document.getElementById('magEmitAll');
if (magEmitChk) magEmitChk.onchange = () => {
	magEmitAll = magEmitChk.checked;
	if (magnetList().length) { fieldSimulate(); startSimLoop(); }
};
if (magDipolesChk) magDipolesChk.onchange = () => {
	MAG_DIPOLES = magDipolesChk.checked;
	if (typeof magBzPoissonHy3Reset === 'function') magBzPoissonHy3Reset();
	if (magnetList().length) { fieldSimulate(); startSimLoop(); }
};
const metalRSlider = document.getElementById('metalR');
  const metalRVal = document.getElementById('metalRVal');
  if (metalRSlider) metalRSlider.oninput = () => {
  	R_metal = +metalRSlider.value;
  	if (metalRVal) metalRVal.textContent = metalRSlider.value;
  	if (anyMetal()) scheduleFieldRecompute();
  };
  const kbSlider = document.getElementById('kbGain');
  const kbVal = document.getElementById('kbGainVal');
  if (kbSlider) kbSlider.oninput = () => {
  	K_B = +kbSlider.value;
  	if (kbVal) kbVal.textContent = kbSlider.value;
  	if (magnetList().length) { fieldSimulate(); startSimLoop(); }
  	else if (electricActive()) scheduleFieldRecompute();
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

	// ---- Scene copy / paste buttons -------------------------------------
	function sceneCopyFallback(text) {
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
	}
	function sceneWrite(text, msg) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text)
				.then(() => logger(msg, 'sys'))
				.catch(() => { if (sceneCopyFallback(text)) logger(msg, 'sys'); else logger('Copy failed (clipboard blocked)', 'err'); });
		} else if (sceneCopyFallback(text)) {
			logger(msg, 'sys');
		} else {
			logger('Copy failed (clipboard unavailable)', 'err');
		}
	}
	const pasteSceneText = () => {
		const apply = (t) => {
			if (!t || !t.trim()) return;
			/^(field|color) /m.test(t) ? loadFullStateFromText(t) : loadMapFromText(t);
		};
		if (navigator.clipboard && navigator.clipboard.readText) {
			navigator.clipboard.readText().then(apply).catch(() => { const t = window.prompt('Paste scene/state text:'); if (t) apply(t); });
		} else {
			const t = window.prompt('Paste scene/state text:'); if (t) apply(t);
		}
	};
	document.getElementById('copyMapBtn').onclick = () => sceneWrite(serializeSceneMap(), 'Copied scene map to clipboard');
	document.getElementById('copyStateBtn').onclick = () => sceneWrite(serializeFullState(), 'Copied full state to clipboard');
	document.getElementById('pasteBtn').onclick = pasteSceneText;

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

// Place or select an Air Pump block: sealed wall block pumping air in arrow dir
function placePump(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = pumps.find(p => p.idx === idx);
	if (existing) { selectedItem = { kind: 'pump', ref: existing }; renderProperties(); return; }
	if (!unlimited && INV.pump.count <= 0) { logger('No air pump left', 'err'); return; }
	if (!wirePassable(idx)) { logger('Air pump needs a corridor or battery pole', 'err'); return; }
	if (manualBatteries.some(b => b.poles.includes(idx))) { logger('Air pump cannot sit on a battery pole', 'err'); return; }
	if (lamps.some(l => l.idx === idx) || switches.some(s => s.idx === idx) || pipeValves.some(v => v.idx === idx) || pipePortals.some(p => p.a === idx || p.b === idx)) {
		logger('Cell already occupied', 'err'); return;
	}
	if (!unlimited) INV.pump.count--;
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
	if (circles.has(idx)) circles.delete(idx);
	const p = {
		x, y, idx,
		dir: 1, // East (Right), 0=N, 1=E, 2=S, 3=W matching dirs
		R: 10.0,
		efficiency: 0.70,
		limited: !unlimited,
		dV: 0,
		lastPower: 0,
		lastFlow: 0,
		lastDeltaP: 0,
		lastEff: 0,
		lastHeat: 0
	};
	pumps.push(p);
	selectedItem = { kind: 'pump', ref: p };
	bus.emit('air:changed');
	bus.emit('wire:placed');
	recompute();
	renderProperties();
	logger(`Placed air pump at ${x},${y}` + (cut ? ' (cut wire → junction)' : ''));
}
function returnPump(p) {
	const i = pumps.indexOf(p);
	if (i < 0) return;
	pumps.splice(i, 1);
	if (selectedItem && selectedItem.kind === 'pump' && selectedItem.ref === p) selectedItem = null;
	if (p.limited) INV.pump.count++;
	bus.emit('air:changed');
	bus.emit('wire:placed');
	recompute();
	renderProperties();
	logger('Returned air pump', 'sys');
}

// Place or select a Piston (2x1 sealed movable obstacle)
function placePiston(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const idx = y * GRID_W + x;
	const existing = pistons.find(p => bodyCells(p).includes(idx));
	if (existing) { selectedItem = { kind: existing.magnet ? 'solenoid' : 'piston', ref: existing }; renderProperties(); return; }
	if (!unlimited && INV.piston.count <= 0) { logger('No piston left', 'err'); return; }

	let axis = null;
	const hFit = (x + 1 < GRID_W) && grid[idx] === 0 && grid[idx + 1] === 0 && !blocked[idx] && !blocked[idx + 1];
	const vFit = (y + 1 < GRID_H) && grid[idx] === 0 && grid[idx + GRID_W] === 0 && !blocked[idx] && !blocked[idx + GRID_W];

	const isVertTunnel = (x === 0 || grid[idx - 1] === 1) && (x === GRID_W - 1 || grid[idx + 1] === 1);
	const isHorizTunnel = (y === 0 || grid[idx - GRID_W] === 1) && (y === GRID_H - 1 || grid[idx + GRID_W] === 1);

	if (isVertTunnel && vFit) axis = 'v';
	else if (isHorizTunnel && hFit) axis = 'h';
	else if (hFit) axis = 'h';
	else if (vFit) axis = 'v';
	else { logger('Piston needs a 2x1 corridor space', 'err'); return; }

	if (!unlimited) INV.piston.count--;
	const p = createMechanicalBody({
		kind: 'piston', magnet: false, x, y, axis, moveAxis: axis,
		pos: axis === 'h' ? x : y, limited: !unlimited
	});
	pistons.push(p);
	syncPistonOccupancy();
	selectedItem = { kind: 'piston', ref: p };
	bus.emit('air:changed');
	renderProperties();
	startSimLoop();
	logger(`Placed piston (2x1 ${axis === 'h' ? 'horizontal' : 'vertical'}) at ${x},${y}`);
}
function returnPiston(p) {
	const i = pistons.indexOf(p);
	if (i < 0) return;
	pistons.splice(i, 1);
	if (selectedItem && (selectedItem.kind === 'piston' || selectedItem.kind === 'solenoid') && selectedItem.ref === p) selectedItem = null;
	if (p.limited) {
		if (p.magnet) INV.solenoid.count++;
		else INV.piston.count++;
	}
	syncPistonOccupancy();
	bus.emit('air:changed');
	bus.emit('wire:placed');
	renderProperties();
	logger(p.magnet ? 'Returned magnet piston' : 'Returned piston', 'sys');
}

function cellIsConductor(idx) {
	if (idx < 0 || idx >= GRID_W * GRID_H) return false;
	if (blocked[idx]) return false;
	if (metalCells[idx]) return true;
	if (manualWires.some(w => w.cells.includes(idx))) return true;
	if (manualBatteries.some(b => b.poles.includes(idx))) return true;
	if (lamps.some(l => l.idx === idx)) return true;
	if (pumps.some(p => p.idx === idx)) return true;
	if (switches.some(s => s.idx === idx && s.value)) return true;
	return false;
}

function placeSolenoid(x, y) {
	if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
	const existing = pistons.find(p => bodyCells(p).includes(y * GRID_W + x));
	if (existing) {
		selectedItem = { kind: existing.magnet ? 'solenoid' : 'piston', ref: existing };
		renderProperties(); return;
	}
	if (!unlimited && INV.solenoid.count <= 0) { logger('No magnet piston left', 'err'); return; }

	const idx = y * GRID_W + x;
	const hFit = (x + 1 < GRID_W) && grid[idx] === 0 && grid[idx + 1] === 0 && !blocked[idx] && !blocked[idx + 1];
	const vFit = (y + 1 < GRID_H) && grid[idx] === 0 && grid[idx + GRID_W] === 0 && !blocked[idx] && !blocked[idx + GRID_W];
	const isVertTunnel = (x === 0 || grid[idx - 1] === 1) && (x === GRID_W - 1 || grid[idx + 1] === 1);
	const isHorizTunnel = (y === 0 || grid[idx - GRID_W] === 1) && (y === GRID_H - 1 || grid[idx + GRID_W] === 1);

	let axis = 'h', moveAxis = 'h';
	// 1-wide tunnel → Case B (axis = motion). Case A only when the 2-cell body
	// spans two conductor cells on opposite ends (rails on the long-axis tips).
	const hEnds = hFit && x > 0 && x + 2 < GRID_W && cellIsConductor(idx - 1) && cellIsConductor(idx + 2);
	const vEnds = vFit && y > 0 && y + 2 < GRID_H && cellIsConductor(idx - GRID_W) && cellIsConductor(idx + 2 * GRID_W);
	if (isVertTunnel && vFit) { axis = 'v'; moveAxis = 'v'; }
	else if (isHorizTunnel && hFit) { axis = 'h'; moveAxis = 'h'; }
	else if (hEnds) { axis = 'h'; moveAxis = 'v'; }
	else if (vEnds) { axis = 'v'; moveAxis = 'h'; }
	else if (hFit) { axis = 'h'; moveAxis = 'h'; }
	else if (vFit) { axis = 'v'; moveAxis = 'v'; }
	else { logger('Magnet piston needs a 2x1 corridor', 'err'); return; }

	if (!unlimited) INV.solenoid.count--;
	const p = createMechanicalBody({
		kind: 'solenoid', magnet: true, x, y, axis, moveAxis,
		pos: moveAxis === 'h' ? x : y, limited: !unlimited
	});
	pistons.push(p);
	syncPistonOccupancy();
	selectedItem = { kind: 'solenoid', ref: p };
	bus.emit('air:changed');
	bus.emit('wire:placed');
	renderProperties();
	startSimLoop();
	logger(`Placed magnet piston (${axis === moveAxis ? 'Case B' : 'Case A'}) at ${x},${y}`);
}

// Double-click handler: return the battery/wire/lamp under the cursor.
// While a plan is pending (a/b strategies awaiting Enter/Esc) a
// double-click must not discard or return anything. Obstacle cells only
// emit the "cannot return" error under the Select tool, so double-clicks
// with a GODMODE tool stay silent.
function handleReturnAt(x, y) {
	if (pendingPlan) return;
	if (pendingMove) return;
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
	const pump = pumps.find(p => p.idx === idx);
	if (pump) { if (selectedItem && selectedItem.kind === 'pump' && selectedItem.ref === pump) selectedItem = null; returnPump(pump); return; }
	const piston = pistons.find(p => bodyCells(p).includes(idx));
	if (piston) { if (selectedItem && (selectedItem.kind === 'piston' || selectedItem.kind === 'solenoid') && selectedItem.ref === piston) selectedItem = null; returnPiston(piston); return; }
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
	const pump = pumps.find(p => p.idx === idx);
	if (pump) return { kind: 'pump', ref: pump };
	const piston = pistons.find(p => {
		const x0 = Math.round(p.pos), y0 = p.y;
		if (p.axis === 'h') return (x0 === x || x0 + 1 === x) && y0 === y;
		else return p.x === x && (y0 === y || y0 + 1 === y);
	});
	if (piston) return { kind: 'piston', ref: piston };
	const bat = manualBatteries.find(b => b.poles.includes(idx));
	if (bat) return { kind: 'battery', ref: bat };
	const wire = manualWires.find(w => w.cells.includes(idx));
	if (wire) return { kind: 'wire', ref: wire };
	if (circles.has(idx)) return { kind: 'node', ref: idx };
	return null;
}

	// ---- Pointer drag-to-move existing placed items --------------------
	function itemCells(ref, kind) {
		if (kind === 'wire') return ref.cells.slice();
		if (kind === 'battery') return ref.poles.slice();
		if (kind === 'piston') return bodyCells(ref);
		if (kind === 'pipeportal') return [ref.a, ref.b];
		if (kind === 'node') return [ref];
		return [ref.idx];
	}

	// Cells a body would occupy if its top-left anchor were `anchor`, keeping
	// the moving axis (bodyMoveAxis) and span (bodySpan) of the original body.
	function bodyCellsAt(b, anchor) {
		const clone = Object.assign({}, b);
		clone.x = anchor % GRID_W;
		clone.y = (anchor / GRID_W) | 0;
		clone.pos = (bodyMoveAxis(b) === 'h') ? clone.x : clone.y;
		return bodyCells(clone);
	}

	// True if `idx` is occupied by an item other than `ref` (of `kind`).
	function otherOccupant(idx, ref, kind) {
		if (blocked[idx]) return true;
		if (pipeValves.some(v => v.idx === idx)) return true;
		if (pipePortals.some(p => (p.a === idx || p.b === idx) && p !== ref)) return true;
		if (circles.has(idx)) {
			if (kind === 'node' && ref === idx) return false;
			if (kind === 'wire' && ref.cells.includes(idx)) return false;
			if (kind === 'battery' && ref.poles.includes(idx)) return false;
			return true;
		}
		if (lamps.some(l => l.idx === idx && l !== ref)) return true;
		if (switches.some(s => s.idx === idx && s !== ref)) return true;
		if (heatSinks.some(h => h.idx === idx && h !== ref)) return true;
		if (airSources.some(s => s.idx === idx && s !== ref)) return true;
		if (airSinks.some(s => s.idx === idx && s !== ref)) return true;
		if (pumps.some(p => p.idx === idx && p !== ref)) return true;
		if (manualBatteries.some(b => b.poles.includes(idx) && b !== ref)) return true;
		if (manualWires.some(w => w.cells.includes(idx) && w !== ref)) return true;
		if (pistons.some(p => bodyCells(p).includes(idx) && p !== ref)) return true;
		return false;
	}

	// Whether the candidate target cell is a legal drop for `ref`.
	function itemTargetFree(ref, kind, toCell, opt) {
		opt = opt || {};
		if (toCell == null || toCell < 0 || toCell >= GRID_W * GRID_H) return false;
		let cells;
		if (kind === 'battery') {
			const newAnchor = toCell - (opt.grabOffset || 0);
			if (((newAnchor / GRID_W) | 0) + 1 >= GRID_H) return false;
			cells = [newAnchor, newAnchor + GRID_W];
		} else if (kind === 'piston') {
			const newAnchor = toCell - (opt.grabOffset || 0);
			cells = bodyCellsAt(ref, newAnchor);
		} else if (kind === 'pipeportal') {
			const delta = toCell - opt.grabbedIdx;
			cells = [ref.a + delta, ref.b + delta];
		} else {
			cells = [(kind === 'node') ? ref : ref.idx];
		}
		for (const c of cells) {
			if (c < 0 || c >= GRID_W * GRID_H) return false;
			if (otherOccupant(c, ref, kind)) return false;
		}
		return true;
	}

	// Cells to highlight in the move preview for a candidate target.
	function movePreviewCells(ref, kind, toCell, opt) {
		opt = opt || {};
		if (toCell == null) return [];
		if (kind === 'battery') {
			const newAnchor = toCell - (opt.grabOffset || 0);
			if (((newAnchor / GRID_W) | 0) + 1 >= GRID_H) return [];
			return [newAnchor, newAnchor + GRID_W];
		} else if (kind === 'piston') {
			const newAnchor = toCell - (opt.grabOffset || 0);
			return bodyCellsAt(ref, newAnchor);
		} else if (kind === 'pipeportal') {
			const delta = toCell - opt.grabbedIdx;
			return [ref.a + delta, ref.b + delta];
		} else {
			return [(kind === 'node') ? ref : ref.idx];
		}
	}

	// Plan a BUILD wire relocation: temporarily extend the pool by the wire's
	// own segments (they'll be returned by returnWire) so the route can be
	// shorter (cut) or longer (place) than the original.
	function planRelocation(path) {
		const orig = dragMove.ref.segs;
		orig.forEach(l => WIRES.set(l, (WIRES.get(l) || 0) + 1));
		const plan = planAllocation(path, wireStrategy);
		orig.forEach(l => { const c = WIRES.get(l) - 1; if (c <= 0) WIRES.delete(l); else WIRES.set(l, c); });
		return plan;
	}

	function beginItemDrag(item, x, y) {
		pendingPlan = null; wireDrag = null; pendingMove = null;
		const kind = item.kind, ref = item.ref;
		const originCell = y * GRID_W + x;
		const dm = {
			kind, ref, free: unlimited, originCell, moved: false, valid: true,
			path: null, plan: null, toCell: null,
			grabEnd: null, fixedEndIdx: null, grabOffset: 0, grabbedIdx: null, color: null
		};
		if (kind === 'wire') {
			const w = ref;
			dm.color = w.color;
			const end0 = w.nodes[0], end1 = w.nodes[w.nodes.length - 1];
			let grabEnd, fixedEnd;
			if (originCell === end0) { grabEnd = end0; fixedEnd = end1; }
			else if (originCell === end1) { grabEnd = end1; fixedEnd = end0; }
			else {
				const d0 = Math.abs(originCell - end0), d1 = Math.abs(originCell - end1);
				if (d0 <= d1) { grabEnd = end0; fixedEnd = end1; }
				else { grabEnd = end1; fixedEnd = end0; }
			}
			dm.grabEnd = grabEnd; dm.fixedEndIdx = fixedEnd;
		} else if (kind === 'battery') {
			dm.grabOffset = originCell - ref.poles[0];
		} else if (kind === 'piston') {
			dm.grabOffset = originCell - (ref.y * GRID_W + ref.x);
		} else if (kind === 'pipeportal') {
			dm.grabbedIdx = item.endpoint;
		}
		dragMove = dm;
		updateItemDrag(x, y);
		render();
	}

	function updateItemDrag(x, y) {
		if (!dragMove) return;
		const dm = dragMove;
		if (dm.kind === 'wire') {
			const target = y * GRID_W + x;
			if (target === dm.originCell) { dm.moved = false; dm.valid = true; dm.path = null; dm.plan = null; return; }
			dm.moved = true;
			const maxLen = dm.free ? GRID_W * GRID_H : (poolTotal() + dm.ref.segs.reduce((a, b) => a + b, 0) + 1);
			const path = findWirePath(dm.fixedEndIdx, target, maxLen);
			dm.path = path;
			if (path.length < 2) { dm.valid = false; dm.plan = null; return; }
			dm.plan = dm.free ? planUnlimited(path) : planRelocation(path);
			dm.valid = !!(dm.plan && dm.plan.ok);
		} else {
			const toCell = y * GRID_W + x;
			dm.toCell = toCell;
			dm.moved = (toCell !== dm.originCell);
			dm.valid = itemTargetFree(dm.ref, dm.kind, toCell, { grabOffset: dm.grabOffset, grabbedIdx: dm.grabbedIdx });
		}
	}

	// Relocate `ref` to `toCell` (no inventory change for non-wire kinds).
	function applyItemMove(ref, kind, toCell, opt) {
		opt = opt || {};
		if (kind === 'node') {
			const old = circles.get(ref);
			circles.delete(ref);
			circles.set(toCell, old);
		} else if (kind === 'pipeportal') {
			const delta = toCell - opt.grabbedIdx;
			ref.a += delta; ref.b += delta;
			syncCellOpen();
		} else if (kind === 'battery') {
			const newAnchor = toCell - (opt.grabOffset || 0);
			ref.poles.forEach(p => { if (!manualWires.some(o => o.cells.includes(p))) circles.delete(p); });
			ref.y = (newAnchor / GRID_W) | 0;
			ref.x = newAnchor % GRID_W;
			ref.poles = [newAnchor, newAnchor + GRID_W];
			circles.set(ref.poles[0], { color: ref.term[0], small: false, manual: true, battery: true });
			circles.set(ref.poles[1], { color: ref.term[1], small: false, manual: true, battery: true });
		} else if (kind === 'piston') {
			const newAnchor = toCell - (opt.grabOffset || 0);
			ref.x = newAnchor % GRID_W; ref.y = (newAnchor / GRID_W) | 0;
			ref.pos = (bodyMoveAxis(ref) === 'h') ? ref.x : ref.y;
			syncPistonOccupancy();
		} else {
			ref.x = toCell % GRID_W; ref.y = (toCell / GRID_W) | 0; ref.idx = toCell;
		}
		buildNetworks();
		syncCellOpen();
		syncPistonOccupancy();
		renderProperties();
	}

	// GODMODE free re-route of a wire end: recompute nodes from the new path.
	function rerouteWire(wire, path, plan) {
		wire.nodes.forEach(nidx => {
			const stillUsed = manualWires.some(o => o !== wire && o.cells.includes(nidx)) ||
				manualBatteries.some(b => b.poles.includes(nidx));
			if (!stillUsed) circles.delete(nidx);
		});
		let acc = 0;
		const nodeIdx = [0];
		for (const s of plan.segs) { acc += s; nodeIdx.push(acc); }
		const nodes = nodeIdx.map(i => path[i]);
		wire.cells = path.slice();
		wire.nodes = nodes;
		wire.segs = plan.segs.slice();
		nodes.forEach(nidx => { if (!circles.has(nidx)) circles.set(nidx, { color: wire.color, small: false, manual: true }); });
		buildNetworks();
		bus.emit('wire:placed');
		render();
	}

	function applyItemMovePlan() {
		if (!pendingMove) return;
		if (pendingMove.kind === 'wire') {
			const w = pendingMove.ref;
			if (!pendingMove.plan || !pendingMove.plan.ok) { pendingMove = null; render(); updateStatus(); return; }
			returnWire(w);
			if (manualWires.includes(w)) {
				logger('Cannot move — wire blocked', 'err');
				pendingMove = null; render(); updateStatus();
				return;
			}
			const prevColor = selectedColor;
			const prevUnlimited = unlimited;
			selectedColor = w.color;
			unlimited = false; // BUILD accounting: consume/cut the pool
			commitWire(Object.assign({}, pendingMove.plan, { path: pendingMove.path }));
			unlimited = prevUnlimited;
			selectedColor = prevColor;
			pendingMove = null;
			buildNetworks(); render(); renderInventory();
		} else {
			const { ref, kind, toCell, grabOffset, grabbedIdx } = pendingMove;
			if (!itemTargetFree(ref, kind, toCell, { grabOffset, grabbedIdx })) {
				logger('Move blocked — destination occupied', 'err');
				pendingMove = null; render(); updateStatus();
				return;
			}
			applyItemMove(ref, kind, toCell, { grabOffset, grabbedIdx });
			selectedItem = { kind, ref: kind === 'node' ? toCell : ref };
			pendingMove = null;
			buildNetworks(); render(); renderInventory();
		}
		updateStatus();
	}

	function cancelItemMove() {
		pendingMove = null;
		render(); updateStatus();
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
	if (moveMode) {
		const item = pickItemAt(x, y);
		if (item && isMovableKind(item.kind)) { beginItemDrag(item, x, y); return; }
	}
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
	} else if (activeTool === 'piston') {
		placePiston(x, y);
	} else if (activeTool === 'solenoid') {
		placeSolenoid(x, y);
	} else if (activeTool === 'pump') {
		placePump(x, y);
	} else if (activeTool === 'select') {
		selectedItem = pickItemAt(x, y);
		renderProperties();
	} else {
		nodeClick(x, y);
	}
}

// Pointer release: ends a drag or commits a wire; shared by mouse + touch.
function pointerUp() {
	if (dragMove) {
		const dm = dragMove;
		dragMove = null;
		if (!dm.moved) {
			selectedItem = pickItemAt(dm.originCell % GRID_W, (dm.originCell / GRID_W) | 0);
			renderProperties();
			render();
			return;
		}
		if (!dm.valid) { render(); return; }
		if (dm.kind === 'wire') {
			selectedItem = { kind: 'wire', ref: dm.ref };
			if (dm.free) rerouteWire(dm.ref, dm.path, dm.plan);
			else pendingMove = { kind: 'wire', ref: dm.ref, path: dm.path, plan: dm.plan };
		} else {
			selectedItem = { kind: dm.kind, ref: dm.kind === 'node' ? dm.toCell : dm.ref };
			if (dm.free) applyItemMove(dm.ref, dm.kind, dm.toCell, { grabOffset: dm.grabOffset, grabbedIdx: dm.grabbedIdx });
			else pendingMove = { kind: dm.kind, ref: dm.ref, toCell: dm.toCell, grabOffset: dm.grabOffset, grabbedIdx: dm.grabbedIdx, valid: dm.valid };
		}
		render(); updateStatus();
		return;
	}
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
		if (dragMove) { updateItemDrag(x, y); render(); return; }
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
		if (pendingMove) return;
		handleReturnAt(x, y);
	};

selectGod('node');
updateStatus();
buildMaze();
updateZoomLabel();
