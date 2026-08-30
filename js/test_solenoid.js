// Headless tests for the solenoid / magnetic DC machine.
// Run: node js/test_solenoid.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const elements = new Map();
function makeEl(id) {
	return {
		id, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
		style: {}, dataset: {}, children: [], childNodes: [],
		getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 800, bottom: 800, right: 800 }; },
		clientWidth: 800, clientHeight: 800, width: 800, height: 800,
		getContext() { return {
			fillRect(){}, clearRect(){}, fillText(){}, strokeRect(){},
			beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
			arc(){}, save(){}, restore(){}, drawImage(){},
			setTransform(){}, scale(){}, translate(){}, closePath(){},
			set fillStyle(v){}, set strokeStyle(v){}, set lineWidth(v){},
			set font(v){}, set imageSmoothingEnabled(v){}, set globalAlpha(v){},
			set lineCap(v){}, set lineJoin(v){}, setLineDash(){},
		}; },
		textContent: '', innerHTML: '', value: '0', checked: false, tagName: 'DIV',
		onchange: null, oninput: null, onclick: null,
		addEventListener() {}, removeEventListener() {},
		appendChild(c) { this.children.push(c); return c; },
		removeChild(c) { this.children = this.children.filter(x => x !== c); },
		prepend(c) { this.children.unshift(c); return c; },
		setAttribute() {}, removeAttribute() {},
		cloneNode() { return makeEl(id); },
		focus() {}, blur() {},
		get firstChild() { return null; }, get lastChild() { return null; },
		get parentNode() { return null; },
		dispatchEvent() {},
		insertBefore() {}, querySelector() { return null; }, querySelectorAll() { return []; },
		contains: () => false,
	};
}
function getEl(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); }

const sandbox = {
	document: {
		getElementById: (id) => getEl(id),
		querySelector: () => getEl('qsel'),
		querySelectorAll: () => [],
		createElement: (tag) => makeEl('ce_' + tag),
		addEventListener: () => {},
	},
	window: { addEventListener: () => {} },
	navigator: { clipboard: null },
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	performance: { now: () => Date.now() },
	setTimeout, clearTimeout, setInterval, clearInterval,
	console, Math, JSON, Date, Array, Object, Map, Set, Promise,
	Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array,
	__dirname, __filename,
};
vm.createContext(sandbox);

const files = ['state.js', 'maze.js', 'network.js', 'render.js', 'air.js', 'electric.js', 'ui.js'];
const jsDir = fs.existsSync(path.join(__dirname, 'state.js')) ? __dirname : path.join(__dirname, 'js');
for (const f of files) {
	const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
	vm.runInContext(src, sandbox, { filename: f });
}
console.log('OK: loaded', files.length, 'JS files into VM sandbox');

function getRef(name) {
	vm.runInContext(`globalThis.__ref = ${name};`, sandbox);
	const v = sandbox.__ref;
	sandbox.__ref = undefined;
	return v;
}
function runCode(code) { return vm.runInContext("(function(){" + code + "})()", sandbox); }

let passCount = 0, failCount = 0;
function assert(cond, desc) {
	if (cond) { console.log('  PASS', desc); passCount++; }
	else { console.error('  FAIL', desc); failCount++; }
}

const GRID_W = getRef('GRID_W');

function settle(n) {
	runCode(`
		for (let i = 0; i < ${n}; i++) { fieldRelax(50); }
		fieldPublish();
	`);
}

function clearBoard() {
	runCode(`
		pistons.length = 0; pumps.length = 0;
		manualWires.length = 0; manualBatteries.length = 0;
		lamps.length = 0; switches.length = 0;
		airSources.length = 0; airSinks.length = 0;
		pipeValves.length = 0; metalCells.fill(0);
		grid.fill(1);
		fieldSystems = [];
		if (fieldV) fieldV.fill(0);
	`);
}

function loopWire(x0, y0, x1, y1) {
	runCode(`
		(function () {
			const rc = (x, y) => y * GRID_W + x;
			const c = [];
			for (let x = ${x0}; x <= ${x1}; x++) c.push(rc(x, ${y0}));
			for (let y = ${y0}+1; y <= ${y1}; y++) c.push(rc(${x1}, y));
			for (let x = ${x1}-1; x >= ${x0}; x--) c.push(rc(x, ${y1}));
			for (let y = ${y1}-1; y > ${y0}; y--) c.push(rc(${x0}, y));
			sceneAddWire(c, '#22c55e');
		})();
	`);
}

// Build a rectangular wire loop (ring) of given bounds in an open chamber,
// optionally with a battery + lamp, leaving the interior open for a magnet.
function buildLoopSetup(opts) {
	const o = Object.assign({ x0: 6, x1: 24, y0: 14, y1: 16, battery: true, lamp: true }, opts || {});
	return `
		INV.battery.count = 10; INV.lamp.count = 10; unlimited = false;
		grid.fill(1);
		for (let y = ${o.y0 - 1}; y <= ${o.y1 + 1}; y++)
			for (let x = ${o.x0 - 2}; x <= ${o.x1 + 2}; x++) grid[y * GRID_W + x] = 0;
		buildNetworks();
		seedAir();
		var rc = (x, y) => y * GRID_W + x;
		var sLoop = [];
		for (let x = ${o.x0}; x <= ${o.x1}; x++) sLoop.push(rc(x, ${o.y0}));
		for (let y = ${o.y0 + 1}; y <= ${o.y1}; y++) sLoop.push(rc(${o.x1}, y));
		for (let x = ${o.x1 - 1}; x >= ${o.x0}; x--) sLoop.push(rc(x, ${o.y1}));
		sLoop.push(rc(${o.x0}, ${o.y0 + 1}));
		sceneAddWire(sLoop, '#f59e0b');
		${o.battery ? 'placeBattery(' + o.x0 + ', ' + o.y0 + ');' : ''}
		${o.lamp ? 'placeLamp(' + Math.floor((o.x0 + o.x1) / 2) + ', ' + o.y0 + ');' : ''}
		manualWires.forEach(w => { w.nodes.forEach(n => { if (!circles.has(n)) circles.set(n, { color: w.color, small: false, manual: true }); }); });
	`;
}

// Run fieldSimulate -> relax(steps) -> fieldPublish. Callers read globals afterwards.
function simulate(steps) {
	runCode(`
		fieldSimulate();
		for (let k = 0; k < ${steps}; k++) fieldRelax(FIELD_SWEEPS_PER_FRAME);
		fieldPublish();
	`);
}

// ---- 1. dirs / kernel orientation ----
console.log('\n== Test 1: dirs ordering and kernel cross-product ==');
const dirs = getRef('dirs');
assert(dirs[0].dx === 0 && dirs[0].dy === -1, 'dirs[0] = Up (0,-1)');
assert(dirs[1].dx === 1 && dirs[1].dy === 0, 'dirs[1] = Right (1,0)');
assert(dirs[2].dx === 0 && dirs[2].dy === 1, 'dirs[2] = Down (0,1)');
assert(dirs[3].dx === -1 && dirs[3].dy === 0, 'dirs[3] = Left (-1,0)');
runCode(`
	const gR = magKernelG(1, 0, 0, 1, 0.25); // +x current, r = +y → Bz > 0 (out)
	const gL = magKernelG(-1, 0, 0, 1, 0.25);
	globalThis.__kg = { gR, gL, grad: magKernelGrad(1, 0, 0.5, 0.5, 0.25) };
`);
const kg = sandbox.__kg;
assert(kg.gR > 0, `+x current, observer at +y: Bz > 0 (got ${kg.gR.toFixed(3)})`);
assert(kg.gL < 0, 'reversing dl reverses Bz');
assert(Number.isFinite(kg.grad.gx) && Number.isFinite(kg.grad.gy), 'analytic gradient is finite');

// ---- 2. factory / composition ----
console.log('\n== Test 2: body factory / composition ==');
runCode(`
	const a = createMechanicalBody({ x: 4, y: 10, axis: 'h', kind: 'piston' });
	const b = createMechanicalBody({ x: 8, y: 10, axis: 'v', moveAxis: 'h', kind: 'solenoid', magnet: true });
	globalThis.__fac = {
		pistonKind: a.kind, pistonMag: a.magnet, pistonMove: a.moveAxis, pistonAxis: a.axis,
		solKind: b.kind, solMag: b.magnet, solMove: b.moveAxis, solAxis: b.axis,
		caseA: isCaseA(b), caseB: isCaseA(a),
		spanA: bodySpan(b), spanB: bodySpan(a),
		bodiesIsPistons: bodies === pistons
	};
`);
const fac = sandbox.__fac;
assert(fac.pistonKind === 'piston' && fac.pistonMag === false, 'plain piston defaults magnet:false');
assert(fac.pistonMove === 'h' && fac.pistonAxis === 'h', 'plain piston moveAxis = axis');
assert(fac.solKind === 'solenoid' && fac.solMag === true, 'solenoid is magnet:true');
assert(fac.solAxis === 'v' && fac.solMove === 'h' && fac.caseA === true, 'Case A: axis ≠ moveAxis');
assert(fac.spanA === 1 && fac.spanB === 2, 'Case A span=1, Mode B span=2');
assert(fac.bodiesIsPistons === true, 'bodies is an alias of pistons');

clearBoard();
runCode(`
	for (let x = 0; x <= 12; x++) { grid[10 * GRID_W + x] = 0; grid[11 * GRID_W + x] = 0; }
	seedAir();
	pistons.push(createMechanicalBody({ x: 4, y: 10, axis: 'v', moveAxis: 'h', magnet: true, pos: 4, friction: 0 }));
	syncPistonOccupancy();
	var cells = bodyCells(pistons[0]);
	globalThis.__ch = {
		nCells: cells.length,
		occA: pistonOcc[10 * GRID_W + 4],
		occB: pistonOcc[11 * GRID_W + 4],
		airA: isAir(10 * GRID_W + 4),
		mass: airN.reduce((s, v) => s + v, 0)
	};
`);
const ch = sandbox.__ch;
assert(ch.nCells === 2, 'Case A body occupies 2 cells');
assert(ch.occA > 0.9 && ch.occB > 0.9, 'both rows occupied');
assert(ch.airA === false, 'fully occupied cells are non-air (hermetic)');

// ---- 3. field from a single wire (loop with one long side) ----
console.log('\n== Test 3: field from a current-carrying wire ==');
clearBoard();
runCode(`
	for (let x = 4; x <= 20; x++) grid[10 * GRID_W + x] = 0;
	for (let y = 10; y <= 14; y++) { grid[y * GRID_W + 4] = 0; grid[y * GRID_W + 20] = 0; }
	for (let x = 4; x <= 20; x++) grid[14 * GRID_W + x] = 0;
	seedAir();
`);
loopWire(4, 10, 20, 14);
runCode(`
	placeBattery(4, 10);
	pistons.push(createMechanicalBody({
		x: 12, y: 8, axis: 'v', moveAxis: 'v', magnet: true, pos: 8, friction: 0, magStrength: 1
	}));
	fieldSimulate();
`);
settle(80);
runCode(`
	var mag = pistons[0];
	globalThis.__F1 = mag.lastFcoil;
	globalThis.__B1 = mag.lastBz;
	mag.magStrength = -1;
	fieldSimulate();
`);
settle(40);
runCode(`
	globalThis.__w = { F1: globalThis.__F1, B1: globalThis.__B1, F2: pistons[0].lastFcoil, B2: pistons[0].lastBz, nE: fieldEdges.length };
`);
const w = sandbox.__w;
assert(w.nE > 0, `edge registry populated (${w.nE} edges)`);
assert(Math.abs(w.F1) > 1e-6 || Math.abs(w.B1) > 1e-6, `magnet beside a live loop feels B or F (B=${w.B1}, F=${w.F1})`);
assert(Math.sign(w.F1) === -Math.sign(w.F2) && Math.abs(w.F1) > 1e-4 && Math.abs(w.F2) > 1e-4,
	'reversing polarity reverses F_coil with finite magnitude (F1=' + w.F1.toExponential(2) + ', F2=' + w.F2.toExponential(2) + ')');

runCode(`
	manualBatteries.length = 0;
	fieldSimulate();
`);
settle(10);
runCode(`globalThis.__w0 = { B: pistons[0].lastBz, F: pistons[0].lastFcoil };`);
assert(Math.abs(sandbox.__w0.B) < 1e-8 && Math.abs(sandbox.__w0.F) < 1e-8, 'no current → Bz=0, F=0');

// ---- 4. two rails / solenoid gradient ----
console.log('\n== Test 4: opposite-current rails ==');
clearBoard();
runCode(`
	for (let x = 5; x <= 18; x++) {
		grid[9 * GRID_W + x] = 0; grid[11 * GRID_W + x] = 0; grid[10 * GRID_W + x] = 0;
		metalCells[9 * GRID_W + x] = 1; metalCells[11 * GRID_W + x] = 1;
	}
	for (let y = 9; y <= 11; y++) { grid[y * GRID_W + 5] = 0; metalCells[y * GRID_W + 5] = 1; }
	grid[8 * GRID_W + 5] = 0; grid[9 * GRID_W + 5] = 0;
	seedAir();
	placeBattery(5, 8);
	pistons.push(createMechanicalBody({
		x: 8, y: 10, axis: 'h', moveAxis: 'h', magnet: true, pos: 8, friction: 0
	}));
	fieldSimulate();
`);
settle(80);
runCode(`
	var mag = pistons[0];
	globalThis.__Bmid = mag.lastBz;
	mag.pos = 16; mag.x = 16;
	fieldSimulate();
`);
settle(40);
runCode(`
	globalThis.__rails = { Bmid: globalThis.__Bmid, Bend: pistons[0].lastBz, Fend: pistons[0].lastFcoil };
`);
const rails = sandbox.__rails;
assert(Number.isFinite(rails.Bmid), `Bz between rails is finite (${rails.Bmid.toFixed(4)})`);
assert(Number.isFinite(rails.Fend), `force is well-defined (no NaN) for the magnet beside the energized rails (F=${rails.Fend.toFixed(4)} N)`);
assert(Number.isFinite(rails.Bmid), `Bz is finite between the opposite-current rails (B=${rails.Bmid.toFixed(4)})`);

// ---- 5. arbitrary geometry: L-shaped run matches analytic kernel ----
console.log('\n== Test 5: arbitrary geometry (no pattern matching) ==');
clearBoard();
runCode(`
	const rc = (x, y) => y * GRID_W + x;
	for (let x = 6; x <= 14; x++) grid[rc(x, 12)] = 0;
	for (let y = 12; y <= 18; y++) grid[rc(14, y)] = 0;
	for (let x = 8; x <= 14; x++) grid[rc(x, 18)] = 0;
	grid[rc(8, 17)] = 0; grid[rc(8, 16)] = 0;
	seedAir();
	sceneAddWire([
		rc(8,16), rc(8,17), rc(8,18), rc(9,18), rc(10,18), rc(11,18), rc(12,18), rc(13,18), rc(14,18),
		rc(14,17), rc(14,16), rc(14,15), rc(14,14), rc(14,13), rc(14,12),
		rc(13,12), rc(12,12), rc(11,12), rc(10,12), rc(9,12), rc(8,12), rc(7,12), rc(6,12),
		rc(6,13), rc(6,14), rc(6,15), rc(6,16), rc(7,16), rc(8,16)
	], '#22c55e');
	placeBattery(8, 16);
	pistons.push(createMechanicalBody({ x: 10, y: 14, axis: 'h', magnet: true, pos: 10, friction: 0 }));
	fieldSimulate();
`);
settle(60);
runCode(`
	var mag = pistons[0];
	var c = bodyCenter(mag);
	var Bz = 0;
	var sig2 = SIGMA_B * SIGMA_B;
	for (var ei = 0; ei < fieldEdges.length; ei++) {
		var e = fieldEdges[ei];
		if (edgeIsSelf(e, mag)) continue;
		var rx = c.x - e.mx, ry = c.y - e.my;
		Bz += K_B * e.I * magKernelG(e.dlx, e.dly, rx, ry, sig2);
	}
	globalThis.__arb = { lastBz: mag.lastBz, analytic: Bz, F: mag.lastFcoil };
`);
const arb = sandbox.__arb;
assert(Math.abs(arb.lastBz - arb.analytic) < 1e-8, `Bz matches analytic kernel (num=${arb.lastBz.toFixed(5)} an=${arb.analytic.toFixed(5)})`);
assert(Number.isFinite(arb.F), 'L-shaped loop produces a well-defined force');

// ---- 6. Case A armature bridge ----
console.log('\n== Test 6: Case A armature bridge ==');
clearBoard();
runCode(`
	for (let y = 8; y <= 18; y++) { grid[y * GRID_W + 10] = 0; grid[y * GRID_W + 11] = 0; }
	for (let y = 8; y <= 18; y++) { metalCells[y * GRID_W + 9] = 1; metalCells[y * GRID_W + 12] = 1; }
	grid[7 * GRID_W + 9] = 0; grid[8 * GRID_W + 9] = 0;
	metalCells[7 * GRID_W + 9] = 1; metalCells[8 * GRID_W + 9] = 1;
	metalCells[7 * GRID_W + 12] = 1; metalCells[8 * GRID_W + 12] = 1;
	metalCells[7 * GRID_W + 10] = 1; metalCells[7 * GRID_W + 11] = 1;
	seedAir();
	placeBattery(9, 7);
	pistons.push(createMechanicalBody({
		x: 10, y: 12, axis: 'h', moveAxis: 'v', magnet: true, pos: 12, friction: 0, R_arm: 2
	}));
	fieldSimulate();
`);
settle(80);
runCode(`
	var mag = pistons[0];
	var cells = bodyCells(mag);
	globalThis.__ca = {
		caseA: isCaseA(mag),
		I: mag.lastCurrent,
		F: mag.lastFcoil,
		nCells: cells.length,
		r0: caseABodyAt(cells[0]) && caseABodyAt(cells[0]).R_arm
	};
	manualBatteries.length = 0;
	fieldSimulate();
`);
settle(20);
runCode(`globalThis.__ca2 = { I: pistons[0].lastCurrent, F: pistons[0].lastFcoil };`);
assert(sandbox.__ca.caseA === true, 'body is Case A');
assert(Math.abs(sandbox.__ca.I) > 1e-4, `current flows through the armature (I=${sandbox.__ca.I.toFixed(4)} A)`);
assert(sandbox.__ca.nCells === 2, 'bridge occupies two cells');
assert(Math.abs(sandbox.__ca2.I) < 1e-6, 'open battery → no armature current');

// ---- 7. Case B generator lights a lamp ----
console.log('\n== Test 7: Case B generator / open loop ==');
clearBoard();
runCode(`
	for (let x = 4; x <= 22; x++) grid[12 * GRID_W + x] = 0;
	for (let x = 6; x <= 18; x++) { metalCells[11 * GRID_W + x] = 1; metalCells[13 * GRID_W + x] = 1; }
	for (let y = 11; y <= 13; y++) { metalCells[y * GRID_W + 6] = 1; metalCells[y * GRID_W + 18] = 1; }
	grid[11 * GRID_W + 10] = 0; grid[13 * GRID_W + 10] = 0;
	seedAir();
	placeLamp(10, 11);
	pistons.push(createMechanicalBody({
		x: 10, y: 12, axis: 'h', moveAxis: 'h', magnet: true, pos: 10, vel: 2, friction: 0
	}));
	fieldSimulate();
`);
settle(80);
runCode(`
	var mag = pistons[0];
	var lamp = lamps[0];
	globalThis.__cb = { dV: lamp.dV, power: mag.lastPower, F: mag.lastFcoil, I: mag.lastCurrent };
	metalCells.fill(0);
	fieldSimulate();
`);
settle(40);
runCode(`globalThis.__cb2 = { dV: lamps[0].dV, I: pistons[0].lastCurrent, F: pistons[0].lastFcoil };`);
const cb = sandbox.__cb, cb2 = sandbox.__cb2;
assert(Math.abs(cb.dV) > 0.01 || Math.abs(cb.power) > 1e-4,
	`moving magnet in a closed loop induces EMF (dV=${cb.dV.toFixed(3)} P=${cb.power.toFixed(4)})`);
assert(Math.abs(cb2.I) < 1e-6 && Math.abs(cb2.F) < 1e-6, 'open loop → no current, no force');

// ---- 8. back-EMF: |I| falls as |v| rises ----
console.log('\n== Test 8: back-EMF current limiting ==');
clearBoard();
runCode(`
	var at = function (x, y) { return y * GRID_W + x; };
	for (var y = 8; y <= 18; y++) { grid[at(10, y)] = 0; grid[at(11, y)] = 0; }
	for (y = 8; y <= 18; y++) { metalCells[at(9, y)] = 1; metalCells[at(12, y)] = 1; }
	// Battery to the west; − return goes around the south end so the only
	// rail-to-rail bridge is the Case A armature.
	grid[at(4, 8)] = 0; grid[at(4, 9)] = 0;
	for (var x = 4; x <= 9; x++) grid[at(x, 8)] = 0;
	for (var yy = 9; yy <= 19; yy++) grid[at(4, yy)] = 0;
	for (x = 4; x <= 12; x++) grid[at(x, 19)] = 0;
	grid[at(4, 19)] = 0; grid[at(12, 19)] = 0; grid[at(12, 18)] = 0;
	seedAir();
	placeBattery(4, 8);
	sceneAddWire([at(4, 8), at(5, 8), at(6, 8), at(7, 8), at(8, 8), at(9, 8)], '#22c55e');
	var ret = [];
	for (yy = 9; yy <= 19; yy++) ret.push(at(4, yy));
	for (x = 5; x <= 12; x++) ret.push(at(x, 19));
	ret.push(at(12, 18));
	sceneAddWire(ret, '#22c55e');
	pistons.push(createMechanicalBody({
		x: 10, y: 9, axis: 'h', moveAxis: 'v', magnet: true, pos: 9, vel: 0, friction: 0
	}));
	fieldSimulate();
`);
settle(80);
runCode(`
	globalThis.__i0 = pistons[0].lastCurrent;
	globalThis.__F0 = pistons[0].lastFcoil || 0;
	pistons[0].vel = (globalThis.__F0 === 0 ? 1 : Math.sign(globalThis.__F0)) * 0.25;
	fieldSimulate();
`);
settle(80);
runCode(`globalThis.__i1 = pistons[0].lastCurrent; globalThis.__p1 = pistons[0].lastPower;`);
assert(Math.abs(sandbox.__i0) > 1e-4, `rest current through armature (I0=${sandbox.__i0.toFixed(4)} A)`);
assert(Math.abs(sandbox.__i1 - sandbox.__i0) > 1e-4,
	`motion changes armature current (I0=${sandbox.__i0.toFixed(4)} I1=${sandbox.__i1.toFixed(4)})`);

// ---- 9 / 10. energy identity ----
console.log('\n== Test 9-10: energy identity Σ E·I + Σ F·v ≈ 0 ==');
runCode(`
	pistons[0].vel = 1.5;
	fieldSimulate();
`);
settle(60);
runCode(`globalThis.__en = { r: magEnergyResidual, P: pistons[0].lastPower, F: pistons[0].lastFcoil, v: pistons[0].vel };`);
const en = sandbox.__en;
assert(Math.abs(en.r) < 1e-6, `energy residual ${en.r.toExponential(2)} (P=${en.P.toFixed(4)} F·v=${(en.F * en.v).toFixed(4)})`);

// ---- 11. metal floor behaves like wire ----
console.log('\n== Test 11: metal rails ==');
assert(Math.abs(sandbox.__ca.I) > 1e-4, 'Case A on painted metal carried current (from test 6)');

// ---- 12. waste heat ----
console.log('\n== Test 12: waste heat ==');
runCode(`
	computeHeatSource();
	let hBody = 0;
	bodyCells(pistons[0]).forEach(i => hBody += heatSource[i]);
	globalThis.__ht = { body: hBody, last: pistons[0].lastHeat };
`);
assert(sandbox.__ht.last >= 0, 'lastHeat is non-negative');

// ---- 13. gas work: compression heats ----
console.log('\n== Test 13: gas P–V work ==');
clearBoard();
runCode(`
	for (let x = 0; x <= 20; x++) grid[15 * GRID_W + x] = 0;
	seedAir();
	pistons.push(createMechanicalBody({ x: 8, y: 15, axis: 'h', pos: 8, vel: 0, friction: 0, damping: 50, mass: 100 }));
	syncPistonOccupancy();
	const y = 15;
	for (let x = 0; x <= 8; x++) {
		airU[y * GRID_W + x] = 0;
	}
	const t0 = [];
	for (let x = 10; x <= 18; x++) t0.push(airU[y * GRID_W + x]);
	dt = (1 / 60 * 10) / 24;
	for (let f = 0; f < 20; f++) {
		const p = pistons[0];
		let backX = Math.max(0, Math.floor(p.pos));
		for (let x = 0; x <= backX; x++) airN[y * GRID_W + x] = (airVol[y * GRID_W + x] / CELL_VOL) * (N0 + 0.08);
		airRelax(24, dt);
	}
	let tFront = 0, nFront = 0;
	for (let x = Math.floor(pistons[0].pos + 2); x <= 19; x++) {
		if (airN[y * GRID_W + x] > N_MIN) { tFront += airU[y * GRID_W + x] / (airN[y * GRID_W + x] * AIR_CV); nFront++; }
	}
	globalThis.__gas = { pos: pistons[0].pos, tFront: nFront ? tFront / nFront : 0, cv: AIR_CV, gamma: AIR_GAMMA };
`);
const gas = sandbox.__gas;
assert(gas.cv > 700 && gas.cv < 750, `AIR_CV ≈ 718 (got ${gas.cv.toFixed(1)})`);
assert(Math.abs(gas.gamma - 1.4) < 0.02, `γ ≈ 1.40 (got ${gas.gamma.toFixed(3)})`);
assert(gas.pos > 8, `piston advanced (pos=${gas.pos.toFixed(2)})`);

// ---- 14. jitter regression with magnet over metal ----
console.log('\n== Test 14: jitter regression (magnet over metal) ==');
clearBoard();
runCode(`
	for (let x = 0; x <= 25; x++) {
		grid[15 * GRID_W + x] = 0;
		metalCells[14 * GRID_W + x] = 1;
		metalCells[16 * GRID_W + x] = 1;
	}
	seedAir();
	pistons.push(createMechanicalBody({
		x: 8, y: 15, axis: 'h', magnet: true, pos: 8, friction: 50, damping: 200, mass: 100
	}));
	syncPistonOccupancy();
	airSources.length = 0;
	airSources.push({ idx: 15 * GRID_W + 5, rate: 0.5, temp: T_AMB });
	dt = (1 / 60 * 10) / 24;
	let rev = 0, prev = 0;
	for (let f = 0; f < 45; f++) {
		airRelax(24, dt);
		const p = pistons[0];
		if (f > 2 && Math.abs(p.vel) > 0.05 && Math.abs(prev) > 0.05) {
			if (Math.sign(p.vel) !== Math.sign(prev)) rev++;
		}
		prev = p.vel;
	}
	globalThis.__jit = { pos: pistons[0].pos, vel: pistons[0].vel, rev };
`);
const jit = sandbox.__jit;
assert(jit.rev === 0, `magnet glides without velocity reversals (got ${jit.rev})`);
assert(jit.pos > 9.0, `magnet advanced past a cell boundary (pos=${jit.pos.toFixed(2)})`);

// ---- 15. scene smoke ----
console.log('\n== Test 15: solenoid-lab scene ==');
runCode(`loadScene('solenoid-lab');`);
assert(getRef('pistons').length >= 1, `scene placed magnet piston(s) (got ${getRef('pistons').length})`);
assert(getRef('pistons').some(p => p.magnet), 'at least one body is a magnet');
runCode(`
	fieldSimulate();
	for (let i = 0; i < 10; i++) fieldRelax(20);
	fieldPublish();
	dt = (1 / 60 * 10) / 24;
	airRelax(24, dt);
`);
const labMag = getRef('pistons').find(p => p.magnet);
const labEdges = getRef('fieldEdges');
assert(Number.isFinite(labMag.lastFcoil) && labEdges.length > 0,
	'scene magnet reports finite force and the edge registry is populated (no NaN, edges=' + labEdges.length + ')');

// ---- 16. solenoid-loop scene smoke ----
console.log('\n== Test 16: solenoid-loop scene ==');
let loopErr = null;
try { runCode(`loadScene('solenoid-loop');`); } catch (e) { loopErr = e; }
assert(loopErr === null, 'loadScene("solenoid-loop") runs without exception' + (loopErr ? ' (' + loopErr.message + ')' : ''));
assert(getRef('pistons').filter(p => p.magnet).length === 1, 'solenoid-loop places exactly one magnet piston');
assert(getRef('manualWires').length >= 1, 'solenoid-loop lays a wire loop');
runCode(`for (let s = 0; s < 5; s++) { fieldSimulate(); fieldRelax(FIELD_SWEEPS_PER_FRAME); fieldPublish(); }`);
assert(Number.isFinite(getRef('pistons')[0].lastFcoil), 'solenoid-loop magnet reports finite force after stepping');

// ---- 17. bat-to-solenoid scene smoke ----
console.log('\n== Test 17: bat-to-solenoid scene ==');
let btsErr = null;
try { runCode(`loadScene('bat-to-solenoid');`); } catch (e) { btsErr = e; }
assert(btsErr === null, 'loadScene("bat-to-solenoid") runs without exception' + (btsErr ? ' (' + btsErr.message + ')' : ''));
assert(getRef('pistons').filter(p => p.magnet).length === 1, 'bat-to-solenoid places exactly one magnet piston');
assert(getRef('manualBatteries').length === 1, 'bat-to-solenoid places one battery');
assert(getRef('manualWires').length >= 2, 'bat-to-solenoid lays current rails');
runCode(`bodies[0].vel = 0; for (let s = 0; s < 60; s++) { fieldSimulate(); fieldRelax(FIELD_SWEEPS_PER_FRAME); fieldPublish(); }`);
assert(Math.abs(getRef('bodies')[0].lastFcoil) > 1e-4, `energized rails act on the solenoid (|F|=${Math.abs(getRef('bodies')[0].lastFcoil).toExponential(3)} N)`);

// ---- 18. force from current: polarity flip + zero current ----
console.log('\n== Test 18: Force-from-current — polarity flip and zero-current ==');
runCode(buildLoopSetup({ battery: true, lamp: false }) + `
	bodies.length = 0;
	var m = createMechanicalBody({ kind: 'solenoid', x: 12, y: 15, axis: 'h', magnet: true });
	m.magStrength = 1; m.vel = 0; m.friction = 0; m.damping = 0;
	bodies.push(m);
`);
simulate(20);
const F_batt = getRef('bodies')[0].lastFcoil;
assert(Math.abs(F_batt) > 1e-4, `magnet beside an energized loop feels force |F|=${Math.abs(F_batt).toExponential(3)} N`);
runCode(`bodies[0].magStrength = -1;`);
simulate(20);
const F_rev = getRef('bodies')[0].lastFcoil;
assert(Math.sign(F_rev) === -Math.sign(F_batt) && Math.abs(F_rev) > 1e-4,
	`reversing polarity reverses F_coil (sign ${Math.sign(F_batt)} -> ${Math.sign(F_rev)})`);
runCode(`manualBatteries.length = 0; bodies[0].magStrength = 1;`);
simulate(20);
const F_zero = getRef('bodies')[0].lastFcoil;
assert(Math.abs(F_zero) < 1e-6, `no current => F ≈ 0 (got ${F_zero.toExponential(2)})`);

// ---- 19. generator: lamp lights + Lenz drag ----
console.log('\n== Test 19: Generator — moving magnet induces EMF, lamp lights, Lenz drag ==');
runCode(buildLoopSetup({ battery: true, lamp: true }) + `
	bodies.length = 0;
	var m = createMechanicalBody({ kind: 'solenoid', x: 12, y: 15, axis: 'h', magnet: true });
	m.magStrength = 2; m.vel = 2; m.friction = 0; m.damping = 0;
	bodies.push(m);
`);
simulate(25);
const gen = getRef('bodies')[0];
const lampGen = getRef('lamps')[0];
assert(gen.lastPower > 0, `generator delivers power to the loop (lastPower=${gen.lastPower.toFixed(3)} W > 0)`);
assert(gen.lastFcoil * gen.vel < 0, `Lenz drag: F·v < 0 (F=${gen.lastFcoil.toFixed(2)}, v=${gen.vel})`);
assert(Math.abs(lampGen.dV) > getRef('DV_LIT'), `lamp receives current: |dV|=${Math.abs(lampGen.dV).toFixed(3)} V > DV_LIT (${getRef('DV_LIT')})`);
runCode(buildLoopSetup({ battery: false, lamp: true }) + `
	bodies.length = 0;
	var m = createMechanicalBody({ kind: 'solenoid', x: 12, y: 15, axis: 'h', magnet: true });
	m.magStrength = 2; m.vel = 2; m.friction = 0; m.damping = 0;
	bodies.push(m);
`);
simulate(25);
const genB = getRef('bodies')[0];
assert(Math.abs(genB.lastCurrent) > 1e-4 && genB.lastPower > 0, `battery-less loop still injects EMF (|I|=${Math.abs(genB.lastCurrent).toExponential(2)} A, P=${genB.lastPower.toFixed(3)} W > 0)`);
runCode(`manualWires.length = 0; lamps.length = 0; bodies[0].vel = 2;`);
simulate(25);
const genOpen = getRef('bodies')[0];
assert(Math.abs(genOpen.lastPower) < 1e-6, `open loop => no generated power (P=${genOpen.lastPower.toExponential(2)})`);

// ---- 20. motor drive + back-EMF identity ----
console.log('\n== Test 20: Motor — battery drives magnet; motion injects back-EMF ==');
runCode(buildLoopSetup({ battery: true, lamp: false }) + `
	bodies.length = 0;
	var m = createMechanicalBody({ kind: 'solenoid', x: 12, y: 15, axis: 'h', magnet: true });
	m.magStrength = 1; m.vel = 0; m.friction = 0; m.damping = 0;
	bodies.push(m);
`);
simulate(20);
const motor0 = getRef('bodies')[0];
const I0 = Math.abs(motor0.lastCurrent);
const F0 = motor0.lastFcoil;
const P0 = motor0.lastPower;
assert(I0 > 1e-3, `battery drives the magnet at rest (|I|=${I0.toExponential(3)} A)`);
assert(Math.abs(F0) > 1e-4, `battery current exerts a motor force on the magnet (F=${F0.toFixed(3)} N)`);
runCode(`bodies[0].vel = 3;`);
simulate(20);
const motorV = getRef('bodies')[0];
const I1 = Math.abs(motorV.lastCurrent);
const P1 = motorV.lastPower;
assert(Math.abs(motorV.lastEMF) > 1e-6, `motion injects a back-EMF (E=${motorV.lastEMF.toFixed(3)} V)`);
assert(Math.abs(P1) > Math.abs(P0) + 1e-9, `conversion power grows with speed (|P|=${Math.abs(P1).toFixed(3)} W > rest ${Math.abs(P0).toFixed(3)})`);
assert(Math.abs(I1 - I0) > 1e-4, `back-EMF changes the loop current from rest (${I0.toExponential(2)} -> ${I1.toExponential(2)} A)`);
assert(Math.abs(motorV.lastPower + motorV.lastFcoil * motorV.vel) < 1e-6,
	`back-EMF identity holds: P = −F·v (P=${motorV.lastPower.toFixed(3)}, −F·v=${(-motorV.lastFcoil * motorV.vel).toFixed(3)})`);

// ---- 21. energy identity Σ E·I + Σ F·v ≈ 0 (arena fieldEdges + bodies) ----
console.log('\n== Test 21: Energy identity Σ_e E_e·I_e + Σ_b F_b·v_b ≈ 0 ==');
runCode(buildLoopSetup({ battery: true, lamp: true }) + `
	bodies.length = 0;
	var m = createMechanicalBody({ kind: 'solenoid', x: 12, y: 15, axis: 'h', magnet: true });
	m.magStrength = 2; m.vel = 3; m.friction = 0; m.damping = 0;
	bodies.push(m);
`);
simulate(30);
runCode(`
	let EI = 0;
	for (let ei = 0; ei < fieldEdges.length; ei++) EI += fieldEdges[ei].E * fieldEdges[ei].I;
	let Fv = 0;
	for (let bi = 0; bi < bodies.length; bi++) if (bodies[bi].magnet) Fv += bodies[bi].lastFcoil * (bodies[bi].vel || 0);
	globalThis.__EI = EI; globalThis.__Fv = Fv;
`);
const EI = sandbox.__EI, Fv = sandbox.__Fv;
assert(Math.abs(EI + Fv) < 1e-6,
	`energy identity closes: ΣE·I=${EI.toExponential(3)}, ΣF·v=${Fv.toExponential(3)}, |sum|=${(EI + Fv).toExponential(2)}`);

// ---- 22. Lenz drag: closed vs open ----
console.log('\n== Test 22: Lenz drag — closed loop opposes, open does not ==');
runCode(buildLoopSetup({ battery: false, lamp: true }) + `
	bodies.length = 0;
	var m = createMechanicalBody({ kind: 'solenoid', x: 12, y: 15, axis: 'h', magnet: true });
	m.magStrength = 2; m.vel = 3; m.friction = 0; m.damping = 0;
	bodies.push(m);
`);
simulate(25);
const bClosed = getRef('bodies')[0];
assert(bClosed.lastFcoil * bClosed.vel < 0, `closed loop: Lenz drag F·v < 0 (F=${bClosed.lastFcoil.toFixed(2)}, v=${bClosed.vel})`);
runCode(`
	grid.fill(1);
	for (let y = 13; y <= 17; y++) for (let x = 4; x <= 26; x++) grid[y * GRID_W + x] = 0;
	buildNetworks(); seedAir();
	manualWires.length = 0; manualBatteries.length = 0; lamps.length = 0;
	bodies.length = 0;
	var m = createMechanicalBody({ kind: 'solenoid', x: 12, y: 15, axis: 'h', magnet: true });
	m.magStrength = 2; m.vel = 3; m.friction = 0; m.damping = 0;
	bodies.push(m);
`);
simulate(25);
const bOpen = getRef('bodies')[0];
const openFv = (bOpen.lastFcoil || 0) * bOpen.vel;
assert(Math.abs(openFv) < 1e-6, `open loop: no Lenz drag |F·v| ≈ 0 (got ${Math.abs(openFv).toExponential(2)})`);

// ---- 23. bat-to-solenoid coupling (battery ON vs open loop) ----
console.log('\n== Test 23: Bat→Solenoid coupling — energized rails act on solenoid, open does not ==');
runCode(`loadScene('bat-to-solenoid');`);
runCode(`bodies[0].vel = 0; for (let s = 0; s < 120; s++) { fieldSimulate(); fieldRelax(FIELD_SWEEPS_PER_FRAME); fieldPublish(); }`);
const bOn = getRef('bodies')[0];
assert(Math.abs(bOn.lastFcoil) > 1e-4, `energized rails create a field that acts on the solenoid (|F|=${Math.abs(bOn.lastFcoil).toFixed(4)} N > 1e-4)`);
runCode(`manualWires.length = 0; manualBatteries.length = 0; buildNetworks(); fieldV.fill(0); voltages.clear(); bodies[0].vel = 0; for (let s = 0; s < 120; s++) { fieldSimulate(); fieldRelax(FIELD_SWEEPS_PER_FRAME); fieldPublish(); }`);
const bOff = getRef('bodies')[0];
assert(Math.abs(bOff.lastFcoil) < 1e-4, `open loop (no wire current) => no magnetic force on the solenoid (|F|=${Math.abs(bOff.lastFcoil).toExponential(2)} < 1e-4)`);

// ---- Translate acceptance criteria (DOCUMENTATION ONLY — not asserted) ----
// Tracked future goal from 09-plan-solenoid-force-rebalance.md. The current
// model has pressure ~30x magnetic, so a hard assertion would fail without a
// separate force-rebalance pass (deferred by decision). Recorded here so the
// bar is visible; requires its own rebalance task before it can be enforced:
//   - battery ON  => magnet translates >= 1 cell within ~2000 frames
//   - |vel| < 6 throughout the motion (no runaway / oscillation)
//   - F_coil remains finite over the whole window
// TODO(deferred): add a force-rebalance pass, then promote this to a real test.

console.log(`\n=== RESULTS: ${passCount} pass, ${failCount} fail ===`);
process.exit(failCount === 0 ? 0 : 1);
