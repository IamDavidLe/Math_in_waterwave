import { describe, expect, it } from "vitest";

import {
  G,
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
