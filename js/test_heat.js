// Headless physics test for the heat/air reimplementation.
// Verifies: 1 heat source + 1 heat sink, 10 cells apart, form a SMOOTH
// gradient, and the gradient forms at roughly 5 deg/s (real time, 10x scale).
// This mirrors the equations that will live in electric.js airRelax().

const GRID_W = 31, GRID_H = 31;
const C_AIR_REAL = 1206;      // J/K per 1 m^3 air cell (AIR_RHO*AIR_CP*CELL_VOL)
const T_MAX = 4000;           // safety clamp
const TIME_SCALE = 10;        // sim runs 10x real time
const SUBSTEPS = 8;

// ---- tunable model constants (to be baked into state.js) ----
let G_COND = +(process.argv[2] || 300);    // W/K effective per face (conduction)
let G_SINK = +(process.argv[3] || 300);    // W/K removed by a placed Heat Sink
let P_SRC  = +(process.argv[4] || 3000);   // effective W injected by the source cell (test)
const T_AMB = 293;

const N = GRID_W * GRID_H;
const T = new Float64Array(N);          // excess temperature (K)
const air = new Uint8Array(N).fill(1);  // all cells air for the test

function isAir(i){ return air[i] === 1; }

const SRC = 15 * GRID_W + 5;            // (5,15)
const SNK = 15 * GRID_W + 15;           // (15,15)  -> 10 cells apart in x
const srcSet = new Set([SRC]);
const snkSet = new Set([SNK]);

function step(dt) {
  for (let it = 0; it < SUBSTEPS; it++) {
    const T0 = T.slice();
    for (let i = 0; i < N; i++) {
      if (!isAir(i)) continue;
      const cx = i % GRID_W, cy = (i / GRID_W) | 0;
      let flux = 0; // W
      const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
      for (const [dx,dy] of dirs) {
        const nx = cx+dx, ny = cy+dy;
        if (nx<0||nx>=GRID_W||ny<0||ny>=GRID_H) continue;
        const m = ny*GRID_W+nx; if (!isAir(m)) continue;
        flux += G_COND * (T0[m] - T0[i]);
      }
      let p = srcSet.has(i) ? P_SRC : 0;
      let cool = 0;
      if (snkSet.has(i)) cool += G_SINK * T0[i];
      let dT = (flux + p - cool) / C_AIR_REAL * dt;
      let t = T0[i] + dT;
      if (t < 0) t = 0; if (t > T_MAX) t = T_MAX;
      T[i] = t;
    }
  }
}

// run
const fps = 60, realDt = 1/fps;
const dt = (realDt * TIME_SCALE) / SUBSTEPS;
const maxReal = 60; // simulate 60 real seconds
const frames = fps * maxReal;

// track max rate of change (K per real second) at several cells
const probe = [SRC, 9*GRID_W+10, 15*GRID_W+10, 15*GRID_W+12, SNK];
const prevProbe = new Float64Array(probe.length);
probe.forEach((c,k)=> prevProbe[k]=T[c]);
let maxRate = 0;

function profile() {
  const xs = [5,7,9,11,13,15];
  return xs.map(x => T[15*GRID_W+x].toFixed(1)).join('  ');
}

let lastPrint = -5;
for (let f = 0; f <= frames; f++) {
  if (f < frames) step(dt);
  if (f % (5*fps) === 0) {
    const tReal = f/fps;
    probe.forEach((c,k)=>{
      const rate = Math.abs(T[c]-prevProbe[k]) / 5; // K per real second over this 5s window
      if (rate > maxRate) maxRate = rate;
      prevProbe[k] = T[c];
    });
    if (tReal - lastPrint >= 5) {
      lastPrint = tReal;
      console.log(`t=${tReal.toFixed(0)}s  row(y=15) x5..15: [${profile()}]`);
    }
  }
}

// ---- checks ----
// smoothness: along x=5..15, temp must be monotonically decreasing (source hot -> sink cold)
let mono = true, prev = Infinity;
for (let x = 5; x <= 15; x++) {
  const t = T[15*GRID_W+x];
  if (t > prev + 1e-6) mono = false;
  prev = t;
}
// no oscillation: smooth gradient should not have a local extremum in the interior
let smooth = true;
for (let x = 6; x <= 14; x++) {
  const a = T[15*GRID_W+(x-1)], b = T[15*GRID_W+x], c = T[15*GRID_W+(x+1)];
  if ((b > a && b > c) || (b < a && b < c)) smooth = false;
}
const srcT = T[SRC], snkT = T[SNK];
console.log('\n--- result ---');
console.log('source T =', srcT.toFixed(1), 'K,  sink T =', snkT.toFixed(1), 'K,  swing =', (srcT-snkT).toFixed(1), 'K');
console.log('max rate of change =', maxRate.toFixed(2), 'K/s (target ~5)');
console.log('monotonic source->sink:', mono, ' smooth (no interior extremum):', smooth);
const pass = mono && smooth && maxRate > 1 && maxRate < 20 && (srcT-snkT) > 5;
console.log(pass ? 'PASS' : 'FAIL');
