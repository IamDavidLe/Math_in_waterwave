import { describe, expect, it } from "vitest";

import { buildProfile, makeProfile } from "@/lib/ripple-field";
import { exposureFor, swellSlopeOf } from "@/lib/ripple-render";
import {
  CHAPTERS,
  SPAN,
  STARTS,
  sceneAt,
  scrubPhase,
  split,
  toChapterSpace,
} from "@/lib/ripple-scene";

/** Every hundredth of a chapter, forwards through the whole film. */
const everywhere = (step = 0.01) => {
  const out: number[] = [];
  for (let f = 0; f <= CHAPTERS.length - 0.001; f += step) out.push(f);
  return out;
};

describe("the scroll film's storyboard", () => {
  it("maps screen-heights onto chapters, and back", () => {
    expect(toChapterSpace(0)).toBe(0);
    CHAPTERS.forEach((c, i) => {
      expect(split(toChapterSpace(STARTS[i]! + 0.001)).id).toBe(c.id);
      // Each chapter gets the full 0 → 1 to arrive over, whatever its length.
      const mid = toChapterSpace(STARTS[i]! + c.len / 2);
      expect(split(mid).p).toBeCloseTo(0.5, 2);
    });
    expect(toChapterSpace(SPAN * 2)).toBeLessThan(CHAPTERS.length);
  });

  it("is finite and sane at every point in the scroll", () => {
    for (const f of everywhere()) {
      const s = sceneAt(f, 3.7, 0.4);
      expect(Number.isFinite(s.spanM)).toBe(true);
      expect(s.spanM).toBeGreaterThan(0.2);
      expect(s.spanM).toBeLessThan(2);
      expect(s.radius).toBeGreaterThan(0.002);
      expect(s.lambda).toBeCloseTo(2 * s.radius, 10);
      expect(s.sources.length).toBeGreaterThan(0);
      for (const src of s.sources) {
        expect(src.amp).toBeGreaterThanOrEqual(0);
        expect(src.age).toBeGreaterThanOrEqual(0);
        expect(src.spread).toBeGreaterThan(0);
        expect(Number.isFinite(src.x)).toBe(true);
      }
      for (const [k, v] of Object.entries(s.o)) {
        expect(Number.isFinite(v), `${k} at ${f}`).toBe(true);
        expect(v, `${k} at ${f}`).toBeGreaterThanOrEqual(0);
        expect(v, `${k} at ${f}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never cuts: the camera and the object move smoothly", () => {
    let prev = sceneAt(0, 0, 0.4);
    for (const f of everywhere(0.005).slice(1)) {
      const s = sceneAt(f, 0, 0.4);
      // This is a guard against a discontinuity, not against a brisk move: the
      // camera is allowed to rush in on the impact, and does.
      expect(Math.abs(s.spanM - prev.spanM), `span at ${f}`).toBeLessThan(0.035);
      // Likewise the size chapter deliberately sweeps the object from a
      // raindrop to a boulder; it just may not do it in one step.
      expect(Math.abs(s.radius - prev.radius), `radius at ${f}`).toBeLessThan(0.0035);
      prev = s;
    }
  });

  it("holds the opening and closing water still, and the rest alive", () => {
    expect(sceneAt(0.5, 0, 0.4).sources[0]!.amp).toBe(0);
    expect(sceneAt(CHAPTERS.length - 0.01, 0, 0.4).sources[0]!.amp).toBe(0);
    expect(sceneAt(4.5, 0, 0.4).sources[0]!.amp).toBeGreaterThan(0);
  });

  it("gives the drop chapter to the scroll, and the rest to the clock", () => {
    expect(scrubPhase(0.5)).toBeNull();
    expect(scrubPhase(5)).toBeNull();
    expect(scrubPhase(1.1)).toBe(0);
    expect(scrubPhase(1.99)).toBeGreaterThan(0.9);
  });

  it("exposes every chapter so the ripple is legible", () => {
    const p = makeProfile();
    for (const f of everywhere(0.25)) {
      const s = sceneAt(f, 3.7, 0.55);
      const src = s.sources[0]!;
      buildProfile(src, s.spanM, p);
      const ex = exposureFor(p.peakSlope, s.swell);
      expect(ex.relief).toBeGreaterThan(0);
      // Whatever the ripple's true steepness, the lit slope lands in a range a
      // screen can show: never a flat sheen, never a wall of white.
      // What is actually drawn, which is not always all the swell the scene
      // asked for — the exposure holds it down beside a faint ripple.
      const lit = Math.max(p.peakSlope, swellSlopeOf(ex.swell)) * ex.relief;
      expect(lit, `lit slope at ${f}`).toBeGreaterThan(0.1);
      expect(lit, `lit slope at ${f}`).toBeLessThan(2.4);
    }
  });
});
