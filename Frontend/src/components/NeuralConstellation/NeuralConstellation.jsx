import { useEffect, useRef } from 'react';
import './NeuralConstellation.css';

// Curated GaintPro-inspired palette: predominantly royal blue and cyan, with occasional green
const PARTICLE_PALETTE = [
  { r: 37, g: 99, b: 235, hex: '#2563eb' },   // GaintPro Royal Blue (~55%)
  { r: 14, g: 165, b: 233, hex: '#0ea5e9' },  // Tech Cyan (~33%)
  { r: 16, g: 185, b: 129, hex: '#10b981' },  // Occasional Emerald Green (~12%)
];

const pickParticleColor = () => {
  const rand = Math.random();
  if (rand < 0.55) {
    return PARTICLE_PALETTE[0];
  } else if (rand < 0.88) {
    return PARTICLE_PALETTE[1];
  } else {
    return PARTICLE_PALETTE[2];
  }
};

const PROXIMITY_DISTANCE = 110; // Distance threshold for connection lines (90-120 CSS px)
const MOUSE_RADIUS = 250;       // Local cursor attraction radius (~250 CSS px)
const MAX_SPEED = 0.95;         // Velocity cap for smooth, clearly visible attraction & drift
const MAX_CONNECTIONS_PER_PARTICLE = 3; // Prevents dense spiderwebs and blob connections

export default function NeuralConstellation() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = null;
    let isTabVisible = !document.hidden;

    // Check user preference for reduced motion
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = reducedMotionQuery.matches;

    // Mouse coordinates
    const mouse = {
      x: -9999,
      y: -9999,
      active: false,
    };

    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles = [];

    // Particle count: 180-260 on 1920x1080 desktop, responsive scaling on tablet & mobile
    const getParticleCount = (w, h) => {
      const isMobile = w < 768;
      const isTablet = w >= 768 && w < 1024;

      if (isMobile) {
        return Math.min(65, Math.max(45, Math.round((w * h) / 7500)));
      } else if (isTablet) {
        return Math.min(130, Math.max(85, Math.round((w * h) / 8800)));
      } else {
        // Desktop: (1920 * 1080) / 9500 ≈ 218 particles
        return Math.min(250, Math.max(180, Math.round((w * h) / 9500)));
      }
    };

    // Resize canvas to parent container or viewport
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      width = parent ? parent.clientWidth : window.innerWidth;
      height = parent ? parent.clientHeight : window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      initParticles();
    };

    // Uniform stratified jittered grid initialization (prevents initial clusters and empty voids)
    const initParticles = () => {
      const count = getParticleCount(width, height);
      const isMobile = width < 768;
      particles = [];

      // Determine grid dimensions to uniformly tile the canvas
      const aspect = width / Math.max(height, 1);
      let cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
      let rows = Math.max(1, Math.ceil(count / cols));

      const cellW = width / cols;
      const cellH = height / rows;

      let created = 0;
      for (let r = 0; r < rows && created < count; r++) {
        for (let c = 0; c < cols && created < count; c++) {
          const colorObj = pickParticleColor();

          // Larger dots:
          // Most particles 3–5px diameter (radius ~1.6–2.4px); ~15% larger hero particles 5–7px diameter (radius ~2.7–3.4px)
          const isLarge = Math.random() < 0.15;
          const baseRadius = isLarge
            ? (isMobile ? 2.2 + Math.random() * 0.5 : 2.7 + Math.random() * 0.7)
            : (isMobile ? 1.4 + Math.random() * 0.4 : 1.7 + Math.random() * 0.6);

          const speedMultiplier = prefersReducedMotion ? 0.02 : isMobile ? 0.35 : 0.42;
          const angle = Math.random() * Math.PI * 2;
          const baseSpeed = (0.22 + Math.random() * 0.24) * speedMultiplier;

          // Jittered position inside grid cell ensures 100% uniform dispersion across the whole screen
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
            baseRadius,
            radius: baseRadius,
            color: colorObj,
            pulseOffset: Math.random() * Math.PI * 2,
            pulseSpeed: 0.012 + Math.random() * 0.018,
            connectionCount: 0,
          });

          created++;
        }
      }
    };

    // Pointer move listener
    const handlePointerMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    };

    const handlePointerLeave = () => {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    };

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (isTabVisible && !animationFrameId) {
        lastTimestamp = performance.now();
        animationFrameId = requestAnimationFrame(render);
      }
    };

    const handleMotionChange = (e) => {
      prefersReducedMotion = e.matches;
      initParticles();
    };

    window.addEventListener('resize', resizeCanvas, { passive: true });
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    reducedMotionQuery.addEventListener('change', handleMotionChange);

    resizeCanvas();

    let lastTimestamp = performance.now();

    // Main animation loop
    const render = (timestamp) => {
      if (!isTabVisible) {
        animationFrameId = null;
        return;
      }

      const dt = Math.min((timestamp - lastTimestamp) / 16.67, 2.0);
      lastTimestamp = timestamp;

      ctx.clearRect(0, 0, width, height);

      const numParticles = particles.length;
      const isMobile = width < 768;
      const lineDistThreshold = isMobile ? 90 : PROXIMITY_DISTANCE;

      // 1. Update particle wander physics and smooth positive attraction toward cursor
      for (let i = 0; i < numParticles; i++) {
        const p = particles[i];
        p.connectionCount = 0;

        if (!prefersReducedMotion) {
          // Independent wandering: smoothly adjust heading angle without sudden turns
          p.wanderPhase += p.wanderSpeed * dt;
          p.angle += Math.sin(p.wanderPhase) * p.wanderRate * dt;

          // Intrinsic target wander velocity
          const targetVx = Math.cos(p.angle) * p.baseSpeed;
          const targetVy = Math.sin(p.angle) * p.baseSpeed;

          // Smoothly restore velocity toward independent wander velocity (prevents permanent clump lock)
          p.vx = p.vx * 0.955 + targetVx * 0.045;
          p.vy = p.vy * 0.955 + targetVy * 0.045;

          // Smooth POSITIVE attraction TOWARD cursor within ~250px
          if (mouse.active) {
            const dx = mouse.x - p.x; // points from particle TOWARD mouse
            const dy = mouse.y - p.y;
            const dist = Math.hypot(dx, dy);

            if (dist < MOUSE_RADIUS && dist > 1) {
              const factor = 1 - dist / MOUSE_RADIUS;
              // Smooth inner easing within 20px so particles don't all collapse into one point
              const innerDamp = Math.min(1, dist / 20);
              const attractionForce = factor * innerDamp * 0.046 * dt;

              p.vx += (dx / dist) * attractionForce;
              p.vy += (dy / dist) * attractionForce;

              // Subtle enlargement near cursor
              p.radius = p.baseRadius + factor * 0.6;
            } else {
              p.radius = p.baseRadius;
            }
          } else {
            p.radius = p.baseRadius;
          }
        } else {
          p.radius = p.baseRadius;
        }

        // Velocity clamp for smooth, continuous organic motion
        const currentSpeed = Math.hypot(p.vx, p.vy);
        if (currentSpeed > MAX_SPEED) {
          p.vx = (p.vx / currentSpeed) * MAX_SPEED;
          p.vy = (p.vy / currentSpeed) * MAX_SPEED;
        }

        // Apply movement with delta-time
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Boundary wrapping with margin to keep distribution completely even across edges
        const margin = 26;
        if (p.x < -margin) p.x = width + margin;
        else if (p.x > width + margin) p.x = -margin;
        if (p.y < -margin) p.y = height + margin;
        else if (p.y > height + margin) p.y = -margin;

        p.pulseOffset += p.pulseSpeed * dt;
      }

      // 2. Spatial Grid Partitioning for lightweight neighbor search, gentle spacing, and lines
      const cellSize = lineDistThreshold;
      const gridCols = Math.max(1, Math.ceil(width / cellSize));
      const gridRows = Math.max(1, Math.ceil(height / cellSize));
      const grid = new Map();

      for (let i = 0; i < numParticles; i++) {
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

      // Render thin connecting lines with delicate opacity
      ctx.lineWidth = isMobile ? 0.5 : 0.55;
      const neighborOffsets = [
        [0, 0],   // same cell
        [1, 0],   // right
        [-1, 1],  // down-left
        [0, 1],   // down
        [1, 1],   // down-right
      ];

      for (let gy = 0; gy < gridRows; gy++) {
        for (let gx = 0; gx < gridCols; gx++) {
          const key1 = gy * gridCols + gx;
          const cell1 = grid.get(key1);
          if (!cell1) continue;

          for (let o = 0; o < neighborOffsets.length; o++) {
            const [ox, oy] = neighborOffsets[o];
            const ngx = gx + ox;
            const ngy = gy + oy;
            if (ngx < 0 || ngx >= gridCols || ngy < 0 || ngy >= gridRows) continue;

            const key2 = ngy * gridCols + ngx;
            const cell2 = grid.get(key2);
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

                // Gentle minimum spacing between particles to prevent overlapping near cursor
                const minSep = 18;
                if (dist < minSep && !prefersReducedMotion) {
                  const d = Math.max(dist, 1.0);
                  const sepFactor = (1 - dist / minSep) * 0.025 * dt;
                  const nx = (dx / d) * sepFactor;
                  const ny = (dy / d) * sepFactor;
                  p1.vx += nx;
                  p1.vy += ny;
                  p2.vx -= nx;
                  p2.vy -= ny;
                }

                // Draw line if within threshold and neither particle exceeds max connections
                if (
                  dist < lineDistThreshold &&
                  p1.connectionCount < MAX_CONNECTIONS_PER_PARTICLE &&
                  p2.connectionCount < MAX_CONNECTIONS_PER_PARTICLE
                ) {
                  p1.connectionCount++;
                  p2.connectionCount++;

                  const proximityFactor = 1 - dist / lineDistThreshold;
                  let alpha = proximityFactor * 0.11;

                  let isNearMouse = false;
                  if (mouse.active) {
                    const d1 = Math.hypot(mouse.x - p1.x, mouse.y - p1.y);
                    const d2 = Math.hypot(mouse.x - p2.x, mouse.y - p2.y);
                    if (d1 < MOUSE_RADIUS || d2 < MOUSE_RADIUS) {
                      const mouseProximity = Math.max(0, 1 - Math.min(d1, d2) / MOUSE_RADIUS);
                      alpha = Math.min(0.28, alpha + mouseProximity * 0.17);
                      isNearMouse = true;
                    }
                  }

                  ctx.beginPath();
                  ctx.moveTo(p1.x, p1.y);
                  ctx.lineTo(p2.x, p2.y);

                  if (isNearMouse) {
                    ctx.strokeStyle = `rgba(37, 99, 235, ${alpha})`;
                  } else {
                    ctx.strokeStyle = `rgba(${p1.color.r}, ${p1.color.g}, ${p1.color.b}, ${alpha})`;
                  }
                  ctx.stroke();
                }
              }
            }
          }
        }
      }

      // 3. Render luminous node particles (larger, clearly visible against white with subtle glow)
      for (let i = 0; i < numParticles; i++) {
        const p = particles[i];
        const pulse = Math.sin(p.pulseOffset) * 0.15;
        const currentRadius = Math.max(1.2, p.radius + pulse);

        let mouseDistFactor = 0;
        if (mouse.active) {
          const distToMouse = Math.hypot(mouse.x - p.x, mouse.y - p.y);
          if (distToMouse < MOUSE_RADIUS) {
            mouseDistFactor = 1 - distToMouse / MOUSE_RADIUS;
          }
        }

        // Subtle blue/cyan outer glow
        const glowRadius = currentRadius * (2.2 + mouseDistFactor * 0.6);
        const glowAlpha = 0.16 + mouseDistFactor * 0.18;

        const gradient = ctx.createRadialGradient(
          p.x, p.y, currentRadius * 0.4,
          p.x, p.y, glowRadius
        );
        gradient.addColorStop(0, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${glowAlpha})`);
        gradient.addColorStop(1, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // Solid, vibrant particle core
        const coreAlpha = 0.88 + mouseDistFactor * 0.10;
        ctx.fillStyle = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${coreAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reducedMotionQuery.removeEventListener('change', handleMotionChange);
    };
  }, []);

  return (
    <div className="neural-constellation-container" aria-hidden="true">
      <div className="neural-constellation-ambient" />
      <canvas ref={canvasRef} className="neural-constellation-canvas" />
    </div>
  );
}
