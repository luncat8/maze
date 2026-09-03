# Architecture & Implementation Plan: Hermetic Piston & Electric Air Pump

## Executive Summary of Plan Review & Critical Improvements

Following an architectural and physical review, three critical corrections and modernizations have been integrated into this plan:

1. **Direction Mapping Alignment (`dirs` Array Synchronization)**:
   - *Issue Identified*: The engine's canonical `dirs` array in `js/state.js` is ordered as `0 = Up (0, -1)`, `1 = Right (1, 0)`, `2 = Down (0, 1)`, and `3 = Left (-1, 0)`. The initial draft indexed `0 = East`, which would cause a 90° clockwise rotation bug where the UI renders East while the engine executes an upward flux.
   - *Resolution*: Canonical 4-way pump direction indexing is strictly unified with `dirs`:
     - `0`: **North / Up** ($\mathbf{d} = (0, -1)$, arrow `↑`)
     - `1`: **East / Right** ($\mathbf{d} = (+1, 0)$, arrow `→`)
     - `2`: **South / Down** ($\mathbf{d} = (0, +1)$, arrow `↓`)
     - `3`: **West / Left** ($\mathbf{d} = (-1, 0)$, arrow `←`)
     Intake is directly at $\mathbf{x} - \mathbf{d}$, exhaust is directly at $\mathbf{x} + \mathbf{d}$.

2. **Decoupling `isAir` from `blocked` via Variable Air Volume (`airVol`)**:
   - *Issue Identified*: Marking the piston footprint as `blocked = 1` or `isAir = false` turns the piston cells into dead wall holes where $P = 0$ and $V = 0$. This hard-disconnects the two chambers rather than compressing them, making true volumetric gas compression ($P = \frac{n}{V_{air}} R T$) impossible and failing Boyle's Law.
   - *Resolution*: We introduce a continuous per-cell effective air volume field `airVol[i]` ($0 \dots 1.0\text{ m}^3$) and piston occupancy fraction `pistonOcc[i]` ($0 \dots 1.0$). A cell is air as long as `grid[i] === 0` and `pistonOcc[i] < PISTON_FULL` (e.g. 0.999). As the piston moves into a cell, `airVol` physically shrinks, causing pressure $P = \frac{n}{airVol} R T$ to rise naturally, forming a realistic pneumatic cushion without artificial mass teleportation.

3. **GPU-Friendly Continuous Cut-Cell Formulation (No Discrete Offset Shifting)**:
   - *Issue Identified*: Discrete offset threshold shifts (e.g. "when offset $\ge 1.0$, shift base index and manually move mass array elements") require sequential CPU branching, discrete events, and pointer manipulation that cannot be ported to WebGPU compute shaders.
   - *Resolution*: The piston is modeled with continuous floating-point coordinates $(X_{pos}, Y_{pos})$. Each grid cell evaluates its overlap fraction `pistonOcc` in parallel via branchless continuous clamping. Mass conservation is formulated using the standard Arbitrary Lagrangian-Eulerian (ALE) moving-boundary flux equation $J = J_{pressure} + \rho \cdot v_{boundary} \cdot A$. This is 100% parallelizable, stencil-compatible, and requires zero dynamic allocations or CPU synchronization during simulation sweeps.

---

## 1. System Context & Physical Foundations

### 1.1 Architectural Constraints
- **Stack**: Vanilla ES6+ JavaScript, HTML5 Canvas 2D, zero dependencies, zero build steps, `file://` friendly.
- **Grid Geometry**: $31 \times 31$ uniform cells (`GRID_W = 31`, `GRID_H = 31`, total $N = 961$).
- **Cell Metric**: $1\text{ m} \times 1\text{ m} \times 1\text{ m}$ tunnel duct ($V_{nominal} = 1.0\text{ m}^3$).
- **Base Constants**:
  - $T_{AMB} = 293\text{ K}$ (~$20^\circ\text{C}$ ambient).
  - $\rho_0 = 1.2\text{ kg/m}^3$, $c_p = 1005\text{ J/(kg}\cdot\text{K)}$, $R_{spec} = 287\text{ J/(kg}\cdot\text{K)}$.
  - Nominal mass per cell: $N_0 = 1.2\text{ kg}$.
  - Baseline ambient pressure: $P_{amb} = \frac{N_0}{V_{nominal}} R_{spec} T_{AMB} \approx 100,910\text{ Pa}$ (~$101\text{ kPa}$).
  - Flow conductance: $G_{flow} = 2 \times 10^{-5}\text{ kg/(Pa}\cdot\text{s)}$.
  - Conduction conductance: $G_{cond} = 200\text{ W/K}$.
  - Substeps per frame: `HEAT_SWEEPS_PER_FRAME = 24`.
  - Default simulation speed: `TIME_SCALE = 10` ($10\times$ real time).
  - Direction vector definitions in `state.js`:
    ```javascript
    const dirs = [{dx:0,dy:-1}, {dx:1,dy:0}, {dx:0,dy:1}, {dx:-1,dy:0}];
    ```

---

## 2. Subsystem 1: Hermetic Piston Block

```
                                  PISTON MECHANICS & FLUID COUPLING
  +---------------------------------------------------------------------------------------------------+
  |                                                                                                   |
  |  Trailing Chamber (Expanding)                   2x1 PISTON                  Leading Chamber       |
  |                                            [ Continuous X_pos ]              (Compressing)        |
  |                                        +--------------------------+                               |
  |  airVol = (1 - occ) * V_cell           |  Silicone  Metallic Seal |         airVol = (1 - occ)    |
  |  P_back = (n / airVol) * R * T         |   Gasket      Body       |         P_front = (n / airVol)|
  |                                        +--------------------------+                               |
  |                === P_back ===>               ───► Velocity v ───►                 <=== P_front =  |
  |                                                                                                   |
  |                                          Restrained by:                                           |
  |                                          - Static Friction F_s                                    |
  |                                          - Kinetic Coulomb F_k (GUI)                              |
  |                                          - Viscous Damping b * v                                  |
  |                                                                                                   |
  +---------------------------------------------------------------------------------------------------+
```

### 2.1 Cut-Cell Formulation & Gas Thermodynamics

#### 2.1.1 Continuous Position & Occupancy
A piston has continuous position $\mathbf{x} = (X_{pos}, Y_{pos})$ and primary orientation `axis` (`'h'` for horizontal $2\times 1$, `'v'` for vertical $1\times 2$).
- For a horizontal piston spanning length $L = 2.0\text{ cells}$ and width $W = 1.0\text{ cell}$ along row $Y$:
  The piston occupies the continuous 1D interval $[X_{pos}, X_{pos} + 2.0]$.
- For any grid cell $(x, Y)$ along that corridor, the fractional occupancy `pistonOcc` is calculated geometrically:
  $$\text{pistonOcc}(x, Y) = \max\left(0.0, \ \min(x + 1.0, X_{pos} + 2.0) - \max(x + 0.0, X_{pos})\right)$$
  - Cells completely outside the piston: $\text{pistonOcc} = 0.0$.
  - Cells completely inside the piston: $\text{pistonOcc} = 1.0$.
  - Boundary cut-cells (partially occupied): $\text{pistonOcc} \in (0.0, 1.0)$.

#### 2.1.2 Effective Air Volume & State Equation
Each cell maintains a dynamic air volume:
$$\text{airVol}[i] = \max\left(V_{MIN}, \ (1.0 - \text{pistonOcc}[i]) \cdot V_{cell}\right)$$
where $V_{MIN} = 10^{-3}\text{ m}^3$ (prevents division by zero when a cell is nearly filled).

The ideal gas pressure in a cut-cell is given by:
$$P[i] = \frac{airN[i]}{\text{airVol}[i]} \cdot R_{spec} \cdot \left(T_{AMB} + temp[i]\right) \cdot P_{scale}$$

**Physical Implication**:
When the piston advances into cell $i$, `pistonOcc[i]` increases and `airVol[i]` drops from $1.0\text{ m}^3 \to 0.1\text{ m}^3$.
Even before mass leaves the cell, the gas pressure $P[i]$ increases tenfold ($P \propto 1 / V$). This provides:
1. True Boyle's Law volumetric compression ($P \cdot V = \text{const}$).
2. An automatic, physically emergent pneumatic cushion that prevents wall penetration.
3. Natural pressure gradients that drive air advection into adjacent open cells via the existing flow solver.

#### 2.1.3 Hermetic Sealing & Permeability Field
The piston body is hermetically sealed: air cannot permeate through its solid interior.
We define the face openness $k_{face} \in [0.0, 1.0]$ between adjacent cells $i$ and $j$:
- If a cell boundary falls *strictly inside* the piston interval $(X_{pos}, X_{pos} + 2.0)$, the face is sealed:
  $$k_{face} = 0.0$$
- If a face is outside the piston, $k_{face} = \min(\text{cellOpen}[i], \text{cellOpen}[j])$.
- This ensures that air cannot leak across the piston from Chamber A to Chamber B.

---

### 2.2 Piston Dynamics & Friction Mechanics

#### 2.2.1 Driving Pneumatic Force
The pneumatic force exerted on the piston face ($A = 1.0\text{ m}^2$) is computed directly from the cut-cell pressures immediately behind and ahead of the piston:
- Pressure behind trailing face: $P_{back} = P(X_{pos} - \epsilon, Y)$
- Pressure ahead of leading face: $P_{front} = P(X_{pos} + 2.0 + \epsilon, Y)$
- Differential driving force:
  $$F_{press} = (P_{back} - P_{front}) \cdot A \quad (\text{Newtons})$$

#### 2.2.2 Coulomb & Viscous Friction Model
The prompt requires: *"gui show friction... typical movement speed is 0.1...5 cells/s depends on friction and pressure dif"*.
We formulate a robust mechanical friction model:
1. **Coulomb Friction Threshold ($F_k$)**:
   Adjustable via the GUI slider ($0 \dots 500\text{ N}$, default $50\text{ N}$).
   Static friction breakout threshold: $F_{static} = 1.2 \cdot F_k$.
2. **Breakout Condition (Static Friction)**:
   If $|v| < v_{thresh}$ ($10^{-4}\text{ m/s}$) and $|F_{press}| \le F_{static}$:
   $$v = 0, \quad a = 0, \quad F_{friction} = -F_{press}$$
   The piston remains locked in place until pressure overcomes static friction.
3. **Kinetic Friction & Viscous Shear Damping ($b$)**:
   Once moving ($|v| > 0$):
   $$F_{friction} = -\text{sign}(v) \cdot F_k - b \cdot v$$
   where $b = 200\text{ N}\cdot\text{s/m} = 200\text{ kg/s}$.

#### 2.2.3 Calibration to Speed Specification ($0.1 \dots 5.0\text{ cells/s}$)
At terminal velocity ($a = 0$):
$$|v_{term}| = \frac{|F_{press}| - F_k}{b}$$
- For $\Delta P = 80\text{ Pa}$ and $F_k = 50\text{ N}$:
  $$|v| = \frac{80 - 50}{200} = 0.15\text{ cells/s}$$
- For $\Delta P = 450\text{ Pa}$ and $F_k = 50\text{ N}$:
  $$|v| = \frac{450 - 50}{200} = 2.00\text{ cells/s}$$
- For $\Delta P = 1050\text{ Pa}$ and $F_k = 50\text{ N}$:
  $$|v| = \frac{1050 - 50}{200} = 5.00\text{ cells/s}$$
- For $\Delta P \le 60\text{ Pa}$:
  $$|v| = 0.00\text{ cells/s} \quad (\text{locked by static friction})$$
This matches the required behavior.

#### 2.2.4 Maze Wall Collision & Hard Stops
The piston cannot penetrate solid walls (`grid[c] === 1`), outer maze boundaries, or other placed obstacles.
- Forward limit: Let $x_{wall\_fwd}$ be the coordinate of the nearest wall ahead of the piston.
  The maximum allowed leading edge is $x_{wall\_fwd}$. Hence:
  $$X_{pos} \le x_{wall\_fwd} - 2.0$$
- Backward limit: Let $x_{wall\_bwd}$ be the coordinate of the nearest wall behind the piston.
  $$X_{pos} \ge x_{wall\_bwd} + 1.0$$
- If the piston contacts a wall boundary, contact normal force cancels acceleration, setting $v = 0$ and locking position at the contact boundary.

---

### 2.3 GPU-Friendly Moving Boundary Mass Conservation (ALE Formulation)

```
             CUT-CELL ADVECTION WITH MOVING PISTON BOUNDARY
  
       Cell (x)               Boundary (v_b)             Cell (x+1)
  +------------------+                              +------------------+
  |                  |                              |                  |
  |  airVol = 0.7    |==============>==============>|  airVol = 0.3    |
  |  airN[x]         |      J_b = rho * v_b * A     |  airN[x+1]       |
  |                  |    + J_flow(k * dP)          |                  |
  +------------------+                              +------------------+
```

Instead of discrete mass teleportation, mass flux across moving cut-cell boundaries follows the standard Arbitrary Lagrangian-Eulerian (ALE) transport equation:
$$\frac{\partial (\rho V)}{\partial t} + \sum_{faces} J = 0$$
For each cell $i$, the mass change over time step $\Delta t$ is:
$$\Delta airN[i] = \Delta t \cdot \sum_{faces} \left( J_{pressure} + J_{boundary} \right)$$
where:
1. $J_{pressure} = k_{face} \cdot G_{flow} \cdot (P_i - P_j)$ (standard passive Darcy/pressure flow).
2. $J_{boundary} = \rho^* \cdot v_{piston} \cdot A$ (mass swept by the moving piston boundary).
   $\rho^*$ is upwind density:
   - If $v_{piston} > 0$ (moving right), the leading face sweeps air out of the forward cut-cell into the chamber ahead at rate $\rho_{lead} \cdot v_{piston}$.
   - The trailing face expands, entraining air into the newly created volume at rate $\rho_{trail} \cdot v_{piston}$.

**GPU Parallelism**:
- Every face computes its total flux $J_{total}$ from local cell variables.
- Zero CPU intervention.
- Zero array re-indexing.
- Mass is conserved to $< 10^{-7}\text{ kg}$ machine precision across all sweeps.

---

## 3. Subsystem 2: Active Electric Air Pump Block

```
                                  ELECTRIC AIR PUMP BLOCK
  +---------------------------------------------------------------------------------------------------+
  |                                                                                                   |
  |       Intake Cell (x - d)                 PUMP BLOCK (x, y)                 Exhaust Cell (x + d)  |
  |       Upwind Reservoir                    Hermetic Wall Body                Downwind Receiver     |
  |                                                                                                   |
  |       Pressure: P_in                      +---------------+                 Pressure: P_out       |
  |       Temp: T_in                          |  Wall Shell   |                 Temp: T_out           |
  |                                           |     ====>     |                                       |
  |       [ airVol_in ]                       |  (Dir Vector) |                 [ airVol_out ]        |
  |                                           +---------------+                                       |
  |                     ==== Active Flux J_pump ====>                   ==== Pushed Mass ====>        |
  |                                                                                                   |
  |                     Electric Network Coupling:                                                    |
  |                     - Resistance R (0.1..10 Ω)                                                    |
  |                     - Efficiency η_base (0..100%)                                                 |
  |                     - Power P_elec = (ΔV)² / R                                                    |
  |                     - Waste Heat Q = (1 - η_eff) * P_elec                                         |
  |                                                                                                   |
  +---------------------------------------------------------------------------------------------------+
```

### 3.1 4-Way Direction & Vector Geometry

The 4-way direction setting $\theta \in \{0, 1, 2, 3\}$ is aligned with the engine's `dirs` array:

$$\text{dirs} = \big[\,(0, -1), \ (1, 0), \ (0, 1), \ (-1, 0)\,\big]$$

| Setting (`dir`) | Cardinal Direction | Vector $\mathbf{d}$ (`dx, dy`) | Intake Cell $\mathbf{x} - \mathbf{d}$ | Exhaust Cell $\mathbf{x} + \mathbf{d}$ | Canvas Glyph |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **`0`** | **North / Up** | `( 0, -1)` | `(x, y + 1)` (South) | `(x, y - 1)` (North) | `↑` |
| **`1`** | **East / Right** | `(+1,  0)` | `(x - 1, y)` (West) | `(x + 1, y)` (East) | `→` |
| **`2`** | **South / Down** | `( 0, +1)` | `(x, y - 1)` (North) | `(x, y + 1)` (South) | `↓` |
| **`3`** | **West / Left** | `(-1,  0)` | `(x + 1, y)` (East) | `(x - 1, y)` (West) | `←` |

- **Hermetic Wall Property**:
  The pump block cell $(x, y)$ is a non-air cell (`isAir(idx) === false`, `cellOpen[idx] = 0`).
  When unpowered ($P_{elec} = 0$), passive flux is strictly zero:
  $$J_{passive} = 0, \quad q_{cond} = 0$$
- **Deadhead Condition**:
  If either intake or exhaust is a solid maze wall (`grid === 1`), another blocked obstacle, or out of bounds, active flow stalls: $\dot{m} = 0$.

---

### 3.2 Electrical Field Network Coupling

1. **Resistance Slider**: Parameter $R_{pump} \in [0.1, 10.0]\ \Omega$ (default $10.0\ \Omega$, same as Lamp).
2. **Efficiency Slider**: Base mechanical efficiency $\eta_{base} \in [0.0, 1.0]$ (default $0.70$).
3. **Field Relaxation Integration (`electric.js`)**:
   Inside `cellR(idx)`:
   ```javascript
   if (pumpByIdx.has(idx)) {
     const p = pumpByIdx.get(idx);
     return p.limited ? (p.R != null ? p.R : 10.0) : R_wire;
   }
   ```
4. **Voltage Drop & Power Consumption**:
   The nodal solver derives voltage potential $V$ across the pump's electrical connections.
   $$\Delta V = |V_A - V_B|$$
   $$P_{elec} = \frac{(\Delta V)^2}{R_{pump}}$$
5. **BUILD vs GODMODE Parity**:
   - In **BUILD Mode** (`pump.limited = true`): Consumes active power $P_{elec}$ and drains the connected battery network (`netParent`). If $\Delta V < 0.05\text{ V}$, $P_{elec} = 0$ (pump remains off).
   - In **GODMODE** (`pump.limited = false`): Self-powered at rated power $P_{elec} = 10.0\text{ W}$, consuming 0 battery charge.

---

### 3.3 Thermodynamic Efficiency Model & Calibration

```
       REALISTIC PUMP EFFICIENCY AS A FUNCTION OF HEAD & INLET TEMP
  
    Efficiency η
        ^
    1.0 |                   .---.  Best Efficiency Point (BEP)
        |                 /       \
        |               /           \
        |             /               \
    0.0 +------------+-----------------+----------------------> Head ΔP
        0        Free Flow         ΔP_stall
```

#### 3.3.1 Head Pressure Efficiency Curve ($\eta_{press}$)
Real pumps exhibit zero thermodynamic fluid efficiency at free flow ($\Delta P = 0$) and at stall ($\Delta P = \Delta P_{stall}$).
Peak aerodynamic efficiency occurs at the Best Efficiency Point (BEP, $\Delta P_{BEP} = 0.5 \Delta P_{stall}$):
$$\Delta P = P_{out} - P_{in}$$
$$\eta_{press}(\Delta P) = \max\left(0.0, \ 4 \cdot \frac{\Delta P}{\Delta P_{stall}} \left( 1 - \frac{\Delta P}{\Delta P_{stall}} \right)\right) \quad (\text{for } 0 \le \Delta P \le \Delta P_{stall})$$
where $\Delta P_{stall} = 1000\text{ Pa}$ (~$0.01\text{ atm}$).
If $\Delta P \ge \Delta P_{stall}$, the pump stalls ($\eta_{press} = 0, \dot{m} = 0$).

#### 3.3.2 Intake Temperature & Rarefaction Factor ($\eta_{temp}$)
Compressing high-temperature gas requires more work and suffers higher volumetric displacement losses:
$$\eta_{temp}(T_{in}) = \sqrt{\frac{T_{AMB}}{T_{AMB} + temp_{in}}} = \left(\frac{293}{293 + temp_{in}}\right)^{0.5}$$
For ambient air ($temp_{in} = 0\text{ K}$), $\eta_{temp} = 1.0$.
For hot exhaust gas ($temp_{in} = 107\text{ K}$, $T = 400\text{ K}$), $\eta_{temp} \approx 0.85$ ($15\%$ degradation).

#### 3.3.3 Combined Operational Efficiency
$$\eta_{eff} = \eta_{base} \cdot \eta_{press}(\Delta P) \cdot \eta_{temp}(T_{in})$$

#### 3.3.4 Mass Transfer Rate & Performance Calibration
The prompt specifies: *"typical performance - think what is good. like 1kg /s for 1W or 1L/s . think what are reasonable values for our scenes."*
- Useful fluid power: $\dot{W}_{fluid} = \frac{\dot{m}}{\rho_{in}} \Delta P$.
- At nominal electrical power $P_{elec} = 10\text{ W}$ and $\eta = 50\%$, fluid power is $5.0\text{ W}$.
- Against $\Delta P = 100\text{ Pa}$, volume flow is $\dot{V} = \frac{5.0\text{ W}}{100\text{ Pa}} = 0.05\text{ m}^3/\text{s} = 50\text{ L/s}$.
- Mass flow is $\dot{m} = 1.2 \times 0.05 = 0.06\text{ kg/s}$ ($60\text{ g/s}$).
- Rated maximum free-delivery flow ($P_{elec} = 10\text{ W}$, $\Delta P = 0$): $\dot{m}_{max} = 0.10\text{ kg/s}$ ($83\text{ L/s}$).
- Pumping formula:
  $$\dot{m} = \dot{m}_{max} \cdot \sqrt{\frac{P_{elec}}{10.0}} \cdot \left(1 - \frac{\Delta P}{\Delta P_{stall}}\right) \cdot \frac{\rho_{in}}{\rho_0}$$
  clamped to CFL limit $\Delta m \le 0.4 \cdot airN_{in}$.

#### 3.3.5 Thermodynamic Heat Dissipation
Electrical energy not converted into kinetic/compression energy of the fluid becomes waste heat:
$$\dot{Q}_{waste} = P_{elec} \cdot (1 - \eta_{eff})$$
$\dot{Q}_{waste}$ is injected directly into `heatSource[pump.idx]`, heating the pump block body and warming the exhaust air.

---

## 4. Complete Data Structures & State Management

### 4.1 State Additions (`js/state.js`)

```javascript
// ==========================================
// PISTON & PUMP STATE EXTENSIONS
// ==========================================

// Global lists of active devices
const pistons = [];
const pumps = [];

// Per-cell effective air volume (m³) and piston occupancy fraction [0..1]
const airVol = new Float64Array(HEAT_N).fill(CELL_VOL);
const pistonOcc = new Float32Array(HEAT_N).fill(0);
const PISTON_FULL = 0.999; // Occupancy threshold above which cell is non-air

// GPU-aligned flat typed arrays (WebGPU compute shader ready)
const MAX_PISTONS = 32;
const pistonGPUData = new Float32Array(MAX_PISTONS * 8); 
// Layout per piston: [posX, posY, axis(0=h,1=v), vel, friction, damping, mass, active]

const MAX_PUMPS = 32;
const pumpGPUData = new Float32Array(MAX_PUMPS * 8);
// Layout per pump: [x, y, dir(0..3), R, efficiency, power, flow, active]

// Decoupled air cell validator
function isAir(i) {
    return grid[i] === 0 && !blocked[i] && pistonOcc[i] < PISTON_FULL;
}

// Direction definitions aligned with state.js:
// dirs[0] = {dx:0, dy:-1} (Up/North)
// dirs[1] = {dx:1, dy:0}  (Right/East)
// dirs[2] = {dx:0, dy:1}  (Down/South)
// dirs[3] = {dx:-1, dy:0} (Left/West)
const PUMP_DIRS = [
    { dx: 0,  dy: -1, arrow: '↑', label: 'North (Up)' },
    { dx: 1,  dy: 0,  arrow: '→', label: 'East (Right)' },
    { dx: 0,  dy: 1,  arrow: '↓', label: 'South (Down)' },
    { dx: -1, dy: 0,  arrow: '←', label: 'West (Left)' }
];
```

### 4.2 Instance Models
- **Piston Instance**:
  ```javascript
  {
    id: number,
    x: number,              // base cell X (integer)
    y: number,              // base cell Y (integer)
    axis: 'h' | 'v',        // 'h' = horizontal (2x1), 'v' = vertical (1x2)
    pos: number,            // continuous position coordinate along axis
    vel: number,            // continuous velocity (cells/s)
    friction: number,       // Coulomb friction threshold F_k (N), slider 0..500
    damping: number,        // viscous damping b (N*s/m), default 200
    mass: number,           // mass (kg), default 100
    limited: boolean,       // true in BUILD mode, false in GODMODE
    lastFpress: number,     // telemetry: pneumatic force (N)
    lastFfric: number,      // telemetry: friction force (N)
    blockedWall: boolean    // telemetry: wall contact status
  }
  ```
- **Pump Instance**:
  ```javascript
  {
    x: number,              // cell X
    y: number,              // cell Y
    idx: number,            // y * GRID_W + x
    dir: 0 | 1 | 2 | 3,     // 0=N, 1=E, 2=S, 3=W (matches dirs)
    R: number,              // resistance (slider 0.1..10.0 ohms, default 10.0)
    efficiency: number,     // base efficiency slider (0.0..1.0, default 0.70)
    limited: boolean,       // true in BUILD mode, false in GODMODE
    dV: number,             // electrical voltage drop (V)
    lastPower: number,      // power consumed (W)
    lastFlow: number,       // mass flow rate (kg/s)
    lastDeltaP: number,     // pressure head (Pa)
    lastEff: number,        // actual operating efficiency (0.0..1.0)
    lastHeat: number        // heat dissipated (W)
  }
  ```

---

## 5. Unified Simulation Loop Architecture

The animation loop (`simTick`) integrates electric diffusion, fluid advection, and piston mechanics in a strict sequential pipeline:

```
                            Unified Frame Tick (simTick)
                                         │
        ┌────────────────────────────────┴────────────────────────────────┐
        ▼                                                                 ▼
 1. Electric Field Relaxation (fieldRelax)                   2. Substep Fluid Sweeps (airRelax)
    - Gauss-Seidel solve for conductive grid                    Advance 24 substeps (dt):
    - Pump electrical load cellR(idx)                           a. Conduction across open faces
    - Derive pump dV across terminals                           b. Passive mass flow J_flow(dP)
    - Compute P_elec = (dV)² / R                                c. Active pump flux J_pump
        │                                                       d. Piston F_press & friction
        │                                                       e. Piston kinematics (v, pos)
        ▼                                                       f. Update pistonOcc & airVol
 3. Thermodynamic Heat Generation (computeHeatSource)           g. ALE moving boundary flux J_b
    - Joule heat from electric conductors                       h. Update P = (n / airVol) * R * T
    - Pump waste heat Q = (1 - η) * P_elec                              │
        └────────────────────────────────┬──────────────────────────────┘
                                         ▼
                   4. Particle Streamline Update (updateFlow)
                                         │
                                         ▼
                   5. Canvas 2D View Render (render)
```

---

## 6. UI, Tooling & DOM Integration

### 6.1 HTML Property Templates (`index.html`)

```html
<!-- PISTON PROPERTY PANEL -->
<template id="prop-tpl-piston">
  <div class="prop-close" data-close>&#x2715;</div>
  <h4>Piston (2×1)</h4>
  <div class="prop-sub">Configuration</div>
  <div class="prop-row"><span>Cells</span><span data-bind="cells"></span></div>
  <div class="prop-row"><span>Orientation</span><span data-bind="axis"></span></div>
  <div class="prop-sub">Friction Dynamics</div>
  <label class="ctrl">
    <span>Friction (N)</span>
    <span class="ctrl-val" data-bind="fricHead"></span>
    <input type="range" data-input="friction" min="0" max="500" step="5" value="50">
  </label>
  <div class="prop-sub">Live Telemetry</div>
  <div class="prop-row"><span>Velocity</span><span data-bind="speed"></span></div>
  <div class="prop-row"><span>ΔP (Drive)</span><span data-bind="deltaP"></span></div>
  <div class="prop-row"><span>F_press</span><span data-bind="fPress"></span></div>
  <div class="prop-row"><span>F_fric</span><span data-bind="fFric"></span></div>
  <div class="prop-row"><span>Status</span><span data-bind="status"></span></div>
  <button data-return>Return to inventory</button>
</template>

<!-- AIR PUMP PROPERTY PANEL -->
<template id="prop-tpl-pump">
  <div class="prop-close" data-close>&#x2715;</div>
  <h4>Air Pump</h4>
  <div class="prop-sub">Configuration</div>
  <div class="prop-row"><span>Cell</span><span data-bind="pos"></span></div>
  <label class="ctrl">
    <span>Direction</span>
    <span class="ctrl-val" data-bind="dirHead"></span>
    <input type="range" data-input="dir" min="0" max="3" step="1" value="1">
  </label>
  <div class="prop-sub">Electrical Input</div>
  <div data-show="limited">
    <label class="ctrl">
      <span>Resistance (Ω)</span>
      <span class="ctrl-val" data-bind="rHead"></span>
      <input type="range" data-input="R" min="0.1" max="10" step="0.1" value="10">
    </label>
  </div>
  <label class="ctrl">
    <span>Efficiency (%)</span>
    <span class="ctrl-val" data-bind="effHead"></span>
    <input type="range" data-input="efficiency" min="0" max="100" step="1" value="70">
  </label>
  <div class="prop-sub">Live Telemetry</div>
  <div class="prop-row"><span>ΔV (drop)</span><span data-bind="dV"></span></div>
  <div class="prop-row"><span>Power (Elec)</span><span data-bind="power"></span></div>
  <div class="prop-row"><span>Flow Rate</span><span data-bind="flow"></span></div>
  <div class="prop-row"><span>Head (ΔP)</span><span data-bind="head"></span></div>
  <div class="prop-row"><span>Net Efficiency</span><span data-bind="actualEff"></span></div>
  <div class="prop-row"><span>Waste Heat</span><span data-bind="heat"></span></div>
  <div class="prop-row"><span>Status</span><span data-bind="status"></span></div>
  <button data-return>Return to inventory</button>
</template>
```

### 6.2 Tool Definitions & Inventory Registration

1. **`GOD_ITEMS` in `state.js`**:
   ```javascript
   { id: 'piston', label: 'Piston (2x1)', tool: 'piston' },
   { id: 'pump',   label: 'Air Pump',     tool: 'pump' },
   ```
2. **`INV` in `state.js`**:
   ```javascript
   piston: { type: 'piston', count: 1, label: 'Piston' },
   pump:   { type: 'pump',   count: 1, label: 'Air Pump' },
   ```
3. **Property Binder Registration in `render.js`**:
   - `BIND_FNS.piston`:
     - `cells`: `p => `(${p.x},${p.y})–(${p.axis==='h'?p.x+1:p.x},${p.axis==='h'?p.y:p.y+1})``
     - `axis`: `p => p.axis === 'h' ? 'Horizontal (X)' : 'Vertical (Y)'`
     - `fricHead`: `p => p.friction.toFixed(0) + ' N'`
     - `speed`: `p => (p.vel).toFixed(2) + ' cells/s'`
     - `deltaP`: `p => (p.lastFpress).toFixed(0) + ' Pa'`
     - `fPress`: `p => (p.lastFpress).toFixed(1) + ' N'`
     - `fFric`: `p => (p.lastFfric).toFixed(1) + ' N'`
     - `status`: `p => p.blockedWall ? 'Wall Contact' : Math.abs(p.vel) < 0.01 ? 'Locked (Friction)' : 'Moving'`
   - `BIND_FNS.pump`:
     - `pos`: `p => cellLabel(p.idx)`
     - `dirHead`: `p => PUMP_DIRS[p.dir].label`
     - `rHead`: `p => p.R.toFixed(1) + ' Ω'`
     - `effHead`: `p => (p.efficiency * 100).toFixed(0) + '%'`
     - `dV`: `p => p.dV ? p.dV.toFixed(2) + ' V' : '0.00 V'`
     - `power`: `p => p.limited ? p.lastPower.toFixed(2) + ' W' : '10.0 W (GODMODE)'`
     - `flow`: `p => `${(p.lastFlow * 1000).toFixed(1)} g/s (${(p.lastFlow / 1.2 * 1000).toFixed(1)} L/s)``
     - `head`: `p => p.lastDeltaP.toFixed(0) + ' Pa'`
     - `actualEff`: `p => `${(p.lastEff * 100).toFixed(1)}%``
     - `heat`: `p => `${p.lastHeat.toFixed(2)} W``
     - `status`: `p => p.lastPower > 0.05 ? (p.lastFlow > 1e-4 ? 'Pumping' : 'Stalled') : 'Off'`

---

## 7. Canvas 2D Rendering Specifications (`js/render.js`)

```
   PUMP BLOCK RENDERING                         PISTON RENDERING (2x1)
+----------------------------+             +----------------------------------+
|   [ Heavy Wall Housing ]   |             |  [ Sub-pixel Interpolated Body ] |
|   +--------------------+   |             |  +---------------+------------+  |
|   | Directional Arrow  |   |             |  | Cyan Gasket   | Slate Steel|  |
|   | (↑, →, ↓, or ←)   |   |             |  | Seal Edge     | Face Plate |  |
|   | Electric Status    |   |             |  +---------------+------------+  |
|   +--------------------+   |             |          Friction Badge          |
+----------------------------+             +----------------------------------+
```

### 7.1 Piston Rendering
- **Smooth Sub-pixel Motion**: The body is translated by continuous floating-point coordinate `piston.pos * CELL_SIZE`, avoiding visual cell-popping.
- **Visual Palette**:
  - Main Body: Slate steel fill (`#334155`) with high-contrast inner bevel (`#475569`).
  - Gasket Seals: Accent caps (`#38bdf8` cyan silicone) on the sliding faces indicating hermetic sealing.
  - Telemetry Overlay: Central friction chevron badge indicating $F_k$ magnitude.
  - In `Pressure View`: Color-coded vector arrows indicating driving pneumatic force $F_{press}$ and movement direction.

### 7.2 Pump Block Rendering
- **Industrial Housing**: Reinforced dark-iron housing (`#1e293b`) with corner rivets matching wall thickness.
- **Directional Indicator**:
  - Canvas vector arrow centered in the cell, oriented to `PUMP_DIRS[p.dir]`.
  - Color state:
    - Active pumping: Glowing cyan (`#06b6d4`).
    - Stalled (overpressure): Pulsing amber (`#f59e0b`).
    - Unpowered / Off: Muted dark slate (`#64748b`).
- **Electric Potential Ring**: Outer border stroked with `voltageColor(V)`, visually linking the pump to the electrical network.

---

## 8. WebGPU / Compute Shader Optimization Architecture

| Architectural Feature | CPU Vanilla JS Implementation | WebGPU Compute Shader Mapping |
| :--- | :--- | :--- |
| **Grid Data Storage** | Flat typed arrays (`Float32Array(961)`). | Uniform `storageBuffer` (`array<f32, 961>`). |
| **Piston Cut-Cell Rasterization** | Continuous branchless overlap math. | Kernel evaluates `pistonOcc` per cell in parallel. |
| **Volume & State Step** | $P_i = \frac{n_i}{airVol_i} R T_i$. | Parallel compute pass over $31 \times 31$ workgroups. |
| **Moving Boundary Flux** | ALE mass flux $J_b = \rho \cdot v_b \cdot A$. | Parallel per-face flux computation with double buffering. |
| **Directional Pump Flux** | Evaluated on `pumps[]` instances. | Direct scatter/gather texture writes via compute kernel. |
| **Branch Avoidance** | Pre-calculated neighbor offsets `dirs`. | Fixed compile-time arrays `array<vec2<i32>, 4>`. |

---

## 9. Implementation Roadmap & Milestones

```
Phase 1: State & UI Foundations
- Add piston and pump arrays in state.js
- Add airVol and pistonOcc arrays in state.js
- Correct dirs alignment for 4-way pump directions
- Add HTML templates in index.html
- Register tools in ui.js
               │
               ▼
Phase 2: Active Electric Pump Implementation
- Connect pump resistance in electric.js fieldSimulate
- Derive dV and electrical power in fieldPublish
- Implement active mass flux in air.js airRelax
- Implement η(ΔP, T) efficiency curves and waste heat
- Implement canvas directional arrow in render.js
               │
               ▼
Phase 3: Hermetic Piston Implementation
- Implement cut-cell volume calculation (airVol, pistonOcc)
- Decouple isAir from blocked in state.js
- Implement pneumatic force F_press and friction solver
- Implement ALE moving-boundary mass transport
- Implement wall collision clamping
- Implement smooth sub-pixel rendering in render.js
               │
               ▼
Phase 4: Property Binders & Telemetry
- Wire up propPanel binders for piston and pump
- Connect live readouts: speed, F_press, flow rate, efficiency
- Enable return-to-inventory and deletion
               │
               ▼
Phase 5: Interactive Scene & Automated Headless Tests
- Create "piston-pump" preset scene in ui.js
- Create test_piston_pump.js headless verification script
```

---

## 10. Automated Headless Verification Suite (`js/test_piston_pump.js`)

A dedicated automated test suite (`js/test_piston_pump.js`) validates all physical invariants:

1. **Direction Vector Invariant**:
   - Asserts that `pump.dir = 0` points North `(0, -1)`, matching `dirs[0]`.
   - Asserts intake cell is $(x, y+1)$ and exhaust cell is $(x, y-1)$.
2. **Static Friction Locking Test**:
   - Tunnel setup with $F_k = 50\text{ N}$ ($F_{static} = 60\text{ N}$).
   - Apply $\Delta P = 40\text{ Pa}$ ($F_{press} = 40\text{ N}$).
   - Asserts velocity remains exactly $0.000\text{ cells/s}$.
3. **Terminal Velocity Dynamic Range Test**:
   - Set $\Delta P = 100\text{ Pa} \implies v \in [0.20, 0.30]\text{ cells/s}$.
   - Set $\Delta P = 500\text{ Pa} \implies v \in [2.10, 2.40]\text{ cells/s}$.
   - Set $\Delta P = 1050\text{ Pa} \implies v \in [4.80, 5.20]\text{ cells/s}$.
4. **Mass Conservation During Cut-Cell Sweeping**:
   - Piston advances continuously across 10 cells in a sealed tunnel.
   - Asserts $|\sum airN_{final} - \sum airN_{initial}| < 10^{-7}\text{ kg}$.
5. **Electric Pump Power & Energy Conservation**:
   - Verifies pump with $R=10\ \Omega$ on 10V battery draws $P_{elec} \approx 8\dots 9\text{ W}$.
   - Confirms thermodynamic energy balance: $P_{elec} = \dot{W}_{fluid} + \dot{Q}_{waste}$.
6. **Deadhead Stall & Hermetic Sealing**:
   - Pump sealed against closed chamber reaching $\Delta P > 1000\text{ Pa}$.
   - Asserts flow rate drops to $< 10^{-5}\text{ kg/s}$, net efficiency drops to $0\%$, and zero passive back-leakage occurs.
