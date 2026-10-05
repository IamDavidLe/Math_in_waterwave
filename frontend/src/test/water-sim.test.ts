import { describe, expect, it } from "vitest";

import { impactOf } from "@/lib/water-physics";
import { MARK_LIFE, WaterSim } from "@/lib/water-sim";

const pebble = impactOf({ mass: 0.02, radius: 0.012, dropHeight: 1 });
const brick = impactOf({ mass: 2.5, radius: 0.09, dropHeight: 2 });

/** Run `fn` with a deterministic Math.random, so splashes repeat exactly. */
function seeded<T>(fn: () => T): T {
  const real = Math.random;
  let seed = 12345;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

/** A sim with the object already in the water at (nx, ny). */
function splashed(sim: WaterSim, nx: number, ny: number, impact = pebble) {
  sim.drop(nx, ny, impact);
  // Fall first; the body only disturbs the surface when it lands.
  for (let i = 0; i < 400 && sim.bodies.some((b) => b.state === "falling"); i++) sim.step(2);
}

describe("WaterSim", () => {
  it("stays bounded for thousands of steps after a heavy impact", () => {
    const sim = new WaterSim({ width: 120, height: 90 });
    splashed(sim, 0.5, 0.5, brick);
    for (let i = 0; i < 1500; i++) sim.step(2);
    expect(Number.isFinite(sim.energy())).toBe(true);
    let peak = 0;
    for (const v of sim.cur) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(2);
  });

  it("loses energy over time instead of gaining it", () => {
    const sim = new WaterSim({ width: 120, height: 90, breaking: false });
    splashed(sim, 0.5, 0.5);
    for (let i = 0; i < 40; i++) sim.step(2);
    const early = sim.energy();
    for (let i = 0; i < 600; i++) sim.step(2);
    expect(sim.energy()).toBeLessThan(early);
  });

  it("sends the ring outward — the crest moves away from the impact", () => {
    const sim = new WaterSim({ width: 160, height: 160, metersAcross: 1.6 });
    splashed(sim, 0.5, 0.5);
    const peakAt = () => {
      const p = sim.sampleRadial(80, 80, 70);
      let best = 0;
      let at = 0;
      for (let i = 2; i < p.length; i++) {
        const v = Math.abs(p[i]!);
        if (v > best) {
          best = v;
          at = i;
        }
      }
      return at;
    };
    for (let i = 0; i < 20; i++) sim.step(2);
    const near = peakAt();
    for (let i = 0; i < 60; i++) sim.step(2);
    expect(peakAt()).toBeGreaterThan(near);
  });

  it("disperses: short waves outrun long ones, so the ring becomes a train", () => {
    const sim = new WaterSim({ width: 160, height: 160, capillarity: 1, viscosity: 0.05 });
    splashed(sim, 0.5, 0.5);
    for (let i = 0; i < 120; i++) sim.step(2);
    const p = sim.sampleRadial(80, 80, 72);
    // Count sign changes: a dispersive train crosses zero many times, a single
    // hoop only a couple.
    let crossings = 0;
    for (let i = 3; i < p.length; i++) if (p[i]! * p[i - 1]! < 0) crossings++;
    expect(crossings).toBeGreaterThan(3);
  });

  it("never gains energy by breaking — the operator must dissipate, not inject", () => {
    // Two real bugs hid here: the shed excess was re-emitted as a ring that
    // carried more energy than the crest lost, and η was lowered at only the
    // new time level, which leaves the crest falling faster than before and so
    // *adds* kinetic energy. Both showed up as a surface that fed itself.
    //
    // This compares one single step from an identical state, because breaking
    // is not monotone over a whole run: it takes energy out early, and the
    // calmer water it leaves then decays more slowly than water that never
    // broke, which can leave more behind at the end.
    // Crown droplets are random and stamp craters where they land, so both
    // runs have to see the same spray.
    const build = () =>
      seeded(() => {
        const sim = new WaterSim({ width: 140, height: 110, breaking: false });
        sim.drop(0.5, 0.5, brick);
        for (let i = 0; i < 400 && sim.bodies.some((b) => b.state === "falling"); i++) sim.step(2);
        for (let i = 0; i < 6; i++) sim.step(2); // steep, young crests
        return sim;
      });
    const withBreak = build();
    const without = build();
    expect(withBreak.energy()).toBe(without.energy()); // identical starting point

    withBreak.cfg.breaking = true;
    const report = withBreak.step(2);
    without.step(2);

    expect(report.breaks).toBeGreaterThan(0); // the step really did break crests
    expect(withBreak.energy()).toBeLessThan(without.energy());
  });

  it("judges breaking by steepness, so gentle swells survive and steep crests do not", () => {
    const breaksWith = (breakSteepness: number) => {
      const sim = new WaterSim({ width: 140, height: 110, breakSteepness });
      let n = 0;
      sim.drop(0.5, 0.5, brick);
      for (let i = 0; i < 300; i++) n += sim.step(2).breaks;
      return n;
    };
    // A limit far above any slope the water reaches must never fire.
    expect(breaksWith(5)).toBe(0);
    // A limit near zero fires constantly.
    expect(breaksWith(0.005)).toBeGreaterThan(breaksWith(0.08));
  });

  it("records where waves were born and forgets them again", () => {
    const sim = new WaterSim({ width: 140, height: 110 });
    splashed(sim, 0.5, 0.5, brick);
    for (let i = 0; i < 40; i++) sim.step(2);
    expect(sim.marks.length).toBeGreaterThan(0);
    for (const m of sim.marks) {
      expect(m.kind).toBe("break");
      expect(m.strength).toBeGreaterThan(0);
    }
    // Marks are a short-lived visual record, not state that accumulates.
    const quiet = Math.ceil(MARK_LIFE / (sim.dt * 2)) + 400;
    for (let i = 0; i < quiet; i++) sim.step(2);
    expect(sim.marks.length).toBe(0);
  });

  it("breaks over-steep crests, which seeds new ripples", () => {
    const sim = new WaterSim({ width: 120, height: 90 });
    let broke = 0;
    sim.drop(0.5, 0.5, brick);
    for (let i = 0; i < 400; i++) broke += sim.step(2).breaks;
    expect(broke).toBeGreaterThan(0);
    // Foam marks where waves broke.
    expect(Math.max(...sim.foam)).toBeGreaterThan(0);
  });

  it("is nonlinear: two colliding rings do not simply superpose", () => {
    const build = (nonlinearity: number) => {
      const sim = new WaterSim({ width: 160, height: 120, nonlinearity, breaking: false });
      splashed(sim, 0.3, 0.5, brick);
      splashed(sim, 0.7, 0.5, brick);
      for (let i = 0; i < 160; i++) sim.step(2);
      return sim;
    };
    const linear = build(0);
    const nonlinear = build(1);
    // Same inputs, same number of steps: any difference in the field is the
    // nonlinear interaction of the two rings.
    let diff = 0;
    for (let i = 0; i < linear.cur.length; i++)
      diff += Math.abs(nonlinear.cur[i]! - linear.cur[i]!);
    expect(diff / linear.cur.length).toBeGreaterThan(1e-4);
  });

  it("throws droplets that fall back in and start their own ripples", () => {
    const sim = new WaterSim({ width: 160, height: 120 });
    sim.drop(0.5, 0.5, brick);
    let landed = 0;
    let sawDroplets = false;
    for (let i = 0; i < 600; i++) {
      landed += sim.step(2).splashbacks;
      if (sim.droplets.length > 0) sawDroplets = true;
    }
    expect(sawDroplets).toBe(true);
    expect(landed).toBeGreaterThan(0);
  });

  it("reports the impact on the frame the object lands", () => {
    const sim = new WaterSim({ width: 80, height: 60 });
    sim.drop(0.5, 0.5, pebble);
    let impacts = 0;
    for (let i = 0; i < 400; i++) impacts += sim.step(2).impacts.length;
    expect(impacts).toBe(1);
  });

  it("keeps a floating object bobbing and radiating after it lands", () => {
    const cork = impactOf({ mass: 0.002, radius: 0.03, dropHeight: 1 });
    const sim = new WaterSim({ width: 120, height: 90 });
    splashed(sim, 0.5, 0.5, cork);
    expect(sim.bodies[0]?.state).toBe("floating");
    for (let i = 0; i < 60; i++) sim.step(2);
    expect(sim.energy()).toBeGreaterThan(0);
  });

  it("sinks a dense object and removes it once it is deep", () => {
    const steel = impactOf({ mass: 4, radius: 0.025, dropHeight: 1 });
    const sim = new WaterSim({ width: 120, height: 90 });
    splashed(sim, 0.5, 0.5, steel);
    expect(sim.bodies[0]?.state).toBe("sinking");
    for (let i = 0; i < 400; i++) sim.step(2);
    expect(sim.bodies.length).toBe(0);
  });

  it("absorbs at the walls when reflection is off", () => {
    const run = (reflect: boolean) => {
      const sim = new WaterSim({ width: 120, height: 90, reflect, viscosity: 0 });
      splashed(sim, 0.5, 0.5, brick);
      for (let i = 0; i < 500; i++) sim.step(2);
      return sim.energy();
    };
    expect(run(false)).toBeLessThan(run(true));
  });

  it("resets to flat water", () => {
    const sim = new WaterSim({ width: 80, height: 60 });
    splashed(sim, 0.5, 0.5, brick);
    sim.reset();
    expect(sim.energy()).toBe(0);
    expect(sim.bodies.length).toBe(0);
    expect(sim.droplets.length).toBe(0);
  });
});
