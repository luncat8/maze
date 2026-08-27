function isPassable(nid, color, type, limit) {
	if (grid[nid] !== type) return false;     // wrong field (existing rule)
	if (blocked[nid]) return false;           // universal absolute avoidance
	if (limit > 0) {                          // per-cell path limit
		const usage = cellUsage.get(nid);
		if (usage && usage.size >= limit && !usage.has(color)) return false;
	}
	return true;
}

// BFS restricted to a single cell type. Returns shortest path from startIdx
// to any node in `connectedSet`, or (when autoSpawn) to any cell already in `set`.
function findPath(startIdx, connectedSet, set, autoSpawn, currentColor, limit) {
	const type = grid[startIdx];
	visited.fill(0);
	parent.fill(-1);
	let head = 0, tail = 0;
	q[tail++] = startIdx;
	visited[startIdx] = 1;

	while (head < tail) {
		const curr = q[head++];
		if (curr !== startIdx && (connectedSet.has(curr) || (autoSpawn && set.has(curr)))) {
			const path = [];
			let temp = curr;
			while (temp !== -1) { path.push(temp); temp = parent[temp]; }
			return { path, junction: curr };
		}
		const cx = curr % GRID_W, cy = (curr / GRID_W) | 0;
		for (let i = 0; i < 4; i++) {
			const nx = cx + dirs[i].dx, ny = cy + dirs[i].dy;
			if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
			const nid = ny * GRID_W + nx;
			if (visited[nid] || !isPassable(nid, currentColor, type, limit)) continue;
			visited[nid] = 1;
			parent[nid] = curr;
			q[tail++] = nid;
		}
	}
	return null;
}

// Greedy nearest-neighbor spanning tree over one (color, cellType) group.
// Connect a list of nodes into the given (possibly pre-existing) network.
// `connected`/`set`/`edges` are mutated in place, so callers can pass fresh
// sets (full rebuild) or persistent ones (preserve-wiring mode).
function connectNodes(nodeList, color, type, autoSpawn, autoSpawnTurns, connected, set, edges, tapWire, limit) {
	if (nodeList.length === 0) return;
	const remaining = nodeList.slice();
	if (connected.size === 0) {
		const first = remaining.shift();
		connected.add(first);
		set.add(first);
		if (!cellUsage.has(first)) cellUsage.set(first, new Set());
		cellUsage.get(first).add(color);
	}

	while (remaining.length > 0) {
		let best = null, bestRem = -1, bestJunction = -1;
		for (let i = 0; i < remaining.length; i++) {
			const res = findPath(remaining[i], connected, set, tapWire, color, limit);
			if (res && (!best || res.path.length < best.length)) {
				best = res.path;
				bestRem = i;
				bestJunction = res.junction;
			}
		}

	if (!best) {
		// No path within this cell type (isolated island): start a new component.
		const seed = remaining[0];
		connected.add(seed);
		set.add(seed);
		if (!cellUsage.has(seed)) cellUsage.set(seed, new Set());
		cellUsage.get(seed).add(color);
		remaining.splice(0, 1);
		continue;
	}

		for (const id of best) {
			set.add(id);
			if (!cellUsage.has(id)) cellUsage.set(id, new Set());
			cellUsage.get(id).add(color);
		}
		for (let i = 0; i < best.length - 1; i++) {
			const a = best[i], b = best[i + 1];
			edges.add(Math.min(a, b) + ':' + Math.max(a, b));
		}
		if (autoSpawnTurns) {
			for (let i = 1; i < best.length - 1; i++) {
				const prev = best[i - 1], curr = best[i], next = best[i + 1];
				const d1x = (curr % GRID_W) - (prev % GRID_W);
				const d1y = ((curr / GRID_W) | 0) - ((prev / GRID_W) | 0);
				const d2x = (next % GRID_W) - (curr % GRID_W);
				const d2y = ((next / GRID_W) | 0) - ((curr / GRID_W) | 0);
				if ((d1x !== d2x || d1y !== d2y) && !circles.has(curr)) {
					circles.set(curr, { color, small: true });
				}
			}
		}
		if (autoSpawn && bestJunction !== -1 && !circles.has(bestJunction)) {
			circles.set(bestJunction, { color, small: true });
			logger(`Junction spawned at ${bestJunction % GRID_W},${(bestJunction / GRID_W) | 0}`);
		}
		connected.add(remaining[bestRem]);
		remaining.splice(bestRem, 1);
	}
}

// Per (color, cellType) group: either rebuild from scratch or, in preserve
// mode, only attach newly placed nodes while keeping every existing wire.
function connectGroup(nodes, color, type, autoSpawn, autoSpawnTurns, preserve, limit) {
	const key = color + '|' + type;
	let set, edges, connected;
	if (preserve && pathCells.has(key)) {
		set = pathCells.get(key);
		edges = pathEdges.get(key);
		connected = connectedSets.get(key);
	} else {
		set = new Set();
		edges = new Set();
		connected = new Set();
		pathCells.set(key, set);
		pathEdges.set(key, edges);
		connectedSets.set(key, connected);
	}

	if (preserve) {
		// A removed node is dropped from the connected set, but its wires are
		// intentionally kept — this mode never removes an existing connection.
		const nodeSet = new Set(nodes);
		for (const idx of [...connected]) {
			if (!nodeSet.has(idx)) connected.delete(idx);
		}
	}

	// In preserve mode a new node may tap the nearest existing wire cell
	// even when Auto Spawn Junctions is off (real-wire placement).
	const canTapWire = preserve ? true : autoSpawn;

	const newNodes = nodes.filter(idx => !connected.has(idx));
	if (newNodes.length > 0) {
		connectNodes(newNodes, color, type, autoSpawn, autoSpawnTurns, connected, set, edges, canTapWire, limit);
	}
}

// Networks are built separately per color AND per cell type (wall / corridor),
// so paths never mix the two fields and every reachable node gets connected.
// Collapsible tree state: color -> {open}, and color|type -> {open} for segments.
const treeState = {};

// Node-to-node segments: contract the per-cell wire tree down to its placed
// nodes, so a chain of 3 nodes through 9 cells reports 2 segments (not 8/9).
function computeNodeSegments(color, type) {
	const key = color + '|' + type;
	const edges = pathEdges.get(key);
	const set = pathCells.get(key);
	if (!edges || !set || set.size === 0) return { count: 0, list: [] };
	const adj = new Map();
	for (const e of edges) {
		const p = e.split(':');
		const a = +p[0], b = +p[1];
		if (!adj.has(a)) adj.set(a, []);
		if (!adj.has(b)) adj.set(b, []);
		adj.get(a).push(b);
		adj.get(b).push(a);
	}
	const nodeCells = [];
	circles.forEach((n, idx) => { if (n.color === color && grid[idx] === type) nodeCells.push(idx); });
	const isNode = new Set(nodeCells);
	const segSet = new Set();
	const list = [];
	for (const start of nodeCells) {
		const visited = new Set([start]);
		const q = [start];
		let found = -1;
		while (q.length) {
			const cur = q.shift();
			for (const nb of (adj.get(cur) || [])) {
				if (visited.has(nb)) continue;
				if (isNode.has(nb)) { found = nb; break; }
				visited.add(nb);
				q.push(nb);
			}
			if (found !== -1) break;
		}
		if (found !== -1) {
			const sk = Math.min(start, found) + ':' + Math.max(start, found);
			if (!segSet.has(sk)) { segSet.add(sk); list.push([start, found]); }
		}
	}
	return { count: list.length, list };
}

function renderPathList() {
	const el = document.getElementById('path-list');
	el.innerHTML = '';
	if (pathCells.size === 0) {
		const empty = document.createElement('div');
		empty.className = 'path-empty';
		empty.textContent = 'No paths yet';
		el.appendChild(empty);
		return;
	}
	COLORS.forEach(color => {
		const keys = [...pathCells.keys()].filter(k => k.startsWith(color + '|'));
		if (keys.length === 0) return;
		let totalCells = 0;
		keys.forEach(k => { totalCells += pathCells.get(k).size; });
		if (totalCells === 0) return;
		const state = treeState[color] || (treeState[color] = { open: false });
		let totalNodes = 0, totalSegments = 0;
		keys.forEach(k => {
			const type = +k.split('|')[1];
			circles.forEach((n, idx) => { if (n.color === color && grid[idx] === type) totalNodes++; });
			totalSegments += computeNodeSegments(color, type).count;
		});
		const head = document.createElement('div');
		head.className = 'path-entry';
		head.style.cursor = 'pointer';
		head.style.fontWeight = 'bold';
		const swatch = document.createElement('span');
		swatch.className = 'path-swatch';
		swatch.style.background = color;
		const label = document.createElement('span');
		label.textContent = (state.open ? '▾ ' : '▸ ') + color + ' — ' + totalNodes + ' nodes, ' + totalSegments + ' segments, ' + totalCells + ' cells';
		head.appendChild(swatch);
		head.appendChild(label);
		head.onclick = () => { state.open = !state.open; renderPathList(); };
		el.appendChild(head);
		if (!state.open) return;
		keys.forEach(k => {
			const type = +k.split('|')[1];
			const set = pathCells.get(k);
			if (set.size === 0) return;
			const seg = computeNodeSegments(color, type);
			let nodeCount = 0;
			circles.forEach((n, idx) => { if (n.color === color && grid[idx] === type) nodeCount++; });
			const subState = treeState[k] || (treeState[k] = { open: false });
			const sub = document.createElement('div');
			sub.className = 'path-entry';
			sub.style.marginLeft = '14px';
			sub.style.cursor = 'pointer';
			const subLabel = document.createElement('span');
			subLabel.textContent = (subState.open ? '▾ ' : '▸ ') + (type === 1 ? 'wall' : 'corridor') + ': ' + nodeCount + ' nodes, ' + seg.count + ' segments, ' + set.size + ' cells';
			sub.appendChild(subLabel);
			sub.onclick = (e) => { e.stopPropagation(); subState.open = !subState.open; renderPathList(); };
			el.appendChild(sub);
			if (subState.open) {
				seg.list.forEach(([a, b]) => {
					const ax = a % GRID_W, ay = (a / GRID_W) | 0;
					const bx = b % GRID_W, by = (b / GRID_W) | 0;
					const row = document.createElement('div');
					row.className = 'path-entry';
					row.style.marginLeft = '28px';
					row.style.color = '#888';
					row.textContent = '(' + ax + ',' + ay + ')-(' + bx + ',' + by + ')';
					el.appendChild(row);
				});
			}
		});
	});
}

function exportNetwork() {
	const lines = [];
	lines.push('Maze Network — ' + GRID_W + 'x' + GRID_H);
	lines.push('');
	lines.push('=== Nodes (x,y color type small) ===');
	if (circles.size === 0) {
		lines.push('(none)');
	} else {
		circles.forEach((n, idx) => {
			const x = idx % GRID_W, y = (idx / GRID_W) | 0;
			const type = grid[idx] === 1 ? 'wall' : 'corridor';
			lines.push('(' + x + ',' + y + ') ' + n.color + ' ' + type + (n.small ? ' small' : ''));
		});
	}
	lines.push('');
	lines.push('=== Links (per path) ===');
	let anyLink = false;
	pathEdges.forEach((edges, key) => {
		const parts = key.split('|');
		const color = parts[0], cellType = parts[1];
		if (edges.size === 0) return;
		anyLink = true;
		const list = [];
		edges.forEach(e => {
			const p = e.split(':');
			const a = +p[0], b = +p[1];
			const ax = a % GRID_W, ay = (a / GRID_W) | 0;
			const bx = b % GRID_W, by = (b / GRID_W) | 0;
			list.push('(' + ax + ',' + ay + ')-(' + bx + ',' + by + ')');
		});
		lines.push(color + ' ' + (cellType === '1' ? 'wall' : 'corridor') + ': ' + list.join('  '));
	});
	if (!anyLink) lines.push('(none)');
	lines.push('');
	lines.push('=== Manual wires (BUILD) ===');
	if (manualWires.length === 0) {
		lines.push('(none)');
	} else {
		manualWires.forEach(w => {
			const c = w.cells;
			const seg = c.map(i => '(' + (i % GRID_W) + ',' + ((i / GRID_W) | 0) + ')').join('-');
			const col = cellColor.get(c[0]) || '#9ca3af';
			lines.push(col + ': ' + seg);
		});
	}
	lines.push('');
	lines.push('=== Batteries (x,y terminals) ===');
	if (manualBatteries.length === 0) {
		lines.push('(none)');
	} else {
		manualBatteries.forEach(b => {
			lines.push('(' + b.x + ',' + b.y + ') ' + b.term[0] + '|' + b.term[1]);
		});
	}
	lines.push('');
	lines.push('=== Obstacles (x,y type) ===');
	let anyObs = false;
	for (let i = 0; i < blocked.length; i++) {
		if (blocked[i]) {
			const kind = obstacleKind[i] === 1 ? 'A' : obstacleKind[i] === 2 ? 'B' : 'C';
			lines.push('(' + (i % GRID_W) + ',' + ((i / GRID_W) | 0) + ') ' + kind);
			anyObs = true;
		}
	}
	if (!anyObs) lines.push('(none)');
	return lines.join('\n');
}

function buildNetworks() {
	const autoConnect = els.autoConnect.checked;
	const preserve = els.preserveWiring.checked;
	const limit = +els.pathLimit.value;
	let protectedEdges = null;

// Auto-spawned nodes (turns / junctions) are transient: drop them on every
// rebuild so they don't accumulate in any mode. User-placed nodes
// (small:false) are always kept.
for (const [idx, n] of [...circles]) if (n.small) circles.delete(idx);

if (!autoConnect) {
	if (!preserve) { pathCells.clear(); pathEdges.clear(); connectedSets.clear(); cellUsage.clear(); }
		render();
		renderPathList();
		renderInventory();
		return;
	}

const autoSpawn = els.autoSpawnNodes.checked;
const autoSpawnTurns = els.autoSpawnTurns.checked;

if (!preserve) {
	// Full rebuild: discard all previous wiring and recompute shortest paths.
	// Snapshot every edge that belongs to a wire passing through a type-C
	// obstacle, so the whole wire (not just the cells adjacent to C) is
	// kept across the rebuild ("Keep wire").
	protectedEdges = new Map(); // key -> Set<"a:b">
	pathEdges.forEach((edges, key) => {
		const list = [...edges].map(e => {
			const [a, b] = e.split(':').map(Number);
			return { e, a, b };
		});
		const cellMap = new Map(); // cell -> indices into list
		list.forEach((it, i) => {
			for (const c of [it.a, it.b]) {
				if (!cellMap.has(c)) cellMap.set(c, []);
				cellMap.get(c).push(i);
			}
		});
		const keepIdx = new Set();
		const queue = [];
		list.forEach((it, i) => {
			if (obstacleKind[it.a] === 3 || obstacleKind[it.b] === 3) {
				if (!keepIdx.has(i)) { keepIdx.add(i); queue.push(i); }
			}
		});
		while (queue.length) {
			const it = list[queue.pop()];
			for (const c of [it.a, it.b]) {
				for (const j of (cellMap.get(c) || [])) {
					if (!keepIdx.has(j)) { keepIdx.add(j); queue.push(j); }
				}
			}
		}
		if (keepIdx.size) {
			const keep = new Set();
			keepIdx.forEach(i => keep.add(list[i].e));
			protectedEdges.set(key, keep);
		}
	});
	pathCells.clear();
	pathEdges.clear();
	connectedSets.clear();
}

rebuildCellUsage();

	for (const color of COLORS) {
		const walls = [], corridors = [];
		for (const [idx, n] of circles) {
			if (n.color !== color) continue;
			if (n.manual) continue; // BUILD-mode nodes are placed manually, not auto-connected
			if (grid[idx] === 1) walls.push(idx);
			else corridors.push(idx);
		}
		connectGroup(walls, color, 1, autoSpawn, autoSpawnTurns, preserve, limit);
		connectGroup(corridors, color, 0, autoSpawn, autoSpawnTurns, preserve, limit);
	}

	// Re-inject wires that pass through a type-C obstacle (kept across rebuild).
	if (protectedEdges) {
		protectedEdges.forEach((edges, key) => {
			const color = key.split('|')[0];
			let set = pathCells.get(key), ed = pathEdges.get(key), conn = connectedSets.get(key);
			if (!set) {
				set = new Set(); ed = new Set(); conn = new Set();
				pathCells.set(key, set); pathEdges.set(key, ed); connectedSets.set(key, conn);
			}
			edges.forEach(e => {
				ed.add(e);
				const [a, b] = e.split(':').map(Number);
				for (const c of [a, b]) {
					set.add(c); conn.add(c);
					if (!cellUsage.has(c)) cellUsage.set(c, new Set());
					cellUsage.get(c).add(color);
				}
			});
		});
	}

	render();
	renderPathList();
	renderInventory();
}

// Rebuild the per-cell occupancy cache from the authoritative pathCells
// (auto-nets) AND the manually placed BUILD/godmode wires. Including the
// manual wires lets `laneFor` offset them against each other and against
// auto-nets when several wires share a cell.
function rebuildCellUsage() {
	cellUsage.clear();
	pathCells.forEach((set, key) => {
		const color = key.split('|')[0];
		for (const idx of set) {
			if (!cellUsage.has(idx)) cellUsage.set(idx, new Set());
			cellUsage.get(idx).add(color);
		}
	});
	manualWires.forEach(w => {
		if (!w.color) return; // colorless fragments (e.g. obstacle-cut) don't claim a lane
		for (const idx of w.cells) {
			if (!cellUsage.has(idx)) cellUsage.set(idx, new Set());
			cellUsage.get(idx).add(w.color);
		}
	});
}

// Place an obstacle at idx with the chosen behavior (A/B/C).
// A: cut the segment through idx and spawn its near end-cells as new nodes.
// B: cut the segment and rebuild that (color,cellType) group from remaining nodes.
// C: just block the cell; existing wires are left untouched (drawn through it).
function applyObstacle(idx, type) {
	pendingPlan = null; wireDrag = null;
	blocked[idx] = 1;
	obstacleKind[idx] = type === 'A' ? 1 : type === 'B' ? 2 : 3;
	// Don't destroy BUILD-mode parts (battery poles / wire ends); the
	// blocked cell just severs conductivity, which simulate() handles.
	if (!circles.has(idx) || !circles.get(idx).manual) circles.delete(idx);
	// Drop transient auto-spawned junctions so a type-B rebuild consumes
	// only real nodes (matches buildNetworks() semantics at line 456).
	for (const [i, n] of [...circles]) if (n.small) circles.delete(i);
	// Split any BUILD-mode manual wire that runs through the blocked cell
	// into two wires (cut is permanent; the pool is unaffected because the
	// original length was already taken out at placement). Neither new wire
	// includes the blocked cell, so drawWireCells won't stroke through it.
	for (const w of manualWires.slice()) {
		const k = w.cells.indexOf(idx);
		if (k < 0) continue;
		const parts = [];
		if (k > 0) parts.push(w.cells.slice(0, k));
		if (k < w.cells.length - 1) parts.push(w.cells.slice(k + 1));
		const i = manualWires.indexOf(w);
		if (i >= 0) manualWires.splice(i, 1);
		for (const part of parts) {
			if (part.length < 2) continue;
			const nodes = [part[0], part[part.length - 1]];
			manualWires.push({ color: w.color, cells: part.slice(), nodes, segs: [part.length - 1] });
		}
		if (k > 0 && !circles.has(w.cells[k - 1])) circles.set(w.cells[k - 1], { color: w.color, small: false, manual: true });
		if (k < w.cells.length - 1 && !circles.has(w.cells[k + 1])) circles.set(w.cells[k + 1], { color: w.color, small: false, manual: true });
	}
	if (type === 'C') {
		// Keep existing wires: do not cut incident edges; only block new paths.
		rebuildCellUsage();
		renderPathList();
		render();
		renderInventory();
		return;
	}
	const affected = [];
	pathCells.forEach((set, key) => { if (set.has(idx)) affected.push(key); });
	for (const key of affected) {
		const [color, cellType] = key.split('|');
		const set = pathCells.get(key);
		const edges = pathEdges.get(key);
		const connected = connectedSets.get(key);
		const incident = [];
		edges.forEach(e => {
			const p = e.split(':');
			const a = +p[0], b = +p[1];
			if (a === idx || b === idx) incident.push([a, b]);
		});
		incident.forEach(([a, b]) => edges.delete(Math.min(a, b) + ':' + Math.max(a, b)));
		connected.delete(idx);
		if (type === 'A') {
			incident.forEach(([a, b]) => {
				const other = a === idx ? b : a;
				if (!circles.has(other)) {
					circles.set(other, { color, small: false });
					logger(`Auto-spawned endpoint at ${other % GRID_W},${(other / GRID_W) | 0}`);
				} else {
					logger(`Obstacle cut near existing node at ${other % GRID_W},${(other / GRID_W) | 0}`);
				}
				set.add(other);
				connected.add(other);
			});
		}
	edges.forEach(e => { const [a, b] = e.split(':').map(Number); set.add(a); set.add(b); });
		connected.forEach(c => set.add(c));
		if (type === 'B') {
			const nodes = [];
			circles.forEach((n, i) => { if (n.color === color && grid[i] === +cellType) nodes.push(i); });
			pathCells.delete(key);
			pathEdges.delete(key);
			connectedSets.delete(key);
			connectGroup(nodes, color, +cellType, els.autoSpawnNodes.checked, els.autoSpawnTurns.checked, false, +els.pathLimit.value);
		}
	}
	cellUsage.delete(idx);
	rebuildCellUsage();
	renderPathList();
	render();
	bus.emit('obstacle:changed', { idx });
}

