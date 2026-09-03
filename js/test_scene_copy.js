// Headless round-trip test for scene copy/paste (map + full state).
// Run: node js/test_scene_copy.js
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
		body: { appendChild() {}, removeChild() {} },
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

const files = ['state.js', 'maze.js', 'network.js', 'render.js', 'air.js', 'electric.js', 'magBzPoissonHy3.js', 'magfield_diffusion.js', 'ui.js'];
const jsDir = __dirname;
for (const f of files) {
	const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
	vm.runInContext(src, sandbox, { filename: f });
}
console.log('OK: loaded', files.length, 'JS files into VM sandbox');

function runCode(code) { return vm.runInContext('(function(){' + code + '})()', sandbox); }
function evalExpr(code) { return vm.runInContext('(function(){return (' + code + ');})()', sandbox); }

let passCount = 0, failCount = 0;
function assert(cond, desc) {
	if (cond) { console.log('  PASS', desc); passCount++; }
	else { console.error('  FAIL', desc); failCount++; }
}

// Functional signature: geometry sums + item counts + a hash of all wire cells.
runCode(`
	globalThis.__sigMap = function () {
		let g = 0, m = 0, bl = 0, ob = 0, wc = 0;
		for (let i = 0; i < grid.length; i++) { g += grid[i]; m += metalCells[i]; bl += blocked[i]; ob += obstacleKind[i]; }
		const cells = [];
		manualWires.forEach(w => w.cells.forEach(c => cells.push(c)));
		cells.sort((a, b) => a - b);
		wc = cells.reduce((h, c) => (h * 31 + c) | 0, 0);
		return [g, m, bl, ob, manualWires.length, manualBatteries.length, lamps.length,
			switches.length, pumps.length, pistons.length, pipePortals.length, wc].join('|');
	};
	globalThis.__snapFields = function () {
		return {
			temp: Array.from(temp),
			airN: Array.from(airN),
			airU: Array.from(airU),
			pressure: Array.from(pressure),
			volt: Array.from(voltages.entries()),
			bz: fieldBz ? Array.from(fieldBz) : [],
			col: Array.from(cellColor.entries()),
		};
	};
`);

const scenes = ['electric-combo', 'tunnel-air', 'piston-pump', 'solenoid-lab', 'solenoid-loop', 'bat-to-solenoid'];

console.log('\n== Map-only round trip (functional state) ==');
for (const name of scenes) {
	runCode(`loadScene(${JSON.stringify(name)});`);
	const before = evalExpr('__sigMap()');
	const text = evalExpr('serializeSceneMap()');
	runCode(`loadMapFromText(${JSON.stringify(text)});`);
	const after = evalExpr('__sigMap()');
	assert(before === after, `map round-trip for "${name}"\n     before=${before}\n     after =${after}`);
}


console.log('\n== Magnetic `emit` token round-trip ==');
runCode(`loadScene('solenoid-lab'); pistons[0].emit = true; pistons[1].emit = false;`);
const emitText = evalExpr('serializeSceneMap()');
runCode(`loadMapFromText(${JSON.stringify(emitText)});`);
assert(evalExpr('bodies[0].emit') === true, 'solenoid with emit:true round-trips as emit');
assert(evalExpr('bodies[1].emit') === false, 'solenoid without emit token stays emit:false');
const noEmitText = emitText.split('\n').map(l => l.startsWith('solenoid ') ? l.replace(/ emit/g, '') : l).join('\n');
runCode(`loadMapFromText(${JSON.stringify(noEmitText)});`);
assert(evalExpr('bodies[0].emit') === false, 'old scene without emit token loads emit:false');

console.log('\n== Full-state round trip (fields within tolerance) ==');
function arrMaxDiff(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; }
function mapMaxDiff(aE, bE) {
	const m = new Map(bE); let d = 0;
	for (const [k, v] of aE) { const b = m.get(k); if (b === undefined) return Infinity; d = Math.max(d, Math.abs(v - b)); }
	return d;
}
for (const name of scenes) {
	runCode(`loadScene(${JSON.stringify(name)}); fieldSimulate(); fieldRelax(50); fieldPublish();`);
	runCode(`
		globalThis.__pidx = 500;
		for (let i = 0; i < grid.length; i++) if (isAir(i)) { globalThis.__pidx = i; break; }
		temp[globalThis.__pidx] = 123.456;
		if (fieldBz) fieldBz[globalThis.__pidx] = 0.0123;
		voltages.set(globalThis.__pidx, 5.5);
		pressure[globalThis.__pidx] = 101500;
		airU[globalThis.__pidx] = 42.5;
		airN[globalThis.__pidx] = 1.2345;
	`);
	const before = evalExpr('__snapFields()');
	const text = evalExpr('serializeFullState()');
	runCode(`loadFullStateFromText(${JSON.stringify(text)});`);
	const after = evalExpr('__snapFields()');
	const dTemp = arrMaxDiff(before.temp, after.temp);
	const dN = arrMaxDiff(before.airN, after.airN);
	const dU = arrMaxDiff(before.airU, after.airU);
	const dP = arrMaxDiff(before.pressure, after.pressure);
	const dV = mapMaxDiff(before.volt, after.volt);
	const dBz = arrMaxDiff(before.bz, after.bz);
	assert(dTemp < 1e-3 && dN < 1e-3 && dU < 1e-2 && dP < 1e-1,
		`primary fields match for "${name}" (dTemp=${dTemp} dN=${dN} dU=${dU} dP=${dP})`);
	assert(dV < 1e-2 && dBz < 1e-3,
		`derived overlays match for "${name}" (dV=${dV} dBz=${dBz})`);
}

console.log('\n== format sanity ==');
const mapText = evalExpr(`(loadScene('tunnel-air'), serializeSceneMap())`);
assert(mapText.split('\n')[0] === '# Maze-Push scene v1', 'map text has header');
assert(mapText.split('\n').some(l => l.startsWith('fill wall')), 'tunnel-air fill is wall (majority)');
assert(mapText.split('\n').some(l => l.startsWith('grid ')), 'tunnel-air emits only minority air cells');
console.log('  map text length for tunnel-air:', mapText.length, 'bytes (vs 961 raw cells)');

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
