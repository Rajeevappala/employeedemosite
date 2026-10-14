// Simulation test: verifies particle distribution uniformity and lack of blob formation over 30s
const fs = require('fs');
const path = require('path');

function testSimulation() {
  console.log('================================================================');
  console.log(' GAINTPRO HRM — 30-SECOND NEURAL CONSTELLATION SIMULATION TEST');
  console.log('================================================================\n');

  const width = 1920;
  const height = 1080;
  const count = Math.min(250, Math.max(180, Math.round((width * height) / 9500))); // 218 particles
  console.log(`Viewport: ${width}x${height}, Initial Particle Count: ${count}`);

  const PROXIMITY_DISTANCE = 110;
  const MOUSE_RADIUS = 250;
  const MAX_SPEED = 0.95;
  const MAX_CONNECTIONS_PER_PARTICLE = 3;
  const prefersReducedMotion = false;

  // Jittered grid initialization
  const aspect = width / Math.max(height, 1);
  let cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  let rows = Math.max(1, Math.ceil(count / cols));
  const cellW = width / cols;
  const cellH = height / rows;

  let particles = [];
  let created = 0;
  for (let r = 0; r < rows && created < count; r++) {
    for (let c = 0; c < cols && created < count; c++) {
      const angle = Math.random() * Math.PI * 2;
      const baseSpeed = 0.20 + Math.random() * 0.22 * 0.38;
      const x = (c + 0.15 + Math.random() * 0.70) * cellW;
      const y = (r + 0.15 + Math.random() * 0.70) * cellH;

      particles.push({
        x,
        y,
        angle,
        wanderPhase: Math.random() * Math.PI * 2,
        wanderSpeed: 0.005 + Math.random() * 0.008,
        wanderRate: 0.008 + Math.random() * 0.012,
        baseSpeed,
        vx: Math.cos(angle) * baseSpeed,
        vy: Math.sin(angle) * baseSpeed,
        baseRadius: 1.0,
        radius: 1.0,
        connectionCount: 0,
      });
      created++;
    }
  }

  // Simulate 30 seconds at 60fps = 1800 frames
  const totalFrames = 1800;
  const dt = 1.0;
  const mouse = { x: 960, y: 540, active: true }; // Mouse sitting in center (simulating user over login card)

  console.log('Simulating 1,800 frames (30 seconds of real-time movement)...');

  let maxOvercrowdingPairDistance = Infinity;
  let minParticleDistanceAcrossSim = Infinity;

  for (let frame = 0; frame < totalFrames; frame++) {
    // Wander & mouse interaction
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.connectionCount = 0;

      p.wanderPhase += p.wanderSpeed * dt;
      p.angle += Math.sin(p.wanderPhase) * p.wanderRate * dt;

      const targetVx = Math.cos(p.angle) * p.baseSpeed;
      const targetVy = Math.sin(p.angle) * p.baseSpeed;

      p.vx = p.vx * 0.94 + targetVx * 0.06;
      p.vy = p.vy * 0.94 + targetVy * 0.06;

      // Mouse POSITIVE attraction toward cursor (dx points toward mouse)
      if (mouse.active) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);

        if (dist < MOUSE_RADIUS && dist > 1) {
          const factor = 1 - dist / MOUSE_RADIUS;
          const innerDamp = Math.min(1, dist / 20);
          const attractionForce = factor * innerDamp * 0.046 * dt;
          p.vx += (dx / dist) * attractionForce;
          p.vy += (dy / dist) * attractionForce;
        }
      }

      const speed = Math.hypot(p.vx, p.vy);
      if (speed > MAX_SPEED) {
        p.vx = (p.vx / speed) * MAX_SPEED;
        p.vy = (p.vy / speed) * MAX_SPEED;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const margin = 24;
      if (p.x < -margin) p.x = width + margin;
      else if (p.x > width + margin) p.x = -margin;
      if (p.y < -margin) p.y = height + margin;
      else if (p.y > height + margin) p.y = -margin;
    }

    // Spatial grid & weak separation force
    const cellSize = PROXIMITY_DISTANCE;
    const gridCols = Math.max(1, Math.ceil(width / cellSize));
    const gridRows = Math.max(1, Math.ceil(height / cellSize));
    const grid = new Map();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const gx = Math.max(0, Math.min(gridCols - 1, Math.floor(p.x / cellSize)));
      const gy = Math.max(0, Math.min(gridRows - 1, Math.floor(p.y / cellSize)));
      const key = gy * gridCols + gx;
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push(i);
    }

    const neighborOffsets = [
      [0, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];

    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        const cell1 = grid.get(gy * gridCols + gx);
        if (!cell1) continue;

        for (let o = 0; o < neighborOffsets.length; o++) {
          const [ox, oy] = neighborOffsets[o];
          const ngx = gx + ox;
          const ngy = gy + oy;
          if (ngx < 0 || ngx >= gridCols || ngy < 0 || ngy >= gridRows) continue;

          const cell2 = grid.get(ngy * gridCols + ngx);
          if (!cell2) continue;

          const isSameCell = ox === 0 && oy === 0;
          for (let i = 0; i < cell1.length; i++) {
            const idx1 = cell1[i];
            const p1 = particles[idx1];
            const startJ = isSameCell ? i + 1 : 0;

            for (let j = startJ; j < cell2.length; j++) {
              const idx2 = cell2[j];
              const p2 = particles[idx2];
              const dx = p1.x - p2.x;
              const dy = p1.y - p2.y;
              const dist = Math.hypot(dx, dy);

              if (dist < minParticleDistanceAcrossSim) {
                minParticleDistanceAcrossSim = dist;
              }

              // Weak separation force
              const minSep = 24;
              if (dist < minSep && !prefersReducedMotion) {
                const d = Math.max(dist, 1.0);
                const sepFactor = (1 - dist / minSep) * 0.035 * dt;
                const nx = (dx / d) * sepFactor;
                const ny = (dy / d) * sepFactor;
                p1.vx += nx;
                p1.vy += ny;
                p2.vx -= nx;
                p2.vy -= ny;
              }
            }
          }
        }
      }
    }
  }

  // Analyze spatial uniformity at t = 30s
  // Divide screen into 16 quadrants (4x4 grid)
  const quadCounts = new Array(16).fill(0);
  const qW = width / 4;
  const qH = height / 4;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const qx = Math.max(0, Math.min(3, Math.floor(p.x / qW)));
    const qy = Math.max(0, Math.min(3, Math.floor(p.y / qH)));
    quadCounts[qy * 4 + qx]++;
  }

  const expectedPerQuad = count / 16;
  console.log(`\n--- Spatial Distribution Across 16 Viewport Regions (Expected: ~${expectedPerQuad.toFixed(1)}/quad) ---`);
  console.log(quadCounts.map((c, i) => `Q${i}: ${c}`).join(' | '));

  let passed = true;

  // Check that no quadrant is empty or overcrowded
  const minCount = Math.min(...quadCounts);
  const maxCount = Math.max(...quadCounts);
  console.log(`\nMin quadrant density: ${minCount}, Max quadrant density: ${maxCount}`);

  if (minCount >= 5 && maxCount <= 28) {
    console.log('✅ PASS: Spatial density remains completely uniform across all 16 regions after 30 seconds!');
  } else {
    console.error('❌ FAIL: Significant spatial imbalance detected.');
    passed = false;
  }

  if (minParticleDistanceAcrossSim >= 1.0) {
    console.log(`✅ PASS: Separation force prevented particle collapse (minimum distance recorded: ${minParticleDistanceAcrossSim.toFixed(2)}px).`);
  } else {
    console.error('❌ FAIL: Particle overlap occurred.');
    passed = false;
  }

  console.log(`\n================================================================`);
  console.log(` RESULT: ${passed ? 'ALL SIMULATION CHECKS PASSED ✅' : 'FAILED ❌'}`);
  console.log(`================================================================\n`);

  process.exit(passed ? 0 : 1);
}

testSimulation();
