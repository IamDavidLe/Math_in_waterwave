/**
 * Closed-form water-wave relations used for the readouts, the analytic
 * cross-section and for turning an object (size + weight + drop height) into
 * the impulse handed to the surface solver in `water-sim.ts`.
 *
 * Everything is SI. The scaling laws for crater size and wave energy are the
 * usual impact-cratering fits — order-of-magnitude honest, not exact.
 */

export const G = 9.81; // m/s²
export const RHO_WATER = 1000; // kg/m³
export const SIGMA_WATER = 0.0728; // N/m, clean water at 20 °C
export const NU_WATER = 1.004e-6; // m²/s kinematic viscosity

/** Fraction of impact energy that leaves the crater as surface waves. */
export const WAVE_EFFICIENCY = 0.05;
/** Prefactor in the gravity-regime crater fit R_c = C (E/ρg)^¼. */
export const CRATER_FIT = 0.5;

export type ObjectParams = {
  /** kg */
  mass: number;
  /** m, sphere radius */
  radius: number;
  /** m, release height above the surface */
  dropHeight: number;
};

export type WaterParams = {
  /** N/m — surface tension, sets the capillary branch of the dispersion curve */
  sigma: number;
  /** m²/s — kinematic viscosity, damps short waves as e^(−2νk²t) */
  nu: number;
};

export const WATER: WaterParams = { sigma: SIGMA_WATER, nu: NU_WATER };

export type Impact = {
  /** m/s impact velocity, √(2gh) */
  v: number;
  /** kg·m/s momentum */
  momentum: number;
  /** J kinetic energy at the surface */
  energy: number;
  /** J that becomes surface waves */
  waveEnergy: number;
  /** m³ */
  volume: number;
  /** kg/m³ */
  density: number;
  /** v²/(gr) — inertia vs gravity */
  froude: number;
  /** ρv²r/σ — inertia vs surface tension; sets whether the crown splashes */
  weber: number;
  /** vr/ν */
  reynolds: number;
  /** m, cavity radius at maximum opening */
  craterRadius: number;
  /** m, dominant wavelength radiated */
  wavelength: number;
  /** rad/m */
  k: number;
  /** rad/s from ω² = gk + σk³/ρ */
  omega: number;
  /** s */
  period: number;
  /** m/s phase speed ω/k */
  phaseSpeed: number;
  /** m/s group speed dω/dk — the speed of the visible ring front */
  groupSpeed: number;
  /** m, initial crest height */
  amplitude: number;
  /** 1/s viscous decay rate 2νk² */
  decay: number;
  /** which branch of the dispersion curve dominates */
  regime: "capillary" | "gravity";
  /** ρ_object < ρ_water */
  floats: boolean;
  /** m, how deep a floating object sits — the submerged cap's depth */
  draft: number;
  /** 0–1 of its diameter that is under water */
  submerged: number;
  /** rad/s buoyancy bobbing frequency of a floating object */
  bobOmega: number;
  /** how many crown droplets the splash throws off */
  droplets: number;
};

/** λ of the slowest possible wave — below it capillarity rules, above it gravity. */
export function minimumWavelength(w: WaterParams = WATER): number {
  return 2 * Math.PI * Math.sqrt(w.sigma / (RHO_WATER * G));
}

/** The slowest speed any deep-water wave can travel, (4gσ/ρ)^¼ ≈ 23 cm/s. */
export function minimumSpeed(w: WaterParams = WATER): number {
  return Math.pow((4 * G * w.sigma) / RHO_WATER, 0.25);
}

/** Gravity–capillary dispersion relation for deep water. */
export function omegaOf(k: number, w: WaterParams = WATER): number {
  return Math.sqrt(G * k + (w.sigma / RHO_WATER) * k ** 3);
}

/** dω/dk at k. */
export function groupSpeedOf(k: number, w: WaterParams = WATER): number {
  const omega = omegaOf(k, w);
  if (omega === 0) return 0;
  return (G + (3 * w.sigma * k * k) / RHO_WATER) / (2 * omega);
}

/** Volume of a spherical cap of depth d cut from a sphere of radius r. */
function capVolume(r: number, d: number): number {
  return (Math.PI / 3) * d * d * (3 * r - d);
}

/**
 * How deep a floating sphere sits: the cap depth whose volume displaces the
 * object's own weight. Monotone in d, so a bisection is exact enough and
 * never misbehaves. A sinking object is drowned, d = 2r.
 */
export function draftOf(radius: number, mass: number): number {
  const full = (4 / 3) * Math.PI * radius ** 3;
  const want = mass / RHO_WATER;
  if (want >= full) return 2 * radius;
  let lo = 0;
  let hi = 2 * radius;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (capVolume(radius, mid) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function impactOf(obj: ObjectParams, w: WaterParams = WATER): Impact {
  const radius = Math.max(obj.radius, 1e-4);
  const mass = Math.max(obj.mass, 1e-7);
  const h = Math.max(obj.dropHeight, 0);

  const v = Math.sqrt(2 * G * h);
  const energy = mass * G * h;
  const waveEnergy = WAVE_EFFICIENCY * energy;
  const volume = (4 / 3) * Math.PI * radius ** 3;
  const density = mass / volume;

  const froude = (v * v) / (G * radius);
  const weber = (RHO_WATER * v * v * radius) / w.sigma;
  const reynolds = (v * radius) / w.nu;

  // Cavity size, gravity-regime impact cratering: the energy has to lift the
  // displaced water, which gives R_c ~ (E/ρg)^¼. The body cannot punch a hole
  // narrower than itself, so its own radius is the floor — that is why a big
  // light object and a small heavy one leave very different ripples.
  const craterRadius = Math.max(radius, CRATER_FIT * Math.pow(energy / (RHO_WATER * G), 0.25));

  // The rim of the collapsing cavity sets the dominant wave: one wavelength
  // spans roughly the cavity diameter.
  const wavelength = Math.max(2 * craterRadius, 1e-3);
  const k = (2 * Math.PI) / wavelength;
  const omega = omegaOf(k, w);
  const phaseSpeed = omega / k;
  const groupSpeed = groupSpeedOf(k, w);

  // Put the wave energy into one ring of width λ: E = ½ρg A² · area.
  const ringArea = 2 * Math.PI * craterRadius * wavelength;
  const amplitude = Math.sqrt((2 * waveEnergy) / (RHO_WATER * G * Math.max(ringArea, 1e-9)));

  const floats = density < RHO_WATER;
  const draft = draftOf(radius, mass);
  // The restoring force comes from the waterline circle, not the sphere's
  // widest point: a beach ball barely dips in, so its waterplane is small and
  // it bobs slowly. Using πr² here instead put a beach ball at 11 Hz and a
  // cork at 139 Hz — faster than the screen can draw, so they juddered.
  const waterplane = Math.PI * Math.max(2 * radius * draft - draft * draft, 1e-9);
  // Bobbing drags water along with it; for a sphere that added mass is about
  // half the water it displaces.
  const addedMass = 0.5 * RHO_WATER * ((4 / 3) * Math.PI * radius ** 3) * (draft / (2 * radius));
  const bobOmega = floats
    ? Math.sqrt((RHO_WATER * G * waterplane) / (mass + addedMass))
    : Math.sqrt((RHO_WATER * G * Math.PI * radius * radius) / mass);

  return {
    v,
    momentum: mass * v,
    energy,
    waveEnergy,
    volume,
    density,
    froude,
    weber,
    reynolds,
    craterRadius,
    wavelength,
    k,
    omega,
    period: omega > 0 ? (2 * Math.PI) / omega : Infinity,
    phaseSpeed,
    groupSpeed,
    amplitude,
    decay: 2 * w.nu * k * k,
    regime: wavelength < minimumWavelength(w) ? "capillary" : "gravity",
    floats,
    draft,
    submerged: draft / (2 * radius),
    bobOmega,
    // A crown only breaks into droplets once inertia beats surface tension.
    droplets:
      weber < 50 ? 0 : Math.min(26, Math.round(3 * Math.log10(weber / 50) * (1 + froude / 40) + 2)),
  };
}

/**
 * Analytic cross-section η(r) of a single expanding ring at time t: cylindrical
 * 1/√r spreading inside a group-velocity envelope, viscously damped.
 */
export function analyticProfile(im: Impact, r: number, t: number): number {
  const rr = Math.max(r, im.craterRadius);
  const front = im.groupSpeed * t;
  const width = Math.max(im.wavelength * 2.5, 1e-4);
  const envelope = Math.exp(-(((rr - front) / width) ** 2));
  return (
    im.amplitude *
    Math.sqrt(im.craterRadius / rr) *
    Math.exp(-im.decay * t) *
    envelope *
    Math.cos(im.k * rr - im.omega * t)
  );
}
