/**
 * The ripple field the scroll film is drawn from.
 *
 * The lab integrates a height field cell by cell (`water-sim.ts`). A scrolled
 * film cannot do that: scrubbing backwards would have to un-integrate, and the
 * picture at any scroll position has to be the *same* picture every time it is
 * visited. So the film is drawn from the closed-form solution instead — the
 * classic Cauchy–Poisson ripple from a point impulse on deep water:
 *
 *     η(r, t) = ∫ A(k) J₀(kr) cos(ω(k)t) k dk,
 *     ω(k)² = gk + σk³/ρ                     (the page's own dispersion relation)
 *
 * Two things make that cheap enough to evaluate 60 times a second. First, far
 * from the impact the Bessel function has an asymptotic form,
 *
 *     J₀(kr) ≈ √(2/πkr) · cos(kr − π/4),
 *
 * which splits the integral into an outgoing and an incoming wave and hands us
 * the 1/√r spreading **for free** — the same 1/√r the investigation argues for
 * from energy per unit of circumference. Keeping only the outgoing half,
 *
 *     η(r, t) ≈ (1/√r) · Σ_k  w(k) · cos(kr − ω(k)t − π/4) · e^(−2νk²t).
 *
 * Second, η depends on nothing but r, so one pass over a radial lookup table
 * serves every pixel. The table is built with a rotation recurrence (no trig in
 * the inner loop), and derivatives come out of the same three accumulators, so
 * slope and curvature are analytic rather than differenced.
 *
 * Nothing here is faked. Give it the real g, σ, ρ and ν and it produces a real
 * dispersive ripple train: the capillary front races out ahead, the gravity
 * swell rolls along behind, and the slow band between them is the 1.7 cm
 * minimum the investigation talks about.
 */

import { G, NU_WATER, RHO_WATER, SIGMA_WATER } from "./water-physics";

/** Radial samples in a profile. 640 over ~1 m is a sample every 1.6 mm. */
const NR = 640;
/** Wavenumber modes, chosen per profile — see `modeCount`. */
const NK_MIN = 48;
const NK_MAX = 288;
/** The rotation recurrence is renormalised this often to shed rounding drift. */
const RENORM = 128;

export type Source = {
  /** scene coordinates, metres */
  x: number;
  y: number;
  /** seconds since the thing hit the water */
  age: number;
  /** radius of whatever fell in, metres — this is what sets λ ≈ 2R */
  radius: number;
  /** crest height scale, metres (an artistic gain, not a measurement) */
  amp: number;
  /** extra damping beyond the real 2νk², so the scene stays readable */
  damp: number;
  /**
   * How wide a band of wavelengths the impact excites, as a fraction of the
   * dominant one. A gentle dip rings at one wavelength; a hard splash throws
   * energy across the spectrum, and because every wavelength travels at its own
   * speed, a wide band is what fans a single impact out into a long train.
   */
  spread: number;
};

/**
 * η and its first two radial derivatives, sampled from r = 0 outward.
 *
 * The renderer reads `eta` and `slope` to shade the water and `lap` to brighten
 * where the surface focuses light. The scroll film also draws `eta` directly as
 * the cosine graph in the slice chapter — the curve on the page and the water
 * behind it are then provably the same numbers.
 */
export type Profile = {
  eta: Float32Array;
  slope: Float32Array;
  lap: Float32Array;
  /**
   * The crest height the ripple reaches near each radius — |η| with the
   * oscillation taken out, by a running maximum over half a wavelength. It is
   * what says *where the ripple train currently is*, which the shading needs in
   * order to paint the still lanes between two ring systems, and which the
   * graph draws as the 1/√r envelope.
   */
  env: Float32Array;
  /** metres between samples */
  dr: number;
  rMax: number;
  /** the dominant wavelength of this ripple, metres — λ ≈ 2R */
  lambda: number;
  /** largest |η| in the table, for scaling the graph */
  peak: number;
  /** largest |dη/dr| in the table — what the shading is actually exposed for */
  peakSlope: number;
};

export function makeProfile(): Profile {
  return {
    eta: new Float32Array(NR),
    slope: new Float32Array(NR),
    lap: new Float32Array(NR),
    env: new Float32Array(NR),
    dr: 1 / NR,
    rMax: 1,
    lambda: 0.03,
    peak: 0,
    peakSlope: 0,
  };
}

/**
 * How many modes the sum needs. Neighbouring modes must stay within a few
 * radians of each other at the far edge of the table, or the sum beats against
 * itself and the ripple train sprouts ghost rings further out.
 */
function modeCount(kSpan: number, rMax: number): number {
  return Math.min(NK_MAX, Math.max(NK_MIN, Math.ceil((kSpan * rMax) / 3)));
}

/**
 * Fill `out` with the ripple a single source has written by `src.age`.
 *
 * `rMax` is how far out the table has to reach — far enough to cover the
 * furthest pixel from this source, or rings stop at an invisible wall.
 */
export function buildProfile(src: Source, rMax: number, out: Profile): Profile {
  const { eta, slope, lap, env } = out;
  const dr = rMax / (NR - 1);
  out.dr = dr;
  out.rMax = rMax;

  // The crater an object of radius R punches is about as wide as the object,
  // and one full wave spans that hole — so the energy goes in around
  // λ ≈ 2R, which is k₀ = π/R. The band around it is what `spread` sets.
  // The Nyquist clamp keeps the table from aliasing when R is very small.
  const R = Math.max(src.radius, 0.0015);
  const k0 = Math.PI / R;
  const sig = Math.max(0.02, src.spread) * k0;
  const nyquist = (0.9 * Math.PI) / dr;
  const kLo = Math.max(0.06 * k0, k0 - 3 * sig);
  const kHi = Math.min(k0 + 3 * sig, nyquist);
  const nk = modeCount(kHi - kLo, rMax);
  const dk = (kHi - kLo) / nk;
  out.lambda = 2 * R;

  eta.fill(0);
  slope.fill(0);
  lap.fill(0);
  env.fill(0);
  if (src.age <= 0) {
    out.peak = 0;
    out.peakSlope = 0;
    return out;
  }

  // Three sums are accumulated at once, all from the same cos/sin pair:
  //   C  = Σ w cos φ        S  = Σ w k sin φ        Q  = Σ w k² cos φ
  // which give η = gC, η' = g'C − gS and η'' = g''C − 2g'S − gQ for the
  // geometric factor g(r) = √(r₀/r). `eta`, `slope` and `lap` hold C, S and Q
  // until the second pass below turns them into the real thing.
  const t = src.age;
  const sigmaOverRho = SIGMA_WATER / RHO_WATER;
  let weightSum = 0;

  for (let m = 0; m < nk; m++) {
    const k = kLo + (m + 0.5) * dk;
    const z = (k - k0) / sig;
    // What the impact put into this wavelength, times the √k from the Bessel
    // asymptotic, times the width of this slice of the integral.
    const w =
      Math.exp(-0.5 * z * z) *
      Math.sqrt(k) *
      dk *
      // Real viscous decay of a deep-water wave is 2νk², plus whatever extra
      // the film asks for to keep old rings from crowding the frame.
      Math.exp(-(2 * NU_WATER * k * k + src.damp * k) * t);
    if (w < 1e-7) continue;
    weightSum += w;

    const omega = Math.sqrt(G * k + sigmaOverRho * k * k * k);
    // φ(r) = kr − ωt − π/4, advanced along r by a rotation of k·dr per step.
    const phase0 = -omega * t - Math.PI / 4;
    let c = Math.cos(phase0);
    let s = Math.sin(phase0);
    const cd = Math.cos(k * dr);
    const sd = Math.sin(k * dr);
    const wk = w * k;
    const wk2 = wk * k;

    for (let i = 0; i < NR; i++) {
      eta[i]! += w * c;
      slope[i]! += wk * s;
      lap[i]! += wk2 * c;
      // rotate (c, s) by k·dr
      const nc = c * cd - s * sd;
      s = s * cd + c * sd;
      c = nc;
      if ((i & (RENORM - 1)) === RENORM - 1) {
        const n = 1 / Math.hypot(c, s);
        c *= n;
        s *= n;
      }
    }
  }

  // Second pass: apply the 1/√r spreading and fold the sums into η, η' and ∇²η.
  //
  // The asymptotic is only true for kr ≫ 1, so inside one object radius there
  // is no far-field ring to speak of — r is held at r₀ there and the whole
  // profile is tapered to nothing, which is also what the crater looks like.
  const gain = weightSum > 0 ? src.amp / weightSum : 0;
  const r0 = Math.max(R, 2 * dr);
  let peak = 0;
  let peakSlope = 0;
  for (let i = 0; i < NR; i++) {
    const r = i * dr;
    const rc = Math.max(r, r0);
    const g = Math.sqrt(r0 / rc);
    const gp = -g / (2 * rc);
    const gpp = (3 * g) / (4 * rc * rc);
    const C = eta[i]!;
    const S = slope[i]!;
    const Q = lap[i]!;

    // Smooth the crater over, so the clamp at r₀ is not a visible kink.
    const taper = r >= r0 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * r) / r0);
    const h = gain * taper * (g * C);
    const hp = gain * taper * (gp * C - g * S);
    const hpp = gain * taper * (gpp * C - 2 * gp * S - g * Q);

    eta[i] = h;
    slope[i] = hp;
    lap[i] = hpp + hp / rc;
    const a = h < 0 ? -h : h;
    if (a > peak) peak = a;
    const b = hp < 0 ? -hp : hp;
    if (b > peakSlope) peakSlope = b;
  }
  out.peak = peak;
  out.peakSlope = peakSlope;

  // The envelope: a running maximum of |η| over half a wavelength either side.
  // A plain box maximum would step; the second pass smooths it back down.
  const half = Math.max(2, Math.round(src.radius / dr));
  for (let i = 0; i < NR; i++) {
    let m = 0;
    const lo = i - half < 0 ? 0 : i - half;
    const hi = i + half >= NR ? NR - 1 : i + half;
    for (let j = lo; j <= hi; j++) {
      const a = eta[j]! < 0 ? -eta[j]! : eta[j]!;
      if (a > m) m = a;
    }
    env[i] = m;
  }
  for (let pass = 0; pass < 2; pass++) {
    let prev = env[0]!;
    for (let i = 1; i < NR - 1; i++) {
      const cur = env[i]!;
      env[i] = (prev + 2 * cur + env[i + 1]!) * 0.25;
      prev = cur;
    }
  }
  return out;
}

/** Linear read of a profile at an arbitrary radius. */
export function etaAt(p: Profile, r: number): number {
  const x = r / p.dr;
  if (x <= 0) return p.eta[0]!;
  if (x >= NR - 1) return 0;
  const i = x | 0;
  const f = x - i;
  return p.eta[i]! + (p.eta[i + 1]! - p.eta[i]!) * f;
}

export const PROFILE_SAMPLES = NR;
