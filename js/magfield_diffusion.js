// Visual-relaxation magnetic diffusion engine.
//
// Selected when magEngine === 'diffusion' in js/state.js. Unlike 'tapered'
// (steady-state analytic, warm-started) and 'hy3' (screened-Poisson, warm-
// started), this engine advances a *transient* heat-equation update each
// frame:
//
//     Bz ← Bz + α · (Bx⁺ + Bx⁻ + By⁺ + By⁻ − 4·Bz) + S
//
// where S is the discrete curl of the edge currents (same sign convention
// as Hy3's magBzPoissonHy3BuildSource, so magnet telemetry lastFcoil keeps
// the same sign across engine switches). α is user-tunable via
// MAG_DIFFUSION_ALPHA (slider range [0.02, 0.24]; CFL stability requires
// 4·α ≤ 1, and α=0.25 is exactly marginal — the amplification factor at
// the Nyquist mode is g = 1−8α = −1, a neutrally-stable checkerboard
// that never damps. The slider cap of 0.24 gives g = −0.92). The field
// actually spreads cell-to-cell over successive iterations: higher α
// diffuses current to neighbours faster per sweep, so the peak decays
// faster. No back-EMF injection in this plan.
//
// Boundary treatment: cells on the grid edge and `blocked` cells are
// pinned to zero, and blocked neighbours contribute 0 to the sum. This
// is a zero-value Dirichlet boundary (not a no-flux / Neumann condition,
// which would require mirroring the cell's own value). Strict Dirichlet
// on an irregular boundary would also need a per-cell correction to the
// stencil weights (fewer valid neighbours ⇒ smaller Laplacian); here we
// keep the weights uniform for simplicity, which slightly over-damps
// near walls.
//
// Globals relied on (state.js / electric.js / maze.js): GRID_W, GRID_H,
// K_B, MAG_DIFFUSION_ALPHA, blocked, fieldBz, fieldEdges, magnetList,
// bodyCenter, bodyRect, bodyHat, bodyCells, edgeIsSelf, isCaseA.

let fieldBzDiff = null;        // Float64Array(N): the engine's Bz
let fieldBzDiffScratch = null; // Float64Array(N): swap buffer for the Euler step
let magSrcDiff = null;         // Float64Array(N): discrete curl of J

function magDiffusionReset() {
	if (fieldBzDiff) fieldBzDiff.fill(0);
	if (fieldBzDiffScratch) fieldBzDiffScratch.fill(0);
	if (magSrcDiff) magSrcDiff.fill(0);
	if (fieldBz) fieldBz.fill(0);
}

function magDiffusionBuildSource() {
	const N = GRID_W * GRID_H, W = GRID_W, H = GRID_H;
	if (!magSrcDiff || magSrcDiff.length !== N) magSrcDiff = new Float64Array(N);
	magSrcDiff.fill(0);

	const mags = magnetList();
	for (let ei = 0; ei < fieldEdges.length; ei++) {
		const e = fieldEdges[ei];
		const I = e.I || 0;
		if (!I) continue;
		let self = false;
		for (let mi = 0; mi < mags.length; mi++) {
			if (edgeIsSelf(e, mags[mi])) { self = true; break; }
		}
		if (self) continue;

		const a = e.a, b = e.b;
		const ax = a % W, ay = (a / W) | 0;
		const bx = b % W, by = (b / W) | 0;
		// Signed incidence of edge current onto endpoint cells. Stokes: this
		// scalar-valued operator on the edges is the discrete curl of J; A is
		// the + endpoint, B is the −. The assignment is identical for
		// horizontal and vertical edges (the orientation only labels which face
		// of the cell carries it).
		magSrcDiff[ay * W + ax] += I;
		magSrcDiff[by * W + bx] -= I;
	}

	for (let i = 0; i < N; i++) magSrcDiff[i] *= K_B;
}

function magDiffusionRelax(sweeps) {
	// Local-clamp the alpha so a hot slider value doesn't silently rewrite
	// the user's MAG_DIFFUSION_ALPHA setting (the previous version assigned
	// back into the global and desynced the slider readout).
	const alpha = MAG_DIFFUSION_ALPHA > 0.24
		? (console.warn('MAG_DIFFUSION_ALPHA=' + MAG_DIFFUSION_ALPHA + ' exceeds the safe CFL cap (0.24); clamping locally'),
		   0.24)
		: MAG_DIFFUSION_ALPHA;
	const N = GRID_W * GRID_H, W = GRID_W, H = GRID_H;
	if (!fieldBzDiff || fieldBzDiff.length !== N) fieldBzDiff = new Float64Array(N);
	if (!fieldBzDiffScratch || fieldBzDiffScratch.length !== N) fieldBzDiffScratch = new Float64Array(N);
	for (let it = 0; it < sweeps; it++) {
		for (let i = 0; i < N; i++) {
			const cx = i % W, cy = (i / W) | 0;
			if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) { fieldBzDiffScratch[i] = 0; continue; }
			if (blocked[i]) { fieldBzDiffScratch[i] = 0; continue; }
			const bz = fieldBzDiff[i];
			let sum = 0;
			if (!blocked[i - 1]) sum += fieldBzDiff[i - 1];
			if (!blocked[i + 1]) sum += fieldBzDiff[i + 1];
			if (!blocked[i - W]) sum += fieldBzDiff[i - W];
			if (!blocked[i + W]) sum += fieldBzDiff[i + W];
			const nv = bz + alpha * (sum - 4 * bz) + magSrcDiff[i];
			fieldBzDiffScratch[i] = isFinite(nv) ? nv : 0;
		}
		const tmp = fieldBzDiff;
		fieldBzDiff = fieldBzDiffScratch;
		fieldBzDiffScratch = tmp;
	}
}

function magDiffusionPublish(mags) {
	const N = GRID_W * GRID_H, W = GRID_W, H = GRID_H;
	if (!fieldBz || fieldBz.length !== N) fieldBz = new Float64Array(N);
	for (let i = 0; i < N; i++) fieldBz[i] = fieldBzDiff ? fieldBzDiff[i] : 0;

	const bzAt = (cx, cy) => {
		if (cx < 0 || cx >= W || cy < 0 || cy >= H) return 0;
		return fieldBz[cy * W + cx];
	};

	for (let mi = 0; mi < mags.length; mi++) {
		const mag = mags[mi];
		const m = mag.magStrength != null ? mag.magStrength : 1;
		const hat = bodyHat(mag);
		const c = bodyCenter(mag);
		const mcx = Math.round(c.x), mcy = Math.round(c.y);
		const dBzdx = (bzAt(mcx + 1, mcy) - bzAt(mcx - 1, mcy)) * 0.5;
		const dBzdy = (bzAt(mcx, mcy + 1) - bzAt(mcx, mcy - 1)) * 0.5;
		const Bz = bzAt(mcx, mcy);
		const F = m * (dBzdx * hat.ax + dBzdy * hat.ay);
		let maxI = 0, bridgeI = 0;
		for (let ei = 0; ei < fieldEdges.length; ei++) {
			const e = fieldEdges[ei];
			if (edgeIsSelf(e, mag)) { bridgeI = e.I; continue; }
			if (Math.abs(e.I) > Math.abs(maxI)) maxI = e.I;
		}
		const dBzdh = dBzdx * hat.ax + dBzdy * hat.ay;
		const Eb = -m * dBzdh * (mag.vel || 0);
		const lastCurrent = isCaseA(mag) ? bridgeI : maxI;
		const elecP = Eb * lastCurrent;
		mag.lastBz = Bz;
		mag.lastFcoil = F;
		mag.lastPower = elecP;
		mag.lastCurrent = lastCurrent;
		mag.lastEMF = lastCurrent ? elecP / lastCurrent : 0;
		const eta = mag.efficiency != null ? mag.efficiency : 0.85;
		mag.lastHeat = Math.abs(elecP) * Math.max(0, 1 - eta);
	}
}
