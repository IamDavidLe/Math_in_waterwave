import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { ObjectDial } from "@/components/object-dial";
import { RipplePool, type PoolStats, type SolverControls } from "@/components/ripple-pool";
import {
  G,
  NU_WATER,
  RHO_WATER,
  SIGMA_WATER,
  WAVE_EFFICIENCY,
  impactOf,
  minimumSpeed,
  minimumWavelength,
  type WaterParams,
} from "@/lib/water-physics";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ripple Lab — The Math of Water Waves" },
      {
        name: "description",
        content:
          "Resize and reweigh an object, drop it in, and watch dispersive ripples collide, break and spawn new waves — with every equation computed live.",
      },
      { property: "og:title", content: "Ripple Lab — The Math of Water Waves" },
      {
        property: "og:description",
        content:
          "Nonlinear water-wave sandbox: size, weight and surface tension shape the ripples.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const SPHERE = (r: number) => (4 / 3) * Math.PI * r ** 3;

const OBJECTS = [
  { name: "Raindrop", mass: 5e-5, radius: 0.002 },
  { name: "Marble", mass: 0.005, radius: 0.008 },
  { name: "Pebble", mass: 0.02, radius: 0.012 },
  { name: "Golf ball", mass: 0.046, radius: 0.021 },
  { name: "Apple", mass: 0.18, radius: 0.04 },
  { name: "Brick", mass: 2.5, radius: 0.09 },
  { name: "Bowling ball", mass: 6.5, radius: 0.11 },
  { name: "Beach ball", mass: 0.15, radius: 0.16 },
];

/** kg/m³ — picking one keeps weight tied to size as you resize. */
const MATERIALS = [
  { name: "Cork", rho: 240 },
  { name: "Pine", rho: 500 },
  { name: "Ice", rho: 917 },
  { name: "Rubber", rho: 1100 },
  { name: "Glass", rho: 2500 },
  { name: "Granite", rho: 2700 },
  { name: "Steel", rho: 7850 },
  { name: "Lead", rho: 11340 },
];

const fmt = (x: number, d = 3) =>
  !Number.isFinite(x)
    ? "∞"
    : Math.abs(x) >= 10000 || (Math.abs(x) < 0.001 && x !== 0)
      ? x.toExponential(2)
      : x.toFixed(d);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function Index() {
  const [radius, setRadius] = useState(0.04);
  const [mass, setMass] = useState(0.18);
  const [dropHeight, setDropHeight] = useState(1);
  /** when a material is chosen, weight follows size */
  const [material, setMaterial] = useState<string | null>(null);

  const [sigma, setSigma] = useState(SIGMA_WATER);
  const [nuMult, setNuMult] = useState(1);
  const [nonlinearity, setNonlinearity] = useState(0.7);
  const [reflect, setReflect] = useState(true);
  const [breaking, setBreaking] = useState(true);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState<PoolStats | null>(null);

  const water: WaterParams = useMemo(() => ({ sigma, nu: NU_WATER * nuMult }), [sigma, nuMult]);
  const object = useMemo(() => ({ mass, radius, dropHeight }), [mass, radius, dropHeight]);
  const im = useMemo(() => impactOf(object, water), [object, water]);

  const solver: SolverControls = useMemo(
    () => ({
      // Surface tension is what stiffens short waves, so it drives the ∇⁴ term.
      capillarity: clamp01((sigma / SIGMA_WATER) * 0.6),
      viscosity: clamp01(0.3 + 0.3 * Math.log10(nuMult)),
      nonlinearity,
      reflect,
      breaking,
    }),
    [sigma, nuMult, nonlinearity, reflect, breaking],
  );

  /** Resizing keeps the chosen material's density, so weight tracks volume. */
  const applyRadius = (r: number) => {
    setRadius(r);
    const m = MATERIALS.find((x) => x.name === material);
    if (m) setMass(m.rho * SPHERE(r));
  };

  const pickMaterial = (name: string, rho: number) => {
    setMaterial(name);
    setMass(rho * SPHERE(radius));
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:py-12">
      <header className="mb-8 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Ripple Lab</p>
        <h1 className="mt-2 font-display text-4xl leading-tight font-light md:text-6xl">
          The mathematics of a <em className="text-primary">splash</em>
        </h1>
        <p className="mt-3 text-muted-foreground">
          Size and weigh an object, then click the water to drop it. The surface is integrated as a
          nonlinear, dispersive wave field — so ripples outrun each other, collide, break, and throw
          off new waves of their own.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="space-y-6">
          <RipplePool
            object={object}
            water={water}
            solver={solver}
            paused={paused}
            onStats={setStats}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Live k="waves born from breaking crests" v={stats ? `${stats.breaks}` : "—"} />
            <Live k="droplets that fell back in" v={stats ? `${stats.splashbacks}` : "—"} />
            <Live k="spray in the air" v={stats ? `${stats.airborne}` : "—"} />
            <Live k="since impact" v={stats ? `${stats.age.toFixed(1)} s` : "—"} />
          </div>
        </section>

        <aside className="space-y-4">
          <div className="glass space-y-4 p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-xl">Object</h2>
              <button
                onClick={() => setPaused((p) => !p)}
                className="rounded-full border px-3 py-1 font-mono text-[11px] transition-colors hover:bg-secondary"
              >
                {paused ? "resume" : "freeze"}
              </button>
            </div>
            <ObjectDial
              radius={radius}
              mass={mass}
              density={im.density}
              floats={im.floats}
              onRadius={applyRadius}
              min={0.001}
              max={0.22}
            />
            <Range
              label="Radius r"
              value={radius}
              unit="cm"
              display={(radius * 100).toFixed(radius < 0.01 ? 2 : 1)}
              min={-3}
              max={-0.66}
              log
              onChange={applyRadius}
            />
            <Range
              label="Mass m"
              value={mass}
              unit={mass >= 1 ? "kg" : "g"}
              display={mass >= 1 ? mass.toFixed(2) : (mass * 1000).toFixed(mass < 0.01 ? 2 : 0)}
              min={-5}
              max={1.5}
              log
              onChange={(v) => {
                setMass(v);
                setMaterial(null);
              }}
            />
            <Range
              label="Drop height h"
              value={dropHeight}
              unit="m"
              display={dropHeight.toFixed(2)}
              min={0.02}
              max={5}
              onChange={setDropHeight}
            />
            <Chips
              title="Made of"
              items={MATERIALS.map((m) => ({
                key: m.name,
                label: m.name,
                active: material === m.name,
              }))}
              onPick={(key) => {
                const m = MATERIALS.find((x) => x.name === key)!;
                pickMaterial(m.name, m.rho);
              }}
            />
            <Chips
              title="Or grab something"
              items={OBJECTS.map((o) => ({
                key: o.name,
                label: o.name,
                active: Math.abs(o.mass - mass) < 1e-9 && Math.abs(o.radius - radius) < 1e-9,
              }))}
              onPick={(key) => {
                const o = OBJECTS.find((x) => x.name === key)!;
                setMaterial(null);
                setRadius(o.radius);
                setMass(o.mass);
              }}
            />
          </div>

          <div className="glass space-y-4 p-5">
            <h2 className="font-display text-xl">Water &amp; solver</h2>
            <Range
              label="Surface tension σ"
              value={sigma}
              unit="N/m"
              display={sigma.toFixed(4)}
              min={0.008}
              max={0.14}
              onChange={setSigma}
              note={
                sigma < 0.04
                  ? "soapy — long ripples only"
                  : sigma > 0.1
                    ? "stiff skin — fine fast ripples"
                    : "clean water"
              }
            />
            <Range
              label="Viscosity ν"
              value={nuMult}
              unit="× water"
              display={nuMult.toFixed(nuMult < 1 ? 2 : 1)}
              min={-1}
              max={2}
              log
              onChange={setNuMult}
              note={nuMult > 8 ? "syrupy — ripples die fast" : "ripples ring on"}
            />
            <Range
              label="Nonlinear coupling α"
              value={nonlinearity}
              unit=""
              display={nonlinearity.toFixed(2)}
              min={0}
              max={1}
              onChange={setNonlinearity}
              note={
                nonlinearity < 0.05
                  ? "linear: rings pass straight through each other"
                  : "crests run faster than troughs, so collisions make new waves"
              }
            />
            <div className="flex flex-wrap gap-2">
              <Toggle on={reflect} onClick={() => setReflect((v) => !v)}>
                {reflect ? "tank walls reflect" : "open water"}
              </Toggle>
              <Toggle on={breaking} onClick={() => setBreaking((v) => !v)}>
                {breaking ? "crests may break" : "no breaking"}
              </Toggle>
            </div>
            {stats && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {fmt(stats.frameMs, 1)} ms/frame · 336 × 210 cells · {fmt(1 / 0.0022, 0)} steps/s
              </p>
            )}
          </div>
        </aside>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Eq
          title="1 · Impact velocity"
          f="v = √(2gh)"
          r={`${fmt(im.v)} m/s`}
          note={`momentum p = mv = ${fmt(im.momentum)} kg·m/s`}
        />
        <Eq
          title="2 · Impact energy"
          f="E = mgh"
          r={`${fmt(im.energy)} J`}
          note={`${WAVE_EFFICIENCY * 100}% of it leaves as waves: ${fmt(im.waveEnergy)} J`}
        />
        <Eq
          title="3 · Cavity radius"
          f="R = max(r, ½(E/ρg)^¼)"
          r={`${fmt(im.craterRadius * 100, 2)} cm`}
          note={`the object cannot punch a hole narrower than itself — ${
            im.craterRadius > radius * 1.02 ? "energy sets this one" : "its own size sets this one"
          }`}
        />
        <Eq
          title="4 · Dominant wavelength"
          f="λ ≈ 2R,  k = 2π/λ"
          r={`λ = ${fmt(im.wavelength * 100, 2)} cm`}
          note={`k = ${fmt(im.k, 1)} rad/m · ${im.regime} regime (λ_min = ${fmt(minimumWavelength(water) * 100, 2)} cm)`}
        />
        <Eq
          title="5 · Dispersion relation"
          f="ω² = gk + σk³/ρ"
          r={`ω = ${fmt(im.omega, 1)} rad/s`}
          note={`T = ${fmt(im.period, 3)} s — the k³ term is why short ripples outrun the swell`}
        />
        <Eq
          title="6 · Wave speeds"
          f="c = ω/k,  c_g = dω/dk"
          r={`c = ${fmt(im.phaseSpeed)} · c_g = ${fmt(im.groupSpeed)} m/s`}
          note={`the ring front travels at c_g; no wave can go slower than ${fmt(minimumSpeed(water))} m/s`}
        />
        <Eq
          title="7 · Crest height"
          f="A = √(2εE / ρg·2πRλ)"
          r={`${fmt(im.amplitude * 1000, 2)} mm`}
          note={`energy spread over the first ring; decays as e^(−2νk²t), γ = ${fmt(im.decay, 3)} /s`}
        />
        <Eq
          title="8 · Splash number"
          f="We = ρv²r/σ"
          r={`${fmt(im.weber, 0)}`}
          note={
            im.droplets > 0
              ? `inertia beats surface tension — the crown breaks into ~${im.droplets} droplets, and each one starts a new ripple`
              : "surface tension holds the crown together, so no droplets"
          }
        />
        <Eq
          title="9 · What floats, bobs"
          f="ρ_o = m/(⁴⁄₃πr³),  ω_b = √(ρgπr²/m)"
          r={`ρ_o = ${fmt(im.density, 0)} kg/m³`}
          note={
            im.floats
              ? `lighter than water: it bobs at ${fmt(im.bobOmega / (2 * Math.PI), 2)} Hz and keeps radiating waves`
              : `${fmt(im.density / RHO_WATER, 1)}× denser than water: it sinks and the surface goes quiet`
          }
        />
        <Eq
          title="10 · What the solver integrates"
          f="η_tt = ∇·(c²(η)∇η) − β∇⁴η + ν∇²η_t"
          r="nonlinear · dispersive · damped"
          note="β∇⁴η spreads one impact into a ripple train; c²(η) = c²(1 + αη) makes crests outrun troughs, so two rings meeting exchange energy and radiate new ones instead of passing through. Crests too steep to stand break, shedding foam and a fresh ring."
          wide
        />
      </section>

      <footer className="mt-10 text-center font-mono text-xs text-muted-foreground">
        g = {G} m/s² · ρ_water = {RHO_WATER} kg/m³ · σ_clean = {SIGMA_WATER} N/m · tank 1.6 m across
        · scaling laws simplified for illustration
      </footer>
    </main>
  );
}

function Live({ k, v }: { k: string; v: string }) {
  return (
    <div className="glass p-3">
      <div className="font-mono text-xl text-primary">{v}</div>
      <div className="mt-1 text-[11px] leading-tight text-muted-foreground">{k}</div>
    </div>
  );
}

function Range({
  label,
  value,
  unit,
  display,
  min,
  max,
  log,
  note,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  display: string;
  min: number;
  max: number;
  log?: boolean;
  note?: string;
  onChange: (v: number) => void;
}) {
  const pos = log ? Math.log10(value) : value;
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="font-mono text-primary">
          {display} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 240}
        value={pos}
        onChange={(e) => onChange(log ? 10 ** +e.target.value : +e.target.value)}
      />
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </label>
  );
}

function Chips({
  title,
  items,
  onPick,
}: {
  title: string;
  items: { key: string; label: string; active: boolean }[];
  onPick: (key: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <button
            key={i.key}
            onClick={() => onPick(i.key)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              i.active ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        on ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"
      }`}
    >
      {children}
    </button>
  );
}

function Eq({
  title,
  f,
  r,
  note,
  wide,
}: {
  title: string;
  f: string;
  r: string;
  note: string;
  wide?: boolean;
}) {
  return (
    <div className={`glass animate-fade-in p-5 ${wide ? "lg:col-span-3 md:col-span-2" : ""}`}>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <p className="mt-3 font-display text-2xl italic">{f}</p>
      <p className="mt-2 font-mono text-lg text-primary">{r}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}
