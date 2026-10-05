import { useEffect, useRef } from "react";

import {
  G,
  type Impact,
  type ObjectParams,
  type WaterParams,
  analyticProfile,
  impactOf,
} from "@/lib/water-physics";
import { drawObject, lookById } from "@/lib/object-looks";
import { MARK_LIFE, type SimConfig, WaterSim, metresPerUnit } from "@/lib/water-sim";

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

export type PoolView = "top" | "side" | "both";

type Props = {
  view: PoolView;
  /** id of the appearance dropped objects are drawn with */
  look: string;
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

export function RipplePool({
  view,
  look,
  object,
  water,
  solver,
  paused,
  onImpact,
  onStats,
}: Props) {
  const waterRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<WaterSim | null>(null);

  // Live props, read inside the animation loop without restarting it.
  const live = useRef({ view, look, object, water, solver, paused, onImpact, onStats });
  live.current = { view, look, object, water, solver, paused, onImpact, onStats };
  /** Row of the grid the side view cuts through, 0–1 down the tank. */
  const slice = useRef(0.5);

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
    // Wavenumber and the solver→metres scale of the ripple now on the water;
    // the side view needs both to draw orbits and to state its exaggeration.
    let lastK = impactOf(live.current.object, live.current.water).k;
    let lastMetresPerUnit = metresPerUnit(impactOf(live.current.object, live.current.water));
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
        const look = lookById(b.look);
        if (b.state === "falling") {
          // Shadow on the water tightens as the object drops.
          const near = 1 - Math.min(1, b.z / Math.max(live.current.object.dropHeight, 0.01));
          octx.fillStyle = `rgba(2,16,24,${0.1 + near * 0.3})`;
          octx.beginPath();
          octx.ellipse(cx, cy, r * (2.4 - near * 1.2), r * (1.6 - near * 0.8), 0, 0, Math.PI * 2);
          octx.fill();
          const lift = b.z * 95 * sy;
          drawObject(octx, look, cx, cy - lift, r * (1 + b.z * 0.5), { spin: b.id * 0.7 });
          continue;
        }
        if (b.state === "floating") {
          drawObject(octx, look, cx, cy - b.z * 10 * sy, r, { spin: b.id * 0.7 });
          continue;
        }
        // Sinking: dim and shrink with depth as the water closes over it.
        const depth = Math.min(1, -b.z / 0.35);
        drawObject(octx, look, cx, cy, r * (1 - depth * 0.55), {
          alpha: 0.85 * (1 - depth),
          spin: b.id * 0.7,
        });
      }

      // Where crests broke — each one is a wave that was just born. A single
      // splash breaks all round its rim at once, so only the strongest few are
      // drawn: enough to point at a collision, not enough to fur the screen.
      const shown = sim.marks
        .filter((m) => sim.time - m.t < MARK_LIFE)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 8);
      for (const m of shown) {
        const age = (sim.time - m.t) / MARK_LIFE;
        octx.strokeStyle = `rgba(190,240,255,${(1 - age) * 0.28})`;
        octx.lineWidth = Math.max(0.8, 1.2 * dpr * (1 - age));
        octx.beginPath();
        octx.arc(m.x * sx, m.y * sy, (2 + age * 22) * sx, 0, Math.PI * 2);
        octx.stroke();
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

      // Where the side view is cutting. Draggable, so you can take the slice
      // anywhere across the tank.
      if (live.current.view !== "top") {
        const y = slice.current * oh;
        octx.strokeStyle = "oklch(0.8 0.13 75 / 0.85)";
        octx.lineWidth = 1.5 * dpr;
        octx.setLineDash([7 * dpr, 6 * dpr]);
        octx.beginPath();
        octx.moveTo(0, y);
        octx.lineTo(ow, y);
        octx.stroke();
        octx.setLineDash([]);
        octx.fillStyle = "oklch(0.8 0.13 75 / 0.9)";
        for (const hx of [10 * dpr, ow - 10 * dpr]) {
          octx.beginPath();
          octx.arc(hx, y, 4 * dpr, 0, Math.PI * 2);
          octx.fill();
        }
      }
    };

    /* ── side view: a slice straight through the tank ───────────────────── */
    // Depth is drawn to its own true scale (one wavelength's worth of water),
    // while the surface displacement is exaggerated — crests here are
    // millimetres on a tank 1.6 m wide, and nothing would be visible at 1:1.
    // The view says by how much, so the exaggeration is never a lie.
    const prevRow = new Float32Array(W);
    let sideGain = 40;
    const drawSide = () => {
      const cv = sideRef.current;
      if (!cv || live.current.view === "top") return;
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const CW = Math.max(1, Math.round(rect.width * dpr));
      const CH = Math.max(1, Math.round(rect.height * dpr));
      if (cv.width !== CW || cv.height !== CH) {
        cv.width = CW;
        cv.height = CH;
      }
      const g = cv.getContext("2d")!;
      const row = Math.max(1, Math.min(H - 2, Math.round(slice.current * H)));
      const eta = sim.cur;
      const base = row * W;
      const sx = CW / (W - 1);
      const waterline = CH * 0.45;

      // Exposure for the slice alone, so a quiet cut is still readable.
      let peak = 1e-5;
      let peakX = W >> 1;
      for (let x = 0; x < W; x++) {
        const a = Math.abs(eta[base + x]!);
        if (a > peak) {
          peak = a;
          peakX = x;
        }
      }
      // Aim for a crest about a quarter of the view tall whatever the wave's
      // real size, so a bowling ball and a raindrop are both readable.
      const want = Math.max(8, Math.min(6000, (CH * 0.26) / peak));
      sideGain += (want - sideGain) * (want < sideGain ? 0.3 : 0.04);

      g.clearRect(0, 0, CW, CH);

      // air
      const air = g.createLinearGradient(0, 0, 0, waterline);
      air.addColorStop(0, "#07131c");
      air.addColorStop(1, "#0d2230");
      g.fillStyle = air;
      g.fillRect(0, 0, CW, waterline);

      // the surface itself
      const surfaceY = (x: number) => waterline - eta[base + x]! * sideGain;
      g.beginPath();
      g.moveTo(0, surfaceY(0));
      for (let x = 1; x < W; x++) g.lineTo(x * sx, surfaceY(x));
      g.lineTo(CW, CH);
      g.lineTo(0, CH);
      g.closePath();
      const body = g.createLinearGradient(0, waterline, 0, CH);
      body.addColorStop(0, "oklch(0.52 0.08 215 / 0.85)");
      body.addColorStop(0.35, "oklch(0.34 0.06 220 / 0.9)");
      body.addColorStop(1, "oklch(0.2 0.04 228)");
      g.fillStyle = body;
      g.fill();

      // still-water reference
      g.strokeStyle = "rgba(190,225,240,0.18)";
      g.setLineDash([5 * dpr, 5 * dpr]);
      g.lineWidth = dpr;
      g.beginPath();
      g.moveTo(0, waterline);
      g.lineTo(CW, waterline);
      g.stroke();
      g.setLineDash([]);

      // the surface line, bright where it is steep
      g.beginPath();
      g.moveTo(0, surfaceY(0));
      for (let x = 1; x < W; x++) g.lineTo(x * sx, surfaceY(x));
      g.strokeStyle = "oklch(0.86 0.11 195)";
      g.lineWidth = 2 * dpr;
      g.stroke();

      /* Water does not travel with the wave — it circles in place. Each dot
         sits at its rest position displaced by (ξx, ξz) = ((1/k)∂η/∂x, η)·e^(kz),
         the exact linear deep-water orbit, so the dots trace circles that
         shrink with depth as the wave passes. */
      const k = Math.max(4, lastK);
      const lambdaCells = (2 * Math.PI) / k / sim.metersPerCell;
      const shownDepth = Math.max(8, Math.min(CH - waterline - 4 * dpr, CH - waterline));
      const depths = [0, 0.125, 0.25, 0.375, 0.5];
      let guideDrawn = false;
      for (const frac of depths) {
        const zMetres = -frac * ((2 * Math.PI) / k);
        const decay = Math.exp(k * zMetres);
        const yRest = waterline + (frac / 0.5) * shownDepth * 0.92;
        for (let px = 20 * dpr; px < CW; px += 30 * dpr) {
          const x = Math.round(px / sx);
          if (x < 1 || x > W - 2) continue;
          const dEta = (eta[base + x + 1]! - eta[base + x - 1]!) * 0.5;
          // (1/k)∂η/∂x in cells → the same units η is drawn in
          const xiX = (dEta / (k * sim.metersPerCell)) * decay;
          const xiZ = eta[base + x]! * decay;
          const r = peak * decay * sideGain;
          // One orbit drawn out in full, so the circling is unmistakable —
          // placed on the tallest wave in the cut, where it means something.
          if (!guideDrawn && frac > 0 && r > 3 * dpr && Math.abs(x - peakX) < 16) {
            g.strokeStyle = "rgba(190,240,255,0.22)";
            g.lineWidth = dpr;
            g.beginPath();
            g.arc(px, yRest, r, 0, Math.PI * 2);
            g.stroke();
            guideDrawn = true;
          }
          g.beginPath();
          g.arc(px + xiX * sideGain, yRest - xiZ * sideGain, 2.1 * dpr, 0, Math.PI * 2);
          g.fillStyle = `rgba(206,240,252,${0.25 + 0.5 * decay})`;
          g.fill();
        }
      }

      // foam where crests broke, and the objects and spray near this slice
      for (const m of sim.marks) {
        const near = Math.abs(m.y - row);
        if (near > 6) continue;
        const age = (sim.time - m.t) / MARK_LIFE;
        if (age > 1) continue;
        g.fillStyle = `rgba(226,244,252,${(1 - age) * 0.55 * (1 - near / 6)})`;
        g.beginPath();
        g.arc(m.x * sx, surfaceY(Math.round(m.x)) - 2 * dpr, (2 + 5 * age) * dpr, 0, Math.PI * 2);
        g.fill();
      }

      /* Heights above and below the water are NOT drawn with sideGain. That
         gain exaggerates millimetre ripples and can run into the thousands, so
         using it for an object threw a bobbing float off the top of the view
         and left it juddering. Air and depth get their own honest scales. */
      const airPx = waterline - 8 * dpr;
      const deepPx = CH - waterline;
      const sprayScale = Math.min(airPx / 0.2, 2600 * dpr);

      for (const b of sim.bodies) {
        const near = Math.abs(b.y - row);
        if (near > 12) continue;
        const r = Math.max(3 * dpr, (b.impact.craterRadius / sim.metersPerCell) * 0.6 * sx);
        const cx = b.x * sx;
        // Keep a floor on the fade: something just off the cut should still be
        // visible rather than winking out exactly at the edge of the band.
        const fade = Math.max(0.15, 1 - near / 12);
        let cy: number;
        if (b.state === "falling") {
          // Scaled so the whole fall is visible, however high it started.
          const fell = Math.max(0.08, b.impact.v ** 2 / (2 * G));
          cy = waterline - b.z * (airPx / fell);
        } else if (b.state === "floating") {
          /* A float rides the surface it sits on, dipped in by the fraction
             Archimedes says — half-submerged sits centred on the line. It
             responds to the *mean* surface under its hull, not to one point:
             reading a single cell let a sharp ripple passing beneath flick the
             object up and down between frames. */
          const half = Math.max(1, Math.round(b.impact.craterRadius / sim.metersPerCell));
          let sum = 0;
          let n = 0;
          for (let x = Math.round(b.x) - half; x <= Math.round(b.x) + half; x++) {
            if (x < 0 || x >= W) continue;
            sum += eta[base + x]!;
            n++;
          }
          const mean = n ? sum / n : 0;
          cy = waterline - mean * sideGain - r * (1 - 2 * b.impact.submerged);
        } else {
          cy = waterline + Math.min(1, -b.z / 0.4) * deepPx;
        }
        drawObject(g, lookById(b.look), cx, cy, r, {
          alpha: fade * (b.state === "sinking" ? 0.7 : 1),
          spin: b.id * 0.7,
        });
      }
      for (const d of sim.droplets) {
        const near = Math.abs(d.y - row);
        if (near > 10) continue;
        g.fillStyle = `rgba(228,244,252,${0.75 * (1 - near / 10)})`;
        g.beginPath();
        g.arc(
          d.x * sx,
          waterline - d.z * sprayScale,
          Math.max(1.2 * dpr, d.r * sx),
          0,
          Math.PI * 2,
        );
        g.fill();
      }

      // honest labels
      const exaggeration = sideGain / lastMetresPerUnit / (CW / sim.cfg.metersAcross);
      g.fillStyle = "rgba(190,225,240,0.65)";
      g.font = `${11 * dpr}px JetBrains Mono, monospace`;
      g.fillText(
        `vertical ×${exaggeration < 10 ? exaggeration.toFixed(1) : exaggeration.toFixed(0)}`,
        10 * dpr,
        18 * dpr,
      );
      g.fillText(
        `depth shown: λ/2 ≈ ${(((lambdaCells * sim.metersPerCell) / 2) * 100).toFixed(1)} cm`,
        10 * dpr,
        CH - 10 * dpr,
      );
      g.fillText("water circles in place", CW - 150 * dpr, CH - 10 * dpr);

      for (let x = 0; x < W; x++) prevRow[x]! = eta[base + x]!;
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
          lastK = body.impact.k;
          lastMetresPerUnit = metresPerUnit(body.impact);
          // Cut the slice through whatever just landed, so the side view is
          // looking at the splash rather than at flat water beside it.
          slice.current = body.y / H;
          impactCb?.(body.impact);
        }
      }
      const showTop = live.current.view !== "side";
      if (showTop) {
        drawWater();
        drawOverlay();
      }
      drawSide();
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

  /**
   * The slice line parks itself on the last splash, which is exactly where you
   * want to drop the next object — so pressing on the line must not steal the
   * click. A press near it only *arms* a drag: move and you take the line with
   * you, release without moving and it drops as usual.
   */
  const armed = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  const drop = (sim: WaterSim, nx: number, ny: number) =>
    sim.drop(nx, ny, impactOf(live.current.object, live.current.water), live.current.look);

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    const sim = simRef.current;
    if (!sim) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    if (view !== "top" && Math.abs(ny - slice.current) * rect.height < 14) {
      armed.current = { x: e.clientX, y: e.clientY, dragging: false };
      return;
    }
    armed.current = null;
    // Take the cut to whatever was just dropped, so the side view shows the
    // fall and the splash rather than flat water beside them.
    if (view !== "top") slice.current = ny;
    drop(sim, nx, ny);
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const sim = simRef.current;
    if (!sim || e.buttons !== 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;

    const a = armed.current;
    if (a) {
      if (!a.dragging && Math.hypot(e.clientX - a.x, e.clientY - a.y) < 4) return;
      a.dragging = true;
      slice.current = ny;
      return;
    }
    sim.stir(nx, ny, 0.07, 2.5);
  };

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const sim = simRef.current;
    const a = armed.current;
    armed.current = null;
    if (!sim || !a || a.dragging) return;
    // Pressed on the line and let go without moving — that was a drop.
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    drop(sim, nx, ny);
  };

  /** Clicking the side view drops onto the line it is cutting. */
  const dropFromSide = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sim = simRef.current;
    if (!sim) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    if (nx < 0 || nx > 1) return;
    sim.drop(
      nx,
      slice.current,
      impactOf(live.current.object, live.current.water),
      live.current.look,
    );
  };

  return (
    <>
      {/* Both views stay mounted — the draw loop binds each canvas context
          once, so unmounting one would leave it blank when it came back. */}
      <div className={view === "side" ? "hidden" : "contents"}>
        <div
          className="glass relative overflow-hidden p-0"
          onPointerDown={down}
          onPointerUp={up}
          onPointerLeave={() => (armed.current = null)}
          onPointerMove={move}
        >
          <canvas
            ref={waterRef}
            className="block aspect-[8/5] w-full cursor-crosshair touch-none"
            aria-label="Water surface seen from above. Click to drop the object, drag to stir."
          />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>
      </div>

      <div className={view === "top" ? "hidden" : "contents"}>
        <div className="glass overflow-hidden p-0">
          <div className="flex items-baseline justify-between gap-4 px-5 pt-4">
            <h2 className="font-display text-xl">Side view</h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              {view === "side" ? "click to drop" : "drag the dashed line above to move the cut"}
            </span>
          </div>
          <canvas
            ref={sideRef}
            onPointerDown={dropFromSide}
            className={`mt-3 block h-[220px] w-full touch-none ${view === "side" ? "cursor-crosshair" : ""}`}
            aria-label="The water surface cut through side-on, showing wave shape and the orbits water follows as a wave passes."
          />
        </div>
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
