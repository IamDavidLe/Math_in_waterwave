/**
 * The marks the film draws over the water.
 *
 * The rings themselves are already on screen; everything here is the film
 * pointing at them — the cut, the cosine read off the same table the water was
 * shaded from, the 1/√r envelope, the dispersion curve, the hyperbolas and their
 * foci. It is drawn on the display canvas at full resolution rather than into
 * the low-resolution water buffer, so a hairline stays a hairline and the type
 * stays crisp.
 *
 * Kept out of the component so the whole annotation layer can be drawn against
 * a recording context and checked, which is the only way to know a panel has not
 * wandered off the edge of the frame.
 */

import { PROFILE_SAMPLES, type Profile } from "./ripple-field";
import { G, RHO_WATER, SIGMA_WATER, minimumSpeed, minimumWavelength } from "./water-physics";
import { HALF_GAP, clamp01, lerp, type Scene } from "./ripple-scene";

/* ── the marks drawn over the water ───────────────────────────────────────────
   Everything below is annotation: the rings themselves are already on screen,
   and this is the film pointing at them. It is drawn on the display canvas at
   full resolution rather than in the low-resolution water buffer, so a hairline
   stays a hairline and the type stays crisp. */

const C_WAVE = "rgb(77, 220, 220)";
const C_NODE = "rgb(238, 177, 84)";
const C_INK = "rgb(125, 159, 168)";
const C_TEXT = "rgb(221, 239, 243)";
const MONO = '600 Npx "JetBrains Mono", ui-monospace, monospace';

export type View = {
  ctx: CanvasRenderingContext2D;
  /** display size, CSS pixels */
  w: number;
  h: number;
  /** pixels per metre */
  s: number;
  /** world → display */
  X: (wx: number) => number;
  Y: (wy: number) => number;
  /** type scale */
  u: number;
};

const mono = (u: number, px: number) => MONO.replace("N", String(Math.round(px * u)));

/**
 * Curves are handed around as flat [x, y, x, y, …] lists. Building a fresh one
 * for each of them every frame is a few hundred short-lived arrays a second,
 * and the collection pauses that causes are visible as a hitch in a scroll
 * animation — so they come from here instead and are reused.
 */
const scratch: number[][] = [];
let taken = 0;
function poly(): number[] {
  const a = scratch[taken] ?? (scratch[taken] = []);
  taken++;
  a.length = 0;
  return a;
}

/**
 * A glow, without `shadowBlur`.
 *
 * Canvas shadows are re-rasterised per draw and are far and away the most
 * expensive thing a 2D context can be asked for; on a long polyline redrawn
 * sixty times a second they cost more than the whole water surface. Two passes
 * of the same path — a wide faint one under a narrow bright one — read the same
 * at a fraction of the price.
 */
function glow(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  t: number,
  colour: string,
  wide: number,
  thin: number,
  halo: string,
) {
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.3;
  ctx.strokeStyle = halo;
  ctx.lineWidth = wide;
  drawIn(ctx, pts, t);
  ctx.globalAlpha = a;
  ctx.strokeStyle = colour;
  ctx.lineWidth = thin;
  drawIn(ctx, pts, t);
}

/** Draws the first `t` of a polyline, so a curve arrives along its own length. */
function drawIn(ctx: CanvasRenderingContext2D, pts: number[], t: number) {
  const n = pts.length / 2;
  const upto = Math.max(2, Math.floor(n * clamp01(t)));
  ctx.beginPath();
  for (let i = 0; i < upto; i++) {
    const x = pts[i * 2]!;
    const y = pts[i * 2 + 1]!;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function label(
  v: View,
  text: string,
  x: number,
  y: number,
  colour: string,
  px = 11,
  align: CanvasTextAlign = "left",
) {
  const { ctx } = v;
  ctx.font = mono(v.u, px);
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 8, 14, 0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

/** A bracket with a label under it, for marking off a length. */
function bracket(v: View, x1: number, x2: number, y: number, text: string, colour: string) {
  const { ctx } = v;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x1, y - 5 * v.u);
  ctx.lineTo(x1, y + 5 * v.u);
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.moveTo(x2, y - 5 * v.u);
  ctx.lineTo(x2, y + 5 * v.u);
  ctx.stroke();
  label(v, text, (x1 + x2) / 2, y + 13 * v.u, colour, 11, "center");
}

/** Radii of the crests in a profile, nearest first. */
function crests(p: Profile, rMax: number): number[] {
  const out: number[] = [];
  const lim = Math.min(PROFILE_SAMPLES - 2, Math.floor(rMax / p.dr));
  for (let i = 2; i < lim; i++) {
    const a = p.eta[i]!;
    if (a > p.eta[i - 1]! && a >= p.eta[i + 1]! && a > p.peak * 0.18) out.push(i * p.dr);
  }
  return out;
}

/** Phase speed c = ω/k of a wave of this wavelength, m/s. */
export function phaseSpeed(lambda: number): number {
  const k = (2 * Math.PI) / lambda;
  return Math.sqrt(G * k + (SIGMA_WATER / RHO_WATER) * k * k * k) / k;
}

/* ── the one falling thing, and the moment it lands ───────────────────────── */

function drawDrop(v: View, scene: Scene) {
  const { ctx } = v;
  const o = scene.o;
  if (o.fall > 0.01 && o.fallAt < 1) {
    const cxp = v.X(0);
    const cyp = v.Y(0);
    // Far away it is big and soft; as it arrives it shrinks and sharpens.
    const q = o.fallAt;
    const rad = lerp(34, 9, q) * v.u;
    const blur = lerp(18, 2, q);
    ctx.save();
    ctx.globalAlpha = o.fall * lerp(0.35, 1, q);
    ctx.shadowColor = C_WAVE;
    ctx.shadowBlur = blur;
    const g = ctx.createRadialGradient(cxp - rad * 0.3, cyp - rad * 0.4, 1, cxp, cyp, rad);
    g.addColorStop(0, "rgba(236, 253, 255, 0.98)");
    g.addColorStop(0.5, "rgba(120, 226, 230, 0.75)");
    g.addColorStop(1, "rgba(30, 120, 140, 0.05)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cxp, cyp, rad, rad * lerp(1.25, 1, q), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (o.flash > 0.01) {
    const cxp = v.X(0);
    const cyp = v.Y(0);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const bloom = (1 - o.flash) * 0.6 + 0.4;
    const rad = 180 * v.u * bloom;
    const g = ctx.createRadialGradient(cxp, cyp, 1, cxp, cyp, rad);
    g.addColorStop(0, `rgba(255, 255, 255, ${0.5 * o.flash})`);
    g.addColorStop(0.3, `rgba(120, 226, 236, ${0.26 * o.flash})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(cxp - rad, cyp - rad, rad * 2, rad * 2);
    // the rim of the crater, thrown outward
    ctx.globalAlpha = o.flash * 0.8;
    ctx.strokeStyle = "rgba(226, 250, 252, 0.9)";
    ctx.lineWidth = 2.2 * (1 - (1 - o.flash)) + 0.6;
    ctx.beginPath();
    ctx.arc(cxp, cyp, 14 * v.u + 130 * v.u * (1 - o.flash), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/* ── chapter 2 · direction does not matter, only distance ─────────────────── */

function drawPolar(v: View, scene: Scene, clock: number) {
  const { ctx } = v;
  const o = scene.o;
  const cxp = v.X(scene.sources[0]!.x);
  const cyp = v.Y(0);

  if (o.polar > 0.01) {
    ctx.save();
    ctx.globalAlpha = o.polar * 0.5;
    ctx.strokeStyle = C_INK;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    for (let n = 1; n <= 5; n++) {
      const rr = n * 0.055 * v.s;
      ctx.beginPath();
      ctx.arc(cxp, cyp, rr, 0, Math.PI * 2 * clamp01(o.polar * 1.4 - n * 0.06));
      ctx.stroke();
    }
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cxp, cyp);
      ctx.lineTo(
        cxp + Math.cos(th) * 0.3 * v.s * o.polar,
        cyp + Math.sin(th) * 0.3 * v.s * o.polar,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  if (o.sweep > 0.01) {
    // One arm goes round at a fixed distance. The water under its tip never
    // changes height — which is the whole of η(r, θ) = η(r).
    const th = clock * 0.75;
    const rr = 0.16 * v.s;
    ctx.save();
    ctx.globalAlpha = o.sweep;
    ctx.strokeStyle = C_NODE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cxp, cyp);
    ctx.lineTo(cxp + Math.cos(th) * rr, cyp + Math.sin(th) * rr);
    ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.globalAlpha = o.sweep * 0.7;
    ctx.beginPath();
    ctx.arc(cxp, cyp, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = o.sweep;
    const tx = cxp + Math.cos(th) * rr;
    const ty = cyp + Math.sin(th) * rr;
    ctx.fillStyle = C_NODE;
    ctx.beginPath();
    ctx.arc(tx, ty, 4.5 * v.u, 0, Math.PI * 2);
    ctx.fill();
    label(v, "same r", tx + 10 * v.u, ty - 9 * v.u, C_NODE, 11);
    label(v, "same height", tx + 10 * v.u, ty + 5 * v.u, C_INK, 10);
    label(
      v,
      "θ",
      cxp + Math.cos(th / 2) * 34 * v.u,
      cyp + Math.sin(th / 2) * 34 * v.u,
      C_NODE,
      12,
      "center",
    );
    ctx.restore();
  }
}

/** Where a chart panel sits: beside the cards on a wide screen, above them otherwise. */
function panelRect(v: View) {
  const gut = 18 * v.u;
  const wide = v.w >= 900;
  const pw = wide ? Math.min(520 * v.u, v.w * 0.44) : v.w - gut * 2;
  const ph = wide ? 198 * v.u : 148 * v.u;
  return {
    x: wide ? v.w - gut - pw : gut,
    y: wide ? v.h - gut - ph - 10 * v.u : gut + 44 * v.u,
    w: pw,
    h: ph,
  };
}

function panel(v: View, r: { x: number; y: number; w: number; h: number }, alpha: number) {
  const { ctx } = v;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 14 * v.u);
  ctx.fillStyle = "rgba(2, 22, 31, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(140, 220, 230, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/* ── chapters 3–5 · the cut, the cosine, the translation, the envelope ────── */

function drawCut(v: View, scene: Scene, pa: Profile, yScale: number, clock: number) {
  const { ctx } = v;
  const o = scene.o;
  const sx = scene.sources[0]!.x;
  const rShow = scene.spanM * 0.5;

  // The cut itself, laid on the water so the graph has somewhere to come from.
  if (o.cut > 0.01) {
    ctx.save();
    ctx.globalAlpha = o.cut;
    ctx.strokeStyle = C_TEXT;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(v.X(sx), v.Y(0));
    ctx.lineTo(v.X(sx) + rShow * v.s * o.cut, v.Y(0));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C_TEXT;
    ctx.beginPath();
    ctx.arc(v.X(sx), v.Y(0), 3.4 * v.u, 0, Math.PI * 2);
    ctx.fill();
    label(v, "cut along here", v.X(sx) + 10 * v.u, v.Y(0) - 12 * v.u, C_INK, 10);
    ctx.restore();
  }

  if (o.graph < 0.01) return;
  const R = panelRect(v);
  panel(v, R, o.graph);

  const pad = 26 * v.u;
  const gx = (r: number) => R.x + pad + (r / rShow) * (R.w - pad * 1.5);
  const gy = (e: number) => R.y + R.h / 2 - (e / yScale) * (R.h / 2 - pad * 0.7);

  ctx.save();
  ctx.globalAlpha = o.graph;

  // axes
  ctx.strokeStyle = "rgba(140, 200, 215, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gx(0), gy(0));
  ctx.lineTo(gx(rShow), gy(0));
  ctx.moveTo(gx(0), R.y + pad * 0.5);
  ctx.lineTo(gx(0), R.y + R.h - pad * 0.5);
  ctx.stroke();
  label(v, "η", gx(0) - 9 * v.u, R.y + pad * 0.6, C_INK, 10, "center");
  label(v, "r", gx(rShow) - 2 * v.u, gy(0) + 13 * v.u, C_INK, 10, "center");

  // The curve, read straight out of the table the water was shaded from.
  const pts = poly();
  const step = Math.max(1, Math.floor(rShow / pa.dr / 260));
  for (let i = 0; i * pa.dr <= rShow && i < PROFILE_SAMPLES; i += step) {
    pts.push(gx(i * pa.dr), gy(pa.eta[i]!));
  }

  // The 1/√r envelope, which is the whole of the spreading argument.
  if (o.envelope > 0.01) {
    ctx.globalAlpha = o.graph * o.envelope * 0.85;
    ctx.strokeStyle = C_NODE;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    for (const sign of [1, -1]) {
      const e = poly();
      for (let i = 0; i * pa.dr <= rShow && i < PROFILE_SAMPLES; i += step) {
        e.push(gx(i * pa.dr), gy(sign * pa.env[i]!));
      }
      drawIn(ctx, e, o.envelope);
    }
    ctx.setLineDash([]);
    label(v, "A ∝ 1/√r", gx(rShow * 0.58), gy(0) - (R.h / 2 - pad * 0.7) * 0.72, C_NODE, 11);
    ctx.globalAlpha = o.graph;
  }

  // Where the same crest stood a quarter second ago: the curve is not reshaped
  // as it travels, only slid along.
  if (o.travel > 0.01) {
    const dt = 0.25;
    const shift = phaseSpeed(scene.lambda) * dt;
    ctx.globalAlpha = o.graph * o.travel * 0.4;
    ctx.strokeStyle = C_INK;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    const ghost = poly();
    for (let i = 0; i * pa.dr <= rShow && i < PROFILE_SAMPLES; i += step) {
      const r = i * pa.dr - shift;
      if (r < 0) continue;
      ghost.push(gx(r), gy(pa.eta[i]!));
    }
    drawIn(ctx, ghost, 1);
    ctx.setLineDash([]);
    ctx.globalAlpha = o.graph * o.travel;

    const cs = crests(pa, rShow);
    const pick = cs[Math.min(1, cs.length - 1)];
    if (pick !== undefined && pick - shift > 0) {
      const ax = gx(pick - shift);
      const bx = gx(pick);
      const ay = gy(pa.peak * 0.1) + 22 * v.u;
      ctx.strokeStyle = C_NODE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, ay);
      ctx.lineTo(bx - 5 * v.u, ay - 4 * v.u);
      ctx.moveTo(bx, ay);
      ctx.lineTo(bx - 5 * v.u, ay + 4 * v.u);
      ctx.stroke();
      label(
        v,
        `c Δt — c = ${(phaseSpeed(scene.lambda) * 100).toFixed(0)} cm/s`,
        bx + 8 * v.u,
        ay,
        C_NODE,
        10,
      );
    }
    ctx.globalAlpha = o.graph;
  }

  ctx.lineJoin = "round";
  glow(ctx, pts, o.graph, C_WAVE, 5.5, 2, "rgba(77, 220, 220, 0.5)");

  // Crest to crest is one wavelength — measured off the curve, not asserted.
  if (o.lambdaMark > 0.01) {
    const cs = crests(pa, rShow);
    if (cs.length >= 2) {
      const a = cs[0]!;
      const b = cs[1]!;
      ctx.globalAlpha = o.graph * o.lambdaMark;
      bracket(
        v,
        gx(a),
        gx(b),
        R.y + R.h - pad * 0.62,
        `λ ≈ ${((b - a) * 100).toFixed(1)} cm`,
        C_NODE,
      );
      ctx.globalAlpha = o.graph;
    }
  }
  ctx.restore();
}

/* ── chapter 6 · speed depends on wavelength ──────────────────────────────── */

function drawDispersion(v: View, scene: Scene) {
  const o = scene.o;
  if (o.dispersion < 0.01) return;
  const { ctx } = v;
  const R = panelRect(v);
  panel(v, R, o.dispersion);

  const pad = 28 * v.u;
  const LO = 0.002;
  const HI = 0.3;
  const span = Math.log(HI / LO);
  const px = (lam: number) => R.x + pad + (Math.log(lam / LO) / span) * (R.w - pad * 1.6);
  const CMAX = 0.78;
  const py = (c: number) => R.y + R.h - pad * 0.9 - (c / CMAX) * (R.h - pad * 1.8);

  ctx.save();
  ctx.globalAlpha = o.dispersion;
  ctx.strokeStyle = "rgba(140, 200, 215, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(LO), py(0));
  ctx.lineTo(px(HI), py(0));
  ctx.moveTo(px(LO), py(0));
  ctx.lineTo(px(LO), R.y + pad * 0.6);
  ctx.stroke();

  const pts = poly();
  for (let i = 0; i <= 160; i++) {
    const lam = LO * Math.exp((i / 160) * span);
    pts.push(px(lam), py(phaseSpeed(lam)));
  }
  glow(ctx, pts, o.dispersion, C_WAVE, 5, 2, "rgba(77, 220, 220, 0.45)");

  // The slowest wave water can carry — the bottom of the curve.
  const lmin = minimumWavelength();
  const cmin = minimumSpeed();
  ctx.strokeStyle = C_NODE;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(lmin), py(cmin));
  ctx.lineTo(px(lmin), py(0));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C_NODE;
  ctx.beginPath();
  ctx.arc(px(lmin), py(cmin), 3.6 * v.u, 0, Math.PI * 2);
  ctx.fill();
  label(
    v,
    `slowest · ${(lmin * 100).toFixed(1)} cm`,
    px(lmin),
    py(0) + 13 * v.u,
    C_NODE,
    10,
    "center",
  );

  label(v, "surface tension", px(0.0035), R.y + pad * 0.7, C_INK, 10);
  label(v, "gravity", px(HI) - 4 * v.u, R.y + pad * 0.7, C_INK, 10, "right");
  label(v, "c", px(LO) - 10 * v.u, R.y + pad * 0.8, C_INK, 10, "center");
  label(v, "λ", px(HI) - 2 * v.u, py(0) + 13 * v.u, C_INK, 10, "center");

  // Where this pond's own ripple sits on the curve.
  const lam = Math.min(HI, Math.max(LO, scene.lambda));
  const cx = px(lam);
  const cy = py(phaseSpeed(lam));
  ctx.strokeStyle = "rgba(226, 250, 252, 0.85)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, 6 * v.u, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* ── chapter 7 · the object sets the wavelength ───────────────────────────── */

function drawSizeDial(v: View, scene: Scene) {
  const o = scene.o;
  if (o.sizeDial < 0.01) return;
  const { ctx } = v;
  const sx = v.X(scene.sources[0]!.x);
  const sy = v.Y(0);
  const rp = scene.radius * v.s;

  ctx.save();
  ctx.globalAlpha = o.sizeDial;
  ctx.strokeStyle = C_NODE;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(rp, 3), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  bracket(v, sx - rp, sx + rp, sy - Math.max(rp, 3) - 16 * v.u, `2R ≈ λ`, C_NODE);
  label(
    v,
    `R = ${(scene.radius * 100).toFixed(1)} cm   →   λ ≈ ${(scene.lambda * 100).toFixed(1)} cm`,
    sx,
    sy + Math.max(rp, 3) + 20 * v.u,
    C_TEXT,
    12,
    "center",
  );
  ctx.restore();
}

/* ── chapters 8–9 · two stones, and the curves where they cancel ──────────── */

function drawInterference(v: View, scene: Scene) {
  const o = scene.o;
  if (o.addMark < 0.01 && o.foci < 0.01) return;
  const { ctx } = v;
  const a = HALF_GAP;
  const lam = scene.lambda;

  ctx.save();

  // Where crest meets crest, and where crest meets trough.
  if (o.addMark > 0.01) {
    ctx.globalAlpha = o.addMark;
    // Anywhere on the perpendicular bisector the two journeys are equal, so the
    // two waves always arrive together.
    const bx = v.X(0);
    const by = v.Y(-0.085);
    ctx.strokeStyle = C_WAVE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by, 6 * v.u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(v.X(-a), v.Y(0));
    ctx.lineTo(bx, by);
    ctx.lineTo(v.X(a), v.Y(0));
    ctx.stroke();
    ctx.setLineDash([]);
    label(v, "equal journeys — crest on crest", bx + 12 * v.u, by + 2 * v.u, C_WAVE, 11);

    // And a quarter of a wavelength off the middle, one arrives half a wave late.
    const dx = lam * 0.25;
    const nx2 = v.X(dx);
    const ny2 = v.Y(0.055);
    ctx.strokeStyle = C_NODE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(nx2, ny2, 6 * v.u, 0, Math.PI * 2);
    ctx.stroke();
    label(v, "half a wave apart — flat", nx2 + 12 * v.u, ny2, C_NODE, 11);
  }

  // The still lanes are already painted into the water by the shader. These are
  // the curves themselves, named.
  if (o.hyperbola > 0.01) {
    ctx.globalAlpha = o.hyperbola;
    const limit = scene.spanM * 0.62;
    for (let n = 0; n < 7; n++) {
      const A = ((n + 0.5) * lam) / 2;
      if (A >= a) break;
      const B = Math.sqrt(a * a - A * A);
      for (const sign of [1, -1]) {
        const pts = poly();
        for (let t = -3.2; t <= 3.2; t += 0.04) {
          const wy = B * Math.sinh(t);
          if (Math.abs(wy) > limit) continue;
          pts.push(v.X(sign * A * Math.cosh(t)), v.Y(wy));
        }
        if (pts.length > 4) {
          glow(ctx, pts, o.hyperbola, C_NODE, 4.5, 1.7, "rgba(238, 177, 84, 0.45)");
        }
      }
    }
  }

  // The foci, and the two distances the condition is written in.
  if (o.foci > 0.01) {
    ctx.globalAlpha = o.foci;
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = C_NODE;
      ctx.beginPath();
      ctx.arc(v.X(sgn * a), v.Y(0), 4.5 * v.u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(238, 177, 84, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(v.X(sgn * a), v.Y(0), 11 * v.u, 0, Math.PI * 2);
      ctx.stroke();
    }
    label(v, "focus", v.X(-a), v.Y(0) - 20 * v.u, C_NODE, 10, "center");
    label(v, "focus", v.X(a), v.Y(0) - 20 * v.u, C_NODE, 10, "center");

    // A point out on the first branch, with both journeys drawn to it.
    const A = (0.5 * lam) / 2;
    if (A < a) {
      const B = Math.sqrt(a * a - A * A);
      const t = 1.15;
      const wx = A * Math.cosh(t);
      const wy = B * Math.sinh(t);
      const pxp = v.X(wx);
      const pyp = v.Y(wy);
      ctx.strokeStyle = "rgba(226, 250, 252, 0.75)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(v.X(-a), v.Y(0));
      ctx.lineTo(pxp, pyp);
      ctx.moveTo(v.X(a), v.Y(0));
      ctx.lineTo(pxp, pyp);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C_TEXT;
      ctx.beginPath();
      ctx.arc(pxp, pyp, 3.4 * v.u, 0, Math.PI * 2);
      ctx.fill();
      const d1 = Math.hypot(wx + a, wy);
      const d2 = Math.hypot(wx - a, wy);
      label(
        v,
        "d₁",
        (v.X(-a) + pxp) / 2 - 4 * v.u,
        (v.Y(0) + pyp) / 2 - 8 * v.u,
        C_TEXT,
        11,
        "center",
      );
      label(
        v,
        "d₂",
        (v.X(a) + pxp) / 2 + 10 * v.u,
        (v.Y(0) + pyp) / 2 - 8 * v.u,
        C_TEXT,
        11,
        "center",
      );
      label(
        v,
        `d₁ − d₂ = ${((d1 - d2) * 100).toFixed(1)} cm = λ/2`,
        pxp + 12 * v.u,
        pyp - 12 * v.u,
        C_NODE,
        11,
      );
    }
  }
  ctx.restore();
}

/** Everything over the water, in the order it should stack. */
export function drawOverlay(v: View, scene: Scene, pa: Profile, yScale: number, clock: number) {
  taken = 0;
  drawPolar(v, scene, clock);
  drawSizeDial(v, scene);
  drawInterference(v, scene);
  drawCut(v, scene, pa, yScale, clock);
  drawDispersion(v, scene);
  drawDrop(v, scene);
}
