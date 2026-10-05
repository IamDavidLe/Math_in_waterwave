import { describe, expect, it } from "vitest";

import {
  G,
  draftOf,
  RHO_WATER,
  impactOf,
  groupSpeedOf,
  minimumSpeed,
  minimumWavelength,
  omegaOf,
} from "@/lib/water-physics";

const obj = { mass: 0.18, radius: 0.04, dropHeight: 1 };

describe("gravity–capillary dispersion", () => {
  it("puts the slowest wave at λ ≈ 1.7 cm and c ≈ 23 cm/s", () => {
    expect(minimumWavelength()).toBeCloseTo(0.0171, 3);
    expect(minimumSpeed()).toBeCloseTo(0.2312, 3);
  });

  it("reduces to ω² = gk for long waves", () => {
    const k = 2 * Math.PI; // λ = 1 m, far into the gravity branch
    expect(omegaOf(k) / Math.sqrt(G * k)).toBeCloseTo(1, 3);
  });

  it("is slowest at the capillary/gravity crossover, and faster either side", () => {
    const kMin = (2 * Math.PI) / minimumWavelength();
    const speed = (k: number) => omegaOf(k) / k;
    expect(speed(kMin)).toBeCloseTo(minimumSpeed(), 6);
    expect(speed(kMin * 0.2)).toBeGreaterThan(speed(kMin));
    expect(speed(kMin * 5)).toBeGreaterThan(speed(kMin));
    // Long gravity waves carry energy at half their phase speed.
    expect(groupSpeedOf(0.4)).toBeCloseTo(speed(0.4) / 2, 3);
  });
});

describe("impact of an object", () => {
  it("scales impact velocity and energy with drop height", () => {
    const low = impactOf({ ...obj, dropHeight: 0.5 });
    const high = impactOf({ ...obj, dropHeight: 2 });
    expect(high.v / low.v).toBeCloseTo(2, 2);
    expect(high.energy / low.energy).toBeCloseTo(4, 2);
  });

  it("makes a heavier object of the same size radiate taller, longer waves", () => {
    const light = impactOf({ ...obj, mass: 0.05 });
    const heavy = impactOf({ ...obj, mass: 1.5 });
    expect(heavy.amplitude).toBeGreaterThan(light.amplitude);
    expect(heavy.wavelength).toBeGreaterThan(light.wavelength);
  });

  it("makes a bigger object radiate longer waves", () => {
    const small = impactOf({ ...obj, radius: 0.01 });
    const big = impactOf({ ...obj, radius: 0.2 });
    expect(big.wavelength).toBeGreaterThan(small.wavelength);
    expect(big.k).toBeLessThan(small.k);
  });

  it("separates the capillary and gravity regimes by object size", () => {
    expect(impactOf({ mass: 5e-5, radius: 0.002, dropHeight: 1 }).regime).toBe("capillary");
    expect(impactOf({ mass: 6.5, radius: 0.11, dropHeight: 1 }).regime).toBe("gravity");
  });

  it("sits a float at the depth that displaces its own weight", () => {
    const r = 0.1;
    const full = (4 / 3) * Math.PI * r ** 3;
    // Neutrally buoyant: exactly half under.
    expect(draftOf(r, 1000 * full) / (2 * r)).toBeCloseTo(1, 2);
    const half = draftOf(r, 500 * full);
    expect(half).toBeCloseTo(r, 2);
    // A nearly weightless ball barely dips in; a heavy one is nearly drowned.
    expect(draftOf(r, 20 * full)).toBeLessThan(r * 0.35);
    expect(draftOf(r, 950 * full)).toBeGreaterThan(r * 1.5);
  });

  it("bobs floats slowly enough to animate, using the waterline not the equator", () => {
    // The restoring force comes from the waterline circle. Taking it as πr²
    // put a beach ball at 11 Hz and a 4 cm cork at 139 Hz — far too fast to
    // draw, so they juddered instead of bobbing.
    const beach = impactOf({ mass: 0.15, radius: 0.16, dropHeight: 1 });
    const cork = impactOf({ mass: 0.0644, radius: 0.04, dropHeight: 1 });
    for (const im of [beach, cork]) {
      const hz = im.bobOmega / (2 * Math.PI);
      expect(hz).toBeGreaterThan(0.3);
      expect(hz).toBeLessThan(8);
    }
    // Denser means deeper. (It does not mean faster: the extra waterline
    // stiffness is outweighed by the extra mass, so a deep float bobs slower.)
    const high = impactOf({ mass: 0.02, radius: 0.05, dropHeight: 1 });
    const low = impactOf({ mass: 0.45, radius: 0.05, dropHeight: 1 });
    expect(low.submerged).toBeGreaterThan(high.submerged);
    expect(low.bobOmega).toBeLessThan(high.bobOmega);
  });

  it("floats anything less dense than water and bobs it slower when heavier", () => {
    const cork = impactOf({ mass: 0.002, radius: 0.03, dropHeight: 1 });
    expect(cork.density).toBeLessThan(RHO_WATER);
    expect(cork.floats).toBe(true);
    const heavier = impactOf({ mass: 0.02, radius: 0.03, dropHeight: 1 });
    expect(heavier.bobOmega).toBeLessThan(cork.bobOmega);
  });

  it("only throws crown droplets once inertia beats surface tension", () => {
    expect(impactOf({ mass: 5e-5, radius: 0.002, dropHeight: 0.01 }).droplets).toBe(0);
    expect(impactOf({ mass: 2.5, radius: 0.09, dropHeight: 4 }).droplets).toBeGreaterThan(4);
  });
});
