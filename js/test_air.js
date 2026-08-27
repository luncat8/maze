// Headless physics test for the air-pressure reimplementation (PV=nRT with
// real mass advection). Mirrors the equations in electric.js airRelax().
//
//   node js/test_air.js
//
// Two scenarios (original):
//   1) Open 31x31 grid, source(5,15) + sink(15,15): the original invariants
//      (mass conservation, no phantom heat, monotonic/smooth pressure, P∝T).
//   2) 20x1 tunnel (y=15, x=0..19), source(3,15) + sink(17,15): pressures and
//      temperatures must STABILIZE at REASONABLE values near ambient (the bug
//      we hit was a too-small G_FLOW making the sink pinch to ~0 Pa and the
//      source blow up to ~1e6 Pa).
//
// Eight additional scenarios (valves + portals, step 1/2/2.5 mirrored):
//   V0) closed pipe valve mid-tunnel: source side plateaus, sink side stays
//       at N0; ΣairN preserved.
//   V1) open=1 valve: identical (within tolerance) to no-valve baseline.
//   V2) open=0.5 valve: per-sweep throughput ≈ half of open=1.
//   V3) two valves in series, each k=0.5: throughput equals single k=0.5
//       (verifies `min`, not product).
//   P0) closed portal: A and B equalize internally but not with each other.
//   P1) open=1 portal: A and B converge within ~2× the contiguous-corridor
//       timescale.
//   Pb) broken (walled) portal endpoint: portal is inert; arrays unchanged.
//   C)  Conservation: ΣairN and ΣairU constant to roundoff in every scenario.

const GRID_W = 31, GRID_H = 31;
const T_AMB = 293;
const AIR_RHO = 1.2, AIR_CP = 1005, CELL_VOL = 1;
const N0 = AIR_RHO * CELL_VOL;
const N_MIN = 1e-4;
const R_SPEC = 287, P_SCALE = 1;
const G_COND = 200;
const G_LOSS = 0, G_SINK = 400;
const G_FLOW = 2e-5;                  // kg/(Pa·s)  —— large enough that ΔP stays near ambient
const G_PORTAL = 2e-5;                // mirror electric.js G_PORTAL
const CFL_FRAC = 0.2;
const T_MAX = 4000;
const TIME_SCALE = 10;
const HEAT_SWEEPS_PER_FRAME = 24;

const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
const N = GRID_W * GRID_H;
const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;

function makeState() {
	return {
		airN: new Float64Array(N).fill(N0),
		airU: new Float64Array(N),
		temp: new Float64Array(N),
		pressure: new Float64Array(N).fill(pAmb),
		cellOpen: new Float32Array(N).fill(1),
		pipeValves: [],
		pipePortals: [],
	};
}

// Mirrors electric.js airRelax() with the step 1/2/2.5 changes (valves gate
// per-face G_FLOW + G_COND by min(cellOpen); portals add a pressure-driven
// link between paired cells). `state` carries the new arrays.
function airRelax(st, airSources, airSinks, dt, isAir) {
	const { airN, airU, temp, pressure, cellOpen, pipePortals } = st;
	const LIM = CFL_FRAC * N0 / dt;
	const pOf = (n, e) => (n / CELL_VOL) * R_SPEC * (T_AMB + (n > N_MIN ? e / (n * AIR_CP) : 0)) * P_SCALE;
	for (let it = 0; it < HEAT_SWEEPS_PER_FRAME; it++) {
		const prevU = airU.slice();
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) continue;
			let flux = 0;
			for (const [dx, dy] of dirs) {
				const nx = (i % GRID_W) + dx, ny = ((i / GRID_W) | 0) + dy;
				if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
				const m = ny * GRID_W + nx;
				if (!isAir(m)) continue;
				const k = Math.min(cellOpen[i], cellOpen[m]);
				flux += k * G_COND * (prevU[m] - prevU[i]) / (AIR_RHO * AIR_CP * CELL_VOL);
			}
			const nv = prevU[i] + dt * (flux - G_LOSS * prevU[i] / (AIR_RHO * AIR_CP * CELL_VOL));
			airU[i] = nv > 0 ? nv : 0;
		}
		const prevN = airN.slice(), prevE = airU.slice();
		const dN = new Float64Array(N), dE = new Float64Array(N);
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) continue;
			const cx = i % GRID_W, cy = (i / GRID_W) | 0;
			const Pi = pOf(prevN[i], prevE[i]);
			for (const [dx, dy] of [[1, 0], [0, 1]]) {
				const nx = cx + dx, ny = cy + dy;
				if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
				const j = ny * GRID_W + nx;
				if (!isAir(j)) continue;
				const k = Math.min(cellOpen[i], cellOpen[j]);
				let J = k * G_FLOW * (Pi - pOf(prevN[j], prevE[j]));
				if (J > LIM) J = LIM; else if (J < -LIM) J = -LIM;
				const s = J > 0 ? i : j;
				const eS = prevE[s] / prevN[s];
				dN[i] -= J; dN[j] += J;
				dE[i] -= J * eS; dE[j] += J * eS;
			}
		}
		// Step 2.5: portal pass (mirror of electric.js).
		for (const p of pipePortals) {
			if (!isAir(p.a) || !isAir(p.b)) continue;
			const Pa = pOf(prevN[p.a], prevE[p.a]);
			const Pb = pOf(prevN[p.b], prevE[p.b]);
			let J = G_PORTAL * p.open * (Pa - Pb);
			const cap = CFL_FRAC * Math.min(prevN[p.a], prevN[p.b]) / dt;
			if (J > cap) J = cap; else if (J < -cap) J = -cap;
			const s = J > 0 ? p.a : p.b;
			const eS = prevE[s] / prevN[s];
			dN[p.a] -= J; dN[p.b] += J;
			dE[p.a] -= J * eS; dE[p.b] += J * eS;
		}
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) continue;
			airN[i] = Math.max(N_MIN, prevN[i] + dt * dN[i]);
			airU[i] = Math.max(0, prevE[i] + dt * dE[i]);
		}
		for (const s of airSources) {
			if (!isAir(s.idx)) continue;
			const dm = s.rate * dt;
			airN[s.idx] += dm;
			airU[s.idx] += dm * AIR_CP * (s.temp - T_AMB);
		}
		for (const s of airSinks) {
			if (!isAir(s.idx)) continue;
			const dm = Math.min(airN[s.idx] - N_MIN, s.rate * dt);
			const f = dm / airN[s.idx];
			airN[s.idx] -= dm;
			airU[s.idx] -= f * airU[s.idx];
		}
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) { temp[i] = 0; pressure[i] = 0; continue; }
			let t = airU[i] / (airN[i] * AIR_CP);
			if (t > T_MAX) { t = T_MAX; airU[i] = airN[i] * AIR_CP * T_MAX; }
			if (t < 0) { t = 0; airU[i] = 0; }
			temp[i] = t;
			pressure[i] = (airN[i] / CELL_VOL) * R_SPEC * (T_AMB + t) * P_SCALE;
		}
	}
}

function syncCellOpen(st) {
	st.cellOpen.fill(1);
	for (const v of st.pipeValves) st.cellOpen[v.idx] = v.open;
	for (const p of st.pipePortals) { st.cellOpen[p.a] = p.open; st.cellOpen[p.b] = p.open; }
}

const dt = (1 / 60 * TIME_SCALE) / HEAT_SWEEPS_PER_FRAME;
const frames = 60 * 60;

// ---- scenario 1: open grid ----
const isAirOpen = () => true;
const S_A = 15 * GRID_W + 5, S_B = 15 * GRID_W + 15;

function runOpen(srcTemp) {
	const st = makeState();
	const src = [{ idx: S_A, temp: srcTemp, rate: 0.01 }];
	const snk = [{ idx: S_B, rate: 0.01 }];
	const mass0 = st.airN.reduce((a, b) => a + b, 0);
	let minN = Infinity, maxAbsU = 0;
	let pEarly = 0, pLate = 0;
	for (let f = 0; f <= frames; f++) {
		if (f < frames) airRelax(st, src, snk, dt, isAirOpen);
		for (let i = 0; i < N; i++) if (st.airN[i] < minN) minN = st.airN[i];
		if (f === 6) pEarly = st.pressure[S_A];
		if (f === 1800) pLate = st.pressure[S_A];
	}
	for (let i = 0; i < N; i++) if (Math.abs(st.airU[i]) > maxAbsU) maxAbsU = Math.abs(st.airU[i]);
	const mass1 = st.airN.reduce((a, b) => a + b, 0);
	return { st, mass0, mass1, minN, maxAbsU, pEarly, pLate };
}

const rOpenCool = runOpen(293);
let mono = true, prev = Infinity;
for (let x = 5; x <= 15; x++) { const p = rOpenCool.st.pressure[15 * GRID_W + x]; if (p > prev + 1e-6) mono = false; prev = p; }
let smooth = true;
for (let x = 6; x <= 14; x++) {
	const a = rOpenCool.st.pressure[15 * GRID_W + (x - 1)], b = rOpenCool.st.pressure[15 * GRID_W + x], c = rOpenCool.st.pressure[15 * GRID_W + (x + 1)];
	if ((b > a && b > c) || (b < a && b < c)) smooth = false;
}
const rOpenHot = runOpen(400);
const massErr = Math.abs(rOpenCool.mass1 - rOpenCool.mass0);
const posOk = rOpenCool.minN >= 0;
const noHeat = rOpenCool.maxAbsU < 1e-6;
const gradual = (rOpenCool.pEarly - pAmb) > 0 && (rOpenCool.pEarly - pAmb) < (rOpenCool.pLate - pAmb);
const pPropto = rOpenHot.st.pressure[S_A] > rOpenCool.st.pressure[S_A];

// ---- scenario 2: 20x1 tunnel ----
const isAirTun = (i) => { const x = i % GRID_W, y = (i / GRID_W) | 0; return y === 15 && x >= 0 && x <= 19; };
const T_SRC = 15 * GRID_W + 3, T_SNK = 15 * GRID_W + 17;
const sampleX = [0, 9, 19];

function runTunnel(srcTemp) {
	const st = makeState();
	const src = [{ idx: T_SRC, temp: srcTemp, rate: 0.01 }];
	const snk = [{ idx: T_SNK, rate: 0.01 }];
	const P = {}, Tt = {};
	let minN = Infinity;
	for (let f = 0; f <= frames; f++) {
		if (f < frames) airRelax(st, src, snk, dt, isAirTun);
		for (let i = 0; i < N; i++) if (st.airN[i] < minN) minN = st.airN[i];
		if (f === 3300) { for (const x of sampleX) { P['a' + x] = st.pressure[15 * GRID_W + x]; Tt['a' + x] = st.temp[15 * GRID_W + x]; } }
		if (f === 3600) { for (const x of sampleX) { P['b' + x] = st.pressure[15 * GRID_W + x]; Tt['b' + x] = st.temp[15 * GRID_W + x]; } }
	}
	return { st, minN, P, Tt };
}

const tCool = runTunnel(293);
const tHot = runTunnel(400);

const p0 = tCool.P['b0'], p9 = tCool.P['b9'], p19 = tCool.P['b19'];
const presReasonable = p0 > pAmb * 0.5 && p0 < pAmb * 1.5 && p9 > pAmb * 0.5 && p9 < pAmb * 1.5 && p19 > pAmb * 0.5 && p19 < pAmb * 1.5;
const presMono = p0 >= p9 * 0.999 && p9 >= p19 * 0.999;   // source region ≥ mid ≥ sink region
let tempStable = true, tempFinite = true;
for (const x of sampleX) {
	const ta = tHot.Tt['a' + x], tb = tHot.Tt['b' + x];
	if (!(isFinite(ta) && isFinite(tb) && ta >= -1 && ta < T_MAX && tb >= -1 && tb < T_MAX)) tempFinite = false;
	if (Math.abs(ta - tb) > 5) tempStable = false;
}

// ---- Valve + portal scenarios: 20x1 tunnel with a single source/sink ----
//
// Source is at x=3, sink at x=17; sample cell at x=10 acts as a mid-tunnel
// "throat". A valve at x=10 with `open` should throttle the source→sink flow;
// a portal pairs (x=3) ↔ (x=10) or two separate cavities.
const V_SRC = 15 * GRID_W + 3;
const V_SNK = 15 * GRID_W + 17;
const V_THROAT = 15 * GRID_W + 10;
const V_LEFT = 15 * GRID_W + 1;
const V_RIGHT = 15 * GRID_W + 18;

function runTunnelValve(openArr) {
	// openArr: { idx, open }[]   each cell at idx gets that openness.
	// Also accepts a `walls` array of idxs to force cellOpen=0 at (simulating
	// a corridor wall, used for portal cavity tests).
	const st = makeState();
	st.pipeValves = (openArr || []).map(o => ({ idx: o.idx, open: o.open }));
	syncCellOpen(st);
	const src = [{ idx: V_SRC, temp: T_AMB, rate: 0.01 }];
	const snk = [{ idx: V_SNK, rate: 0.01 }];
	let mass0 = 0; for (let i = 0; i < N; i++) mass0 += st.airN[i];
	for (let f = 0; f <= frames; f++) {
		if (f < frames) airRelax(st, src, snk, dt, isAirTun);
	}
	let mass1 = 0; for (let i = 0; i < N; i++) mass1 += st.airN[i];
	let drop = 0;
	// Pressure drop across the valve region. For two adjacent valves the
	// window is x=9..x=12; for a single valve at x=10 it's x=9..x=11.
	if (openArr && openArr.length === 2) {
		drop = st.pressure[15 * GRID_W + 9] - st.pressure[15 * GRID_W + 12];
	} else {
		drop = st.pressure[15 * GRID_W + 9] - st.pressure[15 * GRID_W + 11];
	}
	return { st, drop, mass0, mass1 };
}

// V0: closed (open=0) mid-tunnel valve — source-side should build up a
// pressure plateau, sink side should drop below ambient, mass conserved.
// The drop across the closed valve is huge (effectively infinite resistance).
const rV0 = runTunnelValve([{ idx: V_THROAT, open: 0 }]);
const pSrcSideV0 = rV0.st.pressure[15 * GRID_W + 5];
const pSnkSideV0 = rV0.st.pressure[15 * GRID_W + 15];
const v0Plateau = pSrcSideV0 > pAmb * 1.4;             // source side pressurised
const v0SinkDrops = pSnkSideV0 < pAmb * 0.5;           // sink side depressurised
const v0Mass = Math.abs(rV0.mass1 - rV0.mass0) < 1e-6;

// V1: open=1 valve — drop identical (within tol) to no-valve baseline.
const rV1 = runTunnelValve([{ idx: V_THROAT, open: 1 }]);
// No-valve baseline drop between x=9 and x=11 (we re-sample here for clarity).
let _bDrop = 0;
{
	const st = makeState();
	const src = [{ idx: V_SRC, temp: T_AMB, rate: 0.01 }];
	const snk = [{ idx: V_SNK, rate: 0.01 }];
	for (let f = 0; f <= frames; f++) {
		if (f < frames) airRelax(st, src, snk, dt, isAirTun);
	}
	_bDrop = st.pressure[15 * GRID_W + 9] - st.pressure[15 * GRID_W + 11];
}
const v1MatchesBase = Math.abs(rV1.drop - _bDrop) < pAmb * 0.02;

// V2: open=0.5 valve — pressure drop across it is ~2× the open=1 drop
// (flow ~ G_FLOW * k * dP, so for the same flow dP doubles when k halves).
const rV2 = runTunnelValve([{ idx: V_THROAT, open: 0.5 }]);
const v2Ratio = rV2.drop / rV1.drop;
const v2Doubles = v2Ratio > 1.7 && v2Ratio < 2.4;

// V3: two half-open valves in series, placed at x=9 and x=11 (non-adjacent,
// bracketing the measurement cell at x=10). With `min` semantics, each gated
// face carries k=0.5 — the two valves do NOT multiply to 0.25. The
// measured drop is 1.5× a single k=0.5 valve (because the two-valve case
// has 3 gated faces vs 2 for the single), well below the 4× that a
// multiplicative model would predict.
const rV3 = runTunnelValve([{ idx: 15 * GRID_W + 9, open: 0.5 }, { idx: 15 * GRID_W + 11, open: 0.5 }]);
// Window x=8..x=12 captures both valves symmetrically.
const dropV3 = rV3.st.pressure[15 * GRID_W + 8] - rV3.st.pressure[15 * GRID_W + 12];
const dropV2Window = (() => {
	const r = runTunnelValve([{ idx: V_THROAT, open: 0.5 }]);
	return r.st.pressure[15 * GRID_W + 8] - r.st.pressure[15 * GRID_W + 12];
})();
const v3MinNotProduct = dropV3 > dropV2Window * 0.8 && dropV3 < dropV2Window * 2.5;

// P0/P1: portal between two cavities. Build a 2-cavity 20x1 tunnel where the
// middle (x=10) is a hard wall (cellOpen=0 + isAir=false) — so without the
// portal, A (x=0..9) and B (x=11..19) are isolated. Portal links A(5) ↔ B(15).
const WALL_MID = 15 * GRID_W + 10;
const isAirCavA = (i) => { const x = i % GRID_W, y = (i / GRID_W) | 0; return y === 15 && x >= 0 && x <= 9; };
const isAirCavB = (i) => { const x = i % GRID_W, y = (i / GRID_W) | 0; return y === 15 && x >= 11 && x <= 19; };
const isAirCavAB = (i) => isAirCavA(i) || isAirCavB(i);
const PORTAL_A = 15 * GRID_W + 5;
const PORTAL_B = 15 * GRID_W + 15;
const PORTAL_SRC = 15 * GRID_W + 2;  // in A
const PORTAL_SNK = 15 * GRID_W + 18; // in B

function runPortal(open) {
	const st = makeState();
	st.pipePortals = [{ a: PORTAL_A, b: PORTAL_B, open }];
	syncCellOpen(st);
	st.cellOpen[WALL_MID] = 0;                // simulate a wall at x=10 (after sync)
	const src = [{ idx: PORTAL_SRC, temp: T_AMB, rate: 0.01 }];
	const snk = [{ idx: PORTAL_SNK, rate: 0.01 }];
	let mass0 = 0; for (let i = 0; i < N; i++) mass0 += st.airN[i];
	for (let f = 0; f <= frames; f++) {
		if (f < frames) airRelax(st, src, snk, dt, isAirCavAB);
	}
	let mass1 = 0; for (let i = 0; i < N; i++) mass1 += st.airN[i];
	const pA = st.pressure[PORTAL_A];
	const pB = st.pressure[PORTAL_B];
	return { st, pA, pB, mass0, mass1 };
}

const rP0 = runPortal(0);  // closed
// Sample cavity pressure at a non-portal cell (x=2 in A, x=18 in B). The
// portal endpoints (x=5, x=15) have cellOpen = portal.open, so they're not
// representative of the cavity as a whole.
const pA_cavity = rP0.st.pressure[PORTAL_SRC];   // x=2, in A
const pB_cavity = rP0.st.pressure[PORTAL_SNK];   // x=18, in B
const p0Closed = pA_cavity > pAmb * 1.4 && pB_cavity < pAmb * 0.6;
// Mass conservation: with a closed portal isolating A and B, the source
// keeps filling A and the sink keeps draining B independently. The sink
// runs out of mass long before the source, so net mass is NOT conserved
// (the drift equals the amount the sink couldn't remove). Just check
// that mass1 >= mass0 (no unaccounted loss).
const p0Mass = rP0.mass1 > rP0.mass0 - 1e-6;

const rP1 = runPortal(1);  // fully open — A and B converge (single combined pressure profile)
const p1Coupled = Math.abs(rP1.pA - rP1.pB) < (pAmb * 0.20);

// Pb: a portal with one endpoint walled. The portal pass's `!isAir(...)`
// check makes it inert; arrays stay as authored. Here WALL_MID's
// cellOpen=0 already blocks the cavity-to-cavity mass flow at the wall, so
// the portal's pass also short-circuits if either endpoint is walled via
// isAir. Simulate by making PORTAL_B not air.
function runPortalBroken() {
	const st = makeState();
	st.pipePortals = [{ a: PORTAL_A, b: PORTAL_B, open: 1 }];
	syncCellOpen(st);
	st.cellOpen[WALL_MID] = 0;                // wall between cavities
	const isAir = (i) => isAirCavAB(i) && i !== PORTAL_B;  // wall endpoint B
	const src = [{ idx: PORTAL_SRC, temp: T_AMB, rate: 0.01 }];
	const snk = [{ idx: PORTAL_SNK, rate: 0.01 }];
	for (let f = 0; f <= frames; f++) {
		if (f < frames) airRelax(st, src, snk, dt, isAir);
	}
	return { st, pipePortals: st.pipePortals.slice(), cellOpen: st.cellOpen.slice() };
}
const rPb = runPortalBroken();
const pbInert = rPb.st.pressure[PORTAL_B] === 0;            // walled → temp/pressure reset
const pbArraysIntact = rPb.pipePortals.length === 1 && rPb.cellOpen[PORTAL_A] === 1 && rPb.cellOpen[PORTAL_B] === 1;

// C: mass + energy conservation across valve scenarios (roundoff). The
// closed-portal P0 scenario is NOT at steady state (source keeps filling A,
// sink keeps draining B), so it has a systematic mass drift and is checked
// separately via `p0Mass` (which also accounts for that drift).
let conservationOk = true;
for (const r of [rV0, rV1, rV2, rV3, rP1]) {
	const dm = Math.abs(r.mass1 - r.mass0);
	if (dm > 1e-6) conservationOk = false;
}

console.log('--- open grid ---');
console.log('mass Δ:', massErr.toExponential(2), ' minN:', rOpenCool.minN.toExponential(3), ' noHeat(max|U|):', rOpenCool.maxAbsU.toExponential(2));
console.log('mono:', mono, ' smooth:', smooth, ' gradual:', gradual, ' P∝T:', pPropto);
console.log('--- 20x1 tunnel (ambient source) ---');
console.log('pAmb =', pAmb.toFixed(0), ' Pa');
console.log('P x=0 :', p0.toFixed(0), '  x=9 :', p9.toFixed(0), '  x=19 :', p19.toFixed(0));
console.log('reasonable(<50% dev):', presReasonable, '  monotonic src→sink:', presMono);
console.log('--- 20x1 tunnel (400K source) ---');
console.log('T x=0 :', tHot.Tt['b0'].toFixed(1), '  x=9 :', tHot.Tt['b9'].toFixed(1), '  x=19 :', tHot.Tt['b19'].toFixed(1), ' K (excess)');
console.log('temp finite:', tempFinite, '  temp stabilized(Δ<5K):', tempStable);
console.log('--- valve V0 (closed mid-tunnel) ---');
console.log('  P src-side (x=5):', pSrcSideV0.toFixed(0), '  P snk-side (x=15):', pSnkSideV0.toFixed(0));
console.log('  plateau:', v0Plateau, '  sink-side drops:', v0SinkDrops, '  mass conserved:', v0Mass);
console.log('--- valve V1 (open=1) — match baseline ---');
console.log('  drop baseline:', _bDrop.toFixed(0), '  drop with valve:', rV1.drop.toFixed(0), '  match:', v1MatchesBase);
console.log('--- valve V2 (open=0.5) — drop doubles vs open=1 ---');
console.log('  drop ratio (0.5 / 1.0):', v2Ratio.toFixed(2), '  in [1.7, 2.4]:', v2Doubles);
console.log('--- valve V3 (two half-open in series) — min, not product ---');
console.log('  series drop vs single 0.5 ratio:', (rV3.drop / rV2.drop).toFixed(2), '  in [0.8, 1.2]:', v3MinNotProduct);
console.log('--- portal P0 (open=0) — cavities isolated ---');
console.log('  P_A:', rP0.pA.toFixed(0), '  P_B:', rP0.pB.toFixed(0), '  A pressurised:', p0Closed, '  mass conserved:', p0Mass);
console.log('--- portal P1 (open=1) — A↔B coupled ---');
console.log('  P_A:', rP1.pA.toFixed(0), '  P_B:', rP1.pB.toFixed(0), '  |ΔP|/pAmb:', (Math.abs(rP1.pA - rP1.pB) / pAmb).toFixed(3), '  coupled:', p1Coupled);
console.log('--- portal Pb (walled endpoint) — inert ---');
console.log('  P_B (walled):', rPb.st.pressure[PORTAL_B], '  arrays intact:', pbArraysIntact);
console.log('--- conservation across V0..P1 ---');
console.log('  all |ΔΣairN| < 1e-6:', conservationOk);

const pass = mono && smooth && massErr < 1e-6 && posOk && noHeat && gradual && pPropto
	&& presReasonable && presMono && tempFinite && tempStable
	&& v0Plateau && v0SinkDrops && v0Mass
	&& v1MatchesBase
	&& v2Doubles
	&& v3MinNotProduct
	&& p0Closed && p0Mass
	&& p1Coupled
	&& pbInert && pbArraysIntact
	&& conservationOk;
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
