import type { ReactNode } from "react";

import {
  CRATER_FIT,
  G,
  NU_WATER,
  RHO_WATER,
  SIGMA_WATER,
  WAVE_EFFICIENCY,
  type Impact,
  type ObjectParams,
  type WaterParams,
  impactOf,
  minimumSpeed,
  minimumWavelength,
} from "@/lib/water-physics";

/* ── typesetting ──────────────────────────────────────────────────────────── */
/* Variables italic, operators and units upright, indices as real subscripts —
   so c_g, ρ_o and η_tt read as mathematics rather than as code. */

const V = ({ children }: { children: ReactNode }) => (
  <i className="font-display italic">{children}</i>
);
const Sub = ({ children }: { children: ReactNode }) => (
  <sub className="text-[0.62em]">{children}</sub>
);
const Sup = ({ children }: { children: ReactNode }) => (
  <sup className="text-[0.62em]">{children}</sup>
);

const fmt = (x: number, d = 2) =>
  !Number.isFinite(x)
    ? "∞"
    : Math.abs(x) >= 10000 || (Math.abs(x) < 0.001 && x !== 0)
      ? x.toExponential(2)
      : x.toFixed(d);

/**
 * A worked calculation, lined up on the equals signs:
 *
 *     v  =  √(2gh)
 *        =  √(2 × 9.81 × 1.00)
 *        =  4.43 m/s
 *
 * The first row names the quantity; later rows continue it. Substituting the
 * real numbers is the point — it turns a formula into something you can check.
 */
function Work({ name, rows }: { name: ReactNode; rows: ReactNode[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="grid w-fit grid-cols-[auto_auto_1fr] items-baseline gap-x-2.5 gap-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <span className="justify-self-end font-display text-lg italic">
              {i === 0 ? name : ""}
            </span>
            <span className="text-muted-foreground">=</span>
            <span
              className={
                i === rows.length - 1
                  ? "font-mono text-base text-primary"
                  : "font-mono text-[13px] text-foreground/85"
              }
            >
              {r}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** One step: the idea in a sentence or two, then the arithmetic beside it. */
function Stage({
  n,
  title,
  idea,
  math,
}: {
  n: number;
  title: string;
  idea: ReactNode;
  math: ReactNode;
}) {
  return (
    <section className="glass grid gap-6 p-6 md:grid-cols-[1fr_1fr] md:p-7">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Step {n}
        </p>
        <h3 className="mt-2 font-display text-2xl font-light">{title}</h3>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{idea}</div>
      </div>
      <div className="rounded-xl bg-secondary/35 p-5">{math}</div>
    </section>
  );
}

/** What actually changes when the object does. */
function Levers({ items }: { items: { k: string; v: string }[] }) {
  return (
    <dl className="mt-4 space-y-1.5 border-t border-border pt-3">
      {items.map((i) => (
        <div key={i.k} className="flex gap-2 text-xs">
          <dt className="shrink-0 font-mono text-accent">{i.k}</dt>
          <dd className="text-muted-foreground">{i.v}</dd>
        </div>
      ))}
    </dl>
  );
}

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
  // Real comparisons: the same physics re-run on a wider and a heavier object.
  const wider = impactOf({ ...object, radius: object.radius * 2 }, water);
  const heavier = impactOf({ ...object, mass: object.mass * 2 }, water);

  const r = object.radius;
  const m = object.mass;
  const h = object.dropHeight;
  const sigma = water.sigma;
  const energyLimit = CRATER_FIT * Math.pow(im.energy / (RHO_WATER * G), 0.25);
  const halfLife = im.decay > 0 ? Math.LN2 / im.decay : Infinity;
  const lambdaMin = minimumWavelength(water);
  const ringArea = 2 * Math.PI * im.craterRadius * im.wavelength;
  const sizeLimited = im.craterRadius <= r * 1.02;

  return (
    <div className="mt-12 space-y-4">
      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">The physics</p>
        <h2 className="mt-2 font-display text-3xl font-light md:text-4xl">
          From three numbers to a ripple
        </h2>
        <p className="mt-3 text-muted-foreground">
          You set three things. Everything the water does follows from them, one step at a time.
          Each step gives the idea in a sentence, the formula, and then the same formula with your
          numbers put in — so every figure on this page can be checked by hand.
        </p>
      </header>

      {/* What goes in */}
      <section className="glass p-6 md:p-7">
        <h3 className="font-display text-xl font-light">What goes in</h3>
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { s: <V>m</V>, k: "mass", v: `${fmt(m * 1000, m < 0.01 ? 2 : 0)} g`, from: "you" },
            { s: <V>r</V>, k: "radius", v: `${fmt(r * 100)} cm`, from: "you" },
            { s: <V>h</V>, k: "drop height", v: `${fmt(h)} m`, from: "you" },
            { s: <V>g</V>, k: "gravity", v: `${G} m/s²`, from: "Earth" },
            {
              s: <V>ρ</V>,
              k: "density of water",
              v: `${RHO_WATER} kg/m³`,
              from: "water",
            },
            {
              s: <V>σ</V>,
              k: "surface tension",
              v: `${fmt(sigma, 4)} N/m`,
              from: sigma === SIGMA_WATER ? "clean water" : "your slider",
            },
            {
              s: <V>ν</V>,
              k: "viscosity",
              v: `${fmt(water.nu * 1e6, 2)} mm²/s`,
              from: water.nu === NU_WATER ? "clean water" : "your slider",
            },
            {
              s: <V>ε</V>,
              k: "fraction that becomes waves",
              v: `${WAVE_EFFICIENCY}`,
              from: "measured, roughly",
            },
          ].map((x) => (
            <div key={x.k} className="flex items-baseline gap-3">
              <dt className="w-5 shrink-0 font-display text-lg">{x.s}</dt>
              <dd>
                <span className="font-mono text-sm text-primary">{x.v}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {x.k} · {x.from}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <Stage
        n={1}
        title="The fall"
        idea={
          <>
            <p>
              Falling turns height into speed. Notice what is missing from the formula: mass. A
              feather and a cannonball arrive at the same speed.
            </p>
            <p>
              Mass decides what that speed is <em>worth</em>. Energy is what the water must absorb,
              and only a small slice of it — about {WAVE_EFFICIENCY * 100}% — leaves as waves. The
              rest goes into spray, sound and churn.
            </p>
          </>
        }
        math={
          <>
            <Work
              name={<V>v</V>}
              rows={[
                <>√(2gh)</>,
                <>
                  √(2 × {G} × {fmt(h)})
                </>,
                <>{fmt(im.v)} m/s</>,
              ]}
            />
            <Work
              name={<V>E</V>}
              rows={[
                <>mgh</>,
                <>
                  {fmt(m, 3)} × {G} × {fmt(h)}
                </>,
                <>{fmt(im.energy)} J</>,
              ]}
            />
            <Work
              name={
                <>
                  <V>εE</V>
                </>
              }
              rows={[
                <>
                  {WAVE_EFFICIENCY} × {fmt(im.energy)}
                </>,
                <>{fmt(im.waveEnergy, 3)} J as waves</>,
              ]}
            />
            <Levers
              items={[
                { k: "twice as wide", v: "no change — speed and energy ignore size" },
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
        idea={
          <>
            <p>
              Two things limit how wide the crater gets. It can never be narrower than the object.
              And it can never be wider than the energy can pay for, because opening a cavity means
              lifting water out of it — that is where <V>E</V>/<V>ρg</V> comes from.
            </p>
            <p>
              The larger limit wins.{" "}
              {sizeLimited
                ? "Right now the object's own width is binding: it is too big and slow to dig deeper than itself."
                : "Right now energy is binding: it is small and fast enough to open a hole wider than itself."}
            </p>
          </>
        }
        math={
          <>
            <Work
              name={<V>R</V>}
              rows={[
                <>
                  max( r, ½(E/ρg)<Sup>¼</Sup> )
                </>,
                <>
                  max( {fmt(r * 100)}, ½({fmt(im.energy)}/{RHO_WATER * G})<Sup>¼</Sup> × 100 ) cm
                </>,
                <>
                  max( {fmt(r * 100)}, {fmt(energyLimit * 100)} ) = {fmt(im.craterRadius * 100)} cm
                </>,
              ]}
            />
            <Note>
              The fourth root is why weight barely matters here: it takes sixteen times the energy
              to double the hole.
            </Note>
            <Levers
              items={[
                {
                  k: "twice as wide",
                  v: shift(im.craterRadius * 100, wider.craterRadius * 100, "cm"),
                },
                {
                  k: "twice as heavy",
                  v: shift(im.craterRadius * 100, heavier.craterRadius * 100, "cm"),
                },
              ]}
            />
          </>
        }
      />

      <Stage
        n={3}
        title="The wave that comes out"
        idea={
          <>
            <p>
              The crater collapses and its rim sets the size of the wave that leaves: one full wave,
              crest to crest, spans about the width of the hole that made it.
            </p>
            <p>
              From here on the working uses the <em>wavenumber</em> <V>k</V> instead of the
              wavelength — it counts radians of wave per metre. Long swells have small <V>k</V>;
              fine ripples have large <V>k</V>.
            </p>
          </>
        }
        math={
          <>
            <Work
              name={<V>λ</V>}
              rows={[
                <>2R</>,
                <>2 × {fmt(im.craterRadius * 100)} cm</>,
                <>{fmt(im.wavelength * 100)} cm</>,
              ]}
            />
            <Work
              name={<V>k</V>}
              rows={[<>2π/λ</>, <>2π / {fmt(im.wavelength, 4)}</>, <>{fmt(im.k, 1)} rad/m</>]}
            />
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
        idea={
          <>
            <p>
              Water is <em>dispersive</em>: speed depends on wavelength, so one splash spreads into
              a train rather than a single hoop. Two forces compete. Gravity (<V>gk</V>) pulls long
              waves along fastest; surface tension (<V>σk</V>
              <Sup>3</Sup>/<V>ρ</V>) pushes short ones fastest.
            </p>
            <p>
              They trade places at <V>λ</V> = {fmt(lambdaMin * 100)} cm, where water is at its
              slowest — {fmt(minimumSpeed(water))} m/s. Crests move at <V>c</V>; the visible ring
              moves at <V>c</V>
              <Sub>g</Sub>, which is slower, so crests appear at the back of the group, run forward
              through it and vanish off the front.
            </p>
          </>
        }
        math={
          <>
            <Work
              name={<V>ω</V>}
              rows={[
                <>
                  √(gk + σk<Sup>3</Sup>/ρ)
                </>,
                <>
                  √({G}×{fmt(im.k, 1)} + {fmt(sigma, 4)}×{fmt(im.k, 1)}
                  <Sup>3</Sup>/{RHO_WATER})
                </>,
                <>{fmt(im.omega, 1)} rad/s</>,
              ]}
            />
            <Work
              name={<V>c</V>}
              rows={[
                <>ω/k</>,
                <>
                  {fmt(im.omega, 1)} / {fmt(im.k, 1)}
                </>,
                <>{fmt(im.phaseSpeed)} m/s</>,
              ]}
            />
            <Work
              name={
                <>
                  <V>c</V>
                  <Sub>g</Sub>
                </>
              }
              rows={[
                <>
                  (g + 3σk<Sup>2</Sup>/ρ) / 2ω
                </>,
                <>{fmt(im.groupSpeed)} m/s — the speed of the ring you see</>,
              ]}
            />
            <Note>
              {im.regime === "gravity"
                ? `λ = ${fmt(im.wavelength * 100)} cm is longer than ${fmt(lambdaMin * 100)} cm, so gravity rules: bigger waves go faster.`
                : `λ = ${fmt(im.wavelength * 100)} cm is shorter than ${fmt(lambdaMin * 100)} cm, so surface tension rules: smaller waves go faster.`}{" "}
              One oscillation takes <V>T</V> = 2π/ω = {fmt(im.period, 3)} s.
            </Note>
          </>
        }
      />

      <Stage
        n={5}
        title="How tall, and how long it rings"
        idea={
          <>
            <p>
              The wave energy spreads over the first ring, an area of about 2<V>πRλ</V>. Set the
              energy equal to the ½<V>ρgA</V>
              <Sup>2</Sup> it takes to lift that much water, and the crest height falls out.
            </p>
            <p>
              Then viscosity drains it, and the rate goes as <V>k</V>
              <Sup>2</Sup> — halve the wavelength and it dies four times faster. That is why a pond
              keeps its long swell but loses its fine texture at once.
            </p>
          </>
        }
        math={
          <>
            <Work
              name={<V>A</V>}
              rows={[
                <>√( 2εE / ρg·2πRλ )</>,
                <>
                  √( 2×{fmt(im.waveEnergy, 3)} / ({RHO_WATER * G} × {fmt(ringArea, 4)}) )
                </>,
                <>
                  {fmt(im.amplitude, 4)} m = {fmt(im.amplitude * 1000)} mm
                </>,
              ]}
            />
            <Work
              name={<V>γ</V>}
              rows={[
                <>
                  2νk<Sup>2</Sup>
                </>,
                <>
                  2 × {fmt(water.nu * 1e6, 2)}e−6 × {fmt(im.k, 1)}
                  <Sup>2</Sup>
                </>,
                <>{fmt(im.decay, 4)} per second</>,
              ]}
            />
            <Note>
              Amplitude halves every ln2/<V>γ</V> = {fmt(halfLife, 1)} s from viscosity alone —
              before that, spreading out over a wider and wider ring has already thinned it.
            </Note>
            <Levers
              items={[
                {
                  k: "twice as heavy",
                  v: shift(im.amplitude * 1000, heavier.amplitude * 1000, "mm"),
                },
                {
                  k: "twice as wide",
                  v: `${shift(im.amplitude * 1000, wider.amplitude * 1000, "mm")} — same energy, longer ring`,
                },
              ]}
            />
          </>
        }
      />

      <Stage
        n={6}
        title="The splash, and what happens next"
        idea={
          <>
            <p>
              Whether the crown tears into droplets is a contest between inertia, flinging water
              outward, and surface tension, holding the sheet together. Below about <V>We</V> = 50
              the skin holds; above it the rim breaks into beads, and every bead that falls back
              starts a ripple of its own.
            </p>
            <p>
              Then it is simply a question of density.{" "}
              {im.floats
                ? "This one floats, so it keeps bobbing and radiating long after the splash."
                : "This one sinks, and the surface is left to ring down alone."}
            </p>
          </>
        }
        math={
          <>
            <Work
              name={<V>We</V>}
              rows={[
                <>
                  ρv<Sup>2</Sup>r/σ
                </>,
                <>
                  {RHO_WATER} × {fmt(im.v)}
                  <Sup>2</Sup> × {fmt(r, 3)} / {fmt(sigma, 4)}
                </>,
                <>
                  {fmt(im.weber, 0)} —{" "}
                  {im.droplets > 0 ? `about ${im.droplets} droplets` : "no droplets"}
                </>,
              ]}
            />
            <Work
              name={
                <>
                  <V>ρ</V>
                  <Sub>o</Sub>
                </>
              }
              rows={[
                <>
                  m / (⁴⁄₃πr<Sup>3</Sup>)
                </>,
                <>
                  {fmt(m, 3)} / {fmt(im.volume, 5)}
                </>,
                <>
                  {fmt(im.density, 0)} kg/m³ — {im.floats ? "floats" : "sinks"}
                </>,
              ]}
            />
            {im.floats && (
              <Note>
                It sits {fmt(im.submerged * 100, 0)}% submerged and bobs at{" "}
                {fmt(im.bobOmega / (2 * Math.PI))} Hz, set by the width of its waterline, not of its
                equator.
              </Note>
            )}
          </>
        }
      />

      {/* The solver */}
      <section className="glass p-6 md:p-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Step 7 · under the hood
        </p>
        <h3 className="mt-2 font-display text-2xl font-light">
          What the simulation actually solves
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The six steps above are closed-form estimates for a single ripple. The water on screen is
          not drawn from them — it is integrated, cell by cell, from one equation for the surface
          height <V>η</V>. Each term buys one behaviour you can see.
        </p>
        <div className="mt-5 rounded-xl bg-secondary/35 p-5 text-center">
          <p className="font-display text-2xl leading-snug md:text-[1.75rem]">
            <V>η</V>
            <Sub>tt</Sub> = ∇·( <V>c</V>
            <Sup>2</Sup>(<V>η</V>)∇<V>η</V> ) − <V>β</V>∇<Sup>4</Sup>
            <V>η</V> + <V>ν</V>∇<Sup>2</Sup>
            <V>η</V>
            <Sub>t</Sub>
          </p>
        </div>
        <dl className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            {
              t: "transport, nonlinear",
              f: (
                <>
                  <V>c</V>
                  <Sup>2</Sup>(<V>η</V>) = <V>c</V>
                  <Sup>2</Sup>(1 + <V>αη</V>)
                </>
              ),
              d: "Wave speed depends on the height of the water it passes through, so crests travel faster than troughs. That is why two rings interact where they meet instead of sliding through each other untouched.",
            },
            {
              t: "dispersion",
              f: (
                <>
                  −<V>β</V>∇<Sup>4</Sup>
                  <V>η</V>
                </>
              ),
              d: "Stiffens short waves so they outrun long ones, as surface tension does in step 4. Without it every impact would leave one lonely hoop instead of a spreading train.",
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
              d: "Drains the surface at a rate climbing with k², so fine chop dies in moments and the long swell rolls on — the same selectivity as γ in step 5.",
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
          One rule sits on top. Real water spills when a crest gets too <em>steep</em> — not too
          tall, too steep — so any crest past the slope limit sheds its excess as foam. A crest that
          suddenly loses height is itself a new disturbance, and it radiates. That is a new wave,
          born from an old one breaking.
        </p>
      </section>

      {/* Everything, in one place */}
      <section className="glass p-6 md:p-7">
        <h3 className="font-display text-xl font-light">Every number, in one place</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4 font-normal">symbol</th>
                <th className="pb-2 pr-4 font-normal">what it is</th>
                <th className="pb-2 pr-4 font-normal">value</th>
                <th className="pb-2 font-normal">from</th>
              </tr>
            </thead>
            <tbody className="align-baseline">
              {[
                [<V key="v">v</V>, "impact speed", `${fmt(im.v)} m/s`, "step 1"],
                [<V key="E">E</V>, "impact energy", `${fmt(im.energy)} J`, "step 1"],
                [<V key="R">R</V>, "cavity radius", `${fmt(im.craterRadius * 100)} cm`, "step 2"],
                [<V key="l">λ</V>, "wavelength", `${fmt(im.wavelength * 100)} cm`, "step 3"],
                [<V key="k">k</V>, "wavenumber", `${fmt(im.k, 1)} rad/m`, "step 3"],
                [<V key="w">ω</V>, "angular frequency", `${fmt(im.omega, 1)} rad/s`, "step 4"],
                [<V key="T">T</V>, "wave period", `${fmt(im.period, 3)} s`, "step 4"],
                [<V key="c">c</V>, "crest speed", `${fmt(im.phaseSpeed)} m/s`, "step 4"],
                [
                  <span key="cg">
                    <V>c</V>
                    <Sub>g</Sub>
                  </span>,
                  "speed of the ring",
                  `${fmt(im.groupSpeed)} m/s`,
                  "step 4",
                ],
                [<V key="A">A</V>, "crest height", `${fmt(im.amplitude * 1000)} mm`, "step 5"],
                [<V key="g2">γ</V>, "viscous decay", `${fmt(im.decay, 4)} /s`, "step 5"],
                [<V key="We">We</V>, "splash number", `${fmt(im.weber, 0)}`, "step 6"],
                [
                  <span key="ro">
                    <V>ρ</V>
                    <Sub>o</Sub>
                  </span>,
                  "object density",
                  `${fmt(im.density, 0)} kg/m³`,
                  "step 6",
                ],
              ].map((row, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-2 pr-4 font-display text-base">{row[0]}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{row[1] as string}</td>
                  <td className="py-2 pr-4 font-mono text-primary">{row[2] as string}</td>
                  <td className="py-2 font-mono text-[11px] text-muted-foreground">
                    {row[3] as string}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Scaling laws are simplified for illustration; the tank is 1.6 m across.
        </p>
      </section>
    </div>
  );
}
