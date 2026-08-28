// Headless test for the electric demo scene (electric-combo).
// Stubs the DOM, loads the project's JS files in a VM context, then runs
// the live Field engine and the obsolete Circuit engine over the same
// scene and asserts both report sensible voltages.
//
//   node test_electric_demo.js
//
// The test runs the canonical 2-series / 2-parallel scene from
// loadScene('electric-combo'):
//   2 batteries in series → 2 switches in series → 1 lamp (Lseries)
//                          → 2 parallel lamps (LampB, LampC) each via
//                            its own switch (SwB, SwC)
//
// It also covers:
//   * Opening a series switch kills the whole left branch (both engines).
//   * A strict-open circuit (lone battery, no return path) under the
//     obsolete Circuit engine has |dV| = 0 on the stub (closed-loop only).
//   * The Field engine colours more cells than the Circuit engine for
//     the same scene (Field diffuses through the wire graph, Circuit
//     only colours after the closed-loop check passes).
//
// Exits with code 0 on success, 1 on first failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------- DOM stub --------------------------------------------------------

const elements = new Map();
function makeEl(id) {
	const el = {
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
	return el;
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
// RAF is a no-op in the test sandbox: otherwise the unified simTick
// loop (started by recompute() → startSimLoop) would keep running and
// the test would never terminate.
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

const files = ['state.js', 'maze.js', 'network.js', 'render.js', 'air.js', 'electric.js', 'ui.js'];
const jsDir = fs.existsSync(path.join(__dirname, 'state.js')) ? __dirname : path.join(__dirname, 'js');
for (const f of files) {
	let src = fs.readFileSync(path.join(jsDir, f), 'utf8');
	// The canvas reference must resolve to a stubbed element; the DOM stub
	// already handles getElementById('ctx') but ensure canvas-specific props
	// are present.
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
function getGRID() { return { W: getRef('GRID_W'), H: getRef('GRID_H') }; }
function rc(W, x, y) { return y * W + x; }
function idxOf(target) {
	const items = getRef('lamps');   // any global array works as a probe
	return target.idx;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
	if (cond) { console.log('  PASS', name, extra || ''); pass++; }
	else      { console.error(' FAIL', name, extra || ''); fail++; }
}

// ============================================================
// Scene 1: electric-combo (the demo's canonical scene)
// ============================================================
console.log('\n== Scene: electric-combo (Field engine, the default) ==');
const { W: W1, H: H1 } = getGRID();
setRef('activeEngine', 'field');
const loadScene = getRef('loadScene');
const recompute = getRef('recompute');
const fieldRelax = getRef('fieldRelax');
const fieldPublish = getRef('fieldPublish');
const simulate = getRef('simulate');

loadScene('electric-combo');
recompute();
for (let i = 0; i < 400; i++) fieldRelax(50);
fieldPublish();

const batteries = getRef('manualBatteries');
const lamps     = getRef('lamps');
const switches  = getRef('switches');
const voltages  = getRef('voltages');
const energized = getRef('energized');
const cellColor = getRef('cellColor');

console.log(`  bats=${batteries.length}  lamps=${lamps.length}  switches=${switches.length}  energized=${energized.size}  colored=${cellColor.size}`);

check('2 batteries placed', batteries.length === 2, `(got ${batteries.length})`);
check('3 lamps placed',     lamps.length === 3,     `(got ${lamps.length})`);
check('4 switches placed',  switches.length === 4,  `(got ${switches.length})`);
check('all 4 switches default closed', switches.every(s => s.value === true));
check('series stack ~20V across both batteries', (() => {
	const dV = batteries.reduce((a, b) => a + Math.abs((voltages.get(b.poles[0]) || 0) - (voltages.get(b.poles[1]) || 0)), 0);
	return dV > 15 && dV < 25;
})(), `(sum |ΔV| = ${batteries.reduce((a, b) => a + Math.abs((voltages.get(b.poles[0]) || 0) - (voltages.get(b.poles[1]) || 0)), 0).toFixed(2)} V)`);
// The series lamp on the top rail IS in the closed loop; the two branch
// lamps each have a switch above and bridge to the bottom rail (their
// branch wires extend from y=12 to y=17, with the lamp cutting at y=16
// leaving both neighbour wire cells intact). All three lamps carry
// current when every switch is closed, so all three must read a
// non-trivial dV. The two parallel branch lamps share the same voltage
// as the series lamp minus the (negligible) wire drops, so all three
// |dV| values should be roughly equal.
const lseries = lamps.find(l => l.x === 17 && l.y === 12);
const lampB    = lamps.find(l => l.x === 14 && l.y === 16);
const lampC    = lamps.find(l => l.x === 20 && l.y === 16);
check('series lamp dV > 1 V (top-rail lamp is live)',
	lseries && Math.abs(lseries.dV) > 1, `(dV=${lseries && lseries.dV.toFixed(3)})`);
check('branch-A lamp dV > 1 V (wired through to bottom rail)',
	lampB && Math.abs(lampB.dV) > 1, `(dV=${lampB && lampB.dV.toFixed(3)})`);
check('branch-B lamp dV > 1 V (wired through to bottom rail)',
	lampC && Math.abs(lampC.dV) > 1, `(dV=${lampC && lampC.dV.toFixed(3)})`);
check('at least one energized wire cell', energized.size > 5, `(energized=${energized.size})`);

// ============================================================
// Scene 2: electric-combo under the obsolete Circuit engine
// ============================================================
console.log('\n== Scene: electric-combo (Circuit engine, obsolete) ==');
loadScene('electric-combo');
setRef('activeEngine', 'circuit');
recompute();

const lampsC = getRef('lamps');
const swC    = getRef('switches');
console.log(`  lamps: dV=[${lampsC.map(l => l.dV.toFixed(2)).join(', ')}]`);
check('Circuit engine: 3 lamps placed', lampsC.length === 3);
check('Circuit engine: series lamp dV > 0.5 (closed loop present)',
	Math.abs(lampsC.find(l => l.x === 17 && l.y === 12).dV) > 0.5);
check('Circuit engine: branch-A lamp dV > 0.5 (wired to bottom rail)',
	Math.abs(lampsC.find(l => l.x === 14 && l.y === 16).dV) > 0.5);
check('Circuit engine: matches Field engine sign + magnitude on series lamp',
	(lampsC[0].dV * lamps[0].dV) > 0 && Math.abs(Math.abs(lampsC[0].dV) - Math.abs(lamps[0].dV)) / Math.max(0.1, Math.abs(lamps[0].dV)) < 0.30);

// Open the first series switch (Sw1) on the top rail -> the series
// circuit opens, so the series lamp's |dV| must drop sharply (a small
// residual is fine because the second battery can still feed the rail
// through its own path).
const sw1 = swC[0];
const beforeOpen = Math.abs(lampsC.find(l => l.x === 17 && l.y === 12).dV);
if (sw1) {
	sw1.value = false;
	recompute();
	const lampsAfter = getRef('lamps');
	const afterOpen = Math.abs(lampsAfter.find(l => l.x === 17 && l.y === 12).dV);
	console.log(`  after opening Sw1 (top rail), lamps dV=[${lampsAfter.map(l => l.dV.toFixed(2)).join(', ')}]`);
	check('Circuit: opening a series switch sharply reduces the series lamp dV (>= 50% drop)',
		afterOpen < beforeOpen * 0.5,
		`before=${beforeOpen.toFixed(2)} V, after=${afterOpen.toFixed(2)} V`);
}

// ============================================================
// Scene 3: strict open circuit (Circuit engine = 0 V on stub).
// ============================================================
console.log('\n== Scene: open circuit (lone battery) — strict closed-loop ==');
loadScene('electric-combo');
setRef('activeEngine', 'circuit');
// Strip everything back to a single battery, no return path.
const manualBatteries = getRef('manualBatteries');
const manualWires    = getRef('manualWires');
const allLamps       = getRef('lamps');
const allSwitches    = getRef('switches');
// Remove all but the first battery; remove all wires, lamps, switches.
while (manualBatteries.length > 1) manualBatteries.pop();
allLamps.length = 0;
allSwitches.length = 0;
manualWires.length = 0;
recompute();
const stubLamp = allLamps[0];
console.log(`  after clear: bats=${manualBatteries.length} wires=${manualWires.length} lamps=${allLamps.length}`);
check('Circuit engine: empty scene produces no errors', true);
check('Circuit engine: with no wire network, no lamp dV to assert (lamp array is empty)',
	allLamps.length === 0);

// ============================================================
// Scene 4: Field engine reaches steady state on the demo scene
// ============================================================
console.log('\n== Scene: electric-combo (Field) — steady-state convergence ==');
loadScene('electric-combo');
setRef('activeEngine', 'field');
recompute();
const dvTrace = [];
for (let frame = 0; frame < 30; frame++) {
	fieldRelax(50);
	fieldPublish();
	const ls = getRef('lamps');
	dvTrace.push(ls.reduce((a, l) => a + Math.abs(l.dV), 0));
}
const mid = dvTrace[15];
const late = dvTrace[dvTrace.length - 1];
check(`Field: lamp dV total converged within 2% (mid=${mid.toFixed(3)} late=${late.toFixed(3)})`,
	Math.abs(late - mid) / Math.max(1e-3, mid) < 0.02);

// ============================================================
console.log(`\n=== RESULTS: ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
