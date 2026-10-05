import type { ReactNode } from "react";

import {
  G,
  NU_WATER,
  RHO_WATER,
  WAVE_EFFICIENCY,
  type Impact,
  type ObjectParams,
  type WaterParams,
  impactOf,
  minimumSpeed,
  minimumWavelength,
} from "@/lib/water-physics";

/* ── small typesetting helpers ────────────────────────────────────────────── */
/* Variables are italic, operators and units upright, indices are real
   subscripts — so c_g, ρ_o and η_tt read as mathematics instead of code. */

const V = ({ children }: { children: ReactNode }) => (
  <i className="font-display italic">{children}</i>
);
const Sub = ({ children }: { children: ReactNode }) => (
  <sub className="text-[0.62em]">{children}</sub>
);
const Sup = ({ children }: { children: ReactNode }) => (
  <sup className="text-[0.62em]">{children}</sup>
);

function Formula({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-2xl leading-snug tracking-tight text-foreground md:text-[1.75rem]">
      {children}
    </p>
  );
}

function Result({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mt-3">
      <p className="font-mono text-lg text-primary">{children}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One step of the story: prose on the left, the mathematics on the right. */
function Stage({
  n,
  title,
  lead,
  children,
  math,
}: {
  n: number;
  title: string;
  lead: ReactNode;
  children?: ReactNode;
  math: ReactNode;
}) {
  return (
    <section className="glass grid gap-6 p-6 md:grid-cols-[1fr_1fr] md:p-7">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Step {n}
        </p>
        <h3 className="mt-2 font-display text-2xl font-light">{title}</h3>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{lead}</div>
        {children}
      </div>
      <div className="flex flex-col justify-center rounded-xl bg-secondary/35 p-5">{math}</div>
    </section>
  );
}

/** "Turn the dials" — what actually changes when the object changes. */
function Levers({ items }: { items: { k: string; v: string }[] }) {
  return (
    <dl className="mt-4 space-y-1.5">
      {items.map((i) => (
        <div key={i.k} className="flex gap-2 text-xs">
          <dt className="shrink-0 font-mono text-accent">{i.k}</dt>
          <dd className="text-muted-foreground">{i.v}</dd>
        </div>
      ))}
    </dl>
  );
}

const fmt = (x: number, d = 2) =>
  !Number.isFinite(x)
    ? "∞"
    : Math.abs(x) >= 10000 || (Math.abs(x) < 0.001 && x !== 0)
      ? x.toExponential(2)
      : x.toFixed(d);

/** "11.6 cm → 20.1 cm" for a quantity under a changed object. */
const shift = (now: number, then: number, unit: string, d = 2) =>
  `${fmt(now, d)} → ${fmt(then, d)} ${unit}`;

export function PhysicsGuide({
  object,
  water,
  im,
}: {
  object: ObjectParams;
  water: WaterParams;
  im: Impact;
}) {
  // Real comparisons, not hand-waving: re-run the same physics on an object
  // twice as wide and one twice as heavy.
  const wider = impactOf({ ...object, radius: object.radius * 2 }, water);
  const heavier = impactOf({ ...object, mass: object.mass * 2 }, water);
  const halfLife = im.decay > 0 ? Math.LN2 / im.decay : Infinity;
  const lambdaMin = minimumWavelength(water);
  const cMin = minimumSpeed(water);
  const sizeLimited = im.craterRadius <= object.radius * 1.02;

  return (
    <div className="mt-12 space-y-4">
      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">The physics</p>
        <h2 className="mt-2 font-display text-3xl font-light md:text-4xl">
          From three numbers to a ripple
        </h2>
        <p className="mt-3 text-muted-foreground">
          You set three things: how <em>big</em> the object is, how <em>heavy</em> it is, and how
          far it <em>falls</em>. Everything the water does follows from those, one step at a time.
          Each step below shows the reasoning, the formula, and the number it gives for the object
          you have right now.
        </p>
      </header>

      <Stage
        n={1}
        title="The fall"
        lead={
          <>
            <p>
              Falling converts height into speed. Notice what is <em>missing</em>: mass. A feather
              and a cannonball reach the water at the same speed, because gravity accelerates
              everything equally — Galileo's point.
            </p>
            <p>
              Mass does decide what that speed is worth. Energy and momentum both scale with it, and
              energy is what the water has to absorb.
            </p>
          </>
        }
        math={
          <>
            <Formula>
              <V>v</V> = √(2<V>gh</V>)
            </Formula>
            <Result hint={`falling ${fmt(object.dropHeight)} m`}>{fmt(im.v)} m/s</Result>
            <Formula>
              <V>E</V> = <V>mgh</V>
            </Formula>
            <Result
              hint={`about ${WAVE_EFFICIENCY * 100}% leaves as waves — ${fmt(im.waveEnergy, 3)} J. The rest goes into spray, sound and churn.`}
            >
              {fmt(im.energy)} J
            </Result>
            <Levers
              items={[
                { k: "twice as wide", v: "no change — speed and energy do not care about size" },
                { k: "twice as heavy", v: shift(im.energy, heavier.energy, "J") },
                { k: "twice as high", v: "speed ×1.41, energy ×2" },
              ]}
            />
          </>
        }
      />

      <Stage
        n={2}
        title="The hole it punches"
        lead={
          <>
            <p>
              The object drives a crater into the surface, and two separate things limit how wide
              that crater gets. It can never be narrower than the object itself. And it can never be
              wider than the energy can afford, because opening a cavity means lifting water out of
              it — which is where <V>E</V>/<V>ρg</V> comes from.
            </p>
            <p>
              Whichever limit is larger wins.{" "}
              {sizeLimited
                ? "Right now the object's own width is the binding one: it is too big and slow to dig deeper than its own size."
                : "Right now energy is the binding one: the object is small and fast enough to open a cavity wider than itself."}
            </p>
          </>
        }
        math={
          <>
            <Formula>
              <V>R</V> = max( <V>r</V>, ½(<V>E</V>/<V>ρg</V>)<Sup>¼</Sup> )
            </Formula>
            <Result
              hint={`object radius ${fmt(object.radius * 100)} cm · energy limit ${fmt(0.5 * Math.pow(im.energy / (RHO_WATER * G), 0.25) * 100)} cm`}
            >
              {fmt(im.craterRadius * 100)} cm
            </Result>
            <Levers
              items={[
                {
                  k: "twice as wide",
                  v: shift(im.craterRadius * 100, wider.craterRadius * 100, "cm"),
                },
                {
                  k: "twice as heavy",
                  v: `${shift(im.craterRadius * 100, heavier.craterRadius * 100, "cm")} — the fourth root makes weight a weak lever`,
                },
              ]}
            />
          </>
        }
      />

      <Stage
        n={3}
        title="The wave that comes out"
        lead={
          <>
            <p>
              The crater collapses, and its rim sets the size of the wave that leaves. One full wave
              — crest to crest — spans roughly the width of the hole that made it.
            </p>
            <p>
              Physicists usually work with the <em>wavenumber</em> <V>k</V> instead of the
              wavelength: it counts how many radians of wave fit into a metre. Big slow waves have
              small <V>k</V>; fine ripples have large <V>k</V>. Every formula after this uses it.
            </p>
          </>
        }
        math={
          <>
            <Formula>
              <V>λ</V> ≈ 2<V>R</V>
            </Formula>
            <Result>{fmt(im.wavelength * 100)} cm</Result>
            <Formula>
              <V>k</V> = 2<V>π</V>/<V>λ</V>
            </Formula>
            <Result>{fmt(im.k, 1)} rad/m</Result>
            <Levers
              items={[
                { k: "twice as wide", v: shift(im.wavelength * 100, wider.wavelength * 100, "cm") },
                {
                  k: "twice as heavy",
                  v: shift(im.wavelength * 100, heavier.wavelength * 100, "cm"),
                },
              ]}
            />
          </>
        }
      />

      <Stage
        n={4}
        title="How fast it travels"
        lead={
          <>
            <p>
              Water is <em>dispersive</em>: the speed of a wave depends on its wavelength, so a
              single splash spreads into a train rather than one clean hoop. The relation below says
              why, and it has two halves fighting each other.
            </p>
            <p>
              The <V>gk</V> term is gravity pulling long waves along — bigger waves go faster. The{" "}
              <V>σk</V>
              <Sup>3</Sup>/<V>ρ</V> term is surface tension, the skin on the water, and it does the
              opposite: shorter waves go faster. Gravity wins for big waves, tension for tiny ones,
              and the handover sits at <V>λ</V> = {fmt(lambdaMin * 100)} cm — the slowest any ripple
              can go, {fmt(cMin)} m/s.
            </p>
            <p>
              Two speeds come out of this. Individual crests move at <V>c</V>. The visible ring —
              the group of waves travelling together — moves at <V>c</V>
              <Sub>g</Sub>, which is the one your eye follows. Crests appear at the back of the
              group, run forward through it, and vanish off the front.
            </p>
          </>
        }
        math={
          <>
            <Formula>
              <V>ω</V>
              <Sup>2</Sup> = <V>gk</V> + <V>σk</V>
              <Sup>3</Sup>/<V>ρ</V>
            </Formula>
            <Result hint={`one full oscillation takes T = ${fmt(im.period, 3)} s`}>
              {fmt(im.omega, 1)} rad/s
            </Result>
            <Formula>
              <V>c</V> = <V>ω</V>/<V>k</V> &nbsp;·&nbsp; <V>c</V>
              <Sub>g</Sub> = d<V>ω</V>/d<V>k</V>
            </Formula>
            <Result
              hint={`crests ${fmt(im.phaseSpeed)} m/s · the ring front ${fmt(im.groupSpeed)} m/s`}
            >
              {im.regime === "gravity" ? "gravity waves" : "capillary ripples"}
            </Result>
            <Levers
              items={[
                {
                  k: "this object",
                  v:
                    im.regime === "gravity"
                      ? `λ = ${fmt(im.wavelength * 100)} cm is above ${fmt(lambdaMin * 100)} cm, so gravity rules and bigger means faster`
                      : `λ = ${fmt(im.wavelength * 100)} cm is below ${fmt(lambdaMin * 100)} cm, so surface tension rules and smaller means faster`,
                },
                { k: "twice as wide", v: shift(im.groupSpeed, wider.groupSpeed, "m/s") },
              ]}
            />
          </>
        }
      />

      <Stage
        n={5}
        title="How tall, and how long it rings"
        lead={
          <>
            <p>
              The wave energy has to spread over the first ring, an area of about 2<V>πRλ</V>.
              Spread the same energy over a bigger ring and the crest is lower — which is also why
              ripples fade as they travel outward, long before friction gets to them.
            </p>
            <p>
              Then viscosity drains them, and it is brutally selective: the rate goes as <V>k</V>
              <Sup>2</Sup>. Halve the wavelength and the wave dies four times faster. That is why a
              pond keeps its long swell for a while but loses its fine texture almost at once.
            </p>
          </>
        }
        math={
          <>
            <Formula>
              <V>A</V> = √( 2<V>εE</V> / <V>ρg</V>·2<V>πRλ</V> )
            </Formula>
            <Result hint="height of the first crest">{fmt(im.amplitude * 1000)} mm</Result>
            <Formula>
              <V>γ</V> = 2<V>νk</V>
              <Sup>2</Sup>
            </Formula>
            <Result
              hint={`amplitude halves every ${fmt(halfLife, 1)} s from viscosity alone${
                water.nu > NU_WATER * 1.5 ? " — this water is thicker than the real thing" : ""
              }`}
            >
              {fmt(im.decay, 4)} /s
            </Result>
            <Levers
              items={[
                {
                  k: "twice as heavy",
                  v: shift(im.amplitude * 1000, heavier.amplitude * 1000, "mm"),
                },
                {
                  k: "twice as wide",
                  v: `${shift(im.amplitude * 1000, wider.amplitude * 1000, "mm")} — the same energy spread over a longer ring`,
                },
              ]}
            />
          </>
        }
      />

      <Stage
        n={6}
        title="The splash, and what the object does next"
        lead={
          <>
            <p>
              Whether the crown of water tears into droplets is a contest between inertia, which
              wants to fling water outward, and surface tension, which wants to hold the sheet
              together. The Weber number is their ratio. Below about 50 the skin holds; above it the
              rim breaks into beads — and every bead that falls back starts a ripple of its own.
            </p>
            <p>
              Afterwards the object is simply denser or lighter than water.{" "}
              {im.floats
                ? "This one floats, so it keeps bobbing on its own buoyancy and radiating waves long after the splash."
                : "This one sinks, so once it is under, the surface is left to ring down on its own."}
            </p>
          </>
        }
        math={
          <>
            <Formula>
              <V>We</V> = <V>ρv</V>
              <Sup>2</Sup>
              <V>r</V>/<V>σ</V>
            </Formula>
            <Result
              hint={
                im.droplets > 0
                  ? `inertia wins — roughly ${im.droplets} droplets thrown off`
                  : "surface tension wins — the crown holds together"
              }
            >
              {fmt(im.weber, 0)}
            </Result>
            <Formula>
              <V>ρ</V>
              <Sub>o</Sub> = <V>m</V>/(⁴⁄₃<V>πr</V>
              <Sup>3</Sup>)
            </Formula>
            <Result
              hint={
                im.floats
                  ? `lighter than water — it bobs at ${fmt(im.bobOmega / (2 * Math.PI))} Hz`
                  : `${fmt(im.density / RHO_WATER, 1)}× denser than water — it sinks`
              }
            >
              {fmt(im.density, 0)} kg/m³
            </Result>
          </>
        }
      />

      <section className="glass p-6 md:p-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Step 7 · under the hood
        </p>
        <h3 className="mt-2 font-display text-2xl font-light">
          What the simulation actually solves
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The six steps above are closed-form estimates for a single ripple. The water you are
          looking at is not drawn from them — it is integrated, cell by cell, from one equation for
          the surface height <V>η</V>. Each term buys one behaviour you can see.
        </p>
        <div className="mt-5 rounded-xl bg-secondary/35 p-5">
          <Formula>
            <V>η</V>
            <Sub>tt</Sub> = ∇·( <V>c</V>
            <Sup>2</Sup>(<V>η</V>)∇<V>η</V> ) − <V>β</V>∇<Sup>4</Sup>
            <V>η</V> + <V>ν</V>∇<Sup>2</Sup>
            <V>η</V>
            <Sub>t</Sub>
          </Formula>
        </div>
        <dl className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            {
              t: "transport, and it is nonlinear",
              f: (
                <>
                  ∇·( <V>c</V>
                  <Sup>2</Sup>(<V>η</V>)∇<V>η</V> ), with <V>c</V>
                  <Sup>2</Sup>(<V>η</V>) = <V>c</V>
                  <Sup>2</Sup>(1 + <V>αη</V>)
                </>
              ),
              d: "Wave speed depends on the height of the water it is passing through, so crests travel faster than troughs. That is what makes two rings interact where they meet — trading energy and radiating new waves — instead of sliding through each other untouched.",
            },
            {
              t: "dispersion",
              f: (
                <>
                  −<V>β</V>∇<Sup>4</Sup>
                  <V>η</V>
                </>
              ),
              d: "Stiffens short waves so they outrun long ones, exactly as surface tension does in step 4. Without it every impact would leave one lonely hoop; with it you get a spreading train.",
            },
            {
              t: "viscosity",
              f: (
                <>
                  <V>ν</V>∇<Sup>2</Sup>
                  <V>η</V>
                  <Sub>t</Sub>
                </>
              ),
              d: "Drains the surface at a rate that climbs with k², so fine chop dies in moments and the long swell rolls on — the same selectivity as γ in step 5.",
            },
          ].map((x) => (
            <div key={x.t} className="rounded-lg border border-border p-4">
              <dt className="font-display text-lg">{x.t}</dt>
              <p className="mt-1 font-display text-base italic text-primary">{x.f}</p>
              <dd className="mt-2 text-xs leading-relaxed text-muted-foreground">{x.d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          One rule sits on top of the equation. Real water spills when a crest gets too{" "}
          <em>steep</em> — not too tall, too steep — so any crest whose slope passes the limit sheds
          the excess as foam. A crest that suddenly loses height is itself a fresh disturbance, and
          it radiates. That is a new wave, born from an old one breaking.
        </p>
      </section>

      <p className="pt-2 text-center font-mono text-xs text-muted-foreground">
        g = {G} m/s² · ρ = {RHO_WATER} kg/m³ · σ = {fmt(water.sigma, 4)} N/m · ν ={" "}
        {fmt(water.nu * 1e6, 2)} mm²/s · tank 1.6 m across · scaling laws simplified for
        illustration
      </p>
    </div>
  );
}
