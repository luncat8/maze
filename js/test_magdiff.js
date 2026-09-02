// Headless tests for the DIFFUSION magnetic-field engine (magEngine='diffusion')
// and for the legacy 'direct' engine kept beside it.
// See 12-plan-magnetic-diffusion.md.
// Run: node js/test_magdiff.js

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
const GRID_H = getRef('GRID_H');
// Board helpers ---------------------------------------------------------
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
		magReset();
		MAG_RANGE = 8; magEmitAll = false; magEngine = 'diffusion';
	`);
}
// Rail pair + battery in an open chamber, magnet riding the centre line.
function railScene(opts) {
	const o = Object.assign({ bat: true, magX: 15, magY: 15, emit: false }, opts || {});
	runCode(`
		INV.battery.count = 10; unlimited = false;
		for (let y = 12; y <= 18; y++) for (let x = 4; x <= 26; x++) grid[y * GRID_W + x] = 0;
		buildNetworks(); seedAir();
		var rc = (x, y) => y * GRID_W + x;
		var top = [], bot = [];
		for (let x = 6; x <= 24; x++) { top.push(rc(x, 13)); bot.push(rc(x, 17)); }
		sceneAddWire(top, '#22c55e');
		sceneAddWire(bot.slice().reverse(), '#22c55e');
		sceneAddWire([rc(6,14), rc(6,15), rc(6,16)], '#22c55e');
		sceneAddWire([rc(24,14), rc(24,15), rc(24,16)], '#22c55e');
		${o.bat ? 'placeBattery(6, 13);' : ''}
		pistons.push(createMechanicalBody({
			x: ${o.magX}, y: ${o.magY}, axis: 'h', moveAxis: 'h', magnet: true,
			pos: ${o.magX}, friction: 0, damping: 0, emit: ${o.emit}
		}));
		fieldSimulate();
	`);
}
function step(frames, relaxPerFrame) {
	runCode(`for (let s = 0; s < ${frames}; s++) { fieldSimulate(); fieldRelax(${relaxPerFrame || 50}); fieldPublish(); }`);
}

// ---- 1. engine selection ----------------------------------------------
console.log('\n== 1. Engine selection ==');
clearBoard();
assert(getRef('magEngine') === 'diffusion', `diffusion is the default magnetic engine (got ${getRef('magEngine')})`);
runCode(`magEngine = 'direct';`);
assert(typeof getRef('magSolveDirect') === 'function' && typeof getRef('magSolveDiffusion') === 'function',
	'both magnetic solvers are present');
runCode(`magEngine = 'diffusion';`);

// ---- 2. relaxed field reproduces the analytic kernel -------------------
console.log('\n== 2. Relaxed field == windowed analytic kernel ==');
clearBoard();
railScene();
step(40);
runCode(`
	var m = pistons[0], c = bodyCenter(m), sig2 = SIGMA_B * SIGMA_B;
	function win(x, y) { var s = 0, raw = 0;
		for (var ei = 0; ei < fieldEdges.length; ei++) { var e = fieldEdges[ei];
			var rx = x - e.mx, ry = y - e.my, r2 = rx*rx + ry*ry, r = Math.sqrt(r2);
			var w = magWindow(r);
			raw += K_B * e.I * magKernelG(e.dlx, e.dly, rx, ry, sig2);
			if (!w || !e.I) continue;
			s += K_B * e.I * w * magKernelG(e.dlx, e.dly, rx, ry, sig2); }
		return { w: s, raw: raw }; }
	var ref = win(c.x, c.y);
	var maxRel = 0, worst = null, peak = 0;
	for (var y = 13; y <= 17; y++) for (var x = 8; x <= 22; x++) {
		var a = win(x + 0.5, y + 0.5).w, d = fieldBz[y * GRID_W + x];
		if (Math.abs(a) > peak) peak = Math.abs(a);
		if (Math.abs(a) < 1) continue;
		var rel = Math.abs(d - a) / Math.abs(a);
		if (rel > maxRel) { maxRel = rel; worst = [x, y, d, a]; }
	}
	globalThis.__acc = { maxRel: maxRel, worst: worst, peak: peak, lastBz: m.lastBz, refBz: ref.w,
		lastDv: magLastDv, srcCells: magSrcCells };
`);
const acc = sandbox.__acc;
assert(acc.maxRel < 0.05, `relaxed Bz matches the windowed analytic kernel within 5 % (worst ${(acc.maxRel * 100).toFixed(2)} % at cell ${acc.worst && acc.worst.slice(0, 2)})`);
assert(Math.abs(acc.lastBz - acc.refBz) < 0.05 * Math.abs(acc.refBz),
	`lastBz is read off the relaxed field (num=${acc.lastBz.toFixed(3)} analytic=${acc.refBz.toFixed(3)})`);
console.log(`   source support: ${acc.srcCells} of ${GRID_W * GRID_H} cells (scales with wire length, not with the magnet count — see test 6)`);

// ---- 3. persistent state: warm start, no zero-and-recompute ------------
console.log('\n== 3. Persistent field state (warm start) ==');
// 3a. The field is warm-started from the previous frame's state: after the
// circuit is changed, one frame moves the field only PART of the way to the new
// steady state (magLastDv > 0), and successive frames converge it. The legacy
// engine has no such state — it is recomputed from scratch every frame.
runCode(`
	globalThis.__b0 = fieldBz[15 * GRID_W + 15];
	// halve the drive: the V field relaxes toward a new steady state
	for (const b of manualBatteries) b.term[1] = b.term[0];
	globalThis.__dv = [];
	for (var s = 0; s < 12; s++) { fieldSimulate(); fieldRelax(50); fieldPublish(); globalThis.__dv.push(magLastDv); }
	globalThis.__b1 = fieldBz[15 * GRID_W + 15];
`);
const warm = { b0: sandbox.__b0, b1: sandbox.__b1, dv: sandbox.__dv };
assert(warm.b0 !== 0 && Number.isFinite(warm.b1), `field survives the circuit change (Bz ${warm.b0.toFixed(3)} -> ${warm.b1.toFixed(3)})`);
assert(warm.dv[0] > 0 && warm.dv[warm.dv.length - 1] < warm.dv[0],
	`the field is a LIVING relaxation: max|dv| ${warm.dv[0].toExponential(2)} on the first frame after the change, ${warm.dv[warm.dv.length - 1].toExponential(2)} once converged`);
// 3b. With no sources at all the relaxed steady state IS exactly zero, so the
// solver snaps the buffer instead of decaying for ~1000 sweeps. This is the one
// place the diffusion engine is discontinuous, and it is exactly where the
// legacy engine is discontinuous too (it also drops to 0 when the current goes).
runCode(`
	manualBatteries.length = 0;
	for (let s = 0; s < 40; s++) { fieldSimulate(); fieldRelax(50); fieldPublish(); }
	globalThis.__settled = 0;
	for (var i = 0; i < fieldBz.length; i++) if (Math.abs(fieldBz[i]) > Math.abs(globalThis.__settled)) globalThis.__settled = fieldBz[i];
	globalThis.__F0 = pistons[0].lastFcoil; globalThis.__B0 = pistons[0].lastBz;
`);
assert(Math.abs(sandbox.__settled) === 0,
	`no sources left ⇒ field is EXACTLY zero (peak=${Math.abs(sandbox.__settled).toExponential(2)})`);
assert(sandbox.__F0 === 0 && sandbox.__B0 === 0, `no sources ⇒ Bz = 0 and F = 0 exactly (B=${sandbox.__B0}, F=${sandbox.__F0})`);

// ---- 4. no cutoff discontinuity ---------------------------------------
console.log('\n== 4. Smooth across the old MAG_RMAX cutoff ==');
// A wide loop: near rail at y=8, far return at y=26, connectors 9+ cells away.
// The magnet walks perpendicular to the near rail, so it crosses the legacy
// 8-cell cutoff — where the legacy field drops from full strength to exactly 0.
clearBoard();
runCode(`
	INV.battery.count = 10;
	for (let y = 4; y <= 27; y++) for (let x = 2; x <= 28; x++) grid[y * GRID_W + x] = 0;
	buildNetworks(); seedAir();
	var rc = (x, y) => y * GRID_W + x;
	var a = [], b = [];
	for (let x = 6; x <= 24; x++) { a.push(rc(x, 8)); b.push(rc(x, 26)); }
	sceneAddWire(a, '#22c55e');
	sceneAddWire(b.slice().reverse(), '#22c55e');
	var c1 = [], c2 = [];
	for (let y = 9; y <= 25; y++) c1.push(rc(6, y));
	for (let y = 9; y <= 25; y++) c2.push(rc(24, y));
	sceneAddWire(c1, '#22c55e');
	sceneAddWire(c2, '#22c55e');
	placeBattery(6, 8);
	pistons.push(createMechanicalBody({ x: 15, y: 12, axis: 'v', moveAxis: 'v', magnet: true, pos: 12, friction: 0 }));
	fieldSimulate();
`);
step(40);
runCode(`
	function sweep() {
		var m = pistons[0], o = [];
		for (var y = 9; y <= 22; y++) { m.pos = y; m.y = y; fieldSimulate(); fieldPublish(); o.push(m.lastBz); }
		return o;
	}
	// relative jump |dB| / max(|B| on either side): 1.0 == a hard discontinuity
	function rough(p) { var r = 0;
		for (var i = 1; i < p.length; i++) {
			var den = Math.max(Math.abs(p[i]), Math.abs(p[i-1]), 1e-12);
			r = Math.max(r, Math.abs(p[i] - p[i-1]) / den); }
		return r; }
	globalThis.__diffProf = sweep(); globalThis.__diffRough = rough(globalThis.__diffProf);
	magEngine = 'direct'; magReset();
	for (var s = 0; s < 40; s++) { fieldSimulate(); fieldRelax(50); fieldPublish(); }
	globalThis.__legProf = sweep(); globalThis.__legRough = rough(globalThis.__legProf);
	magEngine = 'diffusion'; magReset();
`);
const cut = { diff: sandbox.__diffProf, leg: sandbox.__legProf, dr: sandbox.__diffRough, lr: sandbox.__legRough };
console.log(`   diffusion Bz(d=1..14): ${cut.diff.map(v => v.toFixed(2)).join(' ')}`);
console.log(`   legacy    Bz(d=1..14): ${cut.leg.map(v => v.toFixed(2)).join(' ')}`);
assert(cut.lr > 0.9, `LEGACY still has its hard cutoff: a 1-cell step of ${(100 * cut.lr).toFixed(0)} % of the local field (unchanged behaviour)`);
assert(cut.dr < 0.5, `diffusion has no discontinuity: largest 1-cell step is ${(100 * cut.dr).toFixed(1)} % of the local field`);
assert(cut.dr < 0.5 * cut.lr, `diffusion is at least 2x smoother than the legacy cutoff (${(100 * cut.dr).toFixed(1)} % vs ${(100 * cut.lr).toFixed(0)} %)`);
assert(cut.leg.some(v => v === 0) && cut.diff.every(v => v > 0),
	`the legacy field dies completely in the mid-gap while the diffused field keeps a smooth tail (legacy min ${Math.min(...cut.leg).toFixed(3)}, diffusion min ${Math.min(...cut.diff).toFixed(3)})`);

// ---- 5. energy identity ------------------------------------------------
console.log('\n== 5. Energy identity Σ E·I + Σ F·v = 0 (diffusion engine) ==');
clearBoard();
railScene({ magX: 20 });          // off-centre: a strong, non-cancelling coupling
runCode(`pistons[0].vel = -2.5;`);  // driven against the coil force => generator
step(40);
runCode(`
	var EI = 0; for (var ei = 0; ei < fieldEdges.length; ei++) EI += fieldEdges[ei].E * fieldEdges[ei].I;
	var Fv = 0, P = 0;
	for (var bi = 0; bi < bodies.length; bi++) if (bodies[bi].magnet) { Fv += bodies[bi].lastFcoil * (bodies[bi].vel || 0); P += bodies[bi].lastPower; }
	globalThis.__en = { EI: EI, Fv: Fv, P: P, residual: magEnergyResidual, I: pistons[0].lastCurrent, EMF: pistons[0].lastEMF };
`);
const en = sandbox.__en;
assert(Math.abs(en.EI + en.Fv) < 1e-9,
	`energy identity closes algebraically: ΣE·I=${en.EI.toExponential(3)}, ΣF·v=${en.Fv.toExponential(3)}, |sum|=${Math.abs(en.EI + en.Fv).toExponential(2)}`);
assert(Math.abs(en.P + en.Fv) < 1e-12, `lastPower = −F·v (P=${en.P.toExponential(3)})`);
assert(Math.abs(en.residual) < 1e-9, `magEnergyResidual ≈ 0 (got ${en.residual.toExponential(2)})`);
assert(en.EMF * en.I !== 0 || en.EMF === 0, `EMF/current telemetry is consistent (E=${en.EMF.toFixed(3)} V, I=${en.I.toFixed(3)} A)`);
assert(en.Fv < -1e-3, `moving magnet is braked (Lenz) with a non-trivial power flow: F·v = ${en.Fv.toFixed(4)} W`);
assert(Math.abs(en.EI) > 1e-3, `the identity is tested at a meaningful power level (|ΣE·I| = ${Math.abs(en.EI).toFixed(4)} W)`);

// ---- 6. cost is independent of the magnet count ------------------------
console.log('\n== 6. Cost does not scale with the magnet count ==');
function sourceCellsFor(nMags) {
	clearBoard();
	railScene();
	runCode(`
		for (var s = 0; s < 20; s++) { fieldSimulate(); fieldRelax(50); fieldPublish(); }
		for (var k = 1; k < ${nMags}; k++) {
			var b = createMechanicalBody({ x: 8 + 2 * k, y: 15, axis: 'h', moveAxis: 'h', magnet: true, pos: 8 + 2 * k, friction: 0 });
			pistons.push(b);
		}
		fieldSimulate(); fieldRelax(50); fieldPublish();
		globalThis.__cost = { src: magSrcCells, pairs: pistons.reduce((s, p) => s + ((p._couple || []).length), 0),
			perMag: (pistons[0]._couple || []).length, edges: fieldEdges.length };
	`);
	return sandbox.__cost;
}
const cost1 = sourceCellsFor(1), cost5 = sourceCellsFor(5);
assert(cost1.src > 0, `the coil source is non-empty while current flows (${cost1.src} cells)`);
assert(cost1.src === cost5.src,
	`source assembly is per-edge, not per-magnet: ${cost1.src} cells with 1 magnet, ${cost5.src} with 5`);
assert(cost5.pairs <= 5 * cost1.perMag + 1,
	`coupling is local: ${cost5.pairs} pairs for 5 magnets (${cost1.perMag} per magnet), edges=${cost5.edges}`);

// ---- 7. optional magnet self-field (dipole emission) -------------------
console.log('\n== 7. Optional dipole emission ==');
clearBoard();
runCode(`
	for (let y = 12; y <= 18; y++) for (let x = 4; x <= 26; x++) grid[y * GRID_W + x] = 0;
	buildNetworks(); seedAir();
	pistons.push(createMechanicalBody({ x: 12, y: 15, axis: 'h', moveAxis: 'h', magnet: true, pos: 12, friction: 0, magStrength: 2 }));
	pistons.push(createMechanicalBody({ x: 17, y: 15, axis: 'h', moveAxis: 'h', magnet: true, pos: 17, friction: 0, magStrength: 2 }));
	fieldSimulate(); fieldPublish();
	globalThis.__off = { F: pistons.map(p => p.lastFcoil), peak: 0, emit: pistons.map(p => !!p.emit) };
	for (var i = 0; i < fieldBz.length; i++) globalThis.__off.peak = Math.max(globalThis.__off.peak, Math.abs(fieldBz[i]));
`);
assert(sandbox.__off.peak === 0, `emission off by default ⇒ no field at all (peak=${sandbox.__off.peak})`);
assert(sandbox.__off.F.every(f => f === 0), `emission off ⇒ no magnet↔magnet force (${sandbox.__off.F})`);
runCode(`
	pistons.forEach(p => p.emit = true);
	fieldSimulate();
	for (var s = 0; s < 30; s++) { fieldSimulate(); fieldPublish(); }
	globalThis.__on = { F: pistons.map(p => p.lastFcoil), B: pistons.map(p => p.lastBz), peak: 0 };
	for (var i = 0; i < fieldBz.length; i++) globalThis.__on.peak = Math.max(globalThis.__on.peak, Math.abs(fieldBz[i]));
`);
const on = sandbox.__on;
assert(on.peak > 0, `emitting magnets populate the Bz overlay (peak=${on.peak.toFixed(3)})`);
assert(on.F[0] < 0 && on.F[1] > 0,
	`equal dipoles repel along their move axis (F_left=${on.F[0].toFixed(3)} N, F_right=${on.F[1].toFixed(3)} N)`);
assert(Math.abs(on.F[0] + on.F[1]) < 1e-9, `action = reaction (F_left + F_right = ${(on.F[0] + on.F[1]).toExponential(2)})`);
assert(on.B[0] < 0 && on.B[1] < 0, `a ⊙ dipole reads negative Bz at its own centre (${on.B.map(b => b.toFixed(3))})`);
// One magnet alone must not push itself.
runCode(`
	pistons.length = 1; magReset();
	for (var s = 0; s < 30; s++) { fieldSimulate(); fieldPublish(); }
	globalThis.__selfF = pistons[0].lastFcoil;
	globalThis.__selfPeak = 0;
	for (var i = 0; i < fieldBz.length; i++) globalThis.__selfPeak = Math.max(globalThis.__selfPeak, Math.abs(fieldBz[i]));
`);
assert(sandbox.__selfF === 0, `a lone emitting magnet does not push itself (F=${sandbox.__selfF})`);
assert(sandbox.__selfPeak > 0, `...but it still radiates a dipole field (peak=${sandbox.__selfPeak.toFixed(3)})`);
// Master switch.
clearBoard();
runCode(`
	for (let y = 12; y <= 18; y++) for (let x = 4; x <= 26; x++) grid[y * GRID_W + x] = 0;
	buildNetworks(); seedAir();
	pistons.push(createMechanicalBody({ x: 12, y: 15, axis: 'h', moveAxis: 'h', magnet: true, pos: 12, friction: 0 }));
	pistons.push(createMechanicalBody({ x: 17, y: 15, axis: 'h', moveAxis: 'h', magnet: true, pos: 17, friction: 0 }));
	magEmitAll = true;
	for (var s = 0; s < 20; s++) { fieldSimulate(); fieldPublish(); }
	globalThis.__all = pistons.map(p => p.lastFcoil);
	magEmitAll = false; magReset(); fieldSimulate(); fieldPublish();
	globalThis.__allOff = pistons.map(p => p.lastFcoil);
`);
assert(sandbox.__all[1] > 0 && sandbox.__allOff[1] === 0,
	`magEmitAll master switch drives emission for every magnet (on F=${sandbox.__all[1].toFixed(3)}, off F=${sandbox.__allOff[1]})`);

// ---- 8. engine switching round-trip ------------------------------------
console.log('\n== 8. Engine switching ==');
clearBoard();
railScene({ magX: 20 });
// The magnet is pinned (pos and vel) so both runs see an identical circuit: any
// difference in the reported current would mean the magnetic engine is leaking
// into the shared electric solve.
runCode(`
	function run(eng) {
		magEngine = eng; magReset();
		if (fieldV) fieldV.fill(0);
		for (var s = 0; s < 40; s++) {
			pistons[0].pos = 20; pistons[0].x = 20; pistons[0].vel = 0;
			fieldSimulate(); fieldRelax(50); fieldPublish();
			pistons[0].pos = 20; pistons[0].x = 20; pistons[0].vel = 0;
		}
		return { F: pistons[0].lastFcoil, B: pistons[0].lastBz, I: pistons[0].lastCurrent };
	}
	globalThis.__diff = run('diffusion');
	globalThis.__clearedPeak = 0;
	for (var i = 0; i < fieldBz.length; i++) globalThis.__clearedPeak = Math.max(globalThis.__clearedPeak, Math.abs(fieldBz[i]));
	globalThis.__preLeg = 0;
	magEngine = 'direct'; magReset();
	for (var i = 0; i < fieldBz.length; i++) globalThis.__preLeg = Math.max(globalThis.__preLeg, Math.abs(fieldBz[i]));
	globalThis.__leg = run('direct');
`);
const sw = { diff: sandbox.__diff, leg: sandbox.__leg, cleared: sandbox.__preLeg };
assert(sw.cleared === 0, 'magReset() clears the solver state before switching engines');
assert(Number.isFinite(sw.diff.F) && Number.isFinite(sw.leg.F), 'both engines report a finite force');
assert(Math.sign(sw.diff.F) === Math.sign(sw.leg.F) && Math.abs(sw.diff.F) > 1e-4,
	`both engines push the same way (diffusion F=${sw.diff.F.toExponential(3)} N, direct F=${sw.leg.F.toExponential(3)} N)`);
assert(Math.abs(sw.diff.I - sw.leg.I) < 1e-6 * Math.abs(sw.diff.I) + 1e-12,
	`the shared electric solve is untouched by the magnetic engine (I: ${sw.diff.I.toFixed(6)} vs ${sw.leg.I.toFixed(6)} A)`);
runCode(`magEngine = 'diffusion'; magReset();`);

// ---- 9. range slider ----------------------------------------------------
console.log('\n== 9. B range slider ==');
// On the rail board (rails at y=13 and y=17) a cell 5 cells off a rail is
// inside the field for MAG_RANGE >= 6 and provably outside it for MAG_RANGE <= 4.
runCode(`
	var m = pistons[0];
	function fieldAt(R) {
		MAG_RANGE = R; magReset();
		for (var s = 0; s < 30; s++) { fieldSimulate(); fieldRelax(50); fieldPublish(); }
		return fieldBz[8 * GRID_W + 15];        // 5 cells above the y=13 rail
	}
	globalThis.__rng = { far: fieldAt(4), mid: fieldAt(7), near: fieldAt(12) };
	MAG_RANGE = 8; magReset();
`);
const rr = sandbox.__rng;
console.log(`   Bz 5 cells off the rail: MAG_RANGE=4 -> ${rr.far.toExponential(2)}, =7 -> ${rr.mid.toExponential(2)}, =12 -> ${rr.near.toExponential(2)}`);
assert(Math.abs(rr.far) < 1e-6,
	`MAG_RANGE=4 leaves a cell 5 cells away numerically zero (|Bz| = ${Math.abs(rr.far).toExponential(2)}, vs ${Math.abs(rr.mid).toFixed(2)} at R=7)`);
assert(Math.abs(rr.mid) > 0 && Math.abs(rr.near) > Math.abs(rr.mid),
	`a larger B range reaches further and couples harder (|Bz| ${Math.abs(rr.mid).toExponential(2)} at R=7, ${Math.abs(rr.near).toExponential(2)} at R=12)`);

// ---- 10. why the force is NOT read off the relaxed grid ----------------
console.log('\n== 10. Grid owns values, analytic kernel owns derivatives ==');
// The relaxed grid reproduces the analytic field VALUES closely, but a 1-cell
// gradient of it does not reproduce the analytic GRADIENT in a near-symmetric
// geometry, where the true gradient is a small residue of large cancelling
// terms. That measurement is the reason F_coil and the motional EMF stay
// analytic while the grid carries only the field state (overlay, lastBz,
// dipole emission, smooth range). If magGradAt is ever improved, this test
// should be revisited — not silently "fixed" by loosening the numbers.
clearBoard();
railScene();                 // magnet centred between two opposite rails
step(60);
runCode(`
	var m = pistons[0], c = bodyCenter(m), hat = bodyHat(m), sig2 = SIGMA_B * SIGMA_B;
	var Bz = 0, gx = 0, gy = 0;
	for (var ei = 0; ei < fieldEdges.length; ei++) {
		var e = fieldEdges[ei];
		if (edgeIsSelf(e, m)) continue;
		var rx = c.x - e.mx, ry = c.y - e.my, r = Math.hypot(rx, ry);
		var w = magWindow(r);
		if (!w) continue;
		var g = magKernelG(e.dlx, e.dly, rx, ry, sig2);
		var gr = magKernelGrad(e.dlx, e.dly, rx, ry, sig2);
		var wr = magWindowGrad(r);
		var drdx = r > 1e-9 ? rx / r : 0, drdy = r > 1e-9 ? ry / r : 0;
		var cw = K_B * e.I;
		Bz += cw * w * g;
		gx += cw * (w * gr.gx + wr * drdx * g);
		gy += cw * (w * gr.gy + wr * drdy * g);
	}
	var gs = magGradAt(fieldBz, c.x, c.y);
	globalThis.__gr = { Bz: Bz, gridBz: magBzAt(fieldBz, c.x, c.y), gx: gx, gy: gy, ggx: gs.gx, ggy: gs.gy,
		F: m.lastFcoil, Fan: m.magStrength != null ? m.magStrength * (gx * hat.ax + gy * hat.ay) : (gx * hat.ax + gy * hat.ay) };
`);
const gr = sandbox.__gr;
console.log(`   value:  analytic ${gr.Bz.toFixed(4)}  grid ${gr.gridBz.toFixed(4)}  (${(100 * Math.abs(gr.gridBz - gr.Bz) / Math.abs(gr.Bz)).toFixed(2)} % off)`);
console.log(`   dBz/dx: analytic ${gr.gx.toExponential(3)}  grid ${gr.ggx.toExponential(3)}`);
console.log(`   dBz/dy: analytic ${gr.gy.toExponential(3)}  grid ${gr.ggy.toExponential(3)}`);
assert(Math.abs(gr.gridBz - gr.Bz) < 0.05 * Math.abs(gr.Bz),
	`the grid is accurate for VALUES (${(100 * Math.abs(gr.gridBz - gr.Bz) / Math.abs(gr.Bz)).toFixed(2)} % off)`);
const gyErr = Math.abs(gr.ggy - gr.gy) / Math.abs(gr.gy);
assert(gyErr > 0.5,
	`...but a 1-cell gradient of the grid is NOT the analytic gradient here: dBz/dy off by ${(100 * gyErr).toFixed(0)} % (this is why F_coil stays analytic)`);
assert(Math.abs(gr.F - gr.Fan) < 1e-9 * Math.max(1, Math.abs(gr.Fan)),
	`the reported force IS the analytic windowed-gradient force (F=${gr.F.toExponential(3)}, analytic=${gr.Fan.toExponential(3)})`);

console.log(`\n=== RESULTS: ${passCount} pass, ${failCount} fail ===`);
process.exit(failCount === 0 ? 0 : 1);
