function generateConnected(sx, sy) {
	const visitedM = new Uint8Array(BFS_N);
	const stack = [{x:sx, y:sy}];
	visitedM[sy * GRID_W + sx] = 1;
	grid[sy * GRID_W + sx] = 0;
	while (stack.length > 0) {
		const curr = stack[stack.length - 1];
		const available = [];
		for (let i = 0; i < 4; i++) {
			const d = mDirs[i];
			const nx = curr.x + d.dx, ny = curr.y + d.dy;
			if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H && !visitedM[ny * GRID_W + nx]) {
				available.push(i);
			}
		}
		if (available.length > 0) {
			const dirIdx = available[(Math.random() * available.length) | 0];
			const d = mDirs[dirIdx];
			const nx = curr.x + d.dx, ny = curr.y + d.dy;
			grid[((curr.y + d.dy / 2) * GRID_W) + (curr.x + d.dx / 2)] = 0;
			grid[ny * GRID_W + nx] = 0;
			visitedM[ny * GRID_W + nx] = 1;
			stack.push({x: nx, y: ny});
		} else {
			stack.pop();
		}
	}
}

function generateRandom() {
	for (let i = 0; i < grid.length; i++) grid[i] = Math.random() < 0.3 ? 1 : 0;
}

// Recursive division: start from a solid wall border + open interior, then
// repeatedly split chambers with a wall that has a single random gap. Yields
// a "classic" maze of long straight walls (visually distinct from DFS/random).
function generateRecursiveDivision() {
	grid.fill(1);
	for (let y = 1; y < GRID_H - 1; y++)
		for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = 0;
	divide(1, 1, GRID_W - 2, GRID_H - 2);
}

function divide(x, y, w, h) {
	if (w < 3 || h < 3) return;
	const horizontal = w < h ? true : h < w ? false : Math.random() < 0.5;
	if (horizontal) {
		const wy = y + 1 + Math.floor(Math.random() * (h - 2));
		const px = x + Math.floor(Math.random() * w);
		for (let i = x; i < x + w; i++) if (i !== px) grid[wy * GRID_W + i] = 1;
		divide(x, y, w, wy - y);
		divide(x, wy + 1, w, y + h - wy - 1);
	} else {
		const wx = x + 1 + Math.floor(Math.random() * (w - 2));
		const py = y + Math.floor(Math.random() * h);
		for (let i = y; i < y + h; i++) if (i !== py) grid[i * GRID_W + wx] = 1;
		divide(x, y, wx - x, h);
		divide(wx + 1, y, x + w - wx - 1, h);
	}
}

function buildMaze() {
	grid.fill(1);
	const type = mazeType;
	if (type === 'connected') generateConnected(1, 1);
	else if (type === 'random') generateRandom();
	else generateRecursiveDivision();
	circles.clear();
	pathCells.clear();
	pathEdges.clear();
	connectedSets.clear();
	blocked.fill(0);
	obstacleKind.fill(0);
	buildNetworks();
	renderInventory();
	bus.emit('air:changed');
	logger('Maze generated (' + type + ')', 'sys');
}

// Single extension point for all avoidance rules: a cell is traversable by
// (color,type) only if it matches the field, is not an absolute obstacle, and
// (when a per-cell limit is set) still has capacity for a new color.
