// Hy3 screened-Poisson magnetic-field solver.
//
// Selected when magEngine === 'hy3' in js/state.js. Replaces the per-frame
// Biot–Savart summation (still selectable via magEngine === 'direct') with a
// LIVING screened-Poisson solve, exactly like the electric potential:
//
//     (∇² − λ²) Bz = S
//
// where the source S is the discrete curl of the current density J (so the
// field is the 2-D "magnetic" potential of the wire currents), relaxed by
// red-black Gauss–Seidel and WARM-STARTED across frames. There is no hard
// MAG_RMAX cutoff, so the range is one tunable parameter (λ) and the field is
// smooth with no flicker. When MAG_DIPOLES is on, magnets also inject their
// intrinsic dipole as two opposite point sources offset just OUTSIDE the body,
// so they interact with each other and with the wire field automatically.
//
// Self-force note: a dipole represented as two point sources has a non-zero
// on-axis gradient at its own centre, so a magnet would spuriously feel its
// OWN field. magBzPoissonHy3Publish subtracts each magnet's own dipole field
// (solved separately) from the gradient it samples, so a dipole exerts no net
// force on itself — but still feels wires and other magnets. The B-field VIEW
// (fieldBz) keeps the full field including every magnet's own contribution.
//
// Globals relied on (state.js / electric.js / maze.js): GRID_W, GRID_H, K_B,
// MAG_LAMBDA, MAG_DIPOLES, blocked, fieldBz, fieldEdges, magnetList,
// bodyCenter, bodyRect, bodyHat, bodyCells, edgeIsSelf, isCaseA,
// magPublishTelemetry.

let magSrcHy3 = null;        // Float64Array(N): current-frame source (curl J + dipole)
let magSrcSelfHy3 = null;    // Float64Array(N): one magnet's own dipole source
let magBzSelfHy3 = null;     // Float64Array(N): relaxed self-field for one magnet
const MAG_SWEEPS = 40;       // self-field convergence sweeps per magnet

// Phase 1 calibration gain. The Stokes-formulated curl source on the unit
// grid is much smaller than the 'tapered' engine's windowed analytic sum,
// so the relaxed field (and the magnet force) come out ~20× weaker at the
// same K_B. Multiply the source by this factor so the field is in the
// same ballpark as 'tapered' (Phase 2 will replace the source formulation
// with a MAC-staggered centered curl + per-edge coupling, and this gain
// can go back to 1).
const MAG_SRC_GAIN_HY3 = 20;

// Lazy allocation of every Hy3 grid buffer in ONE place. They used to be
// re-checked at each of their use sites (`!buf || buf.length !== N` in both
// BuildSource and Publish), which read like a bug on re-reading — 17-T4.
// Idempotent and cheap (four length checks per entry point).
// Lifetime: allocated on first use, then never freed for the session; the grid
// is a fixed GRID_W × GRID_H, so a buffer that already matches N is never
// re-allocated. `fieldBz` is the shared published overlay owned by
// electric.js — Hy3 relaxes straight into it.
function hy3EnsureBuffers() {
	const N = GRID_W * GRID_H;
	if (!magSrcHy3 || magSrcHy3.length !== N) magSrcHy3 = new Float64Array(N);
	if (!magSrcSelfHy3 || magSrcSelfHy3.length !== N) magSrcSelfHy3 = new Float64Array(N);
	if (!magBzSelfHy3 || magBzSelfHy3.length !== N) magBzSelfHy3 = new Float64Array(N);
	if (!fieldBz || fieldBz.length !== N) fieldBz = new Float64Array(N);
}

// Wipe the warm-started field so stale cross-engine/cross-λ state can't bleed
// in. Called on engine switch, λ change, or dipole toggle.
function magBzPoissonHy3Reset() {
	hy3EnsureBuffers();
	fieldBz.fill(0);
}

// Red-black Gauss–Seidel relaxation of the screened Poisson
//   Bz[n] = (Σ_nbr Bz_nbr − S[n]) / (4 + λ²)
// into `dst`. Blocked and out-of-bounds neighbours are treated as zero,
// approximating a zero-value Dirichlet boundary (not a no-flux / Neumann
// condition: those would require mirroring the cell's own value or
// correcting the stencil, not substituting 0). The denominator stays
// 4 + λ² regardless of how many neighbours are actually present, so this
// is a truncated discretization — strict Dirichlet on an arbitrary
// boundary would need a per-cell denom reflecting the count of valid
// neighbours. The practical effect: the field does not leak through
// walls and decays naturally outside the wires.
function magRelaxInto(src, dst, sweeps) {
	const N = GRID_W * GRID_H, W = GRID_W, H = GRID_H;
	const lam2 = MAG_LAMBDA * MAG_LAMBDA;
	const denom = 4 + lam2;
	for (let it = 0; it < sweeps; it++) {
		for (let pass = 0; pass < 2; pass++) {
			for (let i = 0; i < N; i++) {
				const cx = i % W, cy = (i / W) | 0;
				if (((cx + cy) & 1) !== pass) continue; // checkerboard
				if (blocked[i]) { dst[i] = 0; continue; }
				let sum = 0;
				if (cx > 0     && !blocked[i - 1]) sum += dst[i - 1];
				if (cx < W - 1 && !blocked[i + 1]) sum += dst[i + 1];
				if (cy > 0     && !blocked[i - W]) sum += dst[i - W];
				if (cy < H - 1 && !blocked[i + W]) sum += dst[i + W];
				const nv = (sum - src[i]) / denom;
				dst[i] = isFinite(nv) ? nv : 0;
			}
		}
	}
}

// Build the screened-Poisson source S over the grid.
//
// S[n] = K_B · (circulation of J around cell n)
//
// where the circulation is the sum of signed edge currents on the cell's four
// boundary edges (Stokes: ∮J·dl = ∫curl J·dA). Each edge current I_e is a
// single scalar, so this needs no MAC staggering ambiguity:
//   - a horizontal edge [1,0] between cells A and B (B east of A) is the
//     BOTTOM edge of A (+I_e) and the TOP edge of B (−I_e);
//   - a vertical edge   [0,1] between cells A and C (C south of A) is the
//     RIGHT edge of A (+I_e) and the LEFT edge of C (−I_e).
// A magnet's own armature (bridge) edge is excluded via edgeIsSelf, matching
// the legacy "force comes from the rails, not the bridge" convention.
function magBzPoissonHy3BuildSource() {
	const N = GRID_W * GRID_H, W = GRID_W, H = GRID_H;
	hy3EnsureBuffers();
	magSrcHy3.fill(0);

	const mags = magnetList();
	for (let ei = 0; ei < fieldEdges.length; ei++) {
		const e = fieldEdges[ei];
		const I = e.I || 0;
		if (!I) continue;
		// Skip a magnet's own armature (bridge) edge for every magnet.
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
		magSrcHy3[ay * W + ax] += I;
		magSrcHy3[by * W + bx] -= I;
	}

	for (let mi = 0; mi < mags.length; mi++) {
		const mag = mags[mi];
		if (!MAG_DIPOLES) continue;
		injectDipoleSource(mag, magSrcHy3, 1);
	}

	// Scale the curl source by K_B × MAG_SRC_GAIN_HY3 (the gain compensates for
	// the small Stokes-formulation normalization so the field is in the same
	// ballpark as the 'tapered' engine's windowed analytic sum; see
	// MAG_SRC_GAIN_HY3 above).
	for (let i = 0; i < N; i++) magSrcHy3[i] *= K_B * MAG_SRC_GAIN_HY3;
}

// Add magnet `mag`'s two opposite dipole point sources (scaled by `scale`) to
// `dst` at the cells one step beyond each end of its body along its motion
// (hat) axis. Keeping the sample points off the body keeps the field smooth.
function injectDipoleSource(mag, dst, scale) {
	const W = GRID_W, H = GRID_H;
	const hat = bodyHat(mag);
	const m = (mag.magStrength != null ? mag.magStrength : 1) * scale;
	const r = bodyRect(mag);
	let px, py, qx, qy;
	if (hat.ax !== 0) {
		const cyc = Math.round((r.y0 + r.y1) * 0.5);
		px = Math.round(hat.ax > 0 ? r.x1 + 1 : r.x0 - 1);
		qx = Math.round(hat.ax > 0 ? r.x0 - 1 : r.x1 + 1);
		py = qy = cyc;
	} else {
		const cxc = Math.round((r.x0 + r.x1) * 0.5);
		py = Math.round(hat.ay > 0 ? r.y1 + 1 : r.y0 - 1);
		qy = Math.round(hat.ay > 0 ? r.y0 - 1 : r.y1 + 1);
		px = qx = cxc;
	}
	if (px >= 0 && px < W && py >= 0 && py < H) dst[py * W + px] += m;
	if (qx >= 0 && qx < W && qy >= 0 && qy < H) dst[qy * W + qx] -= m;
}

// Relax the persistent fieldBz from the current source.
function magBzPoissonHy3Relax(sweeps) {
	hy3EnsureBuffers();
	magRelaxInto(magSrcHy3, fieldBz, sweeps);
}

// Sample Bz + its gradient at each magnet (finite differences on the relaxed
// field) and write the telemetry the legacy engine wrote, so the property panel
// keeps working. The per-magnet body lives in the SHARED magPublishTelemetry
// (electric.js) — this function only supplies the grid sampler and, when
// MAG_DIPOLES is on, the self-field gradient to subtract.
function magBzPoissonHy3Publish(mags) {
	const W = GRID_W, H = GRID_H;
	hy3EnsureBuffers();
	const bzAt = (cx, cy) => {
		if (cx < 0 || cx >= W || cy < 0 || cy >= H) return 0;
		return fieldBz[cy * W + cx];
	};
	// Self-field cancellation is only needed when magnets inject dipoles and
	// there is at least one magnet to cancel for.
	const needSelf = MAG_DIPOLES && mags.length > 0;
	magPublishTelemetry(mags, bzAt, needSelf ? { selfGrad: hy3SelfGrad } : null);
}

// One magnet's own dipole field, as a gradient to SUBTRACT from the sampled
// total: a dipole represented as two point sources has a non-zero on-axis
// gradient at its own centre, so without this a magnet would spuriously feel
// its own field. Solved from a cold start with enough sweeps to converge (a
// point source spreads slowly), matching the converged warm-started fieldBz it
// is subtracted from. The B-field VIEW (fieldBz) keeps the full field including
// every magnet's own contribution — only the force sampling cancels it.
function hy3SelfGrad(mag, mcx, mcy) {
	const W = GRID_W, H = GRID_H;
	hy3EnsureBuffers();
	magSrcSelfHy3.fill(0);
	injectDipoleSource(mag, magSrcSelfHy3, K_B * MAG_SRC_GAIN_HY3); // pre-scale like magSrcHy3
	magBzSelfHy3.fill(0);
	magRelaxInto(magSrcSelfHy3, magBzSelfHy3, MAG_SWEEPS * 6);
	const sbz = (cx, cy) => (cx < 0 || cx >= W || cy < 0 || cy >= H) ? 0 : magBzSelfHy3[cy * W + cx];
	return {
		dx: (sbz(mcx + 1, mcy) - sbz(mcx - 1, mcy)) * 0.5,
		dy: (sbz(mcx, mcy + 1) - sbz(mcx, mcy - 1)) * 0.5
	};
}
