// ---- Electric simulation ---------------------------------------------
// A flexible substrate for the planned electric simulation. Wires are
// colorless until they connect (through a shared cell / junction) to a
// battery pole; then they take that pole's color. Batteries are the only
// fixed color sources. Any operation that changes the topology (place
// wire, place battery, cut, obstacle, remove) emits on `bus`, and this
// module recomputes colors and redraws — so future parts (lamps,
// switches, resistors…) just need their own sources/sinks + listeners.

// Voltage heatmap color (blue 0V -> red Vbat). Shared by both engines;
// only the cosmetic display quantization happens here (no clamping of the
// stored field values).
function voltageColor(v, vmin, vmax) {
	const span = (vmax - vmin) || 1;
	const t = Math.max(0, Math.min(1, (v - vmin) / span));
	const r = Math.round(255 * t), b = Math.round(255 * (1 - t));
	return `rgb(${r},0,${b})`;
}

// Closed-circuit (nodal graph) engine. — OBSOLETE, kept for regression.
//
// Instead of flooding each battery pole's color independently, we require a
// *closed loop*: a battery's two poles must belong to the same conductive
// component before any power flows. The component is then solved as a
// resistor network by nodal analysis (Laplacian relaxation) to obtain a
// per-node voltage, and each lamp lights by the voltage drop (dV) across
// its two terminals. Conductor colours become a voltage heatmap
// (blue 0V -> red Vbat).
//
// Status: NO new features planned. Selectable from the Engine dropdown for
// comparison with the Field engine; covered by test_electric_demo.js so a
// change to the live Field engine that touches shared code paths will be
// caught here too. New work should target the Field engine above.
function circuitSimulate() {
	cellColor.clear();
	shorts.clear();
	energized.clear();
	voltages.clear();
	resPos.clear();
	resNeg.clear();

	// ---- conductive graph ------------------------------------------
	const adj = new Map();
	const link = (a, b) => {
		if (!adj.has(a)) adj.set(a, new Set());
		if (!adj.has(b)) adj.set(b, new Set());
		adj.get(a).add(b);
		adj.get(b).add(a);
	};

	// A battery's own two poles must NOT be linked by a R_wire edge from the
	// wire run that includes them — they form a 1×2 source whose internal
	// resistance is modelled separately (Norton g_int). Without this skip the
	// battery is silently shorted by R_wire and series behaviour is wrong.
	const batteryPolePair = new Set();
	manualBatteries.forEach(b => {
		const a = b.poles[0], c = b.poles[1];
		batteryPolePair.add(Math.min(a, c) + ':' + Math.max(a, c));
	});
	const isPolePair = (a, b) => batteryPolePair.has(Math.min(a, b) + ':' + Math.max(a, b));

	// Wires conduct along their consecutive cells.
	manualWires.forEach(w => {
		for (let i = 0; i < w.cells.length - 1; i++) {
			const u = w.cells[i], v = w.cells[i + 1];
			if (isPolePair(u, v)) continue;
			link(u, v);
		}
	});
	// Auto-solved net paths (GODMODE corridors) also conduct.
	pathEdges.forEach(edges => {
		edges.forEach(e => {
			const p = e.split(':');
			link(+p[0], +p[1]);
		});
	});

	// Lamps conduct into any 4-neighbour that is already part of the
	// conductive graph (a wire or net corridor). A lamp cuts the wire it
	// sits on, so it has exactly two conductor neighbours (a junction).
	lamps.forEach(l => {
		const idx = l.idx;
		if (blocked[idx]) return;
		const cx = idx % GRID_W, cy = (idx / GRID_W) | 0;
		for (let i = 0; i < 4; i++) {
			const nx = cx + dirs[i].dx, ny = cy + dirs[i].dy;
			if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
			const nid = ny * GRID_W + nx;
			if (adj.has(nid)) link(idx, nid);
		}
	});

	// Switches bridge the wire they sit on while closed (value = true);
	// an open switch (value = false) adds no edge, so the cut wire stays
	// broken and the circuit is interrupted. Same neighbour rule as lamps.
	switches.forEach(s => {
		if (!s.value) return;
		const idx = s.idx;
		if (blocked[idx]) return;
		const cx = idx % GRID_W, cy = (idx / GRID_W) | 0;
		for (let i = 0; i < 4; i++) {
			const nx = cx + dirs[i].dx, ny = cy + dirs[i].dy;
			if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
			const nid = ny * GRID_W + nx;
			if (adj.has(nid)) link(idx, nid);
		}
	});

	// ---- connected components (DSU) -------------------------------
	netParent.clear();
	const mk = (x) => { if (!netParent.has(x)) netParent.set(x, x); };
	const uni = (a, b) => { mk(a); mk(b); const ra = netFind(a), rb = netFind(b); if (ra !== rb) netParent.set(ra, rb); };
	adj.forEach((set, a) => {
		if (blocked[a]) return;
		set.forEach(b => { if (!blocked[b]) uni(a, b); });
	});
	// Augment with each battery's internal g_int edge so series batteries
	// — whose two poles sit in DIFFERENT conductor components (e.g. the − of
	// bat1 connects to the + of bat2 only through bat2) — join into ONE
	// closed loop. Without this, the conductor DSU alone leaves p1 and q1
	// in different components and the closed-loop check would (falsely)
	// report "open circuit" for a valid series. An isolated battery (no
	// external path) still has only its two poles in the component, and
	// the external-conductor check below rejects it as cold.
	manualBatteries.forEach(b => {
		const p = b.poles[0], q = b.poles[1];
		if (blocked[p] || blocked[q]) return;
		uni(p, q);
	});

	// ---- cell-type sets -------------------------------------------
	const lampIdx = new Set(lamps.map(l => l.idx));
	const lampByIdx = new Map(lamps.map(l => [l.idx, l]));
	const pumpIdx = new Set(pumps.map(p => p.idx));
	const pumpByIdx = new Map(pumps.map(p => [p.idx, p]));
	const switchIdx = new Set(switches.map(s => s.idx));
	const poleSet = new Set();
	manualBatteries.forEach(b => b.poles.forEach(p => poleSet.add(p)));

	function typeOf(n) {
		if (poleSet.has(n)) return 'pole';
		if (lampIdx.has(n)) return 'lamp';
		if (pumpIdx.has(n)) return 'pump';
		if (switchIdx.has(n)) return 'switch';
		return 'wire';
	}
	// Resistance of one adj edge between endpoints u and v. A lamp/switch/pump
	// is split into two halves (one per terminal edge); a GODMODE lamp/pump is a
	// near-ideal conductor (self-powered, not a load).
	function edgeR(u, v) {
		const tu = typeOf(u), tv = typeOf(v);
		const isWire = (t) => t === 'wire' || t === 'pole';
		if (isWire(tu) && isWire(tv)) return R_wire;
		if (tu === 'lamp' || tv === 'lamp') {
			const l = lampByIdx.get(tu === 'lamp' ? u : v);
			return (l && !l.limited) ? R_switch / 2 : ((l && l.R != null ? l.R : R_lamp) / 2);
		}
		if (tu === 'pump' || tv === 'pump') {
			const p = pumpByIdx.get(tu === 'pump' ? u : v);
			return (p && !p.limited) ? R_switch / 2 : ((p && p.R != null ? p.R : 10.0) / 2);
		}
		if (tu === 'switch' || tv === 'switch') return R_switch / 2;
		return R_wire;
	}
		// Reset every lamp and pump voltage drop; only loads inside a closed loop
		// will be given a non-zero value below.
		lamps.forEach(l => { l.dV = 0; });
		pumps.forEach(p => {
			if (!p.limited) { p.dV = 10; p.lastPower = 10; }
			else { p.dV = 0; p.lastPower = 0; }
		});

	// ---- per-component nodal solve (Norton equivalent) ------------
	// One system per connected component that contains a battery. ALL
	// batteries in the component are solved together so series/parallel
	// stacks behave correctly. Each battery is injected as a Norton source:
	// an internal conductance g_int = 1/R_bat between its poles (p=+, q=−)
	// plus a nodal current I_n = Vbat/R_bat at p and −I_n at q. Exactly one
	// node per component is grounded (the first battery's q, V=0); the rest
	// float so node differences are unique.
	const processedRoots = new Set();
	manualBatteries.forEach(b => {
		const p = b.poles[0], q = b.poles[1];          // p = +, q = −
		if (blocked[p] || blocked[q]) return;
		const root = netFind(p);
		// Augmented DSU (poles unioned) puts p and q in the same root, so
		// the old p-vs-q check no longer detects "open". Instead require
		// the augmented component to contain at least one external
		// conductor cell (a wire, lamp, switch, or painted metal) — an
		// isolated battery with no external path has only its two poles
		// in the component and stays cold.
		let hasExternal = false;
		adj.forEach((set, n) => {
			if (hasExternal) return;
			if (netFind(n) !== root) return;
			if (n === p || n === q) return;
			hasExternal = true;
		});
		if (!hasExternal) return;        // open circuit -> cold/grey
		if (processedRoots.has(root)) return;
		processedRoots.add(root);

		// All batteries inside this closed component.
		const compBatts = manualBatteries.filter(bb => {
			const pp = bb.poles[0], qq = bb.poles[1];
			if (blocked[pp] || blocked[qq]) return false;
			return netFind(pp) === root;
		});
		const nBatt = compBatts.length;
		const Vbat_total = nBatt * Vbat;

		// All cells in this closed component.
		const comp = [];
		adj.forEach((set, a) => { if (!blocked[a] && netFind(a) === root) comp.push(a); });

		// Conductance adjacency (g = 1/R) within the component.
		const gAdj = new Map();
		comp.forEach(n => gAdj.set(n, []));
		comp.forEach(u => {
			const s = adj.get(u);
			if (!s) return;
			s.forEach(v => {
				if (blocked[v] || netFind(v) !== root) return;
				gAdj.get(u).push([v, 1 / edgeR(u, v)]);
			});
		});

		// Norton injections + internal conductance for every battery.
		const inj = new Map();
		comp.forEach(n => inj.set(n, 0));
		let groundQ = null;
		compBatts.forEach((bb, i) => {
			const bp = bb.poles[0], bq = bb.poles[1];
			const g_int = 1 / R_bat, I_n = Vbat / R_bat;
			gAdj.get(bp).push([bq, g_int]);
			gAdj.get(bq).push([bp, g_int]);
			inj.set(bp, inj.get(bp) + I_n);
			inj.set(bq, inj.get(bq) - I_n);
			if (i === 0) groundQ = bq;                 // single ground per component
		});

		// Gauss–Seidel relaxation of the Laplacian (KCL with injection; one
		// fixed ground node). Converges to the exact nodal solution for any
		// series/parallel battery topology.
		const V = new Map();
		const fixed = new Set([groundQ]);
		V.set(groundQ, 0);
		comp.forEach(n => { if (!fixed.has(n)) V.set(n, 0); });
		let dv = Infinity, iter = 0;
		while (dv > 1e-4 && iter < 100000) {
			dv = 0; iter++;
			for (const n of comp) {
				if (fixed.has(n)) continue;
				const edges = gAdj.get(n);
				let sumGV = 0, sumG = 0;
				for (const [j, g] of edges) { sumGV += g * V.get(j); sumG += g; }
				if (sumG === 0) continue;
				const nv = (sumGV + inj.get(n)) / sumG;
				dv = Math.max(dv, Math.abs(nv - V.get(n)));
				V.set(n, nv);
			}
		}

		// Total delivered current (Norton: I_n minus the part recirculating
		// through the internal conductance) and equivalent resistance.
		let Iext = 0;
		compBatts.forEach(bb => {
			const bp = bb.poles[0], bq = bb.poles[1];
			const g_int = 1 / R_bat, I_n = Vbat / R_bat;
			Iext += I_n - g_int * (V.get(bp) - V.get(bq));
		});
		const Req = Iext > 1e-12 ? Vbat_total / Iext : Infinity;

		// Per-component span for the heatmap colour normalisation.
		let vmin = Infinity, vmax = -Infinity;
		comp.forEach(n => { const vn = V.get(n); if (vn < vmin) vmin = vn; if (vn > vmax) vmax = vn; });

		let hasLoad = false;
		comp.forEach(n => {
			if (lampIdx.has(n) || pumpIdx.has(n)) hasLoad = true;
			const vn = V.get(n);
			voltages.set(n, vn);
			resPos.set(n, ((Vbat_total - vn) / Vbat_total) * Req);   // R to + stack
			resNeg.set(n, (vn / Vbat_total) * Req);                 // R to − stack
			cellColor.set(n, voltageColor(vn, vmin, vmax));
			energized.add(n);
		});

		// Lamp and pump voltage drops = difference between two conductor neighbours.
		lamps.forEach(l => {
			if (netFind(l.idx) !== root) return;
			const nbrs = [...(adj.get(l.idx) || [])].filter(nn => netFind(nn) === root);
			if (nbrs.length >= 2) l.dV = V.get(nbrs[0]) - V.get(nbrs[1]);
			else if (nbrs.length === 1) l.dV = V.get(nbrs[0]) - V.get(l.idx);
		});
		pumps.forEach(p => {
			if (!p.limited) return;
			if (netFind(p.idx) !== root) return;
			const nbrs = [...(adj.get(p.idx) || [])].filter(nn => netFind(nn) === root);
			if (nbrs.length >= 2) p.dV = Math.abs(V.get(nbrs[0]) - V.get(nbrs[1]));
			else if (nbrs.length === 1) p.dV = Math.abs(V.get(nbrs[0]) - V.get(p.idx));
			p.lastPower = (p.dV * p.dV) / (p.R || 10.0);
		});

		// Closed loop with a battery but no load -> short (magenta).
		if (!hasLoad) comp.forEach(n => shorts.add(n));
	});

	// Keep battery poles merged in DSU for any compatibility use; lamps no
	// longer read it (lighting is driven by dV, not by pooled energy).
	manualBatteries.forEach(b => {
		const [p, qd] = b.poles;
		if (!blocked[p] && !blocked[qd]) uni(p, qd); else { mk(p); mk(qd); }
	});

	// Voltages are set; build the shared R grid + Joule heat sources once.
	computeHeatSource();
}

// Field (diffusion) engine — a LIVING simulation, not a one-shot solve.
//
// Electricity is the diffusion of a potential (voltage) through a conductive
// medium. Every cell with finite resistance (wire, painted metal, lamp load,
// closed switch, or a battery pole) participates; neighbours couple with
// conductance g(u,v) = 1/(R_u + R_v). Higher R -> lower g -> less diffusion
// (steeper gradient). The only Dirichlet references are the battery + (Vbat)
// and − (0 V) poles.
//
// We never block waiting for convergence. Instead we keep a persistent
// potential field and relax it a fixed number of Gauss–Seidel sweeps every
// animation frame, re-publishing and re-rendering continuously — the field
// "flows" toward steady state as fast as the frame budget allows. When it is
// effectively still we pause the loop to save CPU and resume on any change.
// Each sweep is a conservative convex combination (KCL holds per node:
// Σ I = 0), so the diffusion is unconditionally stable and charge is
// conserved exactly. Stored voltages are full-precision doubles; rounding
// happens only at display.

// Persistent field state shared across frames. Warm-starting between edits
// (rather than zeroing each change) is what makes the simulation feel alive.
let fieldV = null;                 // Float64Array(N): current potential (V)
let fieldSystems = [];             // one relaxation system per battery-fed component
let fieldLampByIdx = new Map();    // idx -> lamp (for the dV readout)
let fieldPumpByIdx = new Map();    // idx -> pump (for load detection & readout)
const FIELD_SWEEPS_PER_FRAME = 50; // relaxation steps advanced each frame
let simRunning = false;            // unified sim (field + heat) loop is active
let fieldDirty = false;            // force at least one more field frame
let heatDirty = false;             // force at least one more heat frame
let fieldEdges = [];               // {a,b,Re,dlx,dly,mx,my,E,I,key}
let fieldEdgeMap = new Map();      // "a:b" -> edge
let fieldBz = null;                // per-cell Bz overlay
let magEnergyResidual = 0;         // Σ E·I + Σ F·v (should be ~0)

function magKernelG(dlx, dly, rx, ry, sig2) {
	const den = rx * rx + ry * ry + sig2;
	return (dlx * ry - dly * rx) / den;
}
function magKernelGrad(dlx, dly, rx, ry, sig2) {
	const num = dlx * ry - dly * rx;
	const den = rx * rx + ry * ry + sig2;
	const den2 = den * den;
	return {
		gx: (-dly * den - num * 2 * rx) / den2,
		gy: (dlx * den - num * 2 * ry) / den2
	};
}
function magnetList() {
	const out = [];
	for (let i = 0; i < pistons.length; i++) if (pistons[i].magnet) out.push(pistons[i]);
	return out;
}
function edgeIsSelf(edge, body) {
	const cells = bodyCells(body);
	let ha = false, hb = false;
	for (let i = 0; i < cells.length; i++) {
		if (cells[i] === edge.a) ha = true;
		if (cells[i] === edge.b) hb = true;
	}
	return ha && hb;
}

function fieldSimulate() {
	// 1) Per-cell resistance grid + connected components.
	fieldLampByIdx = new Map(lamps.map(l => [l.idx, l]));
	fieldPumpByIdx = new Map(pumps.map(p => [p.idx, p]));
	const switchByIdx = new Map(switches.map(s => [s.idx, s]));
	const pumpByIdx = fieldPumpByIdx;

	const wireCells = new Set();
	manualWires.forEach(w => w.cells.forEach(c => wireCells.add(c)));
	pathEdges.forEach(edges => edges.forEach(e => {
		const p = e.split(':');
		wireCells.add(+p[0]); wireCells.add(+p[1]);
	}));
	manualBatteries.forEach(b => b.poles.forEach(p => wireCells.add(p)));

	function cellR(idx) {
		if (blocked[idx]) return Infinity;
		if (fieldLampByIdx.has(idx)) {
			const l = fieldLampByIdx.get(idx);
			// GODMODE lamps are self-powered (near-ideal, no load); BUILD lamps
			// use their own per-instance resistance so the slider actually drives
			// the solve (and thus voltage drop + Joule heat).
			return l.limited ? (l.R != null ? l.R : R_lamp) : R_wire;
		}
		if (pumpByIdx.has(idx)) {
			const p = pumpByIdx.get(idx);
			return p.limited ? (p.R != null ? p.R : 10.0) : R_wire;
		}
		if (switchByIdx.has(idx)) {
			const s = switchByIdx.get(idx);
			return s.value ? R_switch : Infinity; // open switch breaks the medium
		}
		const ba = caseABodyAt(idx);
		if (ba) return (ba.R_arm != null ? ba.R_arm : 2) / 2;
		if (metalCells[idx]) return R_metal;
		if (wireCells.has(idx)) return R_wire;
		return Infinity; // bare ground / air is non-conductive
	}

	const N = GRID_W * GRID_H;
	const R = new Float64Array(N);
	for (let i = 0; i < N; i++) R[i] = cellR(i);
	const finite = (i) => isFinite(R[i]);

	// A battery is a source, not a conductor: its own + and − terminals must
	// not be coupled to each other (they are grid-adjacent in a 1×2 battery).
	const forbidden = new Set();
	manualBatteries.forEach(b => {
		const a = b.poles[0], c = b.poles[1];
		forbidden.add(Math.min(a, c) + ':' + Math.max(a, c));
	});
	const isForbidden = (a, b) => forbidden.has(Math.min(a, b) + ':' + Math.max(a, b));

	netParent.clear();
	const mk = (x) => { if (!netParent.has(x)) netParent.set(x, x); };
	const uni = (a, b) => { mk(a); mk(b); const ra = netFind(a), rb = netFind(b); if (ra !== rb) netParent.set(ra, rb); };
	for (let i = 0; i < N; i++) {
		if (!finite(i)) continue;
		const cx = i % GRID_W, cy = (i / GRID_W) | 0;
		for (let d = 0; d < 4; d++) {
			const nx = cx + dirs[d].dx, ny = cy + dirs[d].dy;
			if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
			const n = ny * GRID_W + nx;
			if (finite(n) && !isForbidden(i, n)) uni(i, n);
		}
	}
	// Augment with each battery's internal g_int edge so series batteries
	// (poles in different conductor components) join into ONE closed loop.
	// An isolated battery (no external path) still has only its two poles
	// in the component and is rejected by the external-conductor check
	// below.
	manualBatteries.forEach(b => {
		const p = b.poles[0], q = b.poles[1];
		if (blocked[p] || blocked[q]) return;
		if (!finite(p) || !finite(q)) return;
		uni(p, q);
	});

	// 2) Build a relaxation system per component that holds a battery. Every
	//    battery in the component is injected as a Norton source (internal
	//    conductance g_int = 1/R_bat plus nodal current I_n = Vbat/R_bat at p
	//    and −I_n at q). Exactly one node per system is grounded (the first
	//    battery's q, V=0); the series/parallel voltage then EMERGES from the
	//    diffusion over animation frames. The forbidden set keeps the generic
	//    4-neighbour coupling from also shorting the battery's poles.
	const gOf = (u, v) => 1 / (R[u] + R[v]);
	const sig2 = SIGMA_B * SIGMA_B;
	const r2max = MAG_RMAX * MAG_RMAX;
	const mags = magnetList();

	// Per-edge registry (a < b, row-major) + magnet-induced EMF.
	fieldEdges = [];
	fieldEdgeMap = new Map();
	for (let i = 0; i < N; i++) {
		if (!finite(i)) continue;
		const cx = i % GRID_W, cy = (i / GRID_W) | 0;
		for (const [dx, dy] of [[1, 0], [0, 1]]) {
			const nx = cx + dx, ny = cy + dy;
			if (nx >= GRID_W || ny >= GRID_H) continue;
			const m = ny * GRID_W + nx;
			if (!finite(m) || isForbidden(i, m)) continue;
			const a = i, b = m;
			const Re = R[a] + R[b];
			const dlx = dx, dly = dy;
			const mx = (cx + nx) * 0.5 + 0.5;
			const my = (cy + ny) * 0.5 + 0.5;
			let E = 0;
			for (let mi = 0; mi < mags.length; mi++) {
				const mag = mags[mi];
				const edgeTmp = { a, b };
				if (edgeIsSelf(edgeTmp, mag)) continue;
				const c = bodyCenter(mag);
				const rx = c.x - mx, ry = c.y - my;
				if (rx * rx + ry * ry > r2max) continue;
				const hat = bodyHat(mag);
				const gxy = magKernelGrad(dlx, dly, rx, ry, sig2);
				const dgda = gxy.gx * hat.ax + gxy.gy * hat.ay;
				E += -(mag.magStrength || 1) * K_B * dgda * (mag.vel || 0);
			}
			const edge = { a, b, Re, dlx, dly, mx, my, E, I: 0, key: a + ':' + b };
			fieldEdges.push(edge);
			fieldEdgeMap.set(edge.key, edge);
		}
	}

	function injectEMF(inj, root) {
		for (let ei = 0; ei < fieldEdges.length; ei++) {
			const e = fieldEdges[ei];
			if (!e.E) continue;
			if (netFind(e.a) !== root || netFind(e.b) !== root) continue;
			const In = e.E / e.Re;
			inj.set(e.b, (inj.get(e.b) || 0) + In);
			inj.set(e.a, (inj.get(e.a) || 0) - In);
		}
	}
	function buildComp(root) {
		const comp = [];
		const compRed = [], compBlack = [];
		for (let i = 0; i < N; i++) if (netFind(i) === root) {
			comp.push(i);
			const cx = i % GRID_W, cy = (i / GRID_W) | 0;
			(cx + cy & 1 ? compBlack : compRed).push(i);
		}
		const Ga = new Map();
		for (const n of comp) {
			const cx = n % GRID_W, cy = (n / GRID_W) | 0, list = [];
			for (let d = 0; d < 4; d++) {
				const nx = cx + dirs[d].dx, ny = cy + dirs[d].dy;
				if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
				const m = ny * GRID_W + nx;
				if (netFind(m) === root && !isForbidden(n, m) && finite(m)) list.push([m, gOf(n, m)]);
			}
			Ga.set(n, list);
		}
		return { comp, compRed, compBlack, Ga };
	}

	const seen = new Set();
	fieldSystems = [];
	manualBatteries.forEach(b => {
		const p = b.poles[0], q = b.poles[1];     // p = +, q = −
		if (blocked[p] || blocked[q]) return;
		if (!finite(p) || !finite(q)) return;
		const root = netFind(p);
		// Augmented DSU already unions p and q, so the p-vs-q check is no
		// longer the right "open circuit" test. Require the component to
		// contain an external finite cell (wire/lamp/switch/metal) so an
		// isolated battery with no external path stays cold.
		let hasExternal = false;
		for (let i = 0; i < N && !hasExternal; i++) {
			if (netFind(i) !== root) continue;
			if (i === p || i === q) continue;
			if (finite(i)) hasExternal = true;
		}
		if (!hasExternal) return;               // open circuit -> stays cold
		if (seen.has(root)) return;               // one system per component
		seen.add(root);

		// All batteries inside this closed component.
		const compBatts = manualBatteries.filter(bb => {
			const pp = bb.poles[0], qq = bb.poles[1];
			if (blocked[pp] || blocked[qq]) return false;
			return netFind(pp) === root;
		});

		const { comp, compRed, compBlack, Ga } = buildComp(root);
		// Norton injections + internal conductance for every battery.
		const inj = new Map();
		comp.forEach(n => inj.set(n, 0));
		let groundQ = null;
		compBatts.forEach((bb, i) => {
			const bp = bb.poles[0], bq = bb.poles[1];
			const g_int = 1 / R_bat, I_n = Vbat / R_bat;
			Ga.get(bp).push([bq, g_int]);
			Ga.get(bq).push([bp, g_int]);
			inj.set(bp, inj.get(bp) + I_n);
			inj.set(bq, inj.get(bq) - I_n);
			if (i === 0) groundQ = bq;             // single ground per component
		});
		injectEMF(inj, root);
		fieldSystems.push({ root, comp, compRed, compBlack, Ga, inj, groundQ, fixed: new Set([groundQ]), compBatts, lastDv: Infinity });
	});

	// Magnet-only loops: a connected conductor component with a cycle (or a
	// moving magnet inducing EMF on a loop) and no battery still carries current.
	if (mags.length) {
		const edgeCount = new Map();
		const nodeCount = new Map();
		for (let i = 0; i < N; i++) {
			if (!finite(i)) continue;
			const r = netFind(i);
			nodeCount.set(r, (nodeCount.get(r) || 0) + 1);
		}
		for (let ei = 0; ei < fieldEdges.length; ei++) {
			const e = fieldEdges[ei];
			const r = netFind(e.a);
			if (netFind(e.b) !== r) continue;
			edgeCount.set(r, (edgeCount.get(r) || 0) + 1);
		}
		const magRoots = new Set();
		for (let ei = 0; ei < fieldEdges.length; ei++) {
			if (!fieldEdges[ei].E) continue;
			magRoots.add(netFind(fieldEdges[ei].a));
		}
		nodeCount.forEach((nN, root) => {
			if (seen.has(root)) return;
			const nE = edgeCount.get(root) || 0;
			const hasCycle = nE > nN - 1;
			if (!hasCycle) return;
			if (!magRoots.has(root)) return;
			seen.add(root);
			const { comp, compRed, compBlack, Ga } = buildComp(root);
			if (!comp.length) return;
			const inj = new Map();
			comp.forEach(n => inj.set(n, 0));
			injectEMF(inj, root);
			const groundQ = comp[0];
			fieldSystems.push({ root, comp, compRed, compBlack, Ga, inj, groundQ, fixed: new Set([groundQ]), compBatts: [], lastDv: Infinity });
		});
	}

	// 3) Ensure the persistent field exists. No Dirichlet pinning — the EMF is
	//    injected every sweep (see fieldRelax) so the series voltage EMERGES
	//    from diffusion rather than being hard-set. Warm-start keeps the
	//    simulation continuous across edits.
	if (!fieldV || fieldV.length !== N) fieldV = new Float64Array(N);

	// 4) Compatibility: keep battery poles merged in the shared DSU.
	manualBatteries.forEach(b => {
		const [p, qd] = b.poles;
		if (!blocked[p] && !blocked[qd]) uni(p, qd); else { mk(p); mk(qd); }
	});

	// The unified loop (startSimLoop, called from recompute) now drives both
	// the field relaxation and the heat diffusion, so we no longer start a
	// field-only loop here.
}

// Advance the living diffusion by `sweeps` Gauss–Seidel passes over every
// active component. Returns the largest per-cell change this call.
function fieldRelax(sweeps) {
	let globalMax = 0;
		for (const s of fieldSystems) {
		const { compRed, compBlack, Ga, fixed, inj } = s;
		let maxc = 0;
		for (let it = 0; it < sweeps; it++) {
			// Checkerboard (red-black) Gauss–Seidel: update red cells using only
			// old (black) neighbours, then black using the just-updated reds. This
			// removes the directional bias a single row-major sweep would inject
			// (a plain sweep propagates the field faster along its scan order).
			for (let pass = 0; pass < 2; pass++) {
				const list2 = pass === 0 ? compRed : compBlack;
				for (let ri = 0; ri < list2.length; ri++) {
					const n = list2[ri];
					if (fixed.has(n)) continue;
					const list = Ga.get(n);
					let sgv = 0, sg = 0;
					for (let k = 0; k < list.length; k++) { const e = list[k]; sgv += e[1] * fieldV[e[0]]; sg += e[1]; }
					if (sg === 0) continue;
					// Inject the battery current every sweep so the series EMF
					// accumulates naturally over frames (emergent, not pinned).
					const nv = (sgv + inj.get(n)) / sg;
					const d = Math.abs(nv - fieldV[n]);
					if (d > maxc) maxc = d;
					fieldV[n] = nv;
				}
			}
		}
		s.lastDv = maxc;
		if (maxc > globalMax) globalMax = maxc;
	}
	return globalMax;
}

// Push the current field into the shared render/property maps.
function fieldPublish() {
	cellColor.clear(); shorts.clear(); energized.clear();
	voltages.clear(); resPos.clear(); resNeg.clear();
	lamps.forEach(l => { l.dV = 0; });
	pumps.forEach(p => {
		if (!p.limited) { p.dV = 10; p.lastPower = 10; }
		else { p.dV = 0; p.lastPower = 0; }
	});

	for (const s of fieldSystems) {
		const compBatts = s.compBatts || [];
		const nBatt = compBatts.length;
		const Vbat_total = nBatt * Vbat;
		// Total delivered current (Norton: I_n minus the part recirculating
		// through the internal conductance). Same formula as the circuit engine.
		let Iext = 0;
		compBatts.forEach(bb => {
			const bp = bb.poles[0], bq = bb.poles[1];
			const g_int = 1 / R_bat, I_n = Vbat / R_bat;
			Iext += I_n - g_int * (fieldV[bp] - fieldV[bq]);
		});
		const Req = Iext > 1e-12 ? Vbat_total / Iext : Infinity;

		// Per-component span for the heatmap colour normalisation.
		let vmin = Infinity, vmax = -Infinity;
		for (const n of s.comp) { const vn = fieldV[n]; if (vn < vmin) vmin = vn; if (vn > vmax) vmax = vn; }

		let hasLoad = false;
		for (const n of s.comp) {
			if (fieldLampByIdx.has(n) || fieldPumpByIdx.has(n)) hasLoad = true;
			const vn = fieldV[n];
			voltages.set(n, vn);
			cellColor.set(n, voltageColor(vn, vmin, vmax));
			energized.add(n);
			if (nBatt > 0 && isFinite(Req)) {
				resPos.set(n, ((Vbat_total - vn) / Vbat_total) * Req);
				resNeg.set(n, (vn / Vbat_total) * Req);
			} else {
				resPos.set(n, 0); resNeg.set(n, 0);
			}
		}
		// Lamp voltage drop = difference between its two conductor neighbours.
		lamps.forEach(l => {
			if (netFind(l.idx) !== s.root) return;
			const list = s.Ga.get(l.idx);
			if (!list || list.length === 0) return;
			if (list.length >= 2) l.dV = fieldV[list[0][0]] - fieldV[list[1][0]];
			else l.dV = fieldV[list[0][0]] - fieldV[l.idx];
		});
		pumps.forEach(p => {
			if (!p.limited) return;
			if (netFind(p.idx) !== s.root) return;
			const list = s.Ga.get(p.idx);
			if (!list || list.length === 0) return;
			if (list.length >= 2) p.dV = Math.abs(fieldV[list[0][0]] - fieldV[list[1][0]]);
			else p.dV = Math.abs(fieldV[list[0][0]] - fieldV[p.idx]);
			p.lastPower = (p.dV * p.dV) / (p.R || 10.0);
		});
		if (!hasLoad && nBatt > 0) for (const n of s.comp) shorts.add(n);
	}

	// Per-edge current, Bz overlay, magnet force / EMF readouts, energy identity.
	const Ngrid = GRID_W * GRID_H;
	if (!fieldBz || fieldBz.length !== Ngrid) fieldBz = new Float64Array(Ngrid);
	else fieldBz.fill(0);
	const sig2 = SIGMA_B * SIGMA_B;
	const r2max = MAG_RMAX * MAG_RMAX;
	const live = new Set();
	for (const s of fieldSystems) for (let i = 0; i < s.comp.length; i++) live.add(s.comp[i]);
	for (let ei = 0; ei < fieldEdges.length; ei++) {
		const e = fieldEdges[ei];
		if (!live.has(e.a) || !live.has(e.b)) { e.I = 0; continue; }
		const Va = fieldV[e.a] || 0, Vb = fieldV[e.b] || 0;
		e.I = (Va - Vb + (e.E || 0)) / e.Re;
	}
	const mags = magnetList();
	for (let mi = 0; mi < mags.length; mi++) {
		const mag = mags[mi];
		const m = mag.magStrength != null ? mag.magStrength : 1;
		const c = bodyCenter(mag);
		const hat = bodyHat(mag);
		let Bz = 0, dBx = 0, dBy = 0, elecP = 0, maxI = 0, bridgeI = 0;
		for (let ei = 0; ei < fieldEdges.length; ei++) {
			const e = fieldEdges[ei];
			if (edgeIsSelf(e, mag)) {
				bridgeI = e.I;
				continue;
			}
			const rx = c.x - e.mx, ry = c.y - e.my;
			if (rx * rx + ry * ry > r2max) continue;
			const g = magKernelG(e.dlx, e.dly, rx, ry, sig2);
			const gr = magKernelGrad(e.dlx, e.dly, rx, ry, sig2);
			Bz += K_B * e.I * g;
			dBx += K_B * e.I * gr.gx;
			dBy += K_B * e.I * gr.gy;
			// E_e,b for this magnet (same kernel as force)
			const dgda = gr.gx * hat.ax + gr.gy * hat.ay;
			const Eb = -m * K_B * dgda * (mag.vel || 0);
			elecP += Eb * e.I;
			if (Math.abs(e.I) > Math.abs(maxI)) maxI = e.I;
		}
		const F = m * (dBx * hat.ax + dBy * hat.ay);
		mag.lastBz = Bz;
		mag.lastFcoil = F;
		mag.lastPower = elecP;
		mag.lastCurrent = isCaseA(mag) ? bridgeI : maxI;
		mag.lastEMF = mag.lastCurrent ? elecP / mag.lastCurrent : 0;
		const eta = mag.efficiency != null ? mag.efficiency : 0.85;
		mag.lastHeat = Math.abs(elecP) * Math.max(0, 1 - eta);
	}
	for (let i = 0; i < Ngrid; i++) {
		const cx = (i % GRID_W) + 0.5, cy = ((i / GRID_W) | 0) + 0.5;
		let Bz = 0;
		for (let ei = 0; ei < fieldEdges.length; ei++) {
			const e = fieldEdges[ei];
			const rx = cx - e.mx, ry = cy - e.my;
			if (rx * rx + ry * ry > r2max) continue;
			Bz += K_B * e.I * magKernelG(e.dlx, e.dly, rx, ry, sig2);
		}
		fieldBz[i] = Bz;
	}
	let residual = 0;
	for (let ei = 0; ei < fieldEdges.length; ei++) residual += fieldEdges[ei].E * fieldEdges[ei].I;
	for (let mi = 0; mi < mags.length; mi++) residual += (mags[mi].lastFcoil || 0) * (mags[mi].vel || 0);
	magEnergyResidual = residual;

	// The electric field is live, so heat tracks it every frame. Build the
	// shared per-cell R grid + Joule heat sources now; the unified tick's
	// heatRelax consumes them. (No render() here — simTick renders once.)
	computeHeatSource();
}

// ---- Joule heat source + diffusion (engine-agnostic) ----------------
// Build ONE per-cell resistance grid `heatR` (single source of truth for the
// electric medium: mirrors cellR/edgeR open-switch/pole handling) and the
// per-cell Joule power `heatSource`. Each undirected edge is counted exactly
// once (forward dirs only), and its full edge power P = dV²/Re is attributed
// to each endpoint by its share of the edge resistance => total power is
// conserved and a high-R lamp receives most of the heat.
function computeHeatSource() {
	const N = GRID_W * GRID_H;
	const lampByIdx = new Map(lamps.map(l => [l.idx, l]));        // from global `lamps`
	const pumpByIdx = new Map(pumps.map(p => [p.idx, p]));
	const switchOn = new Set(switches.filter(s => s.value).map(s => s.idx)); // closed only
	const wireCells = new Set();
	manualWires.forEach(w => w.cells.forEach(c => wireCells.add(c)));
	pathEdges.forEach(es => es.forEach(e => { const p = e.split(':'); wireCells.add(+p[0]); wireCells.add(+p[1]); }));
	manualBatteries.forEach(b => b.poles.forEach(p => wireCells.add(p))); // poles are conductors
	// The two poles of a battery are a 1×2 source: grid-adjacent but NOT
	// resistor-coupled (current flows out through the external circuit, not
	// straight across the EMF). Exclude that edge from the heat source, else
	// the full Vbat drop across it fakes enormous Joule power at the battery.
	const forbidden = new Set();
	manualBatteries.forEach(b => {
		const a = b.poles[0], c = b.poles[1];
		forbidden.add(Math.min(a, c) + ':' + Math.max(a, c));
	});
	for (let i = 0; i < N; i++) {
		let r;
		if (blocked[i]) r = Infinity;
		else if (lampByIdx.has(i)) { const l = lampByIdx.get(i); r = l.limited ? l.R : R_wire; }
		else if (pumpByIdx.has(i)) { const p = pumpByIdx.get(i); r = p.limited ? p.R : R_wire; }
		else if (switchOn.has(i)) r = R_switch;
		else if (caseABodyAt(i)) { const ba = caseABodyAt(i); r = (ba.R_arm != null ? ba.R_arm : 2) / 2; }
		else if (metalCells[i]) r = R_metal;
		else if (wireCells.has(i)) r = R_wire;
		else r = Infinity;
		heatR[i] = r;
	}
	heatSource.fill(0);
	for (let i = 0; i < N; i++) {
		if (!isFinite(heatR[i]) || !voltages.has(i)) continue;
		const cx = i % GRID_W, cy = (i / GRID_W) | 0;
		for (const [dx, dy] of [[1, 0], [0, 1]]) {            // forward dirs only => each edge ONCE
			const nx = cx + dx, ny = cy + dy; if (nx >= GRID_W || ny >= GRID_H) continue;
			const m = ny * GRID_W + nx;
			if (!isFinite(heatR[m]) || !voltages.has(m)) continue;
			const ek = Math.min(i, m) + ':' + Math.max(i, m);
			if (forbidden.has(ek)) continue;                 // skip the battery's own pole-to-pole edge
			const emf = (fieldEdgeMap.get(ek) && fieldEdgeMap.get(ek).E) || 0;
			const dV = voltages.get(i) - voltages.get(m) + emf;
			const Re = heatR[i] + heatR[m];
			const P = (dV * dV) / Re;                          // = I²·Re, full edge Joule power
			heatSource[i] += P * heatR[i] / Re;               // resistance-weighted attribution
			heatSource[m] += P * heatR[m] / Re;
		}
	}
	// GODMODE (self-powered) lamps also warm the air: 100% of their (electrical)
	// power becomes heat; power is the emitted light divided by luminous efficacy.
	// Scaled by HEAT_GAIN so a default lamp reaches a watchable ~5 K/s gradient.
	for (const l of lamps) if (!l.limited) heatSource[l.idx] += (l.lumen / LM_EFFICACY) * HEAT_GAIN;
	for (const p of pumps) if (p.lastHeat) heatSource[p.idx] += p.lastHeat;
	for (const b of pistons) {
		if (!b.lastHeat) continue;
		const cells = bodyCells(b);
		const share = b.lastHeat / Math.max(1, cells.length);
		for (let i = 0; i < cells.length; i++) heatSource[cells[i]] += share;
	}
}

// ---- Air pressure engine -------------------------------------------------
// isAir(), airRelax(), updateFlow(), and heatAirActive() now live in air.js.
// They operate on the air state (airU/airN/temp/pressure/velX/velY/…) declared
// in state.js and are invoked from simTick() below.

// Subsystem gating: each subsystem pauses independently.
function electricActive() {
	// Battery-only (NOT gated on wires/loads): a lone battery still has a valid
	// 2-pole field, and gating on a network would also skip fieldPublish and
	// starve heatSource. Magnets keep the loop alive so EMF/force update.
	return activeEngine === 'field' && (manualBatteries.length > 0 || magnetList().length > 0);
}

// Unified animation loop: relax the electric field (Field engine) and the air
// field every frame, render once, then pause when the user presses Pause or
// when the scene is fully idle (no electricity, no heat/air items). While any
// subsystem is active the loop runs continuously so the field keeps evolving.
let lastSimT = 0;
function simTick(now) {
	if (!simRunning) return;
	if (!lastSimT) lastSimT = now;
	const realDt = Math.min(0.05, (now - lastSimT) / 1000);
	lastSimT = now;
	const dt = (realDt * TIME_SCALE) / HEAT_SWEEPS_PER_FRAME;  // s per air sub-step
	if (electricActive()) {
		if (magnetList().length) fieldSimulate(); // rebuild edges/EMF/Case-A cells
		fieldRelax(FIELD_SWEEPS_PER_FRAME);
		fieldPublish();   // also refreshes heatSource every frame
	} else if (heatAirActive()) {
		// With the electric engine gated off, fieldPublish never runs, so its
		// heatSource (lamp heat) would go stale. Recompute it here — it is
		// engine-agnostic, cheap O(N), and reads only `voltages`/lamps.
		computeHeatSource();
	}
	let airD = 0;
	if (heatAirActive()) {
		airD = airRelax(HEAT_SWEEPS_PER_FRAME, dt);
		updateFlow(dt * HEAT_SWEEPS_PER_FRAME);
	}
	render();
	if (userPaused) { simRunning = false; return; }
	// Idle auto-pause: only when NOTHING is active (electric OR heat/air). This
	// keeps lamps and Air Source/Sink flowing forever until the user pauses.
	if (!electricActive() && !heatAirActive()) { simRunning = false; lastSimT = 0; return; }
	fieldDirty = false; heatDirty = false;
	requestAnimationFrame(simTick);
}
function startSimLoop() {
	if (userPaused) return;
	if (simRunning) return;
	simRunning = true; fieldDirty = true; heatDirty = true;
	requestAnimationFrame(simTick);
}

// Root of the connected network a cell belongs to (a cell outside the
// conductive graph is its own isolated network).
function netFind(x) {
	if (!netParent.has(x)) return x;
	let r = x;
	while (netParent.get(r) !== r) r = netParent.get(r);
	while (netParent.get(x) !== r) { const n = netParent.get(x); netParent.set(x, r); x = n; }
	return r;
}

// Engine dispatcher: run the active engine. Both engines populate the
// shared result maps (cellColor, voltages, energized, shorts, resPos/Neg)
// so recompute() and every bus listener keep working unchanged.
// NOTE: 'circuit' is the obsolete path — see comment above circuitSimulate.
function simulate() {
	// Global legacy normalization: a loaded pre-feature save has no R yet,
	// which would otherwise produce NaN resistance in edgeR/computeHeatSource.
	for (const l of lamps) if (l.R == null) l.R = R_lamp;
	for (const p of pumps) if (p.R == null) p.R = 10.0;
	if (activeEngine === 'circuit') {
		simRunning = false;  // stop the unified (field + heat) loop
		fieldSystems = [];   // drop stale Field state when switching engines
		circuitSimulate();
	} else {
		fieldSimulate();
	}
}

// Recompute colors and refresh the view. Subscribed to every topology
// event so the editor stays consistent without callers knowing details.
function recompute() {
	simulate();
	rebuildCellUsage(); // keep lane offsets in sync with manual wires
	render();           // one-time immediate feedback
	renderInventory();
	startSimLoop();     // continuously relax field + heat, then auto-pause
}

bus.on('wire:placed', recompute);
bus.on('wire:cut', recompute);
bus.on('battery:placed', recompute);
bus.on('obstacle:changed', recompute);
bus.on('component:removed', recompute);
bus.on('lamp:placed', recompute);
bus.on('switch:placed', recompute);
bus.on('heatsink:placed', recompute);
bus.on('air:changed', recompute);
bus.on('metal:changed', recompute);
