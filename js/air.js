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
		const r = bodyRect(p);
		const minX = Math.max(0, Math.floor(r.x0));
		const maxX = Math.min(GRID_W - 1, Math.floor(r.x1));
		const minY = Math.max(0, Math.floor(r.y0));
		const maxY = Math.min(GRID_H - 1, Math.floor(r.y1));
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const ox = Math.max(0, Math.min(x + 1.0, r.x1) - Math.max(x + 0.0, r.x0));
				const oy = Math.max(0, Math.min(y + 1.0, r.y1) - Math.max(y + 0.0, r.y0));
				const overlap = Math.min(1, ox) * Math.min(1, oy);
				if (overlap <= 0) continue;
				const idx = y * GRID_W + x;
				pistonOcc[idx] = Math.min(1.0, pistonOcc[idx] + overlap);
				airVol[idx] = Math.max(1e-3, (1.0 - pistonOcc[idx]) * CELL_VOL);
				if (pistonOcc[idx] >= PISTON_FULL) { airN[idx] = 0; airU[idx] = 0; }
			}
		}
	}
}

function faceBlocked(i, j) {
	// Hermetic sealing: air cannot permeate through the solid piston interior.
	const ix = i % GRID_W, iy = (i / GRID_W) | 0;
	const jx = j % GRID_W, jy = (j / GRID_W) | 0;
	const faceX = (ix + jx) * 0.5 + 0.5;
	const faceY = (iy + jy) * 0.5 + 0.5;
	for (let k = 0; k < pistons.length; k++) {
		const r = bodyRect(pistons[k]);
		if (faceX > r.x0 + 1e-4 && faceX < r.x1 - 1e-4 && faceY > r.y0 + 1e-4 && faceY < r.y1 - 1e-4) return true;
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
	const tOf = (n, e) => n > N_MIN ? e / (n * AIR_CV) : 0;
	const hOf = (n, e) => AIR_CP * tOf(n, e); // excess specific enthalpy
	const pOf = (n, e, v = CELL_VOL) => (n / Math.max(1e-3, v)) * R_SPEC * (T_AMB + tOf(n, e)) * P_SCALE;
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
				flux += k * G_COND * (tOf(airN[m], prevU[m]) - tOf(airN[i], prevU[i]));
			}
			const Ti = tOf(airN[i], prevU[i]);
			let cool = (coolingEnabled ? G_LOSS : 0) * Ti; // W to ambient
			if (hsSet.has(i)) cool += G_SINK * Ti;        // Heat Sink item
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
				const eS = hOf(prevN[s], prevE[s]);               // specific excess enthalpy
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
			const eS = hOf(prevN[s], prevE[s]);
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
			const Tin = T_AMB + tOf(prevN[inIdx], prevE[inIdx]);
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
			const eS = hOf(prevN[inIdx], prevE[inIdx]);
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
			airU[s.idx] += dm * AIR_CV * (s.temp - T_AMB);
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
			const ma = bodyMoveAxis(p);
			const span = bodySpan(p);
			const area = (p.axis === ma) ? 1.0 : 2.0; // face area (m²); Case A is 2-wide
			const moveH = ma === 'h';
			const limit = moveH ? GRID_W : GRID_H;
			let minPos = 0, maxPos = limit - span;

			function sliceBlocked(coord) {
				if (coord < 0 || coord >= limit) return true;
				const r = bodyRect(p);
				if (moveH) {
					const y0 = Math.floor(r.y0 + 1e-9), y1 = Math.ceil(r.y1 - 1e-9) - 1;
					for (let y = y0; y <= y1; y++) {
						const idx = y * GRID_W + coord;
						if (grid[idx] !== 0 || blocked[idx] || pumps.some(pmp => pmp.idx === idx)) return true;
					}
				} else {
					const x0 = Math.floor(r.x0 + 1e-9), x1 = Math.ceil(r.x1 - 1e-9) - 1;
					for (let x = x0; x <= x1; x++) {
						const idx = coord * GRID_W + x;
						if (grid[idx] !== 0 || blocked[idx] || pumps.some(pmp => pmp.idx === idx)) return true;
					}
				}
				return false;
			}
			const curLo = Math.floor(p.pos);
			const curHi = Math.floor(p.pos + span);
			for (let c = curLo; c >= 0; c--) { if (sliceBlocked(c)) { minPos = c + 1; break; } }
			for (let c = curHi; c < limit; c++) { if (sliceBlocked(c)) { maxPos = c - span; break; } }

			function getChamber(X0, X1) {
				let mR = 0, uR = 0, vR = 0;
				let mF = 0, uF = 0, vF = 0;
				const rCells = [], fCells = [];
				const rVols = [], fVols = [];
				const r = bodyRect(Object.assign({}, p, { pos: X0 }));
				const perp0 = moveH ? Math.floor(r.y0 + 1e-9) : Math.floor(r.x0 + 1e-9);
				const perp1 = moveH ? Math.ceil(r.y1 - 1e-9) - 1 : Math.ceil(r.x1 - 1e-9) - 1;
				const nPerp = Math.max(1, perp1 - perp0 + 1);
				function addCell(coord, isRear, vol1) {
					for (let s = perp0; s <= perp1; s++) {
						const idx = moveH ? (s * GRID_W + coord) : (coord * GRID_W + s);
						if (grid[idx] !== 0) continue;
						const v = vol1;
						if (v > 1e-5 || (isRear ? coord < Math.floor(X0) : coord > Math.floor(X1))) {
							if (isRear) { rCells.push(idx); rVols.push(v); mR += airN[idx]; uR += airU[idx]; vR += v; }
							else { fCells.push(idx); fVols.push(v); mF += airN[idx]; uF += airU[idx]; vF += v; }
						}
					}
				}
				for (let c = minPos; c <= Math.floor(X0); c++) {
					const v = c < Math.floor(X0) ? CELL_VOL : Math.max(0, (X0 - c) * CELL_VOL);
					addCell(c, true, v);
				}
				const endC = Math.min(limit - 1, maxPos + span - 1);
				for (let c = Math.floor(X1); c <= endC; c++) {
					const v = c > Math.floor(X1) ? CELL_VOL : Math.max(0, (c + 1.0 - X1) * CELL_VOL);
					addCell(c, false, v);
				}
				return { mR, uR, vR, rCells, rVols, mF, uF, vF, fCells, fVols, nPerp };
			}

			const ch = getChamber(p.pos, p.pos + span);

			let pBack = pAmb, pFront = pAmb;
			if (ch.vR >= 0.15 * CELL_VOL && ch.mR > N_MIN) {
				const tRear = ch.uR / (ch.mR * AIR_CV);
				pBack = (ch.mR / ch.vR) * R_SPEC * (T_AMB + tRear) * P_SCALE;
			}
			if (ch.vF >= 0.15 * CELL_VOL && ch.mF > N_MIN) {
				const tFront = ch.uF / (ch.mF * AIR_CV);
				pFront = (ch.mF / ch.vF) * R_SPEC * (T_AMB + tFront) * P_SCALE;
			}

			const F_press = (pBack - pFront) * area;
			p.lastFpress = F_press;
			const F_coil = p.lastFcoil || 0;
			const F_drive = F_press + F_coil;

			const F_static = 1.2 * friction;
			let F_fric = 0, F_net = 0;
			if (Math.abs(p.vel) < 1e-4) {
				if (Math.abs(F_drive) <= F_static) {
					p.vel = 0;
					F_fric = -F_drive;
					F_net = 0;
				} else {
					F_fric = -Math.sign(F_drive) * friction;
					F_net = F_drive + F_fric;
				}
			} else {
				F_fric = -Math.sign(p.vel) * friction - damping * p.vel;
				F_net = F_drive + F_fric;
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
				const dV = dPos * area;
				// Excess-pressure P–V: ambient bulk is isothermal (U stays 0),
				// so mass-overwrite tests stay green; compressed extra mass still heats.
				ch.uR -= (pBack - pAmb) * dV;
				ch.uF += (pFront - pAmb) * dV;
				if (ch.uR < 0) ch.uR = 0;
				if (ch.uF < 0) ch.uF = 0;
				p.pos = newPos;
				if (ma === 'h') p.x = Math.round(newPos);
				else p.y = Math.round(newPos);
				syncPistonOccupancy();

				const chNew = getChamber(newPos, newPos + span);

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
		// (4) derive temp = U / (airN·cv); clamps (safety net only). pressure
		//     P = n·R·T_abs now depends on mass, temperature, AND cut-cell airVol.
		pMinP = pAmb; pMaxP = pAmb;   // auto-track range; reset each step (no extra scan)
		for (let i = 0; i < N; i++) {
			if (!isAir(i)) { temp[i] = 0; pressure[i] = 0; continue; }
			const n = airN[i];
			let t = n > N_MIN ? airU[i] / (n * AIR_CV) : 0;
			if (t > T_MAX) { t = T_MAX; airU[i] = n * AIR_CV * T_MAX; }
			if (t < 0) { t = 0; airU[i] = 0; }
			temp[i] = t;
			pressure[i] = (n / Math.max(1e-3, airVol[i])) * R_SPEC * (T_AMB + t) * P_SCALE;
			if (pressure[i] < pMinP) pMinP = pressure[i];
			if (pressure[i] > pMaxP) pMaxP = pressure[i];
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
	if (lamps.length > 0 || heatSinks.length > 0 || coolingEnabled ||
		airSources.length > 0 || airSinks.length > 0 || pumps.length > 0 || pistons.length > 0)
		return true;
	// Also keep the air sim alive while a pressure gradient exists, so a seeded
	// gradient (e.g. the "empty" dam-break scene) actually advects and then
	// auto-idles once it has equalized.
	const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;
	for (let i = 0; i < pressure.length; i++)
		if (isAir(i) && Math.abs(pressure[i] - pAmb) > 1e-3) return true;
	return false;
}
