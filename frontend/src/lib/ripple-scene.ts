/**
 * The storyboard: what the scroll film shows at each point along its one number.
 *
 * Kept apart from the React that drives it so the whole film can be evaluated
 * without a browser — `sceneAt` is a pure function of where the scroll has got
 * to, which is what makes a frame reproducible and testable.
 */

import { type Source } from "./ripple-field";

/* ── the chapters ──────────────────────────────────────────────────────────────
   `len` is how many screen-heights of scrolling a chapter is given — its pace.
   A chapter with a single idea gets less; the two that have to let a pattern
   finish forming get more. */

type Chapter = { id: string; len: number; label: string };

export const CHAPTERS: Chapter[] = [
  { id: "still", len: 1.5, label: "Still" },
  { id: "drop", len: 2.0, label: "The drop" },
  { id: "symmetry", len: 2.2, label: "η(r)" },
  { id: "cosine", len: 2.4, label: "A cos(kr − ωt)" },
  { id: "travel", len: 2.2, label: "r − ct" },
  { id: "spread", len: 2.4, label: "A ∝ 1/√r" },
  { id: "disperse", len: 2.8, label: "ω² = gk + σk³/ρ" },
  { id: "size", len: 2.6, label: "λ ≈ 2R" },
  { id: "two", len: 2.4, label: "Two stones" },
  { id: "hyperbola", len: 3.0, label: "Hyperbolas" },
  { id: "outro", len: 1.6, label: "The lab" },
];

export const SPAN = CHAPTERS.reduce((a, c) => a + c.len, 0);
/** Where each chapter begins, in screen-heights down the track. */
export const STARTS = CHAPTERS.map((_, i) => CHAPTERS.slice(0, i).reduce((a, c) => a + c.len, 0));

/**
 * Screen-heights scrolled → chapter space, where the whole number is the chapter
 * and the fraction is how far through it we are. This is what lets chapters have
 * different lengths while every card still gets the same 0→1 to arrive over.
 */
export function toChapterSpace(v: number): number {
  for (let i = CHAPTERS.length - 1; i >= 0; i--) {
    const start = STARTS[i]!;
    if (v >= start) return Math.min(i + (v - start) / CHAPTERS[i]!.len, CHAPTERS.length - 1e-4);
  }
  return 0;
}

export function split(v: number) {
  const index = Math.min(Math.max(Math.floor(v), 0), CHAPTERS.length - 1);
  return { index, p: Math.min(Math.max(v - index, 0), 1), id: CHAPTERS[index]!.id };
}

/* ── window helpers ───────────────────────────────────────────────────────────
   Everything in the film is a ramp between two points on the flow. These four
   are the whole vocabulary. */

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const win = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Ease out, for things arriving. */
export const out3 = (x: number) => 1 - (1 - x) ** 3;
/** Ease in and out, for the camera. */
export const io3 = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Rises over [a, b], holds, falls over [c, d]. */
const band = (v: number, a: number, b: number, c: number, d: number) =>
  Math.min(out3(win(v, a, b)), out3(1 - win(v, c, d)));

/**
 * A value scripted as keyframes along the flow. The whole film is written as a
 * handful of these, so the storyboard can be read off the page: the first column
 * is where in the scroll, the second is what the value is there.
 */
export function track(f: number, keys: readonly (readonly [number, number])[]): number {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (f <= first[0]) return first[1];
  if (f >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    if (f <= b[0]) return lerp(a[1], b[1], io3((f - a[0]) / (b[0] - a[0])));
  }
  return last[1];
}

/** Fraction of the drop chapter spent falling, before the surface is touched. */
const FALL = 0.22;
/** Where in the flow the drop lands. */
const IMPACT = 1 + FALL;

/* ── the storyboard ───────────────────────────────────────────────────────────
   Camera first, then what is falling in, then the water.

   Every key below is in **chapter space**: the whole number is the chapter and
   the fraction is how far through it. So 7.27 is a quarter of the way into
   chapter 7, whatever that chapter's pace happens to be. Writing the film this
   way means re-timing a chapter — giving it more or fewer screen-heights of
   scroll — never moves anything inside it. */

const SPAN_M = [
  [0, 1.2],
  [1.0, 1.0],
  [IMPACT, 0.56],
  [2.0, 0.82],
  [3.0, 0.78],
  [4.0, 0.86],
  [5.0, 1.0],
  [6.0, 1.14],
  [7.0, 1.16],
  [7.27, 0.52],
  [7.62, 1.35],
  [7.88, 1.0],
  [8.0, 0.95],
  [10.0, 0.9],
  [11, 1.34],
] as const;

/** View centre, as a fraction of the span — lifts the rings clear of the graph. */
const CY_FRAC = [
  [0, 0],
  [3.1, 0],
  [3.35, 0.15],
  [5.85, 0.15],
  [6.1, 0],
  [11, 0],
] as const;

/** Radius of the object, metres. Chapter 7 is the whole point of this track. */
export const RADIUS = [
  [0, 0.018],
  [7.0, 0.018],
  [7.27, 0.006],
  [7.62, 0.055],
  [7.88, 0.03],
  [8.1, 0.022],
  [11, 0.022],
] as const;

/**
 * Seconds between drops.
 *
 * It is not just pacing: a ripple has to be caught while it is still in frame.
 * Fine capillary rings travel at nearly 30 cm/s, so the tight shot on a
 * six-millimetre object has to come round quickly or there is nothing left on
 * screen to look at; a boulder's slow rolling swell is given five seconds.
 */
const PERIOD = [
  [0, 3.0],
  [6.0, 3.0],
  [6.25, 4.6],
  [7.0, 4.6],
  [7.27, 1.4],
  [7.62, 5.4],
  [8.1, 3.8],
  [11, 3.8],
] as const;

/**
 * Extra damping, beyond the 2νk² the water really has. It is deliberately zero
 * through the spreading and dispersion chapters: those two claim the rings
 * flatten and fan out by geometry alone, so nothing may be quietly helping.
 */
const DAMP = [
  [0, 0.006],
  [5.0, 0.006],
  [5.25, 0],
  [7.0, 0],
  [8.0, 0.004],
  [10.0, 0.004],
  [11, 0.06],
] as const;

/**
 * How broad a band of wavelengths each impact throws out, as a fraction of the
 * dominant one. The dispersion chapter opens it right up, because a wide band
 * is the only way to *see* that different wavelengths travel at different
 * speeds: a narrow one arrives as a single compact packet.
 */
const SPREAD = [
  [0, 0.15],
  [6.0, 0.15],
  [6.25, 1.0],
  [6.95, 1.0],
  [7.27, 0.16],
  [7.95, 0.17],
  [8.3, 0.05],
  [11, 0.05],
] as const;

/**
 * The long, slow swell that keeps the pond from ever being perfectly dead. The
 * opening and closing chapters have no ripple at all, so there the swell is the
 * only thing on screen and the exposure is set by it.
 */
const SWELL = [
  [0, 0.0035],
  [1.0, 0.0022],
  [2.0, 0.0012],
  [10.0, 0.0012],
  [11, 0.0035],
] as const;

const AMP_GAIN = [
  [0, 1],
  [10.0, 1],
  [10.8, 0],
] as const;

const TWO_ON = [
  [0, 0],
  [7.95, 0],
  [8.2, 1],
  [11, 1],
] as const;

/** Half the distance between the two impacts, metres — the foci of the hyperbolas. */
export const HALF_GAP = 0.115;

export type Overlays = {
  fall: number;
  fallAt: number;
  flash: number;
  polar: number;
  sweep: number;
  cut: number;
  graph: number;
  lambdaMark: number;
  travel: number;
  envelope: number;
  dispersion: number;
  sizeDial: number;
  addMark: number;
  foci: number;
  hyperbola: number;
};

export type Scene = {
  sources: Source[];
  spanM: number;
  cx: number;
  cy: number;
  swell: number;
  swellPhase: number;
  nodal: number;
  radius: number;
  lambda: number;
  o: Overlays;
};

/**
 * The film at one point on the flow.
 *
 * `phase` is where the pond is in its own cycle of drops, 0 → 1. In the drop
 * chapter the scroll sets it directly, so the stone falls under your thumb;
 * everywhere else the pond keeps its own time and `phase` arrives from the loop.
 */
export function sceneAt(f: number, clock: number, phase: number): Scene {
  const spanM = track(f, SPAN_M);
  const swell = track(f, SWELL);
  const radius = track(f, RADIUS);
  const period = track(f, PERIOD);
  const damp = track(f, DAMP);
  const twoOn = track(f, TWO_ON);

  // Rings fade out before the cycle wraps, so a new drop never cuts an old
  // ring train off mid-flight.
  const ringFade = 1 - io3(win(phase, 0.78, 1));
  const onAfterImpact = out3(win(f, 1.0, 1.12));
  const amp = 0.0042 * (radius / 0.018) ** 0.7 * ringFade * onAfterImpact * track(f, AMP_GAIN);

  const x1 = lerp(0, -HALF_GAP, twoOn);
  const base = { age: phase * period, radius, damp, spread: track(f, SPREAD) };
  const sources: Source[] = [{ ...base, x: x1, y: 0, amp }];
  if (twoOn > 0.002) {
    sources.push({ ...base, x: HALF_GAP, y: 0, amp: amp * twoOn });
  }

  return {
    sources,
    spanM,
    cx: 0,
    cy: track(f, CY_FRAC) * spanM,
    swell,
    swellPhase: clock * 0.55,
    nodal: band(f, 9.033, 9.3, 9.933, 10.062) * twoOn,
    radius,
    lambda: 2 * radius,
    o: {
      fall: win(f, 0.84, 1.0) * (1 - win(f, IMPACT - 0.04, IMPACT + 0.02)),
      fallAt: io3(win(f, 1.0, IMPACT)),
      flash: band(f, IMPACT - 0.02, IMPACT + 0.03, IMPACT + 0.04, IMPACT + 0.22),
      polar: band(f, 2.045, 2.25, 2.773, 3.0),
      sweep: band(f, 2.205, 2.409, 2.818, 3.0),
      cut: band(f, 3.042, 3.229, 5.792, 6.0),
      graph: band(f, 3.125, 3.333, 5.833, 6.0),
      lambdaMark: band(f, 3.375, 3.562, 3.917, 4.068),
      travel: band(f, 4.045, 4.295, 4.864, 5.021),
      envelope: band(f, 5.083, 5.292, 5.833, 6.0),
      dispersion: band(f, 6.071, 6.268, 6.893, 7.038),
      sizeDial: band(f, 7.077, 7.25, 7.923, 8.062),
      addMark: band(f, 8.146, 8.354, 8.875, 9.0),
      foci: band(f, 9.033, 9.2, 9.933, 10.062),
      hyperbola: band(f, 9.117, 9.333, 9.933, 10.062),
    },
  };
}

/** What `phase` should be at `f`, while the drop chapter is being scrubbed. */
export function scrubPhase(f: number): number | null {
  if (f <= 1 || f >= 2) return null;
  return clamp01((f - IMPACT) / (1 - FALL));
}

export function periodAt(f: number): number {
  return track(f, PERIOD);
}
