// Resolve the color a conductive cell should be drawn with.
// Net view: the net's identity color. Electric view: battery terminal
// color (r/b) from the simulation, grey when the net is unpowered.
function viewColor(idx, netColor) {
		return (colorView === 'electric' || colorView === 'voltage') ? (cellColor.get(idx) || '#9ca3af')
		: (colorView === 'heat' || colorView === 'pressure' ? '#374151' : netColor);
}

const L_N = GRID_W * GRID_H;
const lightField = new Float32Array(L_N);
const lightR = new Float32Array(L_N);
const lightG = new Float32Array(L_N);
const lightB = new Float32Array(L_N);
const dState = new Float64Array(L_N * 5); // per (cell, dir): dir 0..3 + 4 (none)
const dWire = new Int32Array(L_N).fill(-1);
const wireMask = new Uint8Array(L_N);
// Per-cell light loss in the Light view. The old model lost a fixed 1 lm/cell,
// so a lamp's reach (in cells) equalled its lumen output; any lamp brighter than
// ~250 lm lit the whole open board and the view blew out to solid white. A
// distance-proportional loss keeps brightness meaningful (brighter lamps reach
// further) while bounding the reach so even a very bright lamp forms a visible
// pool that fades to dark instead of washing out the scene.
const LIGHT_DECAY = 0.7;
let heatTRef = 1e-3; // smoothed peak temperature so the Heat-view colormap doesn't jump each frame

// Binary min-heap of {c, cell, dir} for the per-lamp Dijkstra.
const heap = [];
function heapPush(c, cell, dir) {
	heap.push({ c, cell, dir });
	let n = heap.length - 1;
	while (n > 0) {
		const p = (n - 1) >> 1;
		if (heap[p].c <= heap[n].c) break;
		const t = heap[p]; heap[p] = heap[n]; heap[n] = t;
		n = p;
	}
}
function heapPop() {
	const top = heap[0];
	const last = heap.pop();
	if (heap.length) {
		heap[0] = last;
		let n = 0;
		const len = heap.length;
		for (;;) {
			let l = 2 * n + 1, r = 2 * n + 2, s = n;
			if (l < len && heap[l].c < heap[s].c) s = l;
			if (r < len && heap[r].c < heap[s].c) s = r;
			if (s === n) break;
			const t = heap[s]; heap[s] = heap[n]; heap[n] = t;
			n = s;
		}
	}
	return top;
}

// Emitted light of a lamp (lm). Lighting is driven by the voltage drop
// (dV) across the lamp: a closed loop gives dV > 0 -> lit ("charged");
// an open circuit gives dV = 0 -> dark ("discharged"). GODMODE lamps are
// self-powered and always burn at full power. The bulb and the light
// field share this single source of truth.
// Dissipated power of a lamp (W). GODMODE lamps are self-powered (Infinity);
// BUILD lamps dissipate P = dV²/R from the circuit they sit in. Light and heat
// both derive from this single P, so brightness and temperature share one source.
function lampPower(l) {
	if (!l.limited) return Infinity;
	const dV = Math.abs(l.dV || 0);
	return (dV * dV) / (l.R || R_lamp);
}
function lampOutput(l) {
	if (!l.limited) return l.lumen || 0;        // GODMODE: self-powered, constant lumen field
	if ((l.efficiency || 0) <= 0) return 0;
	return l.efficiency * lampPower(l);
}

// State of the lamp's circuit, expressed in the closed-loop model.
function lampSupply(l) {
	if (!l.limited) return 'GODMODE (self-powered)';
	const on = lampOutput(l) > 0;
	return on ? 'closed loop · ' + lampPower(l).toFixed(2) + ' W' : 'open · dark';
}

function computeLightField() {
	wireMask.fill(0);
	cellUsage.forEach((colors, idx) => { wireMask[idx] = 1; });
	manualWires.forEach(w => { for (let i = 0; i < w.cells.length; i++) wireMask[w.cells[i]] = 1; });

	const passable = (i) => !blocked[i] && (grid[i] === 0 || wireMask[i]);

	lightField.fill(44);
	lightR.fill(0);
	lightG.fill(0);
	lightB.fill(0);
	let q;

	// Each lamp emits `src` lumen. Light is lost proportionally with distance
	// ((r-1)·LIGHT_DECAY each step) so reach is bounded and a very bright lamp
	// still forms a pool that fades to dark instead of washing out the scene;
	// a 90° turn halves the remaining light. We propagate the maximum remaining
	// light with a max-heap (Dijkstra on remaining lumens), then additively
	// accumulate each lamp's colour scaled by its remaining light.
	for (let li = 0; li < lamps.length; li++) {
		const lp = lamps[li];
		const eff = lampOutput(lp);
		if (eff <= 0 || !passable(lp.idx)) continue;
		const src = eff;
		const col = lp.color || '#ffffff';
		const cr = (parseInt(col.slice(1, 3), 16) / 255) * src;
		const cg = (parseInt(col.slice(3, 5), 16) / 255) * src;
		const cb = (parseInt(col.slice(5, 7), 16) / 255) * src;
		dState.fill(-Infinity);
		heap.length = 0;
		dState[lp.idx * 5 + 4] = src;
		heapPush(-src, lp.idx, 4); // negate for the min-heap
		while (heap.length) {
			const top = heapPop();
			const r = -top.c, curr = top.cell, dir = top.dir;
			const si = curr * 5 + dir;
			if (r < dState[si]) continue;
			const cx = curr % GRID_W, cy = (curr / GRID_W) | 0;
			for (let i = 0; i < 4; i++) {
				const nx = cx + dirs[i].dx, ny = cy + dirs[i].dy;
				if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
				const nid = ny * GRID_W + nx;
				if (!passable(nid)) continue;
				const turn = (dir !== 4 && dir !== i);
				const nr = (r - 1) * LIGHT_DECAY * (turn ? 0.5 : 1);
				if (nr <= 0) continue;
				const nsi = nid * 5 + i;
				if (nr > dState[nsi]) {
					dState[nsi] = nr;
					heapPush(-nr, nid, i);
				}
			}
		}
		for (let i = 0; i < L_N; i++) {
			let best = (i === lp.idx) ? src : -Infinity;
			for (let d = 0; d < 5; d++) {
				const v = dState[i * 5 + d];
				if (v > best) best = v;
			}
			if (best > 0) {
				const v = 44 + best;
				if (v > lightField[i]) lightField[i] = v > 255 ? 255 : v;
				lightR[i] = Math.min(255, lightR[i] + cr * best / src);
				lightG[i] = Math.min(255, lightG[i] + cg * best / src);
				lightB[i] = Math.min(255, lightB[i] + cb * best / src);
			}
		}
	}

	// Wires carry a lamp's light (extension-cord model): seed only from
	// wire cells a lamp already reached (lightField above ambient).
	dWire.fill(-1);
	q = [];
	for (let i = 0; i < L_N; i++) {
		if (wireMask[i] && lightField[i] > 44) { dWire[i] = 0; q.push(i); }
	}
	for (let head = 0; head < q.length; head++) {
		const curr = q[head];
		const cx = curr % GRID_W, cy = (curr / GRID_W) | 0;
		const nd = dWire[curr] + 1;
		for (let i = 0; i < 4; i++) {
			const nx = cx + dirs[i].dx, ny = cy + dirs[i].dy;
			if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
			const nid = ny * GRID_W + nx;
			if (dWire[nid] !== -1 || !passable(nid)) continue;
			dWire[nid] = nd; q.push(nid);
		}
	}
	for (let i = 0; i < L_N; i++) {
		if (dWire[i] >= 0) {
			const c = 22 - dWire[i];
			if (44 + c > lightField[i]) lightField[i] = Math.min(255, 44 + c);
		}
	}
	for (let i = 0; i < L_N; i++) if (lightField[i] > 255) lightField[i] = 255;
}

// ---- Properties panel: template-per-kind + binder architecture ----
// Static markup lives in <template id="prop-tpl-<kind>"> blocks in index.html.
// Each binder clones its template, stamps values (fill), binds inputs once
// (wire), and updates only dynamic text spans every frame (refresh, allocation
// free and dirty-checked so a slider drag/focus is never disturbed).

// Voltage/R→±/powered spans for a cell index (guard against empty solve state).
function cellBind(field, idx) {
	if (field === 'voltage') return voltages.has(idx) ? voltages.get(idx).toFixed(2) + ' V' : '—';
	if (field === 'rPos') return resPos.has(idx) ? resPos.get(idx).toFixed(1) + ' Ω' : '—';
	if (field === 'rNeg') return resNeg.has(idx) ? resNeg.get(idx).toFixed(1) + ' Ω' : '—';
	if (field === 'powered') return cellColor.has(idx) ? 'yes' : 'no';
	return '';
}

// Voltage/R→±/powered binds for the cell index of a given item.
function cellBinds(idxOf) {
	return {
		voltage: r => cellBind('voltage', idxOf(r)),
		rPos:    r => cellBind('rPos', idxOf(r)),
		rNeg:    r => cellBind('rNeg', idxOf(r)),
		powered: r => cellBind('powered', idxOf(r)),
	};
}

// Single source of truth for every dynamic `data-bind` span, shared by fill()
// and refresh() so the two never diverge. Flat (kind → field → fn) table: no
// nested switch/if-else, and a missing entry returns '' instead of silently
// blanking a field.
const BIND_FNS = {
	lamp: {
		rHead:   l => l.R.toFixed(1) + ' Ω',
		effHead: l => (l.efficiency ?? 0) + ' lm/W',
		dV:      l => (l.dV ? l.dV.toFixed(2) : '0.00') + ' V',
		lit:     l => lampOutput(l) > 0 ? 'yes' : 'no',
		light:   l => lampOutput(l).toFixed(0) + ' lm',
		power:   l => l.limited ? lampPower(l).toFixed(2) + ' W' : '∞ (self-powered)',
		wired:   l => l.wired ? 'yes (300 lm/W)' : 'no',
		network: l => lampSupply(l),
	},
	wire: Object.assign({
		cells: w => '' + w.cells.length,
		color: w => w.color || '—',
	}, cellBinds(r => r.cells[0])),
	battery: {
		pos:       b => b.x + ',' + b.y,
		charge:    b => formatCharge(b),
		terminals: b => b.term[0] + ' | ' + b.term[1],
	},
	switch: Object.assign({
		state:   s => s.value ? 'Closed (on)' : 'Open (off)',
		ctrlval: s => s.value ? 'on' : 'off',
		wired:   s => s.wired ? 'yes (junction)' : 'no',
	}, cellBinds(r => r.idx)),
	heatsink: {
		pos:     s => s.x + ',' + s.y,
		cooling: s => G_SINK + ' W/K (local)',
		network: s => 'passive radiator',
	},
	airsrc: {
		pos:      s => s.x + ',' + s.y,
		srcTHead: s => s.temp + ' K',
		rateHead: s => s.rate.toFixed(3) + ' kg/s',
	},
	airsink: {
		pos:      s => s.x + ',' + s.y,
		rateHead: s => s.rate.toFixed(3) + ' kg/s',
	},
	pipevalve: {
		kind:     () => 'Valve',
		pos:      v => cellLabel(v.idx),
		openHead: v => (v.open * 100).toFixed(0) + '%',
	},
	pipeportal: {
		kind:     () => 'Portal',
		pos:      p => cellLabel(selectedItem && selectedItem.endpoint != null ? selectedItem.endpoint : p.a),
		openHead: p => (p.open * 100).toFixed(0) + '%',
		partner:  p => cellLabel(p.a === (selectedItem && selectedItem.endpoint) ? p.b : p.a),
	},
	node: Object.assign({
		pos:   r => (r % GRID_W) + ',' + ((r / GRID_W) | 0),
		color: r => { const n = circles.get(r); return n ? n.color : '—'; },
	}, cellBinds(r => r)),
};
function computeBind(kind, field, ref) {
	const fn = BIND_FNS[kind] && BIND_FNS[kind][field];
	return fn ? fn(ref) : '';
}

// Value to stamp on each `data-input` element (input/checkbox/color).
const INPUT_FNS = {
	lamp:    { color: l => l.color || '#ffffff', efficiency: l => l.efficiency ?? 0, R: l => l.R },
	switch:  { switch: s => !!s.value },
	airsrc:  { srcT: s => s.temp, rate: s => s.rate },
	airsink: { rate: s => s.rate },
	pipevalve:  { open: v => v.open },
	pipeportal: { open: p => p.open },
};
function computeInput(kind, field, ref) {
	const fn = INPUT_FNS[kind] && INPUT_FNS[kind][field];
	return fn ? fn(ref) : '';
}

// Cache every [data-bind]/[data-input] element in the clone for O(1) refresh.
function cacheRefs(root) {
	const bind = {}, input = {};
	const bs = root.querySelectorAll('[data-bind]');
	for (let i = 0; i < bs.length; i++) bind[bs[i].getAttribute('data-bind')] = bs[i];
	const ins = root.querySelectorAll('[data-input]');
	for (let i = 0; i < ins.length; i++) input[ins[i].getAttribute('data-input')] = ins[i];
	root._refs = { bind, input, last: {} };
}

// input field → the `data-bind` head span it updates live (e.g. 'effHead').
const HEAD_BIND = { efficiency: 'effHead', R: 'rHead', srcT: 'srcTHead', rate: 'rateHead', open: 'openHead' };

function cellLabel(idx) { return (idx % GRID_W) + ',' + ((idx / GRID_W) | 0); }

function makeInputHandler(kind, field, ref, root) {
	return (e) => {
		const el = e.target;
		const v = el.type === 'checkbox' ? el.checked : +el.value;
		if (field === 'color') ref.color = el.value;
		else if (field === 'switch') ref.value = el.checked;
		else if (field === 'efficiency') { ref.efficiency = v; ref.lumen = v * P_REF; }
		else if (field === 'R') ref.R = v;
		else if (field === 'srcT') ref.temp = v;
		else if (field === 'rate') ref.rate = v;
		const head = HEAD_BIND[field];
		if (head && root._refs && root._refs.bind[head]) {
			const t = computeBind(kind, head, ref);
			root._refs.bind[head].textContent = t;
			root._refs.last[head] = t;
		}
		if (field === 'switch') { bus.emit('switch:placed'); return; }
		if (field === 'color') { if (colorView === 'light') render(); return; }
		if (field === 'efficiency') { if (colorView === 'light') render(); startSimLoop(); return; }
		if (field === 'R') {
			if (el._rTimer) clearTimeout(el._rTimer);
			el._rTimer = setTimeout(() => recompute(), 30); // debounce the nodal re-solve
			return;
		}
		if (field === 'srcT' || field === 'rate') { startSimLoop(); render(); return; }
		if (field === 'open') { ref.open = v; syncCellOpen(); startSimLoop(); render(); return; }
	};
}

function wireCommon(kind, onReturn, ref, root) {
	const close = root.querySelector('[data-close]');
	if (close) close.onclick = () => { selectedItem = null; renderProperties(); };
	const ret = root.querySelector('[data-return]');
	if (ret) ret.onclick = () => {
		if (onReturn) onReturn(ref);
		selectedItem = null; renderProperties();
	};
	const ins = root._refs ? root._refs.input : {};
	for (const f in ins) {
		const el = ins[f];
		const h = makeInputHandler(kind, f, ref, root);
		if (el.type === 'checkbox') el.onchange = h; else el.oninput = h;
	}
}

function makeBinder(kind, onReturn) {
	return {
		fill(ref, root) {
			if (kind === 'lamp' && ref.R == null) ref.R = R_lamp; // backup legacy normalization
			cacheRefs(root);
			const ins = root._refs.input;
			for (const f in ins) {
				const v = computeInput(kind, f, ref);
				if (typeof v === 'boolean') ins[f].checked = v; else ins[f].value = v;
			}
			const show = root.querySelectorAll('[data-show]');
			for (let i = 0; i < show.length; i++) {
				const cond = show[i].getAttribute('data-show');
				let vis = true;
				if (cond === 'limited') vis = !!ref.limited;
				else if (cond === 'paired') vis = !!ref.b; // only portals have a partner cell
				show[i].style.display = vis ? '' : 'none';
			}
			const b = root._refs.bind;
			for (const f in b) {
				const t = computeBind(kind, f, ref);
				b[f].textContent = t;
				root._refs.last[f] = t;
			}
		},
		refresh(ref, root) {
			const r = root._refs; if (!r) return;
			const b = r.bind;
			for (const f in b) {
				const t = computeBind(kind, f, ref);
				if (r.last[f] !== t) { b[f].textContent = t; r.last[f] = t; }
			}
		},
		wire(ref, root) { wireCommon(kind, onReturn, ref, root); },
		onReturn
	};
}

const panelBinders = {
	lamp: makeBinder('lamp', (ref) => returnLamp(ref)),
	wire: makeBinder('wire', (ref) => returnWire(ref)),
	battery: makeBinder('battery', (ref) => returnBattery(ref)),
	switch: makeBinder('switch', (ref) => returnSwitch(ref)),
	heatsink: makeBinder('heatsink', (ref) => returnHeatSink(ref)),
	airsrc: makeBinder('airsrc', (ref) => returnAirSource(ref)),
	airsink: makeBinder('airsink', (ref) => returnAirSink(ref)),
	pipevalve:  makeBinder('pipevalve',  (ref) => returnPipeValve(ref)),
	pipeportal: makeBinder('pipeportal', (ref) => returnPipePortal(ref)),
	node: makeBinder('node', null),
};

let currentRoot = null, currentKind = null;
function renderProperties() {
	const panel = document.getElementById('propPanel');
	if (!panel) return;
	if (!selectedItem) { panel.style.display = 'none'; currentRoot = null; currentKind = null; return; }
	panel.style.display = 'block';
	const b = panelBinders[selectedItem.kind];
	const tplId = (selectedItem.kind === 'pipevalve' || selectedItem.kind === 'pipeportal') ? 'prop-tpl-pipe' : 'prop-tpl-' + selectedItem.kind;
	const tpl = document.getElementById(tplId);
	if (b && tpl && tpl.content) {
		const root = document.createElement('div');
		root.appendChild(tpl.content.cloneNode(true));
		panel.replaceChildren(root);
		b.fill(selectedItem.ref, root);
		b.wire(selectedItem.ref, root);
		currentRoot = root; currentKind = selectedItem.kind;
	} else {
		panel.style.display = 'none'; currentRoot = null; currentKind = null;
	}
}

// Live updater: re-stamps only dynamic spans every animation frame during
// simulation, without rebuilding the DOM (so slider focus/drag is preserved).
function refreshPanel() {
	if (!selectedItem || !currentRoot) return;
	const b = panelBinders[selectedItem.kind];
	if (b) b.refresh(selectedItem.ref, currentRoot);
}

let lastLampT = performance.now();
const lastLampOut = new Map(); // lamp -> quantized lampOutput, to detect visible light change
function lampLoop(now) {
	const dt = Math.min(0.1, (now - lastLampT) / 1000);
	lastLampT = now;
	const wasOn = lamps.map(l => lampOutput(l) > 0);
	// Lighting is driven by dV (set in simulate()), so there is no charge
	// to drain here; an on/off flip or a lumen-boundary crossing repaints.
	let flip = false;
	for (let i = 0; i < lamps.length; i++) if ((lampOutput(lamps[i]) > 0) !== wasOn[i]) flip = true;
	let lightChanged = false;
	for (const l of lamps) {
		const q = Math.round(lampOutput(l));
		if (lastLampOut.get(l) !== q) { lastLampOut.set(l, q); lightChanged = true; }
	}
	if ((flip || lightChanged) && colorView === 'light') render();
	if (selectedItem) refreshPanel();
	requestAnimationFrame(lampLoop);
}
requestAnimationFrame(lampLoop);

// ---- Airflow particles: simple per-cell random drift ----
// Each air cell draws its particles as small dots (no trails). Drawn in the
// air/pressure views over the pressure colormap.
function drawFlowParticle(p) {
	ctx.fillRect(p.x * CELL_SIZE - 1.2, p.y * CELL_SIZE - 1.2, 2.4, 2.4);
}
function drawCellParticles(i) {
	const list = cellParticles[i]; if (!list || !list.length) return;
	const cx = i % GRID_W, cy = (i / GRID_W) | 0;
	ctx.save();
	ctx.translate(cx * CELL_SIZE, cy * CELL_SIZE);
	ctx.fillStyle = 'rgba(220,245,255,0.95)';
	for (let k = 0; k < list.length; k++) drawFlowParticle(list[k]);
	ctx.restore();
}

function render() {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = colorView === 'light' ? '#fff' : '#ddd';
	ctx.fillRect(0, 0, canvas.width, canvas.height);          // full clear, screen space
	ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
	ctx.fillStyle = '#444';
	for (let i = 0; i < grid.length; i++) {
		if (grid[i] === 1) ctx.fillRect((i % GRID_W) * CELL_SIZE, ((i / GRID_W) | 0) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
	}

	ctx.fillStyle = '#264f63';
	for (let i = 0; i < grid.length; i++) {
		if (blocked[i]) ctx.fillRect((i % GRID_W) * CELL_SIZE, ((i / GRID_W) | 0) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
	}

	ctx.strokeStyle = 'rgba(150,165,180,0.4)';
	ctx.lineWidth = 1;
	for (let i = 0; i < grid.length; i++) {
		if (grid[i] === 1 || blocked[i]) {
			const x = (i % GRID_W) * CELL_SIZE, y = ((i / GRID_W) | 0) * CELL_SIZE;
			ctx.strokeRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
		}
	}

	// Painted Metal/Ground conductive medium: a distinct amber tint so the
	// user sees the conductive layer they painted. Energized metal cells are
	// overdrawn by the voltage heatmap in electric/voltage views; this tint
	// mainly shows unenergized metal (e.g. open branches, net view). The Heat
	// view shows temperature instead, so skip this amber tint there.
	if (colorView !== 'light' && colorView !== 'heat' && colorView !== 'pressure') {
		ctx.fillStyle = '#b45309';
		for (let i = 0; i < metalCells.length; i++) {
			if (metalCells[i] && !blocked[i]) ctx.fillRect((i % GRID_W) * CELL_SIZE, ((i / GRID_W) | 0) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
		}
	}

	// ---- Heat view: temperature fill (background) ----
	// Every cell is colored by its excess temperature (auto-scaled to the
	// hottest cell): blue (cool) -> red (hot). Wires and glyphs draw on top.
	if (colorView === 'heat') {
		const N = GRID_W * GRID_H;
		let tMax = 1e-3;
		for (let i = 0; i < N; i++) if (temp[i] > tMax) tMax = temp[i];
		// Ease the auto-scale peak so the colours don't swing every frame as a
		// new hot spot grows (a hard peak makes the whole map re-colour at once).
		heatTRef += (tMax - heatTRef) * 0.08;
		if (heatTRef < 1e-3) heatTRef = 1e-3;
		const tRef = heatTRef;
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) continue;   // walls/obstacles stay their drawn colour (ambient)
			const t = Math.max(0, Math.min(1, temp[i] / tRef));
			ctx.fillStyle = 'rgb(' + Math.round(255 * t) + ',40,' + Math.round(255 * (1 - t)) + ')';
			ctx.fillRect((i % GRID_W) * CELL_SIZE, ((i / GRID_W) | 0) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
		}
	}

	// ---- Pressure view: pressure fill + advected particles + flow arrows ----
	// Pressure P = n·T_abs·P_SCALE (PV=nRT). The colormap scales against the
	// ambient baseline (pAmb), so a uniform room is blue (never all-red).
	// Particles stream along the velocity field (v = −∇P); short arrows show the
	// mass-flow direction.
	if (colorView === 'pressure') {
		const N = GRID_W * GRID_H;
		const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;  // baseline (ambient, Pa)
		let pMax = pAmb;
		for (let i = 0; i < N; i++) if (isAir(i) && pressure[i] > pMax) pMax = pressure[i];
		const span = Math.max(1e-6, pMax - pAmb);
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) continue;
			const t = Math.max(0, Math.min(1, (pressure[i] - pAmb) / span));
			ctx.fillStyle = 'rgb(' + Math.round(255 * t) + ',40,' + Math.round(255 * (1 - t)) + ')';
			ctx.fillRect((i % GRID_W) * CELL_SIZE, ((i / GRID_W) | 0) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
		}
		// per-cell random particles (count ∝ pressure, speed ∝ |v|)
		const Np = GRID_W * GRID_H;
		ctx.fillStyle = 'rgba(220,245,255,0.95)';
		for (let i = 0; i < Np; i++) if (isAir(i)) drawCellParticles(i);
		// per-cell flow-direction arrows (faded)
		ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) continue;
			const cx = i % GRID_W, cy = (i / GRID_W) | 0;
			const sp = Math.hypot(velX[i], velY[i]);
			if (sp < 1e-4) continue;
			const mx = (cx + 0.5) * CELL_SIZE, my = (cy + 0.5) * CELL_SIZE;
			const ux = velX[i] / sp, uy = velY[i] / sp;
			const L = CELL_SIZE * 0.34;
			ctx.beginPath();
			ctx.moveTo(mx - ux * L, my - uy * L);
			ctx.lineTo(mx + ux * L, my + uy * L);
			ctx.stroke();
		}
	}

	const limit = +els.pathLimit.value;
	if (limit > 0 && els.showCellX.checked) {
		ctx.strokeStyle = 'rgba(0,0,0,0.25)';
		ctx.lineWidth = 1;
		cellUsage.forEach((colors, idx) => {
			if (colors.size >= limit) {
				const x = (idx % GRID_W) * CELL_SIZE, y = ((idx / GRID_W) | 0) * CELL_SIZE;
				ctx.beginPath();
				ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + CELL_SIZE - 4, y + CELL_SIZE - 4);
				ctx.moveTo(x + CELL_SIZE - 4, y + 4); ctx.lineTo(x + 4, y + CELL_SIZE - 4);
				ctx.stroke();
			}
		});
	}

	// ---- local per-cell lane assignment ----
	// For each cell shared by >1 color, give every sharing color a sub-lane
	// (offset perpendicular to its wire) so colors don't overlap inside that
	// cell. Lanes are local to the cell: a color is only shifted where it
	// actually shares a cell, so lone wires stay centered and never clip walls.
	// Lane offset for a color inside a cell. Two modes, toggled by the
	// "Stable color lanes" checkbox:
	//  - OFF (default): sharing-based. Only colors that actually share a cell
	//    are spread; lone wires stay centered at offset 0 (no jog between cells
	//    unless the share count changes).
	//  - ON: a fixed offset per color index, identical in every cell. Wires of
	//    the same color keep a stable diagonal via everywhere (no boundary jogs),
	//    and different colors are always separated — at the cost of lone wires
	//    sitting off-center near their corner.
	function laneFor(color, idx) {
		if (els.stableColorLanes.checked) {
			const i = COLORS.indexOf(color);
			const n = COLORS.length;
			return (i - (n - 1) / 2) * STABLE_LANE;
		}
		const set = cellUsage.get(idx);
		if (!set || set.size < 2 || !set.has(color)) return 0;
		const list = [...set].sort();
		const i = list.indexOf(color);
		const n = list.length;
		return (i - (n - 1) / 2) * LANE + 0.5;
	}

	// --- continuous wire rendering ------------------------------------
	// The old renderer drew every path edge as a separate subpath with round
	// caps (producing "cross" overshoots at turns) and computed a fresh point
	// per edge, so two trails of the same color could disagree on a shared
	// cell and cross instead of meeting.
	//
	// New approach: for each (color, cell) compute ONE canonical vertex point
	// and reuse it for every trail through that cell. Trails are then stroked
	// as a single subpath, so the end of one trail is exactly the start of the
	// next — no gaps, no diagonals, no cap overshoot, and branches meet.
	// Turns/crosses use an L-corner shifted by the lane on BOTH axes, keeping
	// every color in its own sub-lane.

	const normEdge = (a, b) => (a < b ? a + ':' + b : b + ':' + a);

	ctx.lineJoin = 'round';
	ctx.lineCap = 'butt'; // prevents cap overshoots at junctions/endpoints

	pathEdges.forEach((edges, groupKey) => {
		if (!edges || edges.size === 0) return;

		const color = groupKey.slice(0, groupKey.indexOf('|'));

		const adj = new Map();
		// Per cell, which axis directions this color occupies here.
		const hCells = new Set(), vCells = new Set();

		edges.forEach(e => {
			const p = e.split(':');
			const a = +p[0], b = +p[1];

			if (!adj.has(a)) adj.set(a, []);
			if (!adj.has(b)) adj.set(b, []);

			adj.get(a).push(b);
			adj.get(b).push(a);

			if (((a / GRID_W) | 0) === ((b / GRID_W) | 0)) { hCells.add(a); hCells.add(b); }
			else { vCells.add(a); vCells.add(b); }
		});

		// ONE canonical vertex per (color, cell). Every trail through the cell
		// reuses this exact same point, so the end of one trail is the start of
		// the next: wires can never cross or overshoot at a junction.
		//  - h-only cell: on the horizontal lane line (shift Y)
		//  - v-only cell: on the vertical lane line (shift X)
		//  - mixed cell (turn/branch/cross): the L-corner, shifted by the same
		//    lane on BOTH axes so every color keeps its own sub-lane.
		function cellPoint(idx) {
			const cx = idx % GRID_W, cy = (idx / GRID_W) | 0;
			const bx = (cx + 0.5) * CELL_SIZE, by = (cy + 0.5) * CELL_SIZE;
			const off = laneFor(color, idx);
			if (hCells.has(idx) && vCells.has(idx)) return [bx + off, by + off];
			if (hCells.has(idx)) return [bx, by + off];
			return [bx + off, by];
		}

		// Consume edges into continuous trails (prefer straight continuation).
		const remaining = new Set(edges);

		for (const startEdge of [...remaining]) {
			if (!remaining.has(startEdge)) continue;

			const a = +startEdge.split(':')[0];
			const b = +startEdge.split(':')[1];
			remaining.delete(startEdge);

			const trail = [a, b];

			while (true) {
				const curr = trail[trail.length - 1];
				const prev = trail[trail.length - 2];

				const cx = curr % GRID_W, cy = (curr / GRID_W) | 0;
				const px = prev % GRID_W, py = (prev / GRID_W) | 0;
				const dx = cx - px, dy = cy - py;

				let chosen = -1, chosenEdge = '';

				// Prefer continuing straight through the current cell.
				for (const nb of (adj.get(curr) || [])) {
					if (nb === prev) continue;
					const ek = normEdge(curr, nb);
					if (!remaining.has(ek)) continue;
					const nx = nb % GRID_W, ny = (nb / GRID_W) | 0;
					if (nx - cx === dx && ny - cy === dy) { chosen = nb; chosenEdge = ek; break; }
				}
				// Otherwise take any still-unvisited incident edge.
				if (chosen === -1) {
					for (const nb of (adj.get(curr) || [])) {
						if (nb === prev) continue;
						const ek = normEdge(curr, nb);
						if (!remaining.has(ek)) continue;
						chosen = nb; chosenEdge = ek; break;
					}
				}
				if (chosen === -1) break;
				remaining.delete(chosenEdge);
				trail.push(chosen);
			}

			// Stroke the whole trail as one subpath. Consecutive cells share the
			// exact same canonical point, so there is no gap, diagonal, or cap
			// overshoot, and branches meet instead of crossing.
			// Net view: identity color. Electric view: battery r/b, grey when cold.
			let ecol = viewColor(trail[0], color);
			for (let i = 0; i < trail.length; i++) if (shorts.has(trail[i])) { ecol = '#ff00ff'; break; }
			ctx.strokeStyle = ecol;
			ctx.lineWidth = 3;
			ctx.beginPath();
			let p = cellPoint(trail[0]);
			ctx.moveTo(p[0], p[1]);
			for (let i = 1; i < trail.length; i++) {
				p = cellPoint(trail[i]);
				ctx.lineTo(p[0], p[1]);
			}
			ctx.stroke();
		}
	});

	// --- manually placed wires (BUILD mode) --------------------------
	// Same lane-aware style as the auto networks so they meet at junctions.
	// Each cell is colored by the simulation (cellColor): a connected
	// wire shows its pole color, a cold wire is grey, a shorted cell is
	// flagged. Stroke segment-by-segment so colors switch at junctions.
	function drawWireCells(cells, netColor) {
		if (!cells || cells.length < 2) return;
		ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
		let prev = null;
		for (let i = 0; i < cells.length; i++) {
			const c = cells[i];
			// Lane offset stays on the net identity color so geometry is
			// stable across views; only the stroke color switches.
			const strokeCol = (colorView === 'electric' || colorView === 'voltage') ? (cellColor.get(c) || '#9ca3af') : netColor;
			const cx = c % GRID_W, cy = (c / GRID_W) | 0;
			const off = laneFor(netColor, c);
			const px = (cx + 0.5) * CELL_SIZE + off, py = (cy + 0.5) * CELL_SIZE + off;
			if (i > 0) {
				ctx.strokeStyle = shorts.has(cells[i - 1]) || shorts.has(c) ? '#ff00ff' : strokeCol;
				ctx.beginPath();
				ctx.moveTo(prev[0], prev[1]);
				ctx.lineTo(px, py);
				ctx.stroke();
			}
			prev = [px, py];
		}
	}
	function drawBattery(b) {
		const x0 = b.x * CELL_SIZE, y0 = b.y * CELL_SIZE, w = CELL_SIZE - 4, h = CELL_SIZE * 2 - 4;
		ctx.fillStyle = '#222'; ctx.fillRect(x0 + 2, y0 + 2, w, h);
		const hh = (h - 4) / 2;
		ctx.fillStyle = b.term[0]; ctx.fillRect(x0 + 4, y0 + 4, w - 4, hh);
		ctx.fillStyle = b.term[1]; ctx.fillRect(x0 + 4, y0 + 4 + hh, w - 4, hh);
		ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 2, y0 + 2, w, h);
	}
	manualWires.forEach(w => drawWireCells(w.cells, w.color));
	// Light is a floor layer: draw it over the grid + wires but BEFORE the
	// object glyphs, so lamps/batteries/switches/junctions stay visible at any
	// light level (light only tints the floor, never hides objects on top).
	if (colorView === 'light') {
		computeLightField();
		for (let i = 0; i < L_N; i++) {
			const r = Math.min(255, lightR[i]) | 0;
			const g = Math.min(255, lightG[i]) | 0;
			const b = Math.min(255, lightB[i]) | 0;
			const lum = Math.min(255, Math.max(0, lightField[i]));
			const k = lum / 255;
			const x = (i % GRID_W) * CELL_SIZE, y = ((i / GRID_W) | 0) * CELL_SIZE;
			if (k < 1) {
				ctx.fillStyle = 'rgba(0,0,0,' + (1 - k) + ')';
				ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
			}
			if (r || g || b) {
				ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + k + ')';
				ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
			}
		}
	}
	manualBatteries.forEach(b => drawBattery(b));
	// Lamp bulbs: the fill mirrors the emitted light (lit while the lamp
	// has charge), the outline shows the pole color when the lamp is
	// wired into a live network. Lamps add no `circles` entry.
	lamps.forEach(l => {
		const cx = (l.idx % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
		const cy = ((l.idx / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		const on = lampOutput(l) > 0;
		ctx.beginPath();
		ctx.arc(cx, cy, CELL_SIZE * 0.3, 0, Math.PI * 2);
		ctx.fillStyle = on ? (l.color || '#fde047') : '#6b7280';
		ctx.fill();
		ctx.strokeStyle = cellColor.get(l.idx) || '#1a1a1a'; ctx.lineWidth = 1.5; ctx.stroke();
	});
	// Switch toggles: a closed switch (value = true) shows a green bar
	// bridging its ends (circuit made); an open switch (value = false)
	// shows a red X (circuit broken). Outline is the live pole color when
	// wired into a powered net. Switches add no `circles`.
	switches.forEach(s => {
		const cx = (s.idx % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
		const cy = ((s.idx / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		const w = CELL_SIZE * 0.34, h = CELL_SIZE * 0.22;
		ctx.fillStyle = '#111';
		ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
		ctx.strokeStyle = cellColor.get(s.idx) || '#1a1a1a'; ctx.lineWidth = 1.5;
		ctx.strokeRect(cx - w, cy - h, w * 2, h * 2);
		ctx.strokeStyle = s.value ? '#22c55e' : '#ef4444';
		ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
		if (s.value) {
			ctx.beginPath();
			ctx.moveTo(cx - w * 0.65, cy); ctx.lineTo(cx + w * 0.65, cy);
			ctx.stroke();
		} else {
			const r = Math.min(w, h) * 0.7;
			ctx.beginPath();
			ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
			ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
			ctx.stroke();
		}
	});
	// Heat Sinks: a passive radiator drawn as a blue-cored grille. They remove
	// excess air heat locally (airRelax's G_SINK term); neighbours conduct heat
	// into them and cool, so they read as cold spots in the Heat view.
	heatSinks.forEach(s => {
		const cx = (s.idx % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
		const cy = ((s.idx / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		const r = CELL_SIZE * 0.32;
		ctx.fillStyle = '#0ea5e9'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
		ctx.strokeStyle = '#e0f2fe'; ctx.lineWidth = 1.5;
		ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
		ctx.beginPath();
		ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
		ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
		ctx.stroke();
	});
	// Air Pressure Source/Sink: a cyan disc with an up/down chevron. They set
	// the boundary air mass (and injected temperature), driving PV=nRT flow.
	function drawAirItem(list, chevronUp) {
		list.forEach(s => {
			const cx = (s.idx % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
			const cy = ((s.idx / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
			const r = CELL_SIZE * 0.32;
			ctx.fillStyle = '#06b6d4'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
			ctx.strokeStyle = '#cffafe'; ctx.lineWidth = 2;
			ctx.beginPath();
			if (chevronUp) { ctx.moveTo(cx - r * 0.5, cy + r * 0.2); ctx.lineTo(cx, cy - r * 0.3); ctx.lineTo(cx + r * 0.5, cy + r * 0.2); }
			else { ctx.moveTo(cx - r * 0.5, cy - r * 0.2); ctx.lineTo(cx, cy + r * 0.3); ctx.lineTo(cx + r * 0.5, cy - r * 0.2); }
			ctx.stroke();
		});
	}
	drawAirItem(airSources, true);
	drawAirItem(airSinks, false);
	// Pipe Valve: a cyan disc whose dark "closed" wedge grows as `open` → 0.
	function drawPipeValve(idx, open) {
		const cx = (idx % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
		const cy = ((idx / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		const r = CELL_SIZE * 0.32;
		ctx.fillStyle = '#06b6d4';
		ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
		if (open < 1) {
			ctx.fillStyle = '#1a1a1a';
			ctx.beginPath(); ctx.moveTo(cx, cy);
			ctx.arc(cx, cy, r, 0, Math.PI * 2 * open, true); ctx.fill();
		}
		ctx.strokeStyle = '#cffafe'; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
	}
	// Pipe Portal stub: a thin cyan ring marking the first endpoint while
	// the user is choosing the second (ghost only, never in pipePortals).
	function drawPortalStub(idx) {
		const cx = (idx % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
		const cy = ((idx / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2;
		ctx.setLineDash([3, 3]);
		ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.28, 0, Math.PI * 2); ctx.stroke();
		ctx.setLineDash([]);
	}
	// Pipe Portal link: a dashed cyan line between the two paired cells.
	function drawPortalLink(p) {
		const ax = (p.a % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
		const ay = ((p.a / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		const bx = (p.b % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
		const by = ((p.b / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		ctx.save();
		ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2;
		ctx.setLineDash([4, 4]);
		ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
		ctx.restore();
	}
	pipePortals.forEach(p => { drawPortalLink(p); drawPipeValve(p.a, p.open); drawPipeValve(p.b, p.open); });
	pipeValves.forEach(v => drawPipeValve(v.idx, v.open));
	if (pendingPortal) drawPortalStub(pendingPortal.a);
	// Predicted junction markers for the active plan (during drag or awaiting Apply).
	function drawPlanJunctions(path, segs) {
		if (!path || path.length < 2 || !segs || !segs.length) return;
		let acc = 0;
		const idxs = [0];
		for (const s of segs) { acc += s; idxs.push(acc); }
		ctx.fillStyle = '#fde047';
		ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
		idxs.forEach(i => {
			if (i < 0 || i >= path.length) return;
			const c = path[i];
			const cx = (c % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
			const cy = ((c / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
			ctx.beginPath(); ctx.arc(cx, cy, CELL_SIZE * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		});
	}
	if (wireDrag && wireDrag.path && wireDrag.path.length > 1) {
		const previewPlan = wireDrag.plan && wireDrag.plan.ok ? wireDrag.plan : null;
		ctx.save();
		ctx.globalAlpha = 0.55;
		drawWireCells(wireDrag.path, selectedColor);
		ctx.restore();
		const e = wireDrag.path[wireDrag.path.length - 1];
		const ex = (e % GRID_W) * CELL_SIZE + CELL_SIZE / 2, ey = ((e / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc(ex, ey, CELL_SIZE * 0.35, 0, Math.PI * 2); ctx.stroke();
		if (previewPlan) drawPlanJunctions(wireDrag.path, previewPlan.segs);
	} else if (pendingPlan && pendingPlan.ok) {
		drawPlanJunctions(pendingPlan.path, pendingPlan.segs);
	}

	// Draw every node once, on top, positioned on its own lane so it sits on
	// its wire.
	circles.forEach((n, idx) => {
		const color = n.color;
		const edgeKey = color + '|' + grid[idx];
		let horiz = false, vert = false;
		const edges = pathEdges.get(edgeKey);
		if (edges) {
			edges.forEach(e => {
				const p = e.split(':');
				const a = +p[0], b = +p[1];
				if (a === idx || b === idx) {
					const ox = (a % GRID_W) - (b % GRID_W);
					const oy = ((a / GRID_W) | 0) - ((b / GRID_W) | 0);
					if (oy === 0) horiz = true;
					if (ox === 0) vert = true;
				}
			});
		}
		const off = laneFor(color, idx);
		const Cx = (idx % GRID_W) * CELL_SIZE + CELL_SIZE / 2;
		const Cy = ((idx / GRID_W) | 0) * CELL_SIZE + CELL_SIZE / 2;
		let mx = Cx, my = Cy;
		if (off !== 0) {
			if (horiz && vert) { mx = Cx + off; my = Cy + off; }
			else if (horiz) my = Cy + off;
			else if (vert)  mx = Cx + off;
			else { mx = Cx + off; my = Cy + off; }
		}
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(mx, my, (n.small ? 0.15 : 0.3) * CELL_SIZE, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
	});

	if (colorView === 'voltage') {
		ctx.font = '8px monospace';
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		// Heatmap fill for every energized cell except those drawn as a
		// lamp/switch/battery (their own glyphs stay visible on top).
		const isGlyph = (i) => lamps.some(l => l.idx === i) || switches.some(s => s.idx === i)
			|| manualBatteries.some(b => b.poles.includes(i));
		for (const [idx, v] of voltages) {
			if (isGlyph(idx)) continue;
			const x = (idx % GRID_W) * CELL_SIZE, y = ((idx / GRID_W) | 0) * CELL_SIZE;
			ctx.fillStyle = shorts.has(idx) ? '#ff00ff' : (cellColor.get(idx) || '#9ca3af');
			ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
		}
		// Numeric voltage on every energized cell.
		for (const [idx, v] of voltages) {
			const x = (idx % GRID_W) * CELL_SIZE, y = ((idx / GRID_W) | 0) * CELL_SIZE;
			ctx.fillStyle = '#fff';
			ctx.fillText(v.toFixed(1) + 'V', x + CELL_SIZE / 2, y + CELL_SIZE / 2);
		}
		// Each lamp's voltage drop beside its bulb.
		ctx.fillStyle = '#fff';
		lamps.forEach(l => {
			if (!energized.has(l.idx)) return;
			const x = (l.idx % GRID_W) * CELL_SIZE, y = ((l.idx / GRID_W) | 0) * CELL_SIZE;
			ctx.fillText('Δ' + (l.dV || 0).toFixed(1) + 'V', x + CELL_SIZE / 2, y + CELL_SIZE - 2);
		});
		// Selected conductor: show its resistance to each pole.
		if (selectedItem) {
			let idx = null, ref = selectedItem.ref;
			if (selectedItem.kind === 'lamp') idx = ref.idx;
			else if (selectedItem.kind === 'switch') idx = ref.idx;
			else if (selectedItem.kind === 'wire') idx = ref.cells[0];
			else if (selectedItem.kind === 'node' && typeof ref === 'number') idx = ref;
			if (idx !== null && voltages.has(idx)) {
				const rp = resPos.get(idx), rn = resNeg.get(idx);
				const x = (idx % GRID_W) * CELL_SIZE, y = ((idx / GRID_W) | 0) * CELL_SIZE;
				ctx.fillStyle = '#fff';
				ctx.fillText('R+ ' + (isFinite(rp) ? rp.toFixed(1) : '∞') + 'Ω', x + CELL_SIZE / 2, y + 4);
				ctx.fillText('R− ' + (isFinite(rn) ? rn.toFixed(1) : '∞') + 'Ω', x + CELL_SIZE / 2, y + CELL_SIZE - 4);
			}
		}
	}

	// ---- Heat view: temperature labels + legend (late, on top) ----
	if (colorView === 'heat') {
		const N = GRID_W * GRID_H;
		const tRef = heatTRef; // reuse the eased peak from the fill pass above
		const fmt = (v) => v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);
		const glyphSet = new Set();
		lamps.forEach(l => glyphSet.add(l.idx));
		switches.forEach(s => glyphSet.add(s.idx));
		heatSinks.forEach(s => glyphSet.add(s.idx));
		airSources.forEach(s => glyphSet.add(s.idx));
		airSinks.forEach(s => glyphSet.add(s.idx));
		pipeValves.forEach(v => glyphSet.add(v.idx));
		pipePortals.forEach(p => { glyphSet.add(p.a); glyphSet.add(p.b); });
		if (pendingPortal) glyphSet.add(pendingPortal.a);
		manualBatteries.forEach(b => { glyphSet.add(b.poles[0]); glyphSet.add(b.poles[1]); });
		// Numeric readout: relative band (skip glyph cells + the very hottest
		// cell + coldest), with precision scaled to the magnitude so small
		// excess temperatures still read meaningfully.
		ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		const lo = tRef * 0.2, hi = tRef * 0.85;
		for (let i = 0; i < N; i++) {
			if (glyphSet.has(i)) continue;           // glyphs drawn on top instead
			if (temp[i] > lo && temp[i] < hi) {
				const x = (i % GRID_W) * CELL_SIZE, y = ((i / GRID_W) | 0) * CELL_SIZE;
				ctx.fillStyle = '#fff'; ctx.fillText(fmt(temp[i]) + '°', x + CELL_SIZE / 2, y + CELL_SIZE / 2);
			}
		}
		lamps.forEach(l => {
			if (!energized.has(l.idx)) return;
			const x = (l.idx % GRID_W) * CELL_SIZE, y = ((l.idx / GRID_W) | 0) * CELL_SIZE;
			ctx.fillStyle = '#fff'; ctx.fillText('Δ' + (l.dV || 0).toFixed(1) + 'V  ' + fmt(temp[l.idx]) + '°', x + CELL_SIZE / 2, y + CELL_SIZE - 2);
		});
		// Legend (bottom-left): blue=cool → red=hot, with the current peak
		// temperature so the auto-scaled colours have context.
		const lx = 6, ly = canvas.height - 52, lw = 132, lh = 46;
		ctx.fillStyle = 'rgba(17,24,39,0.82)';
		ctx.fillRect(lx, ly, lw, lh);
		ctx.strokeStyle = '#374151'; ctx.lineWidth = 1; ctx.strokeRect(lx, ly, lw, lh);
		const bx = lx + 8, by = ly + 20, bw = lw - 16, bh = 9;
		for (let g = 0; g < bw; g++) {
			const t = g / (bw - 1);
			ctx.fillStyle = 'rgb(' + Math.round(255 * t) + ',40,' + Math.round(255 * (1 - t)) + ')';
			ctx.fillRect(bx + g, by, 1, bh);
		}
		ctx.textBaseline = 'alphabetic';
		ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'left';
		ctx.fillText('Temperature (Joule heat)', lx + 8, ly + 13);
		ctx.fillStyle = '#9ca3af'; ctx.fillText('cool', bx, by + bh + 9);
		ctx.textAlign = 'right'; ctx.fillText('hot', bx + bw, by + bh + 9);
		ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
		ctx.fillText('peak ' + fmt(tRef) + '°   (auto-scaled)', bx, by + bh + 20);
	}

	if (hoverCell !== null) {
		const [hx, hy] = hoverCell;
		if (hx >= 0 && hx < GRID_W && hy >= 0 && hy < GRID_H) {
			ctx.fillStyle = 'rgba(129,140,248,.25)';
			ctx.fillRect(hx * CELL_SIZE + 1, hy * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
			ctx.strokeStyle = 'rgba(139,92,246,.8)'; ctx.lineWidth = 2;
			ctx.strokeRect(hx * CELL_SIZE + 1, hy * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
		}
	}

	// ---- Pressure view: pressure legend (bottom-left) ----
	if (colorView === 'pressure') {
		const N = GRID_W * GRID_H;
		const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;  // baseline (ambient, Pa)
		let pMax = pAmb;
		for (let i = 0; i < N; i++) if (isAir(i) && pressure[i] > pMax) pMax = pressure[i];
		const peak = pMax - pAmb;
		const lx = 6, ly = canvas.height - 52, lw = 132, lh = 46;
		ctx.fillStyle = 'rgba(17,24,39,0.82)';
		ctx.fillRect(lx, ly, lw, lh);
		ctx.strokeStyle = '#374151'; ctx.lineWidth = 1; ctx.strokeRect(lx, ly, lw, lh);
		const bx = lx + 8, by = ly + 20, bw = lw - 16, bh = 9;
		for (let g = 0; g < bw; g++) {
			const t = g / (bw - 1);
			ctx.fillStyle = 'rgb(' + Math.round(255 * t) + ',40,' + Math.round(255 * (1 - t)) + ')';
			ctx.fillRect(bx + g, by, 1, bh);
		}
		ctx.textBaseline = 'alphabetic';
		ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'left';
		ctx.fillText('Air pressure (PV=nRT)', lx + 8, ly + 13);
		ctx.fillStyle = '#9ca3af'; ctx.fillText('ambient', bx, by + bh + 9);
		ctx.textAlign = 'right'; ctx.fillText('high', bx + bw, by + bh + 9);
		ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
		ctx.fillText('peak ΔP ' + (peak >= 10 ? peak.toFixed(0) : peak.toFixed(2)) + ' (Pa)', bx, by + bh + 20);
	}
}

// Unified GODMODE item list (all unlimited). One `.gm-item` per entry,
// mirroring the Inventory panel's look; the active entry gets `inv-sel`.
const GM_ICONS = {
	node: '<circle cx="12" cy="12" r="8"/>',
	eraser: '<path d="M20 20H7L3 16a1 1 0 0 1 0-1.4l9.6-9.6a2.83 2.83 0 1 1 4 4L7 20"/><path d="M17.5 14.5 21 18"/>',
	wall: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
	obsA: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8l8 8M16 8l-8 8"/>',
	obsB: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8l8 8M16 8l-8 8"/>',
	obsC: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8l8 8M16 8l-8 8"/>',
	wire: '<path d="M4 12h6M14 12h6M10 8l4 8M14 8l-4 8"/>',
	battery: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10 3V1M14 3V1"/>',
	lamp: '<circle cx="12" cy="9" r="5"/><path d="M9 18h6M10 21h4"/>',
	switch: '<rect x="5" y="9" width="14" height="6" rx="1"/><path d="M8 12h5"/>',
	metal: '<path d="M4 12h4l3-6 4 12 3-6h2"/>',
	heatsink: '<rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
	airsrc: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
	airsink: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
	pipevalve:  '<circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/>',
	pipeportal: '<circle cx="5" cy="12" r="3"/><circle cx="19" cy="12" r="3"/><path d="M8 12h8"/>',
};
function renderGodmode() {
	const el = document.getElementById('godmodeList');
	if (!el) return;
	el.innerHTML = '';
	GOD_ITEMS.forEach(g => {
		const row = document.createElement('div');
		row.className = 'gm-item' + (activeGodId === g.id ? ' inv-sel' : '');
		row.innerHTML = `<svg viewBox="0 0 24 24" class="inv-ico">${GM_ICONS[g.id] || ''}</svg><span>${g.label}</span>`;
		row.onclick = () => selectGod(g.id);
		el.appendChild(row);
	});
}

function renderInventory() {
	const el = document.getElementById('inv-list');
	if (!el) return;
	let walls = 0, paths = 0;
	for (let i = 0; i < grid.length; i++) { if (grid[i] === 1) walls++; else paths++; }
	const obs = { A: 0, B: 0, C: 0 };
	for (let i = 0; i < blocked.length; i++) {
		if (blocked[i]) obs[obstacleKind[i] === 1 ? 'A' : obstacleKind[i] === 2 ? 'B' : 'C']++;
	}
	const colorNodes = {}, colorEdges = {};
	circles.forEach(n => { colorNodes[n.color] = (colorNodes[n.color] || 0) + 1; });
	pathEdges.forEach((edges, key) => {
		const c = key.slice(0, key.indexOf('|'));
		colorEdges[c] = (colorEdges[c] || 0) + edges.size;
	});
	let html = `<div class="inv-row">Walls: ${walls} &middot; Paths: ${paths}</div>`;
	html += `<div class="inv-row">Obstacles &mdash; A: ${obs.A} &middot; B: ${obs.B} &middot; C: ${obs.C}</div>`;

	html += `<div class="inv-sub inv-row">Inventory:</div>`;
	const wireSel = (activeTool === 'wire' && selectedInv === 'wire' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${wireSel}" data-inv="wire"><svg viewBox="0 0 24 24" class="inv-ico"><path d="M4 12h6M14 12h6M10 8l4 8M14 8l-4 8"/></svg>Wire (strategy ${wireStrategy.toUpperCase()})</div>`;
	const batSel = (activeTool === 'wire' && selectedInv === 'battery' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${batSel}" data-inv="battery"><svg viewBox="0 0 24 24" class="inv-ico"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10 3V1M14 3V1"/></svg>Battery &times;${INV.battery.count}</div>`;
	const lampSel = (activeTool === 'lamp' && selectedInv === 'lamp' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${lampSel}" data-inv="lamp"><svg viewBox="0 0 24 24" class="inv-ico"><circle cx="12" cy="9" r="5"/><path d="M9 18h6M10 21h4"/></svg>Lamp ×${INV.lamp.count}</div>`;
	const swSel = (activeTool === 'switch' && selectedInv === 'switch' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${swSel}" data-inv="switch"><svg viewBox="0 0 24 24" class="inv-ico"><rect x="5" y="9" width="14" height="6" rx="1"/><path d="M8 12h5"/></svg>Switch ×${INV.switch.count}</div>`;
	const hsSel = (activeTool === 'heatsink' && selectedInv === 'heatsink' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${hsSel}" data-inv="heatsink"><svg viewBox="0 0 24 24" class="inv-ico"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>Heat Sink ×${INV.heatsink.count}</div>`;
	const asSel = (activeTool === 'airsrc' && selectedInv === 'airsrc' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${asSel}" data-inv="airsrc"><svg viewBox="0 0 24 24" class="inv-ico"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>Air Source ×${INV.airsrc.count}</div>`;
	const akSel = (activeTool === 'airsink' && selectedInv === 'airsink' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${akSel}" data-inv="airsink"><svg viewBox="0 0 24 24" class="inv-ico"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>Air Sink ×${INV.airsink.count}</div>`;
	const pvSel = (activeTool === 'pipevalve' && selectedInv === 'pipevalve' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${pvSel}" data-inv="pipevalve"><svg viewBox="0 0 24 24" class="inv-ico"><circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/></svg>Pipe Valve ×${INV.pipevalve.count}</div>`;
	const ppSel = (activeTool === 'pipeportal' && selectedInv === 'pipeportal' && !unlimited) ? ' inv-sel' : '';
	html += `<div class="inv-row inv-item${ppSel}" data-inv="pipeportal"><svg viewBox="0 0 24 24" class="inv-ico"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="12" r="3"/><path d="M8 12h8"/></svg>Pipe Portal ×${INV.pipeportal.count}</div>`;

	// Colorless segment pool (shared "1, 4×2, 6, 11" formatter).
	html += `<div class="inv-sub inv-row">Wire pool:</div>`;
	html += `<div class="inv-row">${formatWireStock()}</div>`;
	html += `<div class="inv-item inv-row" id="restockBtn">Restock pool</div>`;

	// Manual (c) length picker.
	if (wireStrategy === 'c') {
		html += `<div class="inv-sub inv-row">Pick length (manual):</div>`;
		const lens = [];
		WIRES.forEach((c, l) => { for (let i = 0; i < c; i++) lens.push(l); });
		lens.sort((a, b) => a - b);
		lens.forEach(l => {
			const sel = selectedManualWireLen === l ? ' inv-sel' : '';
			html += `<div class="inv-row inv-item len-pick${sel}" data-len="${l}">${l}</div>`;
		});
	}

	let totalCells = 0; manualWires.forEach(w => totalCells += w.cells.length);
	html += `<div class="inv-sub inv-row">Placed: ${manualWires.length} wires (${totalCells} cells)</div>`;

	html += `<div class="inv-sub inv-row">Nodes by color:</div>`;
	COLORS.forEach(c => {
		const n = colorNodes[c] || 0, e = colorEdges[c] || 0;
		if (n === 0 && e === 0) return;
		html += `<div class="inv-row"><span class="path-swatch" style="background:${c}"></span>${n} nodes &middot; ${e} edges</div>`;
	});
	el.innerHTML = html;

	el.querySelectorAll('.inv-item').forEach(d => {
		d.onclick = () => {
			if (d.dataset.inv === 'lamp') setActiveTool('lamp', { inv: 'lamp', unlimited: false });
			else if (d.dataset.inv === 'switch') setActiveTool('switch', { inv: 'switch', unlimited: false });
			else if (d.dataset.inv === 'heatsink') setActiveTool('heatsink', { inv: 'heatsink', unlimited: false });
			else if (d.dataset.inv === 'airsrc') setActiveTool('airsrc', { inv: 'airsrc', unlimited: false });
			else if (d.dataset.inv === 'airsink') setActiveTool('airsink', { inv: 'airsink', unlimited: false });
			else if (d.dataset.inv === 'pipevalve') setActiveTool('pipevalve', { inv: 'pipevalve', unlimited: false });
			else if (d.dataset.inv === 'pipeportal') setActiveTool('pipeportal', { inv: 'pipeportal', unlimited: false });
			else setActiveTool('wire', { inv: d.dataset.inv, unlimited: false });
		};
	});
	el.querySelectorAll('.len-pick').forEach(d => {
		d.onclick = () => {
			selectedManualWireLen = +d.dataset.len;
			wireStrategy = 'c';
			setWireStrategy('c');
			setActiveTool('wire', { inv: 'wire', unlimited: false });
		};
	});
	const rb = el.querySelector('#restockBtn');
	if (rb) rb.onclick = () => { seedWires(); renderInventory(); logger('Restocked wire pool', 'sys'); };
}

setupPalette();