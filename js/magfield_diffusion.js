// Visual-relaxation magnetic diffusion engine.
//
// Selected when magEngine === 'diffusion' in js/state.js. Unlike 'tapered'
// (steady-state analytic, warm-started) and 'hy3' (screened-Poisson, warm-
// started), this engine advances a *transient* heat-equation update each
// frame:
//
//     Bz ← Bz + α · (Bx⁺ + Bx⁻ + By⁺ + By⁻ − 4·Bz − S)
//
// i.e. ∂Bz/∂t = α·(∇²Bz − S), whose settled state is the Poisson problem
//
//     ∇²Bz = S,     S = K_B · MAG_SRC_GAIN_DIFF · curl J
//
// — the *same* equation and the *same* source sign convention as Hy3's
// screened Poisson (∇²−λ²)Bz = S at λ=0, so `fieldBz` (and with it
// `m.lastFcoil`) keeps its sign when the engine is switched. S is the
// discrete curl of the edge currents, built by magDiffusionBuildSource
// exactly like magBzPoissonHy3BuildSource.
//
// Because the source sits INSIDE the α bracket, α is a pure speed knob: it
// sets the relaxation time constant (≈ 1/α sweeps) and nothing else. The
// settled amplitude is α-independent (test_magdiff.js 11b). Earlier the
// source was added outside the bracket, which made the settled peak scale as
// 1/α — a ~12× force swing across the slider range.
//
// α is user-tunable via MAG_DIFFUSION_ALPHA (slider range [0.02, 0.24]; CFL
// stability requires 4·α ≤ 1, and α=0.25 is exactly marginal — the
// amplification factor at the Nyquist mode is g = 1−8α = −1, a neutrally-
// stable checkerboard that never damps. The slider cap of 0.24 gives
// g = −0.92). The field actually spreads cell-to-cell over successive
// iterations: with a fixed sweep budget, higher α settles closer to the
// asymptote, lower α is still visibly mid-transient (test_magdiff.js 11a).
// No back-EMF injection in this plan.
//
// LIMITATION (16.1 T3): this engine has NO dipole support. It injects only the
// curl-of-J wire source, so with MAG_DIPOLES on, switching to 'diffusion'
// silently drops the magnet↔magnet interaction that 'hy3' provides. The UI
// therefore hides the #magDipoles toggle under 'diffusion' AND logs a hint when
// the engine is selected (js/ui.js magEngineOnChange), rather than leaving the
// toggle visible but inert. A dipole injector here needs the same self-field
// cancellation machinery Hy3 carries (per-magnet cold-start self solve), which
// is recorded as Phase-2 scope in 16.1-plan-add-diffusion-engine.md.
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
// K_B, MAG_DIFFUSION_ALPHA, MAG_SRC_GAIN_DIFF, blocked, fieldBz, fieldEdges,
// magnetList, bodyCenter, bodyRect, bodyHat, bodyCells, edgeIsSelf, isCaseA,
// magPublishTelemetry.

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

	for (let i = 0; i < N; i++) magSrcDiff[i] *= K_B * MAG_SRC_GAIN_DIFF;
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
			// Source folded INSIDE the α bracket — this is the `dt` separation:
			//   ∂Bz/∂t = α·(∇²Bz − S₀)
			// so the per-step source increment is α·S₀ and the settled state is
			//   ∇²Bz = S₀,  S₀ = K_B·MAG_SRC_GAIN_DIFF·curl J
			// i.e. α controls ONLY the relaxation time constant, never the
			// settled amplitude. (The previous form `+ S₀` outside the bracket
			// made α do double duty: settled peak ∝ K_B/α, a ~12× force swing
			// across the 0.02–0.24 slider.) The settled equation is also now
			// the same Poisson sign convention Hy3 solves — (∇²−λ²)Bz = S at
			// λ=0 — so fieldBz, and with it m.lastFcoil, keeps its sign when
			// the engine is switched. See test_magdiff.js 11a/11b/11c.
			const nv = bz + alpha * (sum - 4 * bz - magSrcDiff[i]);
			fieldBzDiffScratch[i] = isFinite(nv) ? nv : 0;
		}
		const tmp = fieldBzDiff;
		fieldBzDiff = fieldBzDiffScratch;
		fieldBzDiffScratch = tmp;
	}
}

// Copy the engine's private Bz into the shared published overlay, then hand the
// per-magnet telemetry to the SHARED magPublishTelemetry (electric.js) — this
// used to be a verbatim copy of magBzPoissonHy3Publish's body (16.1 finding F).
// No `selfGrad` is passed: 'diffusion' injects no dipole source, so there is no
// self-field to cancel — which is also why dipoles are unsupported here (the UI
// says so; see magEngineOnChange in js/ui.js and docs/magnetic-engines.md).
function magDiffusionPublish(mags) {
	const N = GRID_W * GRID_H, W = GRID_W, H = GRID_H;
	if (!fieldBz || fieldBz.length !== N) fieldBz = new Float64Array(N);
	for (let i = 0; i < N; i++) fieldBz[i] = fieldBzDiff ? fieldBzDiff[i] : 0;

	const bzAt = (cx, cy) => {
		if (cx < 0 || cx >= W || cy < 0 || cy >= H) return 0;
		return fieldBz[cy * W + cx];
	};

	magPublishTelemetry(mags, bzAt, null);
}
