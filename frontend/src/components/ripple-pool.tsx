import { useEffect, useRef } from "react";

import {
  type Impact,
  type ObjectParams,
  type WaterParams,
  analyticProfile,
  impactOf,
} from "@/lib/water-physics";
import { type Body, type SimConfig, WaterSim } from "@/lib/water-sim";

export type SolverControls = Pick<
  SimConfig,
  "capillarity" | "viscosity" | "nonlinearity" | "reflect" | "breaking"
>;

export type PoolStats = {
  /** waves that broke since the last drop — each seeded a new ripple */
  breaks: number;
  /** crown droplets that fell back in and started their own rings */
  splashbacks: number;
  /** droplets currently in the air */
  airborne: number;
  /** seconds since the last impact */
  age: number;
  frameMs: number;
};

type Props = {
  object: ObjectParams;
  water: WaterParams;
  solver: SolverControls;
  paused: boolean;
  onImpact?: (impact: Impact) => void;
  onStats?: (stats: PoolStats) => void;
};

/* ── shading constants ────────────────────────────────────────────────────── */

// Ripples are millimetres tall across a 1.6 m tank, so the real surface slope
// is a few parts in a hundred per cell — far too little to see. The renderer
// exaggerates it the way a raking light does on real water, and because a
// splash crest is ~10× the ripples left 2 s later, the gain follows the water
// instead of being fixed: it is set each frame from the mean measured slope.
// The compensation is deliberately partial (the 0.6 exponent) — compensating
// fully would amplify an almost-settled tank back into a boil.
const GAIN_REF = 1.9;
const GAIN_COMPRESS = 0.6;
const GAIN_MIN = 5;
const GAIN_MAX = 55;
// Fast to stop down when a splash lands, slow to open back up as it fades.
const GAIN_CLOSE = 0.35;
const GAIN_OPEN = 0.035;
const CAUSTIC_CLAMP = 70; // keeps focused light from turning neon
const REFRACT = 8; // cells the floor shifts at full slope
const SPEC = 130; // specular highlight strength — sparkle, not sheen
const CAUSTIC_UP = 60; // brightening where the surface focuses light
const CAUSTIC_DOWN = 22; // dimming where it defocuses
// Light from the upper left, viewer straight down; H = normalize(L + V).
const HX = -0.2873,
  HY = -0.4598,
  HZ = 0.8405;

/** Procedural pool floor: sand ripples plus a faint tile grid. */
function buildFloor(w: number, h: number) {
  const floor = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const ripple =
        Math.sin(u * 46 + Math.sin(v * 9) * 2) * 0.5 + Math.sin(v * 61 + Math.sin(u * 7) * 3) * 0.3;
      const grain = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const noise = grain - Math.floor(grain) - 0.5;
      const tile = Math.min(((x + 24) % 48) / 3, ((y + 24) % 48) / 3, 1);
      // Far side of the tank sits in shadow, which sells the depth.
      const falloff = 0.55 + 0.45 * v;
      const shade = (1 + ripple * 0.14 + noise * 0.1) * falloff * (0.82 + tile * 0.18);
      const i = (y * w + x) * 3;
      floor[i]! = 15 * shade;
      floor[i + 1]! = 54 * shade;
      floor[i + 2]! = 70 * shade;
    }
  }
  return floor;
}

export function RipplePool({ object, water, solver, paused, onImpact, onStats }: Props) {
  const waterRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<WaterSim | null>(null);

  // Live props, read inside the animation loop without restarting it.
  const live = useRef({ object, water, solver, paused, onImpact, onStats });
  live.current = { object, water, solver, paused, onImpact, onStats };

  useEffect(() => {
    const sim = new WaterSim({ ...live.current.solver });
    simRef.current = sim;
    const { w: W, h: H } = sim;

    const cv = waterRef.current!;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d", { alpha: false })!;
    const img = ctx.createImageData(W, H);
    const px = img.data;
    const floor = buildFloor(W, H);

    const overlay = overlayRef.current!;
    const octx = overlay.getContext("2d")!;

    let last: { impact: Impact; x: number; y: number; t0: number } | null = null;
    let breaks = 0;
    let splashbacks = 0;
    let statAt = 0;
    let frameMs = 0;
    let raf = 0;

    /* ── water surface ──────────────────────────────────────────────────── */
    let gain = 60;
    const drawWater = () => {
      const eta = sim.cur;
      const foam = sim.foam;

      // Auto-exposure: mean |∂η/∂x| over a coarse sample of the tank.
      let sum = 0;
      let n = 0;
      for (let y = 2; y < H - 2; y += 3) {
        const row = y * W;
        for (let x = 2; x < W - 2; x += 3) {
          sum += Math.abs(eta[row + x - 1]! - eta[row + x + 1]!);
          n++;
        }
      }
      const mean = sum / Math.max(n, 1);
      const want = Math.min(
        GAIN_MAX,
        Math.max(GAIN_MIN, GAIN_REF * Math.pow(1 / Math.max(mean, 1e-7), GAIN_COMPRESS)),
      );
      gain += (want - gain) * (want < gain ? GAIN_CLOSE : GAIN_OPEN);
      const SLOPE = gain;
      // When the exposure is wide open the water is nearly flat, and hard
      // glints on an amplified surface read as glitter rather than calm.
      const spec0 = SPEC * Math.min(1, 40 / gain);
      const causticUp = CAUSTIC_UP * gain;
      const causticDown = CAUSTIC_DOWN * gain;

      for (let y = 1; y < H - 1; y++) {
        const row = y * W;
        for (let x = 1; x < W - 1; x++) {
          const i = row + x;
          const gx = (eta[i - 1]! - eta[i + 1]!) * SLOPE;
          const gy = (eta[i - W]! - eta[i + W]!) * SLOPE;
          const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
          const nx = -gx * inv;
          const ny = -gy * inv;

          // Refraction: the slope shifts where we see the floor.
          let sx = x + nx * REFRACT;
          let sy = y + ny * REFRACT;
          sx = sx < 0 ? 0 : sx > W - 1 ? W - 1 : sx;
          sy = sy < 0 ? 0 : sy > H - 1 ? H - 1 : sy;
          const f = ((sy | 0) * W + (sx | 0)) * 3;

          // Caustics: converging light pools where the surface is concave.
          const focus = eta[i - 1]! + eta[i + 1]! + eta[i - W]! + eta[i + W]! - 4 * eta[i]!;
          let caustic = focus > 0 ? focus * causticUp : focus * causticDown;
          if (caustic > CAUSTIC_CLAMP) caustic = CAUSTIC_CLAMP;
          else if (caustic < -CAUSTIC_CLAMP) caustic = -CAUSTIC_CLAMP;

          // Fresnel mix between the floor and the reflected sky.
          const grazing = 1 - inv;
          const g2 = grazing * grazing;
          const fres = 0.025 + 0.9 * g2 * g2 * grazing;

          // Blinn-Phong glitter, (N·H)^64 by repeated squaring. The high
          // exponent keeps flat water dark and confines highlights to the
          // crest flanks that happen to face the light.
          const nh = nx * HX + ny * HY + inv * HZ;
          let spec = 0;
          if (nh > 0) {
            const t2 = nh * nh;
            const t4 = t2 * t2;
            const t8 = t4 * t4;
            const t16 = t8 * t8;
            const t32 = t16 * t16;
            spec = t32 * t32 * spec0;
          }

          const sky = 0.55 + 0.45 * (1 - y / H);
          const fo = foam[i]!;
          const fw = fo * fo * 130;
          const o = i * 4;
          px[o]! = floor[f]! * (1 - fres) + 96 * sky * fres + caustic * 0.35 + spec * 0.85 + fw;
          px[o + 1]! =
            floor[f + 1]! * (1 - fres) + 166 * sky * fres + caustic * 0.8 + spec + fw * 1.1;
          px[o + 2]! = floor[f + 2]! * (1 - fres) + 196 * sky * fres + caustic + spec + fw * 1.15;
          px[o + 3]! = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    /* ── objects, droplets and spray ────────────────────────────────────── */
    const drawOverlay = () => {
      const rect = overlay.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ow = Math.max(1, Math.round(rect.width * dpr));
      const oh = Math.max(1, Math.round(rect.height * dpr));
      if (overlay.width !== ow || overlay.height !== oh) {
        overlay.width = ow;
        overlay.height = oh;
      }
      const sx = ow / W;
      const sy = oh / H;
      octx.clearRect(0, 0, ow, oh);

      for (const b of sim.bodies) {
        const r = Math.max(2, (b.impact.craterRadius / sim.metersPerCell) * 0.6 * sx);
        const cx = b.x * sx;
        const cy = b.y * sy;
        if (b.state === "falling") {
          // Shadow on the water tightens as the object drops.
          const near = 1 - Math.min(1, b.z / Math.max(live.current.object.dropHeight, 0.01));
          octx.fillStyle = `rgba(2,16,24,${0.1 + near * 0.3})`;
          octx.beginPath();
          octx.ellipse(cx, cy, r * (2.4 - near * 1.2), r * (1.6 - near * 0.8), 0, 0, Math.PI * 2);
          octx.fill();
          const lift = b.z * 95 * sy;
          const scale = 1 + b.z * 0.5;
          octx.fillStyle = "rgba(226,238,245,0.92)";
          octx.beginPath();
          octx.arc(cx, cy - lift, r * scale, 0, Math.PI * 2);
          octx.fill();
          continue;
        }
        if (b.state === "floating") {
          const bob = -b.z * 10 * sy;
          const grad = octx.createLinearGradient(cx, cy - r + bob, cx, cy + r + bob);
          grad.addColorStop(0, "rgba(236,246,252,0.95)");
          grad.addColorStop(1, "rgba(120,170,195,0.85)");
          octx.fillStyle = grad;
          octx.beginPath();
          octx.arc(cx, cy + bob, r, 0, Math.PI * 2);
          octx.fill();
          continue;
        }
        const depth = Math.min(1, -b.z / 0.35);
        octx.fillStyle = `rgba(6,30,42,${0.75 * (1 - depth)})`;
        octx.beginPath();
        octx.arc(cx, cy, r * (1 - depth * 0.55), 0, Math.PI * 2);
        octx.fill();
      }

      for (const d of sim.droplets) {
        const z = Math.max(0, d.z);
        const r = Math.max(0.9, d.r * sx * (1 + z * 2.2));
        const cy = d.y * sy - z * 170 * sy;
        octx.fillStyle = `rgba(228,244,252,${0.55 + Math.min(0.4, z * 6)})`;
        octx.beginPath();
        octx.arc(d.x * sx, cy, r, 0, Math.PI * 2);
        octx.fill();
      }
    };

    /* ── measured vs predicted cross-section ────────────────────────────── */
    const drawChart = () => {
      const gc = chartRef.current;
      if (!gc) return;
      const rect = gc.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const GW = Math.max(1, Math.round(rect.width * dpr));
      const GH = Math.max(1, Math.round(rect.height * dpr));
      if (gc.width !== GW || gc.height !== GH) {
        gc.width = GW;
        gc.height = GH;
      }
      const gx = gc.getContext("2d")!;
      gx.clearRect(0, 0, GW, GH);
      const mid = GH / 2;
      gx.strokeStyle = "rgba(190,225,240,0.16)";
      gx.lineWidth = 1;
      gx.beginPath();
      gx.moveTo(0, mid);
      gx.lineTo(GW, mid);
      gx.stroke();

      const label = (text: string, x: number, y: number, color: string) => {
        gx.fillStyle = color;
        gx.font = `${11 * dpr}px JetBrains Mono, monospace`;
        gx.fillText(text, x, y);
      };

      if (!last) {
        label("drop something to plot η(r, t)", 10 * dpr, mid - 10 * dpr, "rgba(190,225,240,0.5)");
        return;
      }

      const t = (performance.now() - last.t0) / 1000;
      const cells = Math.min(Math.floor(Math.min(W, H) / 2) - 2, 160);
      const measured = sim.sampleRadial(last.x, last.y, cells);
      let peak = 1e-6;
      for (const v of measured) peak = Math.max(peak, Math.abs(v));

      // Measured surface, straight out of the solver.
      gx.lineWidth = 2 * dpr;
      gx.strokeStyle = "oklch(0.82 0.12 195)";
      gx.beginPath();
      for (let i = 0; i < cells; i++) {
        const x = (i / (cells - 1)) * GW;
        const y = mid - (measured[i]! / peak) * (GH * 0.4);
        if (i) gx.lineTo(x, y);
        else gx.moveTo(x, y);
      }
      gx.stroke();

      // Closed-form single-ring prediction for the same instant.
      const im = last.impact;
      const span = cells * sim.metersPerCell;
      let apeak = 1e-9;
      const analytic = new Float32Array(cells);
      for (let i = 0; i < cells; i++) {
        analytic[i]! = analyticProfile(im, (i / (cells - 1)) * span, t);
        apeak = Math.max(apeak, Math.abs(analytic[i]!));
      }
      gx.lineWidth = 1.5 * dpr;
      gx.strokeStyle = "oklch(0.8 0.13 75 / 0.75)";
      gx.setLineDash([4 * dpr, 4 * dpr]);
      gx.beginPath();
      for (let i = 0; i < cells; i++) {
        const x = (i / (cells - 1)) * GW;
        const y = mid - (analytic[i]! / apeak) * (GH * 0.4);
        if (i) gx.lineTo(x, y);
        else gx.moveTo(x, y);
      }
      gx.stroke();
      gx.setLineDash([]);

      label(`t = ${t.toFixed(2)} s`, 10 * dpr, 16 * dpr, "rgba(190,225,240,0.7)");
      label(`r → ${span.toFixed(2)} m`, GW - 78 * dpr, GH - 8 * dpr, "rgba(190,225,240,0.7)");
      label("solver", 10 * dpr, GH - 8 * dpr, "oklch(0.82 0.12 195)");
      label("η = A₀√(R/r)e^(−γt)cos(kr−ωt)", 62 * dpr, GH - 8 * dpr, "oklch(0.8 0.13 75 / 0.85)");
    };

    const frame = () => {
      const t0 = performance.now();
      const { solver: s, paused: isPaused, onImpact: impactCb, onStats: statsCb } = live.current;
      sim.cfg.capillarity = s.capillarity;
      sim.cfg.viscosity = s.viscosity;
      sim.cfg.nonlinearity = s.nonlinearity;
      sim.cfg.reflect = s.reflect;
      sim.cfg.breaking = s.breaking;

      if (!isPaused) {
        const report = sim.step(2);
        breaks += report.breaks;
        splashbacks += report.splashbacks;
        for (const body of report.impacts) {
          breaks = 0;
          splashbacks = 0;
          last = { impact: body.impact, x: body.x, y: body.y, t0: performance.now() };
          impactCb?.(body.impact);
        }
      }
      drawWater();
      drawOverlay();
      drawChart();
      frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
      if (statsCb && t0 - statAt > 120) {
        statAt = t0;
        statsCb({
          breaks,
          splashbacks,
          airborne: sim.droplets.length,
          age: last ? (performance.now() - last.t0) / 1000 : 0,
          frameMs,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // A first ripple so the surface is never dead on arrival.
    sim.drop(
      0.5,
      0.45,
      impactOf({ mass: 0.02, radius: 0.012, dropHeight: 0.6 }, live.current.water),
    );
    const drizzle = window.setInterval(() => {
      if (live.current.paused) return;
      sim.stir(Math.random(), Math.random(), 0.012, 4);
    }, 1400);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(drizzle);
      simRef.current = null;
    };
  }, []);

  const pointer = (e: React.PointerEvent<HTMLDivElement>, dragging: boolean) => {
    const sim = simRef.current;
    if (!sim) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    if (dragging) {
      sim.stir(nx, ny, 0.07, 2.5);
      return;
    }
    sim.drop(nx, ny, impactOf(live.current.object, live.current.water));
  };

  return (
    <>
      <div
        className="glass relative overflow-hidden p-0"
        onPointerDown={(e) => pointer(e, false)}
        onPointerMove={(e) => (e.buttons === 1 ? pointer(e, true) : undefined)}
      >
        <canvas
          ref={waterRef}
          className="block aspect-[8/5] w-full cursor-crosshair touch-none"
          aria-label="Water surface simulation. Click to drop the object, drag to stir."
        />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>
      <div className="glass p-5">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl">Cross-section η(r, t)</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            azimuthal average around the last impact
          </span>
        </div>
        <canvas ref={chartRef} className="block h-[150px] w-full" />
      </div>
    </>
  );
}
