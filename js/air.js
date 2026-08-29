// ---- Air pressure engine ---------------------------------------------
// Pressure-driven (PV=nRT) airflow. The temperature/energy field evolves by
// Fourier conduction + per-cell sources (lamp Joule power) and sinks (opt-in
// global cooling and/or placed Heat Sinks), then mass + energy advect along
// the pressure gradient (real gas flow). A derived velocity field only drives
// the VISUAL particles, so the heat map stays smooth. All state lives in
// state.js (airU/airN/temp/pressure/velX/velY/cellParticles/cellOpen and the
// thermal constants); this module is pure logic over those globals.

function isAir(i) {
	if (grid[i] !== 0 || blocked[i]) return false;
	if (pistonOcc[i] >= PISTON_FULL) return false;
	for (let k = 0; k < pumps.length; k++) {
		if (pumps[k].idx === i) return false; // pump block sealed as wall
	}
	return true;
}

function syncPistonOccupancy() {
	pistonOcc.fill(0);
	airVol.fill(CELL_VOL);
	for (let k = 0; k < pistons.length; k++) {
		const p = pistons[k];
		if (p.axis === 'h') {
			const y = p.y;
			const p0 = p.pos, p1 = p.pos + 2.0;
			const minX = Math.max(0, Math.floor(p0));
			const maxX = Math.min(GRID_W - 1, Math.floor(p1));
			for (let x = minX; x <= maxX; x++) {
				const overlap = Math.max(0, Math.min(x + 1.0, p1) - Math.max(x + 0.0, p0));
				const idx = y * GRID_W + x;
				pistonOcc[idx] = Math.min(1.0, pistonOcc[idx] + overlap);
				airVol[idx] = Math.max(1e-3, (1.0 - pistonOcc[idx]) * CELL_VOL);
				if (pistonOcc[idx] >= PISTON_FULL) { airN[idx] = 0; airU[idx] = 0; }
			}
		} else {
			const x = p.x;
			const p0 = p.pos, p1 = p.pos + 2.0;
			const minY = Math.max(0, Math.floor(p0));
			const maxY = Math.min(GRID_H - 1, Math.floor(p1));
			for (let y = minY; y <= maxY; y++) {
				const overlap = Math.max(0, Math.min(y + 1.0, p1) - Math.max(y + 0.0, p0));
				const idx = y * GRID_W + x;
				pistonOcc[idx] = Math.min(1.0, pistonOcc[idx] + overlap);
				airVol[idx] = Math.max(1e-3, (1.0 - pistonOcc[idx]) * CELL_VOL);
				if (pistonOcc[idx] >= PISTON_FULL) { airN[idx] = 0; airU[idx] = 0; }
			}
		}
	}
}

function faceBlocked(i, j) {
	// Hermetic sealing: air cannot permeate through the solid piston interior
	for (let k = 0; k < pistons.length; k++) {
		const p = pistons[k];
		if (p.axis === 'h') {
			const cy = (i / GRID_W) | 0;
			if (cy !== p.y) continue;
			if (Math.abs(i - j) === 1) {
				const xLeft = Math.min(i % GRID_W, j % GRID_W);
				const faceX = xLeft + 1.0;
				if (faceX > p.pos + 1e-4 && faceX < p.pos + 2.0 - 1e-4) return true;
			}
		} else {
			const cx = i % GRID_W;
			if (cx !== p.x) continue;
			if (Math.abs(i - j) === GRID_W) {
				const yTop = Math.min((i / GRID_W) | 0, (j / GRID_W) | 0);
				const faceY = yTop + 1.0;
				if (faceY > p.pos + 1e-4 && faceY < p.pos + 2.0 - 1e-4) return true;
			}
		}
	}
	return false;
}

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
	syncPistonOccupancy();
	const hsSet = new Set(heatSinks.map(h => h.idx));   // placed Heat Sink cells
	const LIM = CFL_FRAC * N0 / dt;                     // per-face mass-flow cap (kg/s)
	const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;
	const pOf = (n, e, v = CELL_VOL) => (n / Math.max(1e-3, v)) * R_SPEC * (T_AMB + (n > N_MIN ? e / (n * AIR_CP) : 0)) * P_SCALE;
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
				if (faceBlocked(i, m)) continue;                     // hermetic piston body = no flux
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
			const Pi = pOf(prevN[i], prevE[i], airVol[i]);
			for (const [dx, dy] of [[1, 0], [0, 1]]) {
				const nx = cx + dx, ny = cy + dy;
				if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
				const j = ny * GRID_W + nx; if (!isAir(j)) continue;
				if (faceBlocked(i, j)) continue;
				const kVol = Math.min(airVol[i], airVol[j]) / CELL_VOL;
				const k = Math.min(cellOpen[i], cellOpen[j]) * kVol;         // throttled by valve/portal & cut-cell volume
				let J = k * G_FLOW * (Pi - pOf(prevN[j], prevE[j], airVol[j]));  // kg/s, + = i→j, high→low P
				const cap = CFL_FRAC * Math.min(prevN[i], prevN[j], (airVol[i] / CELL_VOL) * N0, (airVol[j] / CELL_VOL) * N0) / dt;
				if (J > cap) J = cap; else if (J < -cap) J = -cap;
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
			const Pa = pOf(prevN[p.a], prevE[p.a], airVol[p.a]);
			const Pb = pOf(prevN[p.b], prevE[p.b], airVol[p.b]);
			let J = G_PORTAL * p.open * (Pa - Pb);
			const cap = CFL_FRAC * Math.min(prevN[p.a], prevN[p.b]) / dt;
			if (J > cap) J = cap; else if (J < -cap) J = -cap;
			const s = J > 0 ? p.a : p.b;
			const eS = prevE[s] / prevN[s];
			dN[p.a] -= J; dN[p.b] += J;
			dE[p.a] -= J * eS; dE[p.b] += J * eS;
		}
		// (2.6) AIR PUMP pass: active directional air displacement driven by electricity
		for (let k = 0; k < pumps.length; k++) {
			const p = pumps[k];
			const P_elec = p.limited ? (p.lastPower || 0) : 10.0;
			if (P_elec < 0.05) {
				p.lastFlow = 0; p.lastDeltaP = 0; p.lastEff = 0; p.lastHeat = 0;
				continue;
			}
			const d = PUMP_DIRS[p.dir];
			const inX = p.x - d.dx, inY = p.y - d.dy;
			const outX = p.x + d.dx, outY = p.y + d.dy;
			if (inX < 0 || inX >= GRID_W || inY < 0 || inY >= GRID_H ||
				outX < 0 || outX >= GRID_W || outY < 0 || outY >= GRID_H) {
				p.lastFlow = 0; p.lastDeltaP = 0; p.lastEff = 0; p.lastHeat = P_elec;
				continue;
			}
			const inIdx = inY * GRID_W + inX;
			const outIdx = outY * GRID_W + outX;
			if (grid[inIdx] !== 0 || blocked[inIdx] || grid[outIdx] !== 0 || blocked[outIdx]) {
				p.lastFlow = 0; p.lastDeltaP = 0; p.lastEff = 0; p.lastHeat = P_elec;
				continue;
			}
			const Pin = pOf(prevN[inIdx], prevE[inIdx], airVol[inIdx]);
			const Pout = pOf(prevN[outIdx], prevE[outIdx], airVol[outIdx]);
			const dP = Pout - Pin;
			const dP_stall = 1000; // Pa stall pressure
			let eta_press = 0;
			if (dP <= 0) eta_press = 0.5;
			else if (dP < dP_stall) eta_press = 4 * (dP / dP_stall) * (1 - dP / dP_stall);
			const Tin = T_AMB + (prevN[inIdx] > N_MIN ? prevE[inIdx] / (prevN[inIdx] * AIR_CP) : 0);
			const eta_temp = Math.sqrt(T_AMB / Math.max(100, Tin));
			const eta_base = p.efficiency != null ? p.efficiency : 0.70;
			const eta_result = Math.max(0, Math.min(1, eta_base * eta_press * eta_temp));

			let flowRate = 0;
			if (dP < dP_stall) {
				const rhoIn = prevN[inIdx] / Math.max(1e-3, airVol[inIdx]);
				flowRate = 0.10 * Math.sqrt(P_elec / 10.0) * (1 - dP / dP_stall) * (rhoIn / AIR_RHO);
				if (flowRate > 0.25) flowRate = 0.25;
				if (flowRate < 0) flowRate = 0;
			}
			const maxDm = prevN[inIdx] * 0.3 / dt;
			let J = Math.min(flowRate, maxDm);
			const eS = prevE[inIdx] / prevN[inIdx];
			dN[inIdx] -= J; dN[outIdx] += J;
			dE[inIdx] -= J * eS; dE[outIdx] += J * eS;

			p.lastFlow = J;
			p.lastDeltaP = dP;
			p.lastEff = eta_result;
			p.lastHeat = P_elec * (1 - eta_result);
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
		
		// (3.5) PISTON DYNAMICS & CONTINUOUS CHAMBER-COUPLED MOVING BOUNDARY
		for (let k = 0; k < pistons.length; k++) {
			const p = pistons[k];
			const mass = p.mass || 100;
			const friction = p.friction != null ? p.friction : 50;
			const damping = p.damping || 200;

			let minPos = 0, maxPos = (p.axis === "h" ? GRID_W : GRID_H) - 2;

			if (p.axis === "h") {
				const y = p.y;
				const curLeft = Math.floor(p.pos);
				const curRight = Math.floor(p.pos + 2.0);
				for (let x = curLeft; x >= 0; x--) {
					const idx = y * GRID_W + x;
					if (grid[idx] !== 0 || blocked[idx] || pumps.some(pmp => pmp.idx === idx)) { minPos = x + 1; break; }
				}
				for (let x = curRight; x < GRID_W; x++) {
					const idx = y * GRID_W + x;
					if (grid[idx] !== 0 || blocked[idx] || pumps.some(pmp => pmp.idx === idx)) { maxPos = x - 2; break; }
				}
			} else {
				const x = p.x;
				const curTop = Math.floor(p.pos);
				const curBot = Math.floor(p.pos + 2.0);
				for (let y = curTop; y >= 0; y--) {
					const idx = y * GRID_W + x;
					if (grid[idx] !== 0 || blocked[idx] || pumps.some(pmp => pmp.idx === idx)) { minPos = y + 1; break; }
				}
				for (let y = curBot; y < GRID_H; y++) {
					const idx = y * GRID_W + x;
					if (grid[idx] !== 0 || blocked[idx] || pumps.some(pmp => pmp.idx === idx)) { maxPos = y - 2; break; }
				}
			}

			// Helper to get chamber properties along corridor
			function getChamber(X0, X1) {
				let mR = 0, uR = 0, vR = 0;
				let mF = 0, uF = 0, vF = 0;
				const rCells = [], fCells = [];
				const rVols = [], fVols = [];

				if (p.axis === "h") {
					const y = p.y;
					for (let x = minPos; x <= Math.floor(X0); x++) {
						const idx = y * GRID_W + x;
						if (grid[idx] === 0) {
							const v = x < Math.floor(X0) ? CELL_VOL : Math.max(0, (X0 - x) * CELL_VOL);
							if (v > 1e-5 || x < Math.floor(X0)) {
								rCells.push(idx); rVols.push(v);
								mR += airN[idx]; uR += airU[idx]; vR += v;
							}
						}
					}
					const endX = Math.min(GRID_W - 1, maxPos + 1);
					for (let x = Math.floor(X1); x <= endX; x++) {
						const idx = y * GRID_W + x;
						if (grid[idx] === 0) {
							const v = x > Math.floor(X1) ? CELL_VOL : Math.max(0, (x + 1.0 - X1) * CELL_VOL);
							if (v > 1e-5 || x > Math.floor(X1)) {
								fCells.push(idx); fVols.push(v);
								mF += airN[idx]; uF += airU[idx]; vF += v;
							}
						}
					}
				} else {
					const x = p.x;
					for (let y = minPos; y <= Math.floor(X0); y++) {
						const idx = y * GRID_W + x;
						if (grid[idx] === 0) {
							const v = y < Math.floor(X0) ? CELL_VOL : Math.max(0, (X0 - y) * CELL_VOL);
							if (v > 1e-5 || y < Math.floor(X0)) {
								rCells.push(idx); rVols.push(v);
								mR += airN[idx]; uR += airU[idx]; vR += v;
							}
						}
					}
					const endY = Math.min(GRID_H - 1, maxPos + 1);
					for (let y = Math.floor(X1); y <= endY; y++) {
						const idx = y * GRID_W + x;
						if (grid[idx] === 0) {
							const v = y > Math.floor(X1) ? CELL_VOL : Math.max(0, (y + 1.0 - X1) * CELL_VOL);
							if (v > 1e-5 || y > Math.floor(X1)) {
								fCells.push(idx); fVols.push(v);
								mF += airN[idx]; uF += airU[idx]; vF += v;
							}
						}
					}
				}
				return { mR, uR, vR, rCells, rVols, mF, uF, vF, fCells, fVols };
			}

			const ch = getChamber(p.pos, p.pos + 2.0);

			let pBack = pAmb, pFront = pAmb;
			if (ch.vR >= 0.15 * CELL_VOL && ch.mR > N_MIN) {
				const tRear = ch.uR / (ch.mR * AIR_CP);
				pBack = (ch.mR / ch.vR) * R_SPEC * (T_AMB + tRear) * P_SCALE;
			}
			if (ch.vF >= 0.15 * CELL_VOL && ch.mF > N_MIN) {
				const tFront = ch.uF / (ch.mF * AIR_CP);
				pFront = (ch.mF / ch.vF) * R_SPEC * (T_AMB + tFront) * P_SCALE;
			}

			const F_press = (pBack - pFront) * 1.0;
			p.lastFpress = F_press;

			const F_static = 1.2 * friction;
			let F_fric = 0, F_net = 0;
			if (Math.abs(p.vel) < 1e-4) {
				if (Math.abs(F_press) <= F_static) {
					p.vel = 0;
					F_fric = -F_press;
					F_net = 0;
				} else {
					F_fric = -Math.sign(F_press) * friction;
					F_net = F_press + F_fric;
				}
			} else {
				F_fric = -Math.sign(p.vel) * friction - damping * p.vel;
				F_net = F_press + F_fric;
			}
			p.lastFfric = F_fric;

			p.vel += (F_net / mass) * dt;
			if (p.vel > 6) p.vel = 6;
			if (p.vel < -6) p.vel = -6;

			let newPos = p.pos + p.vel * dt;
			if (newPos <= minPos) {
				newPos = minPos;
				p.vel = 0;
				p.blockedWall = true;
			} else if (newPos >= maxPos) {
				newPos = maxPos;
				p.vel = 0;
				p.blockedWall = true;
			} else {
				p.blockedWall = false;
			}

			const dPos = newPos - p.pos;
			if (Math.abs(dPos) > 1e-7) {
				p.pos = newPos;
				p.x = p.axis === "h" ? Math.round(newPos) : p.x;
				p.y = p.axis === "v" ? Math.round(newPos) : p.y;
				syncPistonOccupancy();

				const chNew = getChamber(newPos, newPos + 2.0);

				if (chNew.vR > 1e-4 && ch.mR > 0) {
					for (let i = 0; i < chNew.rCells.length; i++) {
						const idx = chNew.rCells[i];
						const frac = chNew.rVols[i] / chNew.vR;
						airN[idx] = ch.mR * frac;
						airU[idx] = ch.uR * frac;
					}
				}
				if (chNew.vF > 1e-4 && ch.mF > 0) {
					for (let i = 0; i < chNew.fCells.length; i++) {
						const idx = chNew.fCells[i];
						const frac = chNew.fVols[i] / chNew.vF;
						airN[idx] = ch.mF * frac;
						airU[idx] = ch.uF * frac;
					}
				}
			}
		}
		syncPistonOccupancy();
		// (4) derive temp = U / (airN·cp); clamps (safety net only). pressure
		//     P = n·R·T_abs now depends on mass, temperature, AND cut-cell airVol.
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) { temp[i] = 0; pressure[i] = 0; continue; }
			const n = airN[i];
			let t = n > N_MIN ? airU[i] / (n * AIR_CP) : 0;
			if (t > T_MAX) { t = T_MAX; airU[i] = n * AIR_CP * T_MAX; }
			if (t < 0) { t = 0; airU[i] = 0; }
			temp[i] = t;
			pressure[i] = (n / Math.max(1e-3, airVol[i])) * R_SPEC * (T_AMB + t) * P_SCALE;
		}
	}
	// (5) cell velocity for PARTICLES ONLY: v = −∇(P/pAmb) (no-flux at walls).
	// High-P cells shed particles toward low-P (source→sink / hot→cold plume).
	// This moves no heat — the temperature field is conduction-only. A raw
	// gradient is unbounded near a point source/sink and, in a wide (>1 cell)
	// tunnel, its sharp cell-to-cell variation makes bilinear-sampled particles
	// whip perpendicular to the flow. We smooth it once and cap the magnitude so
	// wide tunnels render as clean, legible streamlines instead of chaos.
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
		airSources.length > 0 || airSinks.length > 0 || pumps.length > 0 || pistons.length > 0;
}
