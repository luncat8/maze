// ---- Air pressure engine ---------------------------------------------
// Pressure-driven (PV=nRT) airflow. The temperature/energy field evolves by
// Fourier conduction + per-cell sources (lamp Joule power) and sinks (opt-in
// global cooling and/or placed Heat Sinks), then mass + energy advect along
// the pressure gradient (real gas flow). A derived velocity field only drives
// the VISUAL particles, so the heat map stays smooth. All state lives in
// state.js (airU/airN/temp/pressure/velX/velY/cellParticles/cellOpen and the
// thermal constants); this module is pure logic over those globals.

function isAir(i) { return !blocked[i] && grid[i] === 0; }

// Joule-heated airflow — a clean, stable, Boussinesq-style heat model.
//
// The temperature field T = airU / C_AIR_REAL (excess K) evolves ONLY by
// Fourier conduction (G_COND) plus per-cell sources (lamp Joule power) and
// sinks (opt-in global ambient cooling G_LOSS and/or placed Heat Sink G_SINK).
// A Jacobi snapshot of U makes conduction exactly energy-conserving and
// unconditionally stable; T is clamped only by the T_MAX safety net. We do
// NOT advect mass/energy (the old Darcy pass caused perpetual churn/glitches
// and masked that conduction was effectively frozen). The air mass stays
// constant; a buoyancy velocity field v = −∇(P/pAmb) is derived purely to
// advect the VISUAL particles, so the heat map stays smooth.
function airRelax(sweeps, dt) {
	const N = GRID_W * GRID_H;
	let maxD = 0;
	const hsSet = new Set(heatSinks.map(h => h.idx));   // placed Heat Sink cells
	const LIM = CFL_FRAC * N0 / dt;                     // per-face mass-flow cap (kg/s)
	const pOf = (n, e) => (n / CELL_VOL) * R_SPEC * (T_AMB + (n > N_MIN ? e / (n * AIR_CP) : 0)) * P_SCALE;
	for (let it = 0; it < sweeps; it++) {
		// (1) CONDUCTION + SOURCE + COOLING on internal energy (J). The
		// snapshot prevU keeps conduction conservative (ΣU unchanged; only
		// heatSource adds energy). Cooling is OPT-IN: global ambient sink
		// (G_LOSS, settings toggle, default OFF) and/or any placed Heat Sink
		// (G_SINK). With no sink, heat accumulates gradually (never
		// instantaneous) until a sink or the T_MAX clamp removes it.
		const prevU = airU.slice();
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) continue;
			const cx = i % GRID_W, cy = (i / GRID_W) | 0;
			let flux = 0; // W into cell i from its 4 air neighbours
			for (let d = 0; d < 4; d++) {
				const nx = cx + dirs[d].dx, ny = cy + dirs[d].dy;
				if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
				const m = ny * GRID_W + nx; if (!isAir(m)) continue;   // walls = no-flux
				const k = Math.min(cellOpen[i], cellOpen[m]);         // throttled by valve/portal
				flux += k * G_COND * (prevU[m] - prevU[i]) / C_AIR_REAL;  // Σ G·(T_m − T_i), W
			}
			let cool = (coolingEnabled ? G_LOSS : 0) * prevU[i] / C_AIR_REAL; // W to ambient
			if (hsSet.has(i)) cool += G_SINK * prevU[i] / C_AIR_REAL;        // Heat Sink item
			const nv = prevU[i] + dt * (flux + heatSource[i] - cool); // W·s = J
			const d = Math.abs(nv - prevU[i]); if (d > maxD) maxD = d;
			airU[i] = nv > 0 ? nv : 0;
		}
		// (2) MASS + ENERGY ADVECTION (real PV=nRT flow). Snapshot mass/energy,
		// derive pressure, move mass+energy UPWIND along the pressure gradient.
		// Forward dirs ([1,0],[0,1]) count each face exactly once; the per-face
		// cap LIM bounds each endpoint's outflow so airN can never go negative
		// (a cell loses at most 4·CFL_FRAC·N0 per sweep → stays ≥0.2·N0).
		const prevN = airN.slice();
		const prevE = airU.slice();
		const dN = new Float64Array(N), dE = new Float64Array(N);
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) continue;
			const cx = i % GRID_W, cy = (i / GRID_W) | 0;
			const Pi = pOf(prevN[i], prevE[i]);
			for (const [dx, dy] of [[1, 0], [0, 1]]) {
				const nx = cx + dx, ny = cy + dy;
				if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
				const j = ny * GRID_W + nx; if (!isAir(j)) continue;
				const k = Math.min(cellOpen[i], cellOpen[j]);         // throttled by valve/portal
				let J = k * G_FLOW * (Pi - pOf(prevN[j], prevE[j]));  // kg/s, + = i→j, high→low P
				if (J > LIM) J = LIM; else if (J < -LIM) J = -LIM;
				const s = J > 0 ? i : j;                          // upwind source cell
				const eS = prevE[s] / prevN[s];                   // specific excess energy J/kg
				dN[i] -= J; dN[j] += J;
				dE[i] -= J * eS; dE[j] += J * eS;
			}
		}
		// (2.5) PIPE PORTAL pass: pressure-driven link between two paired
		//     air cells. Same CFL-style cap as step 2, but on the SMALLER of
		//     the two endpoint masses (so neither endpoint can go negative in
		//     one sweep). Scaled by `open` so a closed portal is inert.
		for (let kk = 0; kk < pipePortals.length; kk++) {
			const p = pipePortals[kk];
			if (!isAir(p.a) || !isAir(p.b)) continue;             // inert if endpoint walled
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
		// (3) AIR ITEMS. Source injects mass at its set temperature; Sink removes
		//     mass carrying its proportional share of energy, so per-mass energy
		//     stays unchanged. Runs per sweep so the rate integrates over time.
		for (let k = 0; k < airSources.length; k++) {
			const s = airSources[k]; if (!isAir(s.idx)) continue;
			const dm = s.rate * dt;
			airN[s.idx] += dm;
			airU[s.idx] += dm * AIR_CP * (s.temp - T_AMB);
		}
		for (let k = 0; k < airSinks.length; k++) {
			const s = airSinks[k]; if (!isAir(s.idx)) continue;
			const dm = Math.min(airN[s.idx] - N_MIN, s.rate * dt);
			const f = dm / airN[s.idx];
			airN[s.idx] -= dm;
			airU[s.idx] -= f * airU[s.idx];
		}
		// (4) derive temp = U / (airN·cp); clamps (safety net only). pressure
		//     P = n·R·T_abs now depends on BOTH mass and temperature.
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) { temp[i] = 0; pressure[i] = 0; continue; }
			let t = airU[i] / (airN[i] * AIR_CP);
			if (t > T_MAX) { t = T_MAX; airU[i] = airN[i] * AIR_CP * T_MAX; }
			if (t < 0) { t = 0; airU[i] = 0; }
			temp[i] = t;
			pressure[i] = (airN[i] / CELL_VOL) * R_SPEC * (T_AMB + t) * P_SCALE;
		}
	}
	// (5) cell velocity for PARTICLES ONLY: v = −∇(P/pAmb) (no-flux at walls).
	// High-P cells shed particles toward low-P (source→sink / hot→cold plume).
	// This moves no heat — the temperature field is conduction-only. A raw
	// gradient is unbounded near a point source/sink and, in a wide (>1 cell)
	// tunnel, its sharp cell-to-cell variation makes bilinear-sampled particles
	// whip perpendicular to the flow. We smooth it once and cap the magnitude so
	// wide tunnels render as clean, legible streamlines instead of chaos.
	const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;
	for (let i = 0; i < N; i++) {
		if (!isAir(i)) { velX[i] = 0; velY[i] = 0; continue; }
		const cx = i % GRID_W, cy = (i / GRID_W) | 0;
		// No-flux (Neumann) walls: a wall/out-of-bounds neighbour is treated as the
		// cell's OWN pressure, so the gradient normal to the wall is zero — flow
		// never spuriously points into a wall. Using 0 there (old airP) made every
		// wall look like a vacuum and pulled particles the wrong way.
		const Lair = cx > 0 && isAir(i - 1);
		const Rair = cx < GRID_W - 1 && isAir(i + 1);
		const Uair = cy > 0 && isAir(i - GRID_W);
		const Dair = cy < GRID_H - 1 && isAir(i + GRID_W);
		const Pc = pressure[i];
		const Pl = Lair ? pressure[i - 1] : Pc;
		const Pr = Rair ? pressure[i + 1] : Pc;
		const Pu = Uair ? pressure[i - GRID_W] : Pc;
		const Pd = Dair ? pressure[i + GRID_W] : Pc;
		// No-flux: a velocity component is zero unless BOTH perpendicular
		// neighbours are air, so flow never spuriously points into a wall and a
		// symmetric junction (a wall on one side) becomes a true stagnation the
		// particle splitter resolves. Also makes the Pressure-view arrows correct.
		const vx = (Lair && Rair) ? (Pl - Pr) / (2 * pAmb) : 0;
		const vy = (Uair && Dair) ? (Pu - Pd) / (2 * pAmb) : 0;
		velX[i] = vx * VEL_SCALE; velY[i] = vy * VEL_SCALE;
	}
	// air-only box blur (averages with self + 4 air neighbours)
	const svx = velX.slice(), svy = velY.slice();
	for (let i = 0; i < N; i++) {
		if (!isAir(i)) continue;
		const cx = i % GRID_W, cy = (i / GRID_W) | 0;
		let sx = svx[i], sy = svy[i], n = 1;
		for (let d = 0; d < 4; d++) {
			const nx = cx + dirs[d].dx, ny = cy + dirs[d].dy;
			if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
			const m = ny * GRID_W + nx; if (!isAir(m)) continue;
			sx += svx[m]; sy += svy[m]; n++;
		}
		velX[i] = sx / n; velY[i] = sy / n;
	}
	// speed cap: keep direction, clamp |v| so nothing flings across cells
	for (let i = 0; i < N; i++) {
		if (!isAir(i)) continue;
		const m = Math.hypot(velX[i], velY[i]);
		if (m > VEL_CMAX) { const k = VEL_CMAX / m; velX[i] *= k; velY[i] *= k; }
	}
	return maxD;
}

// ---- Airflow particles: simple per-cell random drift ----
// Each air cell holds a small swarm of particles. Count is proportional to the
// cell's pressure above ambient (so a hot/source cell looks denser, a quiet room
// has none), and each particle's drift speed is proportional to the cell's
// velocity magnitude (so still air is still, fast flow is streaky). Particles
// respawn at a random point in their cell after a short life — they never cross
// into a wall. No source/sink plumbing, no lane tracking, no shortest-path.
function updateFlow(dt) {
	if (!velX) return;
	const N = GRID_W * GRID_H;
	const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;
	for (let i = 0; i < N; i++) {
		if (!isAir(i)) continue;
		const list = cellParticles[i];
		const Pi = pressure[i];
		const dP = Math.max(0, Pi - pAmb);
		const target = Math.min(PARTICLES_MAX, Math.max(1, Math.round(Pi / 1000 * PARTICLES_PER_kPa + dP * PARTICLES_PER_dPa)));
		while (list.length < target) list.push({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, age: 0 });
		if (list.length > target) list.length = target;
		const sp = Math.hypot(velX[i], velY[i]);
		const k = sp * PARTICLE_DRIFT;
		for (let k2 = 0; k2 < list.length; k2++) {
			const p = list[k2];
			p.age += dt;
			const ang = Math.random() * Math.PI * 2;
			p.vx += velX[i] * k * dt + Math.cos(ang) * 0.6 * dt;
			p.vy += velY[i] * k * dt + Math.sin(ang) * 0.6 * dt;
			p.x += p.vx * dt; p.y += p.vy * dt;
			if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.age > PARTICLE_LIFE) {
				p.x = Math.random(); p.y = Math.random();
				p.vx = 0; p.vy = 0; p.age = 0;
				continue;
			}
			p.vx *= 0.85; p.vy *= 0.85;
		}
	}
}

// Subsystem gating: the air/heat field pauses independently.
function heatAirActive() {
	// Any driver that keeps the air field evolving: lamps (Joule heat), placed
	// Heat Sinks, global cooling, or any Air Source/Sink.
	return lamps.length > 0 || heatSinks.length > 0 || coolingEnabled ||
		airSources.length > 0 || airSinks.length > 0;
}
