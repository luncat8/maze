// Headless physics test for Piston & Pump components.
//
// Run: node js/test_piston_pump.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------- DOM stub --------------------------------------------------------

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

// ---------- Load project files ---------------------------------------------

const files = ['state.js', 'maze.js', 'network.js', 'render.js', 'air.js', 'electric.js', 'magBzPoissonHy3.js', 'magfield_diffusion.js', 'ui.js'];
const jsDir = fs.existsSync(path.join(__dirname, 'state.js')) ? __dirname : path.join(__dirname, 'js');
for (const f of files) {
	let src = fs.readFileSync(path.join(jsDir, f), 'utf8');
	vm.runInContext(src, sandbox, { filename: f });
}
console.log('OK: loaded', files.length, 'JS files into VM sandbox');

// ---------- Helpers ---------------------------------------------------------

function getRef(name) {
	vm.runInContext(`globalThis.__ref = ${name};`, sandbox);
	const v = sandbox.__ref;
	sandbox.__ref = undefined;
	return v;
}
function setRef(name, val) {
	sandbox.__ref = val;
	vm.runInContext(`${name} = globalThis.__ref;`, sandbox);
	sandbox.__ref = undefined;
}
function runCode(code) {
	return vm.runInContext(code, sandbox);
}

let passCount = 0, failCount = 0;
function assert(cond, desc) {
	if (cond) {
		console.log('  PASS', desc);
		passCount++;
	} else {
		console.error('  FAIL', desc);
		failCount++;
	}
}

// TEST 1: dirs array alignment
console.log('\n== Test 1: dirs array and PUMP_DIRS synchronization ==');
const PUMP_DIRS = getRef('PUMP_DIRS');
const dirs = getRef('dirs');
assert(PUMP_DIRS[0].dx === dirs[0].dx && PUMP_DIRS[0].dy === dirs[0].dy, 'Dir 0 is North/Up (0, -1)');
assert(PUMP_DIRS[1].dx === dirs[1].dx && PUMP_DIRS[1].dy === dirs[1].dy, 'Dir 1 is East/Right (1, 0)');
assert(PUMP_DIRS[2].dx === dirs[2].dx && PUMP_DIRS[2].dy === dirs[2].dy, 'Dir 2 is South/Down (0, 1)');
assert(PUMP_DIRS[3].dx === dirs[3].dx && PUMP_DIRS[3].dy === dirs[3].dy, 'Dir 3 is West/Left (-1, 0)');
assert(PUMP_DIRS[0].arrow === '↑' && PUMP_DIRS[1].arrow === '→', 'Arrow glyphs match cardinal directions');

// TEST 2: Cut-cell volume calculation and isAir decoupling
console.log('\n== Test 2: Cut-cell airVol and isAir decoupling ==');
runCode(`
pistons.length = 0;
pumps.length = 0;
grid.fill(1);
for (let x = 0; x <= 19; x++) grid[15 * GRID_W + x] = 0; // 20x1 corridor
seedAir();

// Add piston at continuous pos 5.4 in row 15
pistons.push({
	id: 1, x: 5, y: 15, axis: 'h', pos: 5.4, vel: 0,
	friction: 50, damping: 200, mass: 100, limited: false
});
syncPistonOccupancy();
`);

const GRID_W = getRef('GRID_W');
const pistonOcc = getRef('pistonOcc');
const airVol = getRef('airVol');

const occ5 = pistonOcc[15 * GRID_W + 5];
const occ6 = pistonOcc[15 * GRID_W + 6];
const occ7 = pistonOcc[15 * GRID_W + 7];
const vol5 = airVol[15 * GRID_W + 5];
const vol7 = airVol[15 * GRID_W + 7];

assert(Math.abs(occ5 - 0.6) < 1e-3, `Cell 5 occupancy is 0.6 (got ${occ5.toFixed(3)})`);
assert(Math.abs(occ6 - 1.0) < 1e-3, `Cell 6 occupancy is 1.0 (got ${occ6.toFixed(3)})`);
assert(Math.abs(occ7 - 0.4) < 1e-3, `Cell 7 occupancy is 0.4 (got ${occ7.toFixed(3)})`);
assert(Math.abs(vol5 - 0.4) < 1e-3, `Cell 5 airVol is 0.4 m^3 (got ${vol5.toFixed(3)})`);
assert(Math.abs(vol7 - 0.6) < 1e-3, `Cell 7 airVol is 0.6 m^3 (got ${vol7.toFixed(3)})`);

assert(runCode(`isAir(15 * GRID_W + 5)`) === true, 'Cell 5 stays air with reduced volume');
assert(runCode(`isAir(15 * GRID_W + 6)`) === false, 'Cell 6 (fully occupied) is non-air');
assert(runCode(`isAir(15 * GRID_W + 7)`) === true, 'Cell 7 stays air with reduced volume');

// TEST 3: Static friction holding
console.log('\n== Test 3: Static friction holding ==');
runCode(`
pistons.length = 0;
seedAir();
// Place piston at cell 10 with high friction (F_k = 500 N, F_s = 600 N)
pistons.push({
	id: 1, x: 10, y: 15, axis: 'h', pos: 10.0, vel: 0,
	friction: 500, damping: 200, mass: 100, limited: false
});
syncPistonOccupancy();

// Set modest pressure difference across piston: P_back = pAmb + 80 Pa, P_front = pAmb
// Driving force F_press = 80 N < 600 N static threshold
const idxBack = 15 * GRID_W + 9;
const idxFront = 15 * GRID_W + 12;
pressure[idxBack] = pressure[idxBack] + 80;
const p0Pos = pistons[0].pos;

dt = (1 / 60 * 10) / 24;
airRelax(24, dt);
`);

const p0 = getRef('pistons')[0];
assert(p0.vel === 0, `Piston stays locked at vel=0 (got ${p0.vel})`);
assert(p0.pos === 10.0, `Piston position unchanged under sub-threshold force`);

// TEST 4: Dynamic speed calibration & terminal velocity
console.log('\n== Test 4: Dynamic speed calibration (0.1..5.0 cells/s) ==');
runCode(`
pistons.length = 0;
seedAir();
// Place piston at cell 6 with F_k = 50 N, damping b = 200
pistons.push({
	id: 1, x: 6, y: 15, axis: 'h', pos: 6.0, vel: 0,
	friction: 50, damping: 200, mass: 100, limited: false
});
syncPistonOccupancy();

dt = (1 / 60 * 10) / 24;
// Apply ΔP = 450 Pa across piston: expected terminal v = (450 - 50) / 200 = 2.0 cells/s
for (let step = 0; step < 18; step++) {
	for (let s = 0; s < 24; s++) {
		const p = pistons[0];
		const y = p.y;
		let backX = Math.max(0, Math.floor(p.pos));
		if (airVol[y * GRID_W + backX] < 0.15 * CELL_VOL && backX > 0) backX--;
		let frontX = Math.min(GRID_W - 1, Math.floor(p.pos + 2.0));
		if (airVol[y * GRID_W + frontX] < 0.15 * CELL_VOL && frontX < GRID_W - 1) frontX++;
		for (let x = 0; x <= backX; x++) {
			airN[y * GRID_W + x] = (airVol[y * GRID_W + x] / CELL_VOL) * (N0 + 0.0053475);
		}
		for (let x = frontX; x <= 19; x++) {
			airN[y * GRID_W + x] = (airVol[y * GRID_W + x] / CELL_VOL) * N0;
		}
		airRelax(1, dt);
	}
}
`);
const vel = getRef('pistons')[0].vel;
assert(vel >= 1.5 && vel <= 2.5, `Piston terminal velocity is near target ~2.0 cells/s (got ${vel.toFixed(2)} cells/s)`);

// TEST 5: Mass conservation during piston motion
console.log('\n== Test 5: Mass conservation during moving boundary flux ==');
runCode(`
pistons.length = 0;
seedAir();
pistons.push({
	id: 1, x: 5, y: 15, axis: 'h', pos: 5.0, vel: 0,
	friction: 20, damping: 200, mass: 100, limited: false
});
syncPistonOccupancy();
`);

let mInitial = runCode(`airN.reduce((a, b) => a + b, 0)`);

// Drive piston across multiple cells
runCode(`
dt = (1 / 60 * 10) / 24;
for (let f = 0; f < 30; f++) {
	const bX = Math.max(0, Math.floor(pistons[0].pos - 0.05));
	pressure[15 * GRID_W + bX] += 300;
	airRelax(24, dt);
}
`);

let mFinal = runCode(`airN.reduce((a, b) => a + b, 0)`);
const massDiff = Math.abs(mFinal - mInitial);
assert(massDiff < 1e-6, `Mass conserved across moving piston (Δm = ${massDiff.toExponential(3)} kg)`);

// TEST 6: Wall collision clamping
console.log('\n== Test 6: Maze wall collision clamping ==');
runCode(`
dt = (1 / 60 * 10) / 24;
// Push piston towards end wall at x=19 (boundary cell x=20 is wall)
for (let f = 0; f < 250; f++) {
	for (let s = 0; s < 24; s++) {
		const p = pistons[0];
		const y = p.y;
		let backX = Math.max(0, Math.floor(p.pos));
		if (airVol[y * GRID_W + backX] < 0.15 * CELL_VOL && backX > 0) backX--;
		let frontX = Math.min(GRID_W - 1, Math.floor(p.pos + 2.0));
		if (airVol[y * GRID_W + frontX] < 0.15 * CELL_VOL && frontX < GRID_W - 1) frontX++;
		for (let x = 0; x <= backX; x++) {
			airN[y * GRID_W + x] = (airVol[y * GRID_W + x] / CELL_VOL) * (N0 + 0.05);
		}
		for (let x = frontX; x <= 19; x++) {
			airN[y * GRID_W + x] = (airVol[y * GRID_W + x] / CELL_VOL) * N0;
		}
		airRelax(1, dt);
	}
}
`);
const finalPiston = getRef('pistons')[0];
assert(finalPiston.pos <= 18.001, `Piston does not penetrate end wall (max allowable pos 18, got ${finalPiston.pos.toFixed(3)})`);
assert(finalPiston.blockedWall === true, `Piston registers wall contact (blockedWall = true)`);

// TEST 7: Electric Air Pump operation & head efficiency
console.log('\n== Test 7: Electric Air Pump & thermodynamic efficiency ==');
runCode(`
pistons.length = 0;
pumps.length = 0;
seedAir();

// Place pump at (8, 15), dir=1 (East), R=10 ohms, eff=0.80
placePump(8, 15);
`);
const pumpLen = getRef('pumps').length;
assert(pumpLen === 1, 'Pump successfully placed at (8, 15)');

runCode(`
const pump = pumps[0];
pump.lastPower = 10.0; // 10W power

const inIdx = 15 * GRID_W + 7;
const outIdx = 15 * GRID_W + 9;
const massIn0 = airN[inIdx];
const massOut0 = airN[outIdx];

dt = (1 / 60 * 10) / 24;
airRelax(24, dt);

globalThis.__test_pump = {
	massIn0, massIn1: airN[inIdx],
	massOut0, massOut1: airN[outIdx],
	flow: pump.lastFlow,
	heat: pump.lastHeat
};
`);
const pData = sandbox.__test_pump;
assert(pData.massOut1 > pData.massOut0, `Pump moved air into exhaust cell (mass ${pData.massOut0.toFixed(4)} -> ${pData.massOut1.toFixed(4)})`);
assert(pData.massIn1 < pData.massIn0, `Pump extracted air from intake cell (mass ${pData.massIn0.toFixed(4)} -> ${pData.massIn1.toFixed(4)})`);
assert(pData.flow > 0, `Pump reports positive flow rate (${(pData.flow * 1000).toFixed(2)} g/s)`);
assert(pData.heat > 0, `Pump reports waste heat dissipation (${pData.heat.toFixed(2)} W)`);

// TEST 8: Demo Scene "piston-pump"
console.log('\n== Test 8: Preset Scene "piston-pump" ==');
runCode(`
loadScene('piston-pump');
`);
assert(getRef('pumps').length === 1, 'Scene has 1 pump');
assert(getRef('pistons').length === 1, 'Scene has 1 piston');
assert(getRef('manualBatteries').length === 1, 'Scene has 1 battery');
assert(getRef('switches').length === 1, 'Scene has 1 switch');
assert(getRef('switches')[0].value === true, 'Switch is closed');

// Step simulation
runCode(`
dt = (1 / 60 * 10) / 24;
for (let f = 0; f < 15; f++) {
	fieldRelax(10);
	fieldPublish();
	airRelax(24, dt);
}
`);
const scenePump = getRef('pumps')[0];
const scenePiston = getRef('pistons')[0];
assert(scenePump.lastPower > 1.0, `Pump is energized by battery circuit (power = ${scenePump.lastPower.toFixed(2)} W)`);
assert(scenePiston.lastFpress > 0, `Piston experiences positive pressure drive from pump (F_press = ${scenePiston.lastFpress.toFixed(2)} N)`);

// TEST 9: Smooth Glide & Zero-Jitter Stability (Continuous Pressure Drive)
console.log('\n== Test 9: Smooth Glide & Zero-Jitter Velocity Stability ==');
runCode(`
grid.fill(1);
for (let x = 0; x <= 25; x++) grid[15 * GRID_W + x] = 0;
pistons.length = 0;
seedAir();
pistons.push({
	id: 1, x: 8, y: 15, axis: 'h', pos: 8.0, vel: 0,
	friction: 50, damping: 200, mass: 100, limited: false
});
syncPistonOccupancy();
airSources.length = 0;
airSources.push({ idx: 15 * GRID_W + 5, rate: 0.5, temp: T_AMB });

dt = (1 / 60 * 10) / 24;
let hReversals = 0;
let prevHVel = 0;
for (let f = 0; f < 45; f++) {
	airRelax(24, dt);
	const p = pistons[0];
	if (f > 2 && Math.abs(p.vel) > 0.05 && Math.abs(prevHVel) > 0.05) {
		if (Math.sign(p.vel) !== Math.sign(prevHVel)) hReversals++;
	}
	prevHVel = p.vel;
}
globalThis.__hPiston = { pos: pistons[0].pos, vel: pistons[0].vel, reversals: hReversals };
`);
const hData = sandbox.__hPiston;
assert(hData.reversals === 0, `Horizontal piston glides without per-frame velocity reversals (got ${hData.reversals} reversals)`);
assert(hData.pos > 9.0, `Horizontal piston smoothly advances past integer cell boundary (pos = ${hData.pos.toFixed(2)})`);

runCode(`
grid.fill(1);
for (let y = 0; y <= 25; y++) grid[y * GRID_W + 15] = 0;
pistons.length = 0;
seedAir();
pistons.push({
	id: 1, x: 15, y: 8, axis: 'v', pos: 8.0, vel: 0,
	friction: 50, damping: 200, mass: 100, limited: false
});
syncPistonOccupancy();
airSources.length = 0;
airSources.push({ idx: 5 * GRID_W + 15, rate: 0.5, temp: T_AMB });

let vReversals = 0;
let prevVVel = 0;
for (let f = 0; f < 45; f++) {
	airRelax(24, dt);
	const p = pistons[0];
	if (f > 2 && Math.abs(p.vel) > 0.05 && Math.abs(prevVVel) > 0.05) {
		if (Math.sign(p.vel) !== Math.sign(prevVVel)) vReversals++;
	}
	prevVVel = p.vel;
}
globalThis.__vPiston = { pos: pistons[0].pos, vel: pistons[0].vel, reversals: vReversals };
`);
const vData = sandbox.__vPiston;
assert(vData.reversals === 0, `Vertical piston glides without per-frame velocity reversals (got ${vData.reversals} reversals)`);
assert(vData.pos > 9.0, `Vertical piston smoothly advances past integer cell boundary (pos = ${vData.pos.toFixed(2)})`);

// ---------- Summary --------------------------------------------------------

console.log(`\n=== RESULTS: ${passCount} pass, ${failCount} fail ===`);
process.exit(failCount === 0 ? 0 : 1);

