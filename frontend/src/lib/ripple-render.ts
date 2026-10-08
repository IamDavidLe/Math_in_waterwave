/**
 * Shading the water.
 *
 * Pure arithmetic over a pixel buffer, with no canvas and no DOM, so a frame
 * can be rendered and inspected outside a browser.
 */

import { PROFILE_SAMPLES, type Profile } from "./ripple-field";
import { type Scene } from "./ripple-scene";

/** The part of an ImageData this renderer needs — so a plain buffer will do. */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/**
 * The two long swells that keep the pond from ever being perfectly dead. They
 * are deliberately short enough to read as texture rather than as a pair of
 * rolling blobs, and in the chapters with no impact in them they are the only
 * thing on screen.
 */
const SWELL_LAMBDA_1 = 0.17;
const SWELL_LAMBDA_2 = 0.11;
const SWELL_SLOPE_PER_UNIT =
  0.6 * ((2 * Math.PI) / SWELL_LAMBDA_1) + 0.4 * ((2 * Math.PI) / SWELL_LAMBDA_2);

/** On-screen steepness the swell is held at, beside a ripple and on its own. */
const SWELL_BESIDE = 0.2;
const SWELL_ALONE = 0.55;

export type Exposure = {
  /** what slopes are multiplied by before they are lit */
  relief: number;
  /** the swell amplitude to actually draw, which may be less than the scene asks */
  swell: number;
};

/**
 * How to expose one frame.
 *
 * A raindrop's rings and a boulder's differ in steepness by more than an order
 * of magnitude, and the film has to read at both ends, so it exposes for
 * whatever is in front of it the way a camera would. The swell is then held
 * down to a fixed share of that, which is the only way a faint ripple is not
 * simply drowned by the texture it sits on.
 *
 * Only the lighting changes. η is never touched, so every number the page
 * quotes — λ, c, A, the arithmetic in the panels — is still the real one.
 */
export function exposureFor(rippleSlope: number, swell: number): Exposure {
  const lively = rippleSlope > 0.012;
  const relief = Math.min(
    90,
    TARGET_SLOPE / (lively ? rippleSlope : Math.max(swellSlopeOf(swell), 0.012)),
  );
  const want = lively ? SWELL_BESIDE : SWELL_ALONE;
  return { relief, swell: Math.min(swell, want / (relief * SWELL_SLOPE_PER_UNIT)) };
}

export function swellSlopeOf(swell: number): number {
  return swell * SWELL_SLOPE_PER_UNIT;
}

/* ── shading the water ────────────────────────────────────────────────────────
   The colours are the site's own tokens resolved to sRGB, so the pond and the
   page are the same palette. Light comes from the upper left and the eye looks
   straight down, which is the one view where a ripple shows itself entirely
   through slope: flat water is almost black, and everything you can see is the
   surface tilting. */

const DEEP = [3, 13, 22] as const;
const BODY = [12, 56, 66] as const;
const SKY = [24, 132, 142] as const;
const CREST = [140, 234, 237] as const;
const GLINT = [226, 244, 248] as const;
const AMBER = [238, 177, 84] as const;

const LX = -0.399;
const LY = -0.658;
const LZ = 0.638;
/** Half way between the light and the eye — where a mirror would glint. */
const HX = -0.22;
const HY = -0.362;
const HZ = 0.902;

/**
 * The slope the shading is exposed for.
 *
 * Real ripples are shallow — a millimetre crest on a four-centimetre wave is a
 * slope of about 0.17, which seen from above is almost nothing, and a raindrop's
 * rings are shallower still by an order of magnitude. So the film exposes for
 * the ripple in front of it, the way a camera would: the caller divides this by
 * the steepest slope actually present and passes the result as `relief`.
 *
 * This is a display gain and nothing more. η is never touched, so every number
 * the page quotes — λ, c, A, the arithmetic in the panels — is still the real
 * one; only how brightly the relief is lit changes.
 */
const TARGET_SLOPE = 0.95;
/** ∇²η runs to tens per metre, and it is what focuses light into caustics. */
const CAUSTIC_GAIN = 0.02;

/**
 * Paint one frame of water into `img`.
 *
 * Everything per-pixel here is a lookup and some arithmetic: the expensive part
 * — solving for the ripple — was done once per source into a radial table, and
 * the ambient swell is advanced along each row by a rotation rather than
 * recomputed, so there is no trigonometry at all inside the loop.
 */
export function drawWater(
  img: Pixels,
  scene: Scene,
  pa: Profile,
  pb: Profile | null,
  ex: Exposure,
) {
  const W = img.width;
  const H = img.height;
  const d = img.data;
  const mpp = scene.spanM / W;
  const x0 = scene.cx - (W * mpp) / 2;
  const y0 = scene.cy - (H * mpp) / 2;

  const s0 = scene.sources[0]!;
  const s1 = pb ? scene.sources[1]! : null;
  const eA = pa.eta;
  const gA = pa.slope;
  const lA = pa.lap;
  const vA = pa.env;
  const idrA = 1 / pa.dr;
  const eB = pb?.eta;
  const gB = pb?.slope;
  const lB = pb?.lap;
  const vB = pb?.env;
  const idrB = pb ? 1 / pb.dr : 0;
  const last = PROFILE_SAMPLES - 2;

  // The two long swells that keep the pond from ever being perfectly dead.
  const sw = ex.swell;
  const relief = ex.relief;
  const k1 = (2 * Math.PI) / 0.58;
  const k2 = (2 * Math.PI) / 0.41;
  const d1x = k1 * 0.86 * mpp;
  const d1c = Math.cos(d1x);
  const d1s = Math.sin(d1x);
  const d2x = k2 * -0.42 * mpp;
  const d2c = Math.cos(d2x);
  const d2s = Math.sin(d2x);

  // The swell's slope contributions are fixed; only its phase moves.
  const sw1x = sw * 0.6 * k1 * 0.86;
  const sw1y = sw * 0.6 * k1 * 0.51;
  const sw2x = sw * 0.4 * k2 * -0.42;
  const sw2y = sw * 0.4 * k2 * 0.91;
  const sw1 = sw * 0.6;
  const sw2 = sw * 0.4;
  const dvx = 2 / W;

  const nodal = scene.nodal;
  const invLam = 1 / scene.lambda;
  const nodeRef = 0.0005;

  for (let py = 0; py < H; py++) {
    const wy = y0 + py * mpp;
    const dy0 = wy - s0.y;
    const dy1 = s1 ? wy - s1.y : 0;

    const a1 = k1 * (x0 * 0.86 + wy * 0.51) - scene.swellPhase * 1.5;
    let c1 = Math.cos(a1);
    let n1 = Math.sin(a1);
    const a2 = k2 * (x0 * -0.42 + wy * 0.91) - scene.swellPhase * 1.1;
    let c2 = Math.cos(a2);
    let n2 = Math.sin(a2);

    const vy = (py / H) * 2 - 1;
    const vig0 = 1 - 0.34 * vy * vy;
    let o = py * W * 4;

    for (let px = 0; px < W; px++, o += 4) {
      const wx = x0 + px * mpp;

      // ── the ripple from each source, read off its radial table ──
      const dx0 = wx - s0.x;
      const r0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      let eta = 0;
      let gx = 0;
      let gy = 0;
      let lap = 0;
      let env0 = 0;
      let env1 = 0;

      const t0 = r0 * idrA;
      if (t0 < last) {
        const i = t0 | 0;
        const fr = t0 - i;
        const h = eA[i]! + (eA[i + 1]! - eA[i]!) * fr;
        const sl = gA[i]! + (gA[i + 1]! - gA[i]!) * fr;
        env0 = vA[i]! + (vA[i + 1]! - vA[i]!) * fr;
        eta += h;
        lap += lA[i]! + (lA[i + 1]! - lA[i]!) * fr;
        if (r0 > 1e-6) {
          const ir = sl / r0;
          gx += ir * dx0;
          gy += ir * dy0;
        }
      }

      let r1 = 0;
      if (s1) {
        const dx1 = wx - s1.x;
        r1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const t1 = r1 * idrB;
        if (t1 < last) {
          const i = t1 | 0;
          const fr = t1 - i;
          const h = eB![i]! + (eB![i + 1]! - eB![i]!) * fr;
          const sl = gB![i]! + (gB![i + 1]! - gB![i]!) * fr;
          env1 = vB![i]! + (vB![i + 1]! - vB![i]!) * fr;
          eta += h;
          lap += lB![i]! + (lB![i + 1]! - lB![i]!) * fr;
          if (r1 > 1e-6) {
            const ir = sl / r1;
            gx += ir * dx1;
            gy += ir * dy1;
          }
        }
      }

      // ── the ambient swell, advanced rather than recomputed ──
      eta += sw1 * n1 + sw2 * n2;
      gx += sw1x * c1 + sw2x * c2;
      gy += sw1y * c1 + sw2y * c2;
      {
        const t = c1 * d1c - n1 * d1s;
        n1 = n1 * d1c + c1 * d1s;
        c1 = t;
        const u = c2 * d2c - n2 * d2s;
        n2 = n2 * d2c + c2 * d2s;
        c2 = u;
      }

      // ── slope to light ──
      const sx = gx * relief;
      const sy = gy * relief;
      const inv = 1 / Math.sqrt(sx * sx + sy * sy + 1);
      const nx = -sx * inv;
      const ny = -sy * inv;
      const nz = inv;

      let diff = nx * LX + ny * LY + nz * LZ;
      if (diff < 0) diff = 0;
      // A glint is the 32nd power of the half-vector term, by five squarings —
      // `**` would be a library call, and this runs once per pixel.
      const hd = nx * HX + ny * HY + nz * HZ;
      let glint = 0;
      if (hd > 0) {
        const h2 = hd * hd;
        const h4 = h2 * h2;
        const h8 = h4 * h4;
        const h16 = h8 * h8;
        glint = h16 * h16;
      }
      // How much sky a tilted facet throws at the eye, and from which side.
      const tilt = 0.03 + 0.92 * (1 - nz);
      const refx = 2 * nz * nx;
      const refy = 2 * nz * ny;
      let sky = 0.5 + 0.5 * (refx * 0.62 - refy * 0.78);
      if (sky < 0) sky = 0;
      else if (sky > 1) sky = 1;
      // Curvature focuses light: a crest acts as a lens and brightens the water
      // under it. This is the band you see sliding along a real ripple.
      let caustic = -lap * CAUSTIC_GAIN;
      if (caustic < 0) caustic = 0;
      else if (caustic > 1.5) caustic = 1.5;

      const lit = 0.26 + 0.74 * diff;
      let rr = DEEP[0] + BODY[0] * lit + SKY[0] * tilt * sky * 1.5 + CREST[0] * caustic * 0.22;
      let gg = DEEP[1] + BODY[1] * lit + SKY[1] * tilt * sky * 1.5 + CREST[1] * caustic * 0.22;
      let bb = DEEP[2] + BODY[2] * lit + SKY[2] * tilt * sky * 1.5 + CREST[2] * caustic * 0.22;
      rr += GLINT[0] * glint * 0.72;
      gg += GLINT[1] * glint * 0.72;
      bb += GLINT[2] * glint * 0.72;

      // ── the still lanes, where two ring systems cancel ──
      if (nodal > 0 && s1) {
        let near = env0 < env1 ? env0 : env1;
        near = near / nodeRef;
        if (near > 1) near = 1;
        if (near > 0.02) {
          // |cos(π·Δ/λ)| vanishes exactly where the two journeys differ by half
          // a wavelength — the hyperbolas, straight out of the field itself. A
          // triangle of the same period stands in for the cosine: it is
          // indistinguishable once cubed, and costs no library call per pixel.
          const ph = (r0 - r1) * invLam;
          const frac = ph - Math.floor(ph);
          const u = 1 - Math.abs(2 * frac - 1);
          const m = u * u * u * near * nodal;
          rr += AMBER[0] * m * 0.58;
          gg += AMBER[1] * m * 0.58;
          bb += AMBER[2] * m * 0.58;
        }
      }

      // ── a vignette, so the frame has a middle ──
      const vx = px * dvx - 1;
      const vig = vig0 - 0.272 * vx * vx;

      d[o] = rr * vig;
      d[o + 1] = gg * vig;
      d[o + 2] = bb * vig;
      d[o + 3] = 255;
    }
  }
}
