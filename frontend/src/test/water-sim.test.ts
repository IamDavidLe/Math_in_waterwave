import { describe, expect, it } from "vitest";

import { impactOf } from "@/lib/water-physics";
import { WaterSim } from "@/lib/water-sim";

const pebble = impactOf({ mass: 0.02, radius: 0.012, dropHeight: 1 });
const brick = impactOf({ mass: 2.5, radius: 0.09, dropHeight: 2 });

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
