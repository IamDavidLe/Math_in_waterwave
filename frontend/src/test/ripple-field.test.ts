import { describe, expect, it } from "vitest";

import { buildProfile, makeProfile, PROFILE_SAMPLES, type Source } from "@/lib/ripple-field";

const drop = (over: Partial<Source> = {}): Source => ({
  x: 0,
  y: 0,
  age: 0.6,
  radius: 0.02,
  amp: 0.01,
  damp: 0,
  spread: 0.42,
  ...over,
});

/** Radius of the tallest crest, and how tall it is. */
function packet(age: number, over: Partial<Source> = {}) {
  const p = buildProfile(drop({ age, ...over }), 2.0, makeProfile());
  let best = 0;
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    if (Math.abs(p.eta[i]!) > Math.abs(p.eta[best]!)) best = i;
  }
  return { r: best * p.dr, a: Math.abs(p.eta[best]!), p };
}

describe("the ripple field the scroll film is drawn from", () => {
  it("is finite everywhere, and flat before anything has fallen in", () => {
    const live = buildProfile(drop(), 1, makeProfile());
    expect(live.eta.every(Number.isFinite)).toBe(true);
    expect(live.slope.every(Number.isFinite)).toBe(true);
    expect(live.peak).toBeGreaterThan(0);

    const unborn = buildProfile(drop({ age: 0 }), 1, makeProfile());
    expect(unborn.peak).toBe(0);
    expect(unborn.eta.every((v) => v === 0)).toBe(true);
  });

  it("sends the ring outward as time passes", () => {
    const a = packet(0.3);
    const b = packet(0.9);
    const c = packet(1.8);
    expect(b.r).toBeGreaterThan(a.r);
    expect(c.r).toBeGreaterThan(b.r);
  });

  it("flattens the crest roughly as 1/√r, with nothing damping it", () => {
    // A·√r is the quantity the spreading argument says is conserved. A point
    // impulse also spreads along r as it disperses, so the real decay is a
    // little faster — but nowhere near, say, 1/r.
    const a = packet(0.3);
    const b = packet(2.4);
    const spread = a.r / b.r;
    const fell = a.a / b.a;
    expect(fell).toBeGreaterThan(1 / Math.sqrt(spread));
    expect(fell).toBeLessThan(1 / spread);
  });

  it("gives a bigger object a longer wave", () => {
    const count = (radius: number) => {
      const p = buildProfile(drop({ radius, age: 0.8 }), 1, makeProfile());
      let z = 0;
      for (let i = 1; i < PROFILE_SAMPLES; i++) {
        if (Math.sign(p.eta[i]!) !== Math.sign(p.eta[i - 1]!)) z++;
      }
      return z;
    };
    expect(count(0.006)).toBeGreaterThan(count(0.05));
  });

  it("keeps the envelope above the wave it envelops", () => {
    const p = buildProfile(drop({ age: 1.0 }), 1, makeProfile());
    for (let i = 0; i < PROFILE_SAMPLES; i++) {
      // Smoothing lets the envelope dip a hair under a lone crest; a tenth of
      // the peak is slack enough to allow that and tight enough to catch a bug.
      expect(p.env[i]!).toBeGreaterThan(Math.abs(p.eta[i]!) - p.peak * 0.1);
    }
  });

  it("builds a worst-case profile well inside a frame", () => {
    // The film rebuilds up to two of these every frame at 60 Hz, so one has to
    // cost a small fraction of 16 ms.
    const p = makeProfile();
    const worst = drop({ radius: 0.004, age: 2.5 });
    for (let i = 0; i < 5; i++) buildProfile(worst, 2.0, p);
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) buildProfile(worst, 2.0, p);
    const each = (performance.now() - t0) / 40;
    expect(each).toBeLessThan(4);
  });
});
