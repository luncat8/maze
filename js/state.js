const canvas = document.getElementById('ctx');
const ctx = canvas.getContext('2d', { alpha: false });
const logEl = document.getElementById('log');

const CELL_SIZE = 20;
const GRID_W = 31;
const GRID_H = 31;
const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff'];
const LANE = 3;
const STABLE_LANE = 2; // spread for the fixed per-color (stable) lane mode
canvas.width = GRID_W * CELL_SIZE;
canvas.height = GRID_H * CELL_SIZE;

const MIN_SCALE = 0.5, MAX_SCALE = 4;
const view = { scale: 1, offsetX: 0, offsetY: 0 }; // offset in backing-store px

const grid = new Uint8Array(GRID_W * GRID_H).fill(1); // 1 = wall, 0 = corridor
const blocked = new Uint8Array(GRID_W * GRID_H); // 1 = absolute obstacle (blocks all paths), 0 = none
const obstacleKind = new Uint8Array(GRID_W * GRID_H); // 0 none, 1 A, 2 B, 3 C (C keeps existing wires)
const cellUsage = new Map(); // idx -> Set<color>  (occupancy cache for the per-cell path limit)
const circles = new Map();   // idx -> { color, small }
const pathCells = new Map(); // `${color}|${cellType}` -> Set<idx>
const pathEdges = new Map(); // `${color}|${cellType}` -> Set<"a:b"> actual path edges (avoids phantom adjacency links)
const connectedSets = new Map(); // `${color}|${cellType}` -> Set<idx> nodes already incorporated into the network
let selectedColor = COLORS[0];
let mazeType = 'connected';

const els = {
	autoConnect: document.getElementById('autoConnect'),
	autoSpawnNodes: document.getElementById('autoSpawnNodes'),
	autoSpawnTurns: document.getElementById('autoSpawnTurns'),
	preserveWiring: document.getElementById('preserveWiring'),
	pathLimit: document.getElementById('pathLimit'),
	showCellX: document.getElementById('showCellX'),
	stableColorLanes: document.getElementById('stableColorLanes'),
	cooling: document.getElementById('cooling')
};

const statusBar = document.getElementById('statusBar');

function setupPalette() {
	const p = document.getElementById('palette');
	COLORS.forEach((c, i) => {
		const btn = document.createElement('div');
		btn.className = 'swatch' + (i === 0 ? ' active' : '');
		btn.style.background = c;
		btn.onclick = () => {
			document.querySelectorAll('.swatch').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			selectedColor = c;
			updateStatus();
		};
		p.appendChild(btn);
	});
}

// Active editing tool: 'node' (place colored node), 'eraser', 'wall' (toggle),
// 'obstacle' (A/B/C), 'wire' (BUILD/godmode wire or battery), 'lamp', or 'select'.
let activeTool = 'node';
let selectedObstacleType = 'A';
let dragging = false, dirty = false, lastCell = '', hoverCell = null;
let colorView = 'net'; // 'net' (identity color) | 'electric' (voltage heatmap, grey when cold) | 'light' (darkness lit by lamps/wires) | 'voltage' (heatmap + numeric V / dV / R)

// Unlocked GODMODE items live in one radio group together with the scarce
// BUILD Inventory rows and the Select tool. Exactly one entry is active at
// any time; selecting one resets every other member before applying itself.
const GOD_ITEMS = [
	{ id: 'node',   label: 'Node',       tool: 'node' },
	{ id: 'eraser', label: 'Eraser',     tool: 'eraser' },
	{ id: 'wall',   label: 'Wall',       tool: 'wall' },
	{ id: 'obsA',   label: 'Obstacle A', tool: 'obstacle', otype: 'A' },
	{ id: 'obsB',   label: 'Obstacle B', tool: 'obstacle', otype: 'B' },
	{ id: 'obsC',   label: 'Obstacle C', tool: 'obstacle', otype: 'C' },
	{ id: 'wire',   label: 'Wire',       tool: 'wire', inv: 'wire' },
	{ id: 'battery',label: 'Battery',    tool: 'wire', inv: 'battery' },
  { id: 'lamp',   label: 'Lamp',       tool: 'lamp' },
  { id: 'switch', label: 'Switch',     tool: 'switch' },
  { id: 'heatsink', label: 'Heat Sink', tool: 'heatsink' },
  { id: 'airsrc', label: 'Air Source', tool: 'airsrc' },
  { id: 'airsink', label: 'Air Sink', tool: 'airsink' },
  { id: 'pipevalve',  label: 'Pipe Valve',  tool: 'pipevalve'  },
  { id: 'pipeportal', label: 'Pipe Portal', tool: 'pipeportal' },
  { id: 'piston',     label: 'Piston (2x1)',tool: 'piston'     },
  { id: 'solenoid',   label: 'Magnet Piston',tool: 'solenoid'  },
  { id: 'pump',       label: 'Air Pump',    tool: 'pump'       },
  { id: 'metal',  label: 'Metal/Ground',tool: 'metal' },
];
let unlimited = false; // true when the active selection is an unlimited GODMODE item
let activeGodId = null; // id of the active GOD_ITEMS entry, else null

// ---- BUILD-mode inventory (manual wiring) ----------------------------
// Wires are placed COLORLESS. When a wire connects (via a shared cell)
// to a battery pole it takes on that pole's color — see electric.js.
// `segments` are the per-piece cell lengths laid in order (a junction
// node is dropped at every segment boundary). Tweak lengths here.
const INV = {
	battery: { type: 'battery', count: 1, label: 'Battery', term: ['#ff0000', '#0000ff'] },
	lamp: { type: 'lamp', count: 1, label: 'Lamp' },
	switch: { type: 'switch', count: 1, label: 'Switch' },
	heatsink: { type: 'heatsink', count: 1, label: 'Heat Sink' },
	airsrc: { type: 'airsrc', count: 1, label: 'Air Source' },
	airsink: { type: 'airsink', count: 1, label: 'Air Sink' },
	pipevalve:  { type: 'pipevalve',  count: 1, label: 'Pipe Valve'  },
	pipeportal: { type: 'pipeportal', count: 1, label: 'Pipe Portal' },
	piston:     { type: 'piston',     count: 1, label: 'Piston' },
	solenoid:   { type: 'solenoid',   count: 1, label: 'Magnet Piston' },
	pump:       { type: 'pump',       count: 1, label: 'Air Pump' },
};
// Single colorless segment pool (no red/blue split). Map len(>=1) -> count available.
const WIRES = new Map();
function seedWires() { WIRES.clear(); WIRES.set(1, 1); WIRES.set(4, 2); WIRES.set(6, 1); WIRES.set(11, 1); }
function poolTake(lens) { for (const l of lens) { const c = WIRES.get(l) || 0; c <= 1 ? WIRES.delete(l) : WIRES.set(l, c - 1); } }
function poolReturn(lens) { for (const l of lens) WIRES.set(l, (WIRES.get(l) || 0) + 1); }
function poolTotal() { let t = 0; WIRES.forEach((c, l) => t += c * l); return t; }
// Render the pool as a clean "1, 4×2, 6, 11" string (shared by the
// Inventory panel and the status-bar tool label).
function formatWireStock() {
	if (WIRES.size === 0) return 'none';
	return [...WIRES.entries()].sort((a, b) => a[0] - b[0])
		.map(([len, cnt]) => cnt === 1 ? `${len}` : `${len}×${cnt}`).join(', ');
}
// Render a charge value for a source/battery (mirrors the lamp/battery
// property rows). Keeps the "∞" threshold consistent across the app.
function formatCharge(ref) {
	if (ref.maxEnergy >= INFINITE_THRESHOLD) return '∞';
	return Math.round(ref.energy) + ' / ' + ref.maxEnergy + ' J';
}
seedWires();

let selectedInv = 'wire';           // inventory item chosen for the BUILD tool: 'battery' | 'wire'
let wireStrategy = 'a';             // 'a' biggest/min-junctions, 'b' smallest, 'c' manual
let pendingPlan = null;             // awaiting Apply/Cancel: { path, segs, consume, returnBack, cut }
let selectedManualWireLen = null;   // explicit length chosen in manual (c) mode
const manualWires = [];             // placed wires: { color:null, cells:[idx...], nodes:[idx...], segs:[len...] }
const manualBatteries = [];         // placed batteries: { x, y, term:[c0,c1], poles:[idx0,idx1], energy, maxEnergy }
let wireDrag = null;                // active placement: { start, target, path, plan }

// ---- Item drag / move (pointer) state ----
let moveMode = false;               // master "Move items" checkbox (godmove on/off)
let dragMove = null;                // active drag: { kind, ref, free, originCell, moved, valid, path, plan, toCell, grabEnd, fixedEndIdx, grabOffset, grabbedIdx, color }
let pendingMove = null;             // awaiting Enter/Esc (BUILD plan move): { kind, ref, path?, plan?, toCell?, grabOffset?, grabbedIdx?, valid? }
function isMovableKind(kind) {
	return kind === 'lamp' || kind === 'switch' || kind === 'battery' ||
		kind === 'heatsink' || kind === 'airsrc' || kind === 'airsink' ||
		kind === 'pipevalve' || kind === 'pump' || kind === 'piston' ||
		kind === 'solenoid' || kind === 'wire' || kind === 'node' || kind === 'pipeportal';
}
const lamps = [];                   // placed lamps: { x, y, idx, limited, energy, maxEnergy, lumen, wired }
const switches = [];                // placed switches: { x, y, idx, limited, value, wired }
const heatSinks = [];               // placed heat sinks: { x, y, idx, limited } (local thermal radiator)
const airSources = [];               // placed air pressure sources: { x, y, idx, limited, temp, rate }
const airSinks = [];                 // placed air pressure sinks: { x, y, idx, limited, rate }
const pipeValves  = [];              // placed pipe valves: { x, y, idx, limited, open }
const pipePortals = [];              // placed pipe portals: { a, b, limited, open }   both endpoints set
const pistons = [];                  // placed pistons: { id, x, y, axis, pos, vel, friction, damping, mass, limited, lastFpress, lastFfric, blockedWall }
const pumps = [];                    // placed pumps: { x, y, idx, dir, R, efficiency, limited, dV, lastPower, lastFlow, lastDeltaP, lastEff, lastHeat }
let pistonIdSeq = 0;

const bodies = pistons; // alias; pistons remains the array of record
let K_B = 40;           // magnetic kernel gain (slider)
const SIGMA_B = 0.5;    // soft-core radius (cells)
const MAG_RMAX = 8;     // kernel cutoff (cells) — LEGACY ('direct') engine only

// Magnetic engine selection. Four engines are selectable:
//  'tapered' — Analytic-tapered diffusion: Bz is persistent solver
//    state, relaxed by red-black Gauss–Seidel every frame from a local source:
//    the discrete Laplacian of the MAG_RANGE-windowed Biot–Savart field, so
//    the relaxed field IS that analytic field, smoothly tapered instead of
//    hard-cut. Warm-started, O(cells) per sweep, no cutoff discontinuity.
//  'diffusion' (default) — Explicit forward-Euler cell-to-cell diffusion.
//    Bz ← Bz + α·(sum of 4 neighbors − 4·Bz) + S, run for MAG_SWEEPS_PER_FRAME
//    iterations per frame. Source S is the discrete curl of the edge
//    currents, computed in-file from fieldEdges. The field actually spreads
//    between cells frame-by-frame; higher α ⇒ faster spread, lower peak.
//    No back-EMF injection in this plan.
//  'hy3' — Hy3 screened-Poisson (separate file: js/magBzPoissonHy3.js).
//    Solves (∇² − λ²) Bz = S for the curl of J + (when MAG_DIPOLES) each
//    magnet's own dipole. Range is λ (1/λ = decay length), no hard cutoff.
//    Warm-started, with self-field cancellation so a magnet exerts no force on
//    itself but still feels wires and other magnets.
//  'direct' — OBSOLETE legacy path: per-frame Biot–Savart summation over
//    every current edge for every magnet, with a hard MAG_RMAX cutoff. Kept
//    selectable for regression/comparison; no new features planned.
let magEngine = 'diffusion';
// Field radius (cells) of the diffused engine: the kernel is tapered smoothly
// to zero here instead of being hard-cut (the legacy MAG_RMAX jump). Measured
// on the solenoid scenes: the net force is a small residue of large cancelling
// near-field terms, so it flips sign below ~7 cells — hence the default keeps
// the legacy 8-cell radius and lets the taper do the shortening (w(6) ≈ 0.19).
let MAG_RANGE = 8;
const MAG_SWEEPS_PER_FRAME = 50;      // magnetic-field (Bz) relaxation steps per frame;
let magEmitAll = false;               // master switch: every magnet emits its dipole field
const MAG_EMIT_R = 3;                 // dipole source window (cells) around a body

// Hy3 engine tuning ('hy3' in magEngine). See js/magBzPoissonHy3.js.
let MAG_LAMBDA = 0.15;                // screened-Poisson decay (1/λ = decay length in cells)
let MAG_DIPOLES = false;              // 'hy3': magnets also inject their own dipole source

// Diffusion engine tuning ('diffusion' in magEngine). See js/magfield_diffusion.js
// (the new visual-relaxation engine; Hy3's file is js/magBzPoissonHy3.js).
// Per-step forward-Euler rate; the slider caps at 0.24 (CFL requires
// 4·α ≤ 1, and 0.25 is exactly marginal — see magfield_diffusion.js).
let MAG_DIFFUSION_ALPHA = 0.20;

function bodyMoveAxis(b) { return b.moveAxis || b.axis; }
function isCaseA(b) { return !!b.magnet && b.axis && bodyMoveAxis(b) !== b.axis; }
function bodySpan(b) { return (b.axis && bodyMoveAxis(b) === b.axis) ? 2 : (isCaseA(b) ? 1 : 2); }
function bodyHat(b) { return bodyMoveAxis(b) === 'h' ? { ax: 1, ay: 0 } : { ax: 0, ay: 1 }; }
function bodyRect(b) {
	const ma = bodyMoveAxis(b);
	const span = bodySpan(b);
	const pos = b.pos != null ? b.pos : (ma === 'h' ? b.x : b.y);
	if (ma === 'h') {
		const y0 = b.y, y1 = b.y + (b.axis === 'v' ? 2 : 1);
		return { x0: pos, x1: pos + span, y0, y1 };
	}
	const x0 = b.x, x1 = b.x + (b.axis === 'h' ? 2 : 1);
	return { x0, x1, y0: pos, y1: pos + span };
}
function bodyCenter(b) {
	const r = bodyRect(b);
	return { x: (r.x0 + r.x1) * 0.5, y: (r.y0 + r.y1) * 0.5 };
}
function bodyCells(b) {
	const r = bodyRect(b);
	const cells = [];
	const x0 = Math.max(0, Math.floor(r.x0 + 1e-9));
	const x1 = Math.min(GRID_W - 1, Math.ceil(r.x1 - 1e-9) - 1);
	const y0 = Math.max(0, Math.floor(r.y0 + 1e-9));
	const y1 = Math.min(GRID_H - 1, Math.ceil(r.y1 - 1e-9) - 1);
	for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(y * GRID_W + x);
	return cells;
}
function caseABodyAt(idx) {
	for (let i = 0; i < pistons.length; i++) {
		const p = pistons[i];
		if (!isCaseA(p)) continue;
		if (bodyCells(p).includes(idx)) return p;
	}
	return null;
}
function createMechanicalBody(spec) {
	const axis = spec.axis || 'h';
	const moveAxis = spec.moveAxis || axis;
	const x = spec.x || 0, y = spec.y || 0;
	const pos = spec.pos != null ? spec.pos : (moveAxis === 'h' ? x : y);
	return {
		id: ++pistonIdSeq,
		kind: spec.kind || (spec.magnet ? 'solenoid' : 'piston'),
		x, y, axis, moveAxis, pos,
		vel: spec.vel || 0,
		friction: spec.friction != null ? spec.friction : 50,
		damping: spec.damping != null ? spec.damping : 200,
		mass: spec.mass != null ? spec.mass : 100,
		limited: spec.limited != null ? spec.limited : true,
		magnet: !!spec.magnet,
		magStrength: spec.magStrength != null ? spec.magStrength : 1,
		// `emit` makes the body a source of its own dipole field (magnet↔magnet
		// coupling + a visible dipole in the B-field view). Only meaningful for
		// magnets, and only the 'tapered' engine injects it. `magEmitAll` is a
		// GUI master switch that forces every magnet to emit.
		emit: !!spec.emit,
		R_arm: spec.R_arm != null ? spec.R_arm : 2,
		efficiency: spec.efficiency != null ? spec.efficiency : 0.85,
		lastFpress: 0, lastFfric: 0, lastFcoil: 0,
		lastBz: 0, lastEMF: 0, lastCurrent: 0, lastPower: 0, lastHeat: 0,
		blockedWall: false
	};
}

const PUMP_DIRS = [
	{ dx: 0,  dy: -1, arrow: '↑', label: 'North (Up)' },
	{ dx: 1,  dy: 0,  arrow: '→', label: 'East (Right)' },
	{ dx: 0,  dy: 1,  arrow: '↓', label: 'South (Down)' },
	{ dx: -1, dy: 0,  arrow: '←', label: 'West (Left)' }
];
let pendingPortal = null;            // UI ghost only, never in pipePortals: { a }
let selectedItem = null;            // selected maze item: { kind: 'lamp'|'wire'|'battery'|'node', ref }
let lampBaseEff = 100;              // default luminous efficacy (lm/W) for new non-wired lamps
let lampCutEff = 300;                // efficacy (lm/W) when a lamp cuts a wire (wiring bonus)
const BATTERY_ENERGY = 20000;       // capacity (J) of an inventory battery
const INFINITE_ENERGY = 1e15;       // capacity (J) of an unlimited/GODMODE source
const INFINITE_THRESHOLD = 1e12;    // maxEnergy at/above this is treated as "∞"

// Electric simulation result state (populated by electric.js simulate()).
const cellColor = new Map();        // idx -> color assigned by the simulation
const shorts = new Set();           // cells reached by two different poles (short circuit)
const netParent = new Map();        // idx -> DSU parent (connected-network id for energy pooling)

// Closed-circuit (voltage / nodal-analysis) simulation state.
const energized = new Set();        // idx -> part of a closed loop containing a battery
const voltages = new Map();         // idx -> node voltage (V), 0..Vbat
const resPos = new Map();           // idx -> resistance from node to the + pole (Ω)
const resNeg = new Map();           // idx -> resistance from node to the − pole (Ω)
const Vbat = 10;                    // battery voltage (V) — R=0.1..10Ω ⇒ lamp power up to ~1 kW (P=V²/R)
const R_wire = 1;                   // resistance of a wire edge (Ω)
const R_lamp = 10;                  // lamp resistance (Ω)
const R_switch = 0.01;              // closed-switch resistance (Ω)
let R_bat = 0.5;                  // battery internal resistance (Ω), slider 0.1..5
const DV_LIT = 0.05;                // |dV| above which a BUILD (limited) lamp counts as lit
const DV_REF = 1;                   // |dV| that fully lights a BUILD lamp (brightness norm)

// Engine selection + paintable Metal/Ground conductive medium.
// 'field' (diffusion of voltage through a conductive medium with
// resistance-dependent coupling) is the default AND the only engine under
// active development. 'circuit' is the legacy closed-loop nodal graph
// engine — kept selectable and covered by test_electric_demo.js for
// regression, but no new features are planned for it (marked obsolete).
let activeEngine = 'field';
const metalCells = new Uint8Array(GRID_W * GRID_H); // 1 = painted metal/ground conductor
let R_metal = 20;                  // metal medium resistance (Ω), slider 1..200
let userPaused = false;            // manual Play/Pause override of the sim loop

// Thermal constants. Temperature is the air excess (K, reused by the Heat
// view); only the relative/colour mapping is meaningful and the view
// auto-scales. Energy enters via heatSource (lamp Joule power) and leaves by
// conduction/advection. By DEFAULT there is NO global sink (heat accumulates,
// as in the original model), so the simulation warms up gradually; place a
// Heat Sink item to remove heat locally, or enable global ambient cooling
// (G_LOSS) from the settings. Without any sink the T_MAX clamp is the only
// ceiling, so warm-up is bounded and never instantaneous.
const HEAT_SWEEPS_PER_FRAME = 24;  // air sub-steps advanced per animation frame
const P_REF = 1.5;                 // W mapping to ~full brightness at default lamp on 5 V

// Persistent heat-diffusion buffers (warm-started across edits).
const HEAT_N = GRID_W * GRID_H;
const temp = new Float64Array(HEAT_N);       // excess temperature (°) = airU/airN
const heatSource = new Float64Array(HEAT_N); // Joule power per cell (W/cell)
const heatR = new Float64Array(HEAT_N);      // per-cell heat resistance (set by computeHeatSource)

// Air medium (Joule-heated airflow, PV = nRT). Grounded in real units:
// each cell is a 1 m × 1 m × 1 m tunnel (1 m^3) of air, 100% of a lamp's
// dissipated electrical power becomes heat, and time runs 10× real. Air fills
// every open cell (!blocked && grid===0); walls/obstacles are no-flux.
// `airU` is excess internal energy in Joules (U = C_AIR_REAL·temp); `airN`
// is the air mass (kg). Pressure P = n·R·T_abs (Pa).
const T_AMB = 293;                       // ambient absolute T (K, ~20C)
const AIR_RHO = 1.2;                     // kg/m^3 (air at ~20C, 1 atm)
const AIR_CP = 1005;                     // J/(kg·K)               (specific heat at const P)
const AIR_CV = AIR_CP - 287;             // J/(kg·K) ≈ 718; T↔U uses cv (R_SPEC declared below)
const AIR_GAMMA = AIR_CP / AIR_CV;       // ≈ 1.40
const CELL_VOL = 1;                      // m^3 (1m × 1m × 1m tunnel)
const C_AIR_REAL = AIR_RHO * AIR_CP * CELL_VOL; // J/K per cell ≈ 1206 (legacy; conduction uses n·cv)
const AIR_K = 0.026;                     // W/(m·K) molecular thermal conductivity
const G_COND = 200;                      // W/K effective per face (conduction). High enough that heat
                                         // actually spreads across the maze on a watchable timescale
                                         // (the old 0.5 made diffusion ~3000 s — effectively frozen).
const G_LOSS = 2;                        // W/K global Newtonian cooling to ambient per cell (opt-in, settings)
let coolingEnabled = false;              // global ambient cooling toggle (default OFF)
const G_SINK = 400;                      // W/K per cell removed by a placed Heat Sink (local radiator)
const HEAT_GAIN = 6000;                  // visual scaling: a GODMODE lamp's lumen/100 W is multiplied so its
                                         // heat evolves at a watchable rate (~5 K/s). Circuit (BUILD) lamps
                                         // keep their real Joule power and are unaffected by this gain.
const R_SPEC = 287;                      // J/(kg·K) specific gas constant (air)
let TIME_SCALE = 10;                        // simulation runs TIME_SCALE× real time (adjustable via slider)
const N0 = AIR_RHO * CELL_VOL;           // air mass per cell (kg) ≈ 1.2
const N_MIN = 1e-4;                      // floor to avoid divide-by-zero
const P_SCALE = 1;                       // lumped with R_SPEC for Pa
const G_FLOW = 2e-5;                     // kg/(Pa·s) pressure-driven mass flux (per face)
const CFL_FRAC = 0.2;                    // per-face mass cap = CFL_FRAC·N0/dt (strict positivity)
const SRC_T_DEF = 293;                                // Air Source set temperature (K)
const SRC_RATE_DEF = 0.01, SINK_RATE_DEF = 0.01;      // Air Source/Sink mass rate (kg/s)
const LM_EFFICACY = 100;                              // lm/W for GODMODE self-powered lamp power
const T_MAX = 4000;                      // safety clamp on excess temp (K), not a sink
const VEL_SCALE = 15;                    // visual scale for the Pressure-view flow arrows
const VEL_CMAX = 1.6;                    // speed cap (cells/s) for arrow field
const PARTICLES_PER_kPa = 1.2;           // particles per (kPa of cell pressure) per cell, floor 1
const PARTICLES_PER_dPa = 0.4;           // extra particles per (Pa above ambient) per cell
const PARTICLES_MAX = 12;                // hard cap on particles per cell
const PARTICLE_DRIFT = 1.5;              // max drift speed (cells/s) at full cell speed
const PARTICLE_LIFE = 1.4;               // sim-sec before a particle respawns elsewhere in its cell
const airN = new Float64Array(HEAT_N);       // air mass (kg)
const airU = new Float64Array(HEAT_N);       // excess internal energy (J)
const pressure = new Float64Array(HEAT_N);   // n·R·T_abs (Pa)
const P_AMB = N0 * R_SPEC * T_AMB * P_SCALE;   // ambient baseline pressure (Pa)
let pMinP = P_AMB, pMaxP = P_AMB;              // auto-tracked pressure range (air cells only)
const velX = new Float64Array(HEAT_N), velY = new Float64Array(HEAT_N); // cell velocity (Pressure arrows)
const cellParticles = [];                // per-cell: array of {x, y, vx, vy, age}
const cellOpen = new Float32Array(HEAT_N).fill(1); // 0..1 per-cell openness; 1 = open corridor, lower = throttled by valve/portal
const airVol = new Float64Array(HEAT_N).fill(CELL_VOL); // per-cell air volume (m^3)
const pistonOcc = new Float32Array(HEAT_N).fill(0); // 0..1 per-cell piston occupancy fraction
const PISTON_FULL = 0.999;
const G_PORTAL = 2e-5;                     // kg/(Pa·s) pressure-driven mass flux for portal link (start == G_FLOW)
function syncCellOpen() {
	cellOpen.fill(1);
	for (const v of pipeValves) cellOpen[v.idx] = v.open;
	for (const p of pipePortals) { cellOpen[p.a] = p.open; cellOpen[p.b] = p.open; }
}
function cellOccupied(idx) {
	return blocked[idx]
		|| circles.has(idx)
		|| lamps.some(l => l.idx === idx)
		|| switches.some(s => s.idx === idx)
		|| heatSinks.some(h => h.idx === idx)
		|| airSources.some(s => s.idx === idx)
		|| airSinks.some(s => s.idx === idx)
		|| pipeValves.some(v => v.idx === idx)
		|| pipePortals.some(p => p.a === idx || p.b === idx)
		|| pumps.some(p => p.idx === idx)
		|| pistons.some(p => bodyCells(p).includes(idx))
		|| manualWires.some(w => w.cells.includes(idx))
		|| manualBatteries.some(b => b.poles.includes(idx));
}
function seedAir() {
	const pAmb = N0 * R_SPEC * T_AMB * P_SCALE;
	airVol.fill(CELL_VOL);
	pistonOcc.fill(0);
	if (typeof syncPistonOccupancy === 'function') syncPistonOccupancy();
	for (let i = 0; i < airN.length; i++) {
		const occ = pistonOcc[i];
		const frac = occ >= PISTON_FULL ? 0 : Math.max(0, 1.0 - occ);
		airN[i] = frac * N0;
		airU[i] = 0;
		temp[i] = 0;
		pressure[i] = (typeof isAir === 'function' ? isAir(i) : (grid[i] === 0 && !blocked[i])) ? pAmb : 0;
	}
	pMinP = pAmb; pMaxP = pAmb;   // all air cells are ambient after seeding
	for (let i = 0; i < cellParticles.length; i++) cellParticles[i].length = 0;
	for (let i = 0; i < HEAT_N; i++) cellParticles.push([]);
}
seedAir();

// Tiny event bus: operations emit, the simulation + view subscribe.
// Keeps the editor decoupled and ready for a richer electric model.
const bus = (() => {
	const map = new Map();
	return {
		on(ev, fn) { if (!map.has(ev)) map.set(ev, []); map.get(ev).push(fn); },
		off(ev, fn) { const a = map.get(ev) || []; map.set(ev, a.filter(f => f !== fn)); },
		emit(ev, data) { (map.get(ev) || []).forEach(fn => fn(data)); }
	};
})();

// Single radio group: one selection across GODMODE list, BUILD Inventory
// rows, and the Select tool. `opts` carries `{ otype, inv, unlimited, godId }`.
// We first reset the whole group, then apply the new selection so no two
// entries can be highlighted simultaneously.
function setActiveTool(t, opts = {}) {
	// ---- reset the radio group -------------------------------------
	activeGodId = null;
	unlimited = false;
	selectedInv = null;
	pendingMove = null;
	if (document.getElementById('btnSelect')) document.getElementById('btnSelect').classList.remove('active');
	document.querySelectorAll('.otype-btn').forEach(b => b.classList.remove('active'));

	// ---- apply the new selection -----------------------------------
	activeTool = t;
	if (opts.otype) selectedObstacleType = opts.otype;
	if (opts.inv) selectedInv = opts.inv;
	if (opts.unlimited) unlimited = true;
	if (opts.godId) activeGodId = opts.godId;
	if (t !== 'wire') { pendingPlan = null; wireDrag = null; }

	if (t === 'select' && document.getElementById('btnSelect')) document.getElementById('btnSelect').classList.add('active');

	updateStatus();
	renderGodmode();
	renderInventory();
}

// Select a GODMODE item by id (all unlimited).
function selectGod(id) {
	const item = GOD_ITEMS.find(g => g.id === id);
	if (!item) return;
	setActiveTool(item.tool, { otype: item.otype, inv: item.inv, unlimited: true, godId: id });
}

const OBSTACLE_LABEL = { A: 'Cut + ends', B: 'Cut + rebuild', C: 'Keep wire' };

function updateStatus(x, y) {
	if (pendingPlan) {
		statusBar.textContent = 'Plan ready — Apply (Enter) · Cancel (Esc)';
		return;
	}
	if (pendingMove) {
		statusBar.textContent = 'Move plan ready — Apply (Enter) · Cancel (Esc)';
		return;
	}
	const tn = activeTool === 'lamp' ? 'Place Lamp' + (unlimited ? ' (∞)' : ' ×' + INV.lamp.count)
		: activeTool === 'switch' ? 'Place Switch' + (unlimited ? ' (∞)' : ' ×' + INV.switch.count)
		: activeTool === 'heatsink' ? 'Place Heat Sink' + (unlimited ? ' (∞)' : ' ×' + INV.heatsink.count)
		: activeTool === 'airsrc' ? 'Place Air Source' + (unlimited ? ' (∞)' : ' ×' + INV.airsrc.count)
		: activeTool === 'airsink' ? 'Place Air Sink' + (unlimited ? ' (∞)' : ' ×' + INV.airsink.count)
		: activeTool === 'pipevalve' ? 'Place Pipe Valve' + (unlimited ? ' (∞)' : ' ×' + INV.pipevalve.count)
		: activeTool === 'pipeportal' ? 'Place Pipe Portal' + (unlimited ? ' (∞)' : ' ×' + INV.pipeportal.count)
		: activeTool === 'piston' ? 'Place Piston (2x1)' + (unlimited ? ' (∞)' : ' ×' + INV.piston.count)
		: activeTool === 'solenoid' ? 'Place Magnet Piston' + (unlimited ? ' (∞)' : ' ×' + INV.solenoid.count)
		: activeTool === 'pump' ? 'Place Air Pump' + (unlimited ? ' (∞)' : ' ×' + INV.pump.count)
		: activeTool === 'node' ? 'Place Node (' + selectedColor + ')'
		: activeTool === 'eraser' ? 'Eraser'
		: activeTool === 'wall' ? 'Toggle Wall'
		: activeTool === 'wire'
			? (selectedInv === 'battery' ? 'Place Battery' + (unlimited ? ' (∞)' : '')
				: 'Lay Wire (' + (unlimited ? '∞' : wireStrategy.toUpperCase() + ' · stock: ' + formatWireStock()) + ')')
		: activeTool === 'obstacle' ? 'Obstacle · ' + OBSTACLE_LABEL[selectedObstacleType]
		: 'Select · ' + (unlimited ? '∞' : (selectedInv === 'battery' ? 'Battery ×' + INV.battery.count : 'Wire (' + wireStrategy.toUpperCase() + ' · stock: ' + formatWireStock() + ')')) + ' — double-click to pick up';
	let ci = '—', ti = '—', tStr = '—', pStr = '—';
	if (x !== undefined && x >= 0 && x < GRID_W && y >= 0 && y < GRID_H) {
		const idx = y * GRID_W + x;
		ci = '(' + x + ',' + y + ')';
		ti = grid[idx] ? 'Wall' : 'Path';
		tStr = isAir(idx) ? (T_AMB + temp[idx]).toFixed(0) + ' K' : '—';
		pStr = isAir(idx) ? pressure[idx].toFixed(0) + ' Pa' : '—';
	}
  let extra = '';
  if (activeTool === 'wire' && selectedInv !== 'battery' && wireDrag && wireDrag.plan) {
		const p = wireDrag.plan;
		if (p.ok) {
			const total = p.segs.reduce((a, b) => a + b, 0);
			extra = `   |   Plan: ${p.segs.join('+')} = ${total}` + (p.cut ? ' · cut' : ' · no cut');
		} else {
			extra = '   |   Plan: not enough wire';
		}
	}
  const engineName = activeEngine === 'field' ? 'Field' : 'Circuit (obsolete)';
  const magName = magEngine === 'direct' ? 'Direct (obsolete)'
                : magEngine === 'hy3'     ? 'Diffusion-Hy3 (screened)'
                : magEngine === 'tapered' ? 'Diffusion-Ar (tapered)'
                :                           'Diffusion (visual relaxation)';
  const viewName = colorView === 'net' ? 'Net' : colorView === 'electric' ? 'Electric' : colorView === 'voltage' ? 'Voltage' : colorView === 'heat' ? 'Heat' : colorView === 'pressure' ? 'Pressure' : colorView === 'bfield' ? 'B-field' : 'Light';
  statusBar.textContent = `Tool: ${tn}   |   Cell: ${ci}   |   Type: ${ti}${extra}   |   Net: ${selectedColor}   |   View: ${viewName}   |   Engine: ${engineName}   |   Mag: ${magName}   |   T: ${tStr}   |   P: ${pStr}`;
}

const dirs = [{dx:0,dy:-1}, {dx:1,dy:0}, {dx:0,dy:1}, {dx:-1,dy:0}];
const mDirs = [{dx:0,dy:-2}, {dx:2,dy:0}, {dx:0,dy:2}, {dx:-2,dy:0}];

// Pre-allocated BFS buffers (avoids GC churn on every findPath call)
const BFS_N = GRID_W * GRID_H;
const q = new Int32Array(BFS_N);
const parent = new Int32Array(BFS_N).fill(-1);
const visited = new Uint8Array(BFS_N);

function logger(msg, type = '') {
	const div = document.createElement('div');
	div.className = 'log-entry ' + type;
	div.textContent = `[${new Date().toLocaleTimeString([], {hour12:false})}] ${msg}`;
	logEl.prepend(div);
	while (logEl.childElementCount > 200) logEl.lastChild.remove();
}

