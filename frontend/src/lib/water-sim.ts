/**
 * Height-field water surface solver.
 *
 * The surface η(x, y, t) is integrated with
 *
 *     η_tt = ∇·(c²(η) ∇η) − β ∇⁴η + ν ∇²η_t − μ η_t
 *
 * which gives the three things a plain wave equation cannot:
 *
 *  - `β ∇⁴η` makes the medium **dispersive** (ω² = c²k² + βk⁴), so short waves
 *    outrun long ones and every impact leaves a spreading ripple *train*
 *    instead of a single hoop.
 *  - `c²(η) = c²(1 + αη)` makes it **nonlinear**: crests travel faster than
 *    troughs, so overlapping rings exchange energy and radiate new sum- and
 *    difference-frequency waves rather than passing through each other.
 *  - `ν ∇²η_t` damps by k², so ripples die young and swells roll on, as in
 *    real water.
 *
 * Crests that steepen past the stability limit of a real wave are broken: the
 * excess is removed and re-emitted as a fresh outgoing ring plus foam, which is
 * what makes colliding ripples visibly give birth to new ones.
 */

import { G, type Impact } from "./water-physics";

/** Isotropic 9-point Laplacian has |λ|max = 32/6; see STABILITY below. */
const LAP_MAX = 32 / 6;
/** Base (long-wave) speed squared, in cells²/step². */
const C2 = 0.22;
/** Capillary stiffness at `capillarity = 1`. Ω² = C2·λ + β·λ² must stay < 4. */
const BETA_MAX = 0.05;
/** Amplitude-dependent speed gain at `nonlinearity = 1`. */
const ALPHA_MAX = 0.55;
/**
 * Breaking is judged by *steepness*, not height — real water spills when ak
 * exceeds about 0.44, whatever the wave's absolute size. That is what lets two
 * modest ripples that merely cross each other break: where their crests
 * coincide the slopes add, the sum tips over the limit, and the surface sheds
 * the excess as a new outgoing ring. A height threshold would only ever fire
 * next to the impact, which is why collisions used to pass by quietly.
 */
const STEEP_LIMIT = 0.06; // rise per cell
/** Hard ceiling on |η|, purely to keep the integrator inside its margin. */
const CLAMP = 1.03;
/** Most breaking events handled per step. */
const MAX_BREAKS = 64;
/** Most collision marks kept for the renderer at once. */
const MAX_MARKS = 120;
/** Seconds a mark stays on screen. */
export const MARK_LIFE = 0.7;

// STABILITY: Ω²max = C2·LAP_MAX + BETA_MAX·LAP_MAX² ≈ 1.17 + 1.42 = 2.59 < 4.
// The nonlinear term can lift c² by α·η, and η is clamped at ±CLAMP, keeping
// the margin.

export type SimConfig = {
  width: number;
  height: number;
  /** physical width of the modelled tank, in metres */
  metersAcross: number;
  /** 0–1, weight of the ∇⁴ (surface-tension) term */
  capillarity: number;
  /** 0–1, weight of the ν∇²η_t (viscous) term */
  viscosity: number;
  /** 0–1, weight of the amplitude-dependent wave speed */
  nonlinearity: number;
  /** walls reflect (a tank) or absorb (open water) */
  reflect: boolean;
  /** let over-steep crests break into new waves and foam */
  breaking: boolean;
  /** slope at which a crest spills; lower means collisions break more readily */
  breakSteepness: number;
};

export const DEFAULT_CONFIG: SimConfig = {
  width: 336,
  height: 210,
  metersAcross: 1.6,
  capillarity: 0.65,
  viscosity: 0.35,
  nonlinearity: 0.7,
  reflect: true,
  breaking: true,
  breakSteepness: STEEP_LIMIT,
};

export type BodyState = "falling" | "floating" | "sinking";

export type Body = {
  id: number;
  /** cell coordinates */
  x: number;
  y: number;
  radiusCells: number;
  /** metres above the surface while falling, metres below it while sinking */
  z: number;
  /** m/s, positive downwards */
  vz: number;
  state: BodyState;
  /** seconds since impact */
  t: number;
  impact: Impact;
};

export type Droplet = {
  x: number;
  y: number;
  /** metres above the surface */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** cells */
  r: number;
};

/**
 * Somewhere a new wave was just born — either a crest that broke and shed its
 * excess, or two ripple trains whose crests arrived together and built a peak
 * neither carried on its own.
 */
export type BreakMark = {
  x: number;
  y: number;
  /** sim time of the event */
  t: number;
  /** displacement shed (break) or gained over the single-train crest (merge) */
  strength: number;
  kind: "break" | "merge";
};

export type FrameReport = {
  /** bodies that hit the surface during this frame */
  impacts: Body[];
  /** waves that broke — each one seeded a new ripple */
  breaks: number;
  /** droplets that fell back in */
  splashbacks: number;
};

/**
 * Crest height in solver units. Real amplitudes span four decades between a
 * raindrop and a bowling ball, so they are compressed onto 0–1.1: saturating
 * rather than clipping keeps the whole range distinguishable on screen and
 * keeps the integrator inside its stability margin.
 */
export function solverAmplitude(impact: Impact): number {
  return Math.max(0.02, 1.1 * (1 - Math.exp(-impact.amplitude / 0.03)));
}

/**
 * Metres of real crest per solver unit, for this impact. The compression above
 * is not linear, so this is only valid near that impact's own amplitude — it
 * exists so a view can say honestly how far it is exaggerating the vertical.
 */
export function metresPerUnit(impact: Impact): number {
  return impact.amplitude / solverAmplitude(impact);
}

/** A volume-conserving crater: a bowl with a raised rim (∫ = 0 in 2D). */
function crater(u: number): number {
  const u2 = u * u;
  return (1 - u2 / 2) * Math.exp(-u2 / 2);
}

export class WaterSim {
  readonly cfg: SimConfig;
  readonly w: number;
  readonly h: number;
  /** seconds of simulated time per integration step */
  readonly dt: number;
  readonly metersPerCell: number;

  /** current surface displacement, in sim units */
  cur: Float32Array;
  private prev: Float32Array;
  private lap: Float32Array;
  private lapPrev: Float32Array;
  /** ∇·(c²(η)∇η) / c², the nonlinear transport operator */
  private flux: Float32Array;
  /** |∇η|² per cell, the breaking criterion */
  private steep: Float32Array;
  /** surface foam coverage, 0–1, used by the renderer */
  readonly foam: Float32Array;

  readonly bodies: Body[] = [];
  readonly droplets: Droplet[] = [];
  /** Where crests broke, for the renderer to mark the waves they threw off. */
  readonly marks: BreakMark[] = [];

  /** Worthington jets queued by past impacts: the cavity rebound. */
  private jets: { x: number; y: number; r: number; amp: number; at: number }[] = [];

  private clock = 0;
  private nextId = 1;

  constructor(config: Partial<SimConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.w = this.cfg.width;
    this.h = this.cfg.height;
    const n = this.w * this.h;
    this.cur = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.lap = new Float32Array(n);
    this.lapPrev = new Float32Array(n);
    this.flux = new Float32Array(n);
    this.steep = new Float32Array(n);
    this.foam = new Float32Array(n);
    this.metersPerCell = this.cfg.metersAcross / this.w;
    // Pin the sim clock to reality by matching the long-wave speed √C2 (in
    // cells/step) to the slowest real water wave, (4gσ/ρ)^¼ ≈ 0.231 m/s.
    this.dt = (Math.sqrt(C2) * this.metersPerCell) / 0.231;
  }

  get time(): number {
    return this.clock;
  }

  /** Drop an object from `impact.v`'s height at the given relative position. */
  drop(nx: number, ny: number, impact: Impact): Body {
    const body: Body = {
      id: this.nextId++,
      x: nx * this.w,
      y: ny * this.h,
      radiusCells: Math.max(1.2, (impact.craterRadius / this.metersPerCell) * 0.75),
      z: Math.max(impact.v ** 2 / (2 * G), 0.001),
      vz: 0,
      state: "falling",
      t: 0,
      impact,
    };
    this.bodies.push(body);
    return body;
  }

  private amplitudeOf(impact: Impact): number {
    return solverAmplitude(impact);
  }

  /** Stamp a crater at (x, y) with zero initial velocity. */
  private stamp(cx: number, cy: number, radius: number, amp: number) {
    const { w, h, cur, prev } = this;
    const reach = Math.ceil(radius * 2.4);
    const x0 = Math.max(1, Math.floor(cx - reach));
    const x1 = Math.min(w - 2, Math.ceil(cx + reach));
    const y0 = Math.max(1, Math.floor(cy - reach));
    const y1 = Math.min(h - 2, Math.ceil(cy + reach));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const u = Math.sqrt(dx * dx + dy * dy) / radius;
        if (u > 2.4) continue;
        const d = amp * crater(u);
        const i = y * w + x;
        cur[i]! += d;
        prev[i]! += d;
      }
    }
  }

  /** A fingertip dragged through the water. */
  stir(nx: number, ny: number, strength = 0.12, radius = 3) {
    this.stamp(nx * this.w, ny * this.h, radius, -strength);
  }

  private splash(body: Body) {
    const amp = this.amplitudeOf(body.impact);
    const r = body.radiusCells;
    this.stamp(body.x, body.y, r, -amp);

    // The cavity closes and throws a jet back up after ~√(R/g).
    const delay = Math.sqrt(Math.max(body.impact.craterRadius, 1e-3) / G);
    this.jets.push({ x: body.x, y: body.y, r: r * 0.6, amp: amp * 0.45, at: this.clock + delay });

    // Crown droplets, thrown outward and up at a fraction of impact speed.
    const n = body.impact.droplets;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const speed = body.impact.v * (0.18 + Math.random() * 0.3);
      const horiz = speed * (0.35 + Math.random() * 0.4);
      this.droplets.push({
        x: body.x + Math.cos(a) * r,
        y: body.y + Math.sin(a) * r,
        z: 0.002,
        vx: (Math.cos(a) * horiz) / this.metersPerCell,
        vy: (Math.sin(a) * horiz) / this.metersPerCell,
        vz: speed * (0.7 + Math.random() * 0.5),
        r: Math.max(0.6, r * (0.1 + Math.random() * 0.18)),
      });
    }
    this.addFoam(body.x, body.y, r * 1.6, 0.9);
  }

  private addFoam(cx: number, cy: number, radius: number, amount: number) {
    const { w, h, foam } = this;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(w - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(h - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        if (d > 1) continue;
        const i = y * w + x;
        foam[i]! = Math.min(1, foam[i]! + amount * (1 - d) * (0.5 + Math.random() * 0.5));
      }
    }
  }

  /** Record a newborn wave, thinning events that cluster on one spot. */
  private mark(x: number, y: number, strength: number, kind: BreakMark["kind"]) {
    if (this.marks.length >= MAX_MARKS) return;
    for (const m of this.marks) {
      if (m.kind === kind && Math.abs(m.x - x) < 7 && Math.abs(m.y - y) < 7) {
        if (strength > m.strength) m.strength = strength;
        return;
      }
    }
    this.marks.push({ x, y, t: this.clock, strength, kind });
  }

  /** Advance the surface by one integration step. Returns breaks seeded. */
  private integrate(): number {
    const { w, h, cur, prev, lap, lapPrev, cfg } = this;
    const beta = BETA_MAX * cfg.capillarity;
    const alpha = ALPHA_MAX * cfg.nonlinearity;
    const nu = 0.12 * cfg.viscosity;
    // Explicit ν∇²η_t has a tight stability limit, so grid-scale chop — which
    // real water loses in milliseconds — is swept up by a small diffusion of η
    // itself. It bites as k², so the two-cell modes die in a fifth of a second
    // while a ten-cell ripple train is untouched for minutes.
    const filter = 0.004 + 0.02 * cfg.viscosity;
    const limit = Math.max(0.005, cfg.breakSteepness);
    const limitSq = limit * limit;
    const mu = 0.002 + 0.006 * cfg.viscosity;

    // 9-point isotropic stencil — the 5-point one radiates squares. Both
    // operators are built from neighbour *differences*, which keeps them
    // symmetric and therefore energy-conserving: the nonlinear term has to be
    // the flux form ∇·(c²∇η), not c²∇²η, or every reflection feeds the waves.
    const { flux, steep } = this;
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        const e = cur[i]!;
        const n0 = cur[i - 1]! - e;
        const n1 = cur[i + 1]! - e;
        const n2 = cur[i - w]! - e;
        const n3 = cur[i + w]! - e;
        const d0 = cur[i - w - 1]! - e;
        const d1 = cur[i - w + 1]! - e;
        const d2 = cur[i + w - 1]! - e;
        const d3 = cur[i + w + 1]! - e;
        lap[i]! = (4 * (n0 + n1 + n2 + n3) + (d0 + d1 + d2 + d3)) / 6;
        const gx = (n1 - n0) * 0.5;
        const gy = (n3 - n2) * 0.5;
        steep[i]! = gx * gx + gy * gy;
        if (alpha === 0) {
          flux[i]! = lap[i]!;
          continue;
        }
        // The face weight 1 + α(η_i + η_j)/2 uses the mean height of the two
        // cells, so it is identical seen from either side.
        const half = alpha * 0.5;
        const o =
          n0 * (1 + half * (2 * e + n0)) +
          n1 * (1 + half * (2 * e + n1)) +
          n2 * (1 + half * (2 * e + n2)) +
          n3 * (1 + half * (2 * e + n3));
        const dg =
          d0 * (1 + half * (2 * e + d0)) +
          d1 * (1 + half * (2 * e + d1)) +
          d2 * (1 + half * (2 * e + d2)) +
          d3 * (1 + half * (2 * e + d3));
        flux[i]! = (4 * o + dg) / 6;
      }
    }

    let breaks = 0;
    for (let y = 2; y < h - 2; y++) {
      const row = y * w;
      for (let x = 2; x < w - 2; x++) {
        const i = row + x;
        const e = cur[i]!;
        const l = lap[i]!;
        // ∇⁴η = ∇²(∇²η)
        const bih = lap[i - 1]! + lap[i + 1]! + lap[i - w]! + lap[i + w]! - 4 * l;
        // ν∇²η_t, from the Laplacian of the previous step for free
        const viscous = nu * (l - lapPrev[i]!);
        let next =
          2 * e -
          prev[i]! +
          C2 * flux[i]! -
          beta * bih +
          viscous -
          mu * (e - prev[i]!) +
          filter * l;

        const sq = steep[i]!;
        if (cfg.breaking && sq > limitSq && next > 0 && l < 0 && breaks < MAX_BREAKS) {
          // Past the limit the crest spills: take the excess out of the water
          // here and put it back as an outgoing ring, which is a new wave.
          const over = Math.sqrt(sq) / limit - 1;
          const shed = next * Math.min(0.4, 0.25 * over);
          // Flattening the crest *is* the new wave: a crest that suddenly
          // loses height is a fresh local disturbance, and it radiates. An
          // extra injected ring on top of it would add energy rather than
          // move it, and with a whole steep region breaking at once those
          // rings would superpose and feed the field.
          // Lower η at both time levels: dropping only the new one would
          // leave the crest moving downward faster than it was, which *adds*
          // kinetic energy — breaking has to take energy out, not put it in.
          next -= shed;
          cur[i]! = e - shed;
          this.addFoam(x, y, 2.6, Math.min(0.7, shed * 6));
          breaks++;
          if (shed > 0.004) this.mark(x, y, shed, "break");
        }
        prev[i]! = next > CLAMP ? CLAMP : next < -CLAMP ? -CLAMP : next;
      }
    }

    // next → cur, cur → prev
    const swap = this.cur;
    this.cur = this.prev;
    this.prev = swap;
    const ls = this.lap;
    this.lap = this.lapPrev;
    this.lapPrev = ls;

    this.applyBoundary();
    return breaks;
  }

  private applyBoundary() {
    const { w, h, cur, prev, cfg } = this;
    if (cfg.reflect) {
      // Neumann: no flux through the wall, so the wave reflects in phase. Two
      // layers, because the ∇⁴ term leaves the integrator a two-cell margin.
      for (let x = 0; x < w; x++) {
        const src = cur[2 * w + x]!;
        cur[w + x]! = src;
        cur[x]! = src;
        const srcB = cur[(h - 3) * w + x]!;
        cur[(h - 2) * w + x]! = srcB;
        cur[(h - 1) * w + x]! = srcB;
      }
      for (let y = 0; y < h; y++) {
        const row = y * w;
        const src = cur[row + 2]!;
        cur[row + 1]! = src;
        cur[row]! = src;
        const srcR = cur[row + w - 3]!;
        cur[row + w - 2]! = srcR;
        cur[row + w - 1]! = srcR;
      }
      return;
    }
    // Sponge layer: fade everything near the rim so nothing comes back.
    const pad = 12;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (d >= pad) continue;
        const f = 0.55 + 0.45 * (d / pad);
        const i = y * w + x;
        cur[i]! *= f;
        prev[i]! *= f;
      }
    }
  }

  private advanceBodies(dt: number): Body[] {
    const impacts: Body[] = [];
    for (let n = this.bodies.length - 1; n >= 0; n--) {
      const b = this.bodies[n]!;
      if (b.state === "falling") {
        b.vz += G * dt;
        b.z -= b.vz * dt;
        if (b.z <= 0) {
          b.z = 0;
          b.state = b.impact.floats ? "floating" : "sinking";
          this.splash(b);
          impacts.push(b);
        }
        continue;
      }
      b.t += dt;
      if (b.state === "floating") {
        // Buoyancy spring: the hull follows a damped bob and drags the surface
        // with it, radiating a slow train of waves at ω_bob.
        const decay = Math.exp(-b.t * 0.9);
        const z = this.amplitudeOf(b.impact) * 0.55 * decay * Math.cos(b.impact.bobOmega * b.t);
        b.z = z;
        this.drive(b.x, b.y, b.radiusCells, z, 0.3);
        if (b.t > 14) this.bodies.splice(n, 1);
      } else {
        b.z -= Math.min(0.6, 0.12 + b.t * 0.25) * dt;
        if (b.z < -0.35) this.bodies.splice(n, 1);
      }
    }
    return impacts;
  }

  /** Pull the surface under a floating hull toward its height. */
  private drive(cx: number, cy: number, radius: number, z: number, blend: number) {
    const { w, h, cur } = this;
    const x0 = Math.max(1, Math.floor(cx - radius));
    const x1 = Math.min(w - 2, Math.ceil(cx + radius));
    const y0 = Math.max(1, Math.floor(cy - radius));
    const y1 = Math.min(h - 2, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        if (d > 1) continue;
        const i = y * w + x;
        cur[i]! += (z - cur[i]!) * blend * (1 - d);
      }
    }
  }

  private advanceDroplets(dt: number): number {
    let landed = 0;
    for (let n = this.droplets.length - 1; n >= 0; n--) {
      const d = this.droplets[n]!;
      d.vz -= G * dt;
      d.z += d.vz * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.z > 0 && d.x > 1 && d.y > 1 && d.x < this.w - 2 && d.y < this.h - 2) continue;
      if (d.z <= 0 && d.x > 1 && d.y > 1 && d.x < this.w - 2 && d.y < this.h - 2) {
        // Splash-back: every droplet starts its own ripple.
        this.stamp(d.x, d.y, Math.max(1.2, d.r), -Math.min(0.3, 0.02 + Math.abs(d.vz) * 0.03));
        this.addFoam(d.x, d.y, d.r + 1, 0.35);
        landed++;
      }
      this.droplets.splice(n, 1);
    }
    return landed;
  }

  private fireJets() {
    if (!this.jets.length) return;
    const due = this.jets.filter((j) => j.at <= this.clock);
    if (!due.length) return;
    this.jets = this.jets.filter((j) => j.at > this.clock);
    for (const j of due) this.stamp(j.x, j.y, j.r, j.amp);
  }

  /** Run `steps` integration steps plus one pass of bodies, drops and foam. */
  step(steps = 2): FrameReport {
    let breaks = 0;
    for (let s = 0; s < steps; s++) {
      this.clock += this.dt;
      this.fireJets();
      breaks += this.integrate();
    }
    const dt = this.dt * steps;
    const impacts = this.advanceBodies(dt);
    const splashbacks = this.advanceDroplets(dt);
    const decay = Math.pow(0.965, steps);
    for (let i = 0; i < this.foam.length; i++) this.foam[i]! *= decay;
    // Marks are only a visual record of where a wave was just born.
    for (let n = this.marks.length - 1; n >= 0; n--) {
      if (this.clock - this.marks[n]!.t > MARK_LIFE) this.marks.splice(n, 1);
    }
    return { impacts, breaks, splashbacks };
  }

  reset() {
    this.cur.fill(0);
    this.prev.fill(0);
    this.lap.fill(0);
    this.lapPrev.fill(0);
    this.flux.fill(0);
    this.steep.fill(0);
    this.marks.length = 0;
    this.foam.fill(0);
    this.bodies.length = 0;
    this.droplets.length = 0;
    this.jets = [];
  }

  /** Total surface energy, ∝ Σ η² — handy for checking the solver is stable. */
  energy(): number {
    let sum = 0;
    for (let i = 0; i < this.cur.length; i++) sum += this.cur[i]! * this.cur[i]!;
    return sum;
  }

  /**
   * Azimuthally averaged profile η(r) around a point, in sim units, sampled
   * every cell out to `cells`. Averaging over angles cancels the other ripples
   * crossing the tank and leaves the ring from that impact.
   */
  sampleRadial(cx: number, cy: number, cells: number, rays = 24): Float32Array {
    const out = new Float32Array(cells);
    for (let ri = 0; ri < cells; ri++) {
      let sum = 0;
      let count = 0;
      for (let a = 0; a < rays; a++) {
        const th = (a / rays) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(th) * ri);
        const y = Math.round(cy + Math.sin(th) * ri);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        sum += this.cur[y * this.w + x]!;
        count++;
      }
      out[ri]! = count ? sum / count : 0;
    }
    return out;
  }
}
