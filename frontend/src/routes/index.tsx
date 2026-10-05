import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ObjectDial } from "@/components/object-dial";
import { PhysicsGuide } from "@/components/physics-guide";
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

type WaveImpact = { x: number; startedAt: number };

function WaveFigure() {
  const [impact, setImpact] = useState<WaveImpact | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!impact) return;
    let frame = 0;
    const animate = () => {
      const age = (performance.now() - impact.startedAt) / 1000;
      if (age >= 6) {
        setImpact(null);
        setElapsed(0);
        return;
      }
      setElapsed(age);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [impact]);

  const wavePath = useMemo(() => {
    if (!impact) return "M20 132H540";
    const points: string[] = [];
    for (let x = 20; x <= 540; x += 4) {
      const distance = Math.abs(x - impact.x);
      const arrival = elapsed - distance / 155;
      const height =
        arrival > 0
          ? 52 *
            Math.exp(-distance / 220) *
            Math.exp(-arrival * 0.38) *
            Math.cos(arrival * 10 - distance * 0.115)
          : 0;
      points.push(`${x === 20 ? "M" : "L"}${x.toFixed(1)} ${(132 - height).toFixed(1)}`);
    }
    return points.join(" ");
  }, [elapsed, impact]);

  const dropObject = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(20, Math.min(540, ((event.clientX - bounds.left) / bounds.width) * 560));
    setElapsed(0);
    setImpact({ x, startedAt: performance.now() });
  };

  const isWaving = Boolean(impact);
  const dropY = impact ? Math.min(108, 18 + elapsed * 240) : 18;

  return (
    <figure className="wave-figure" aria-labelledby="wave-figure-caption">
      <div className="wave-figure__topline">
        <span>Wave equation</span>
        <span>{isWaving ? `t = ${elapsed.toFixed(2)} s` : "surface at rest"}</span>
      </div>
      <svg
        className="wave-figure__surface"
        viewBox="0 0 560 260"
        role="img"
        aria-label="Interactive water surface. Click to drop an object and create a cosine ripple."
        onClick={dropObject}
      >
        <defs>
          <linearGradient id="wave-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="var(--primary)" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="var(--primary)" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0.24" />
          </linearGradient>
          <linearGradient id="wave-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--primary)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="wave-figure__grid" aria-hidden="true">
          <path d="M20 48H540M20 104H540M20 160H540M20 216H540" />
          <path d="M52 24V228M164 24V228M276 24V228M388 24V228M500 24V228" />
        </g>
        <path className="wave-figure__baseline" d="M20 132H540" />
        <path className="wave-figure__fill" d={`${wavePath} L540 228 L20 228Z`} />
        <path className={`wave-figure__line ${isWaving ? "is-active" : ""}`} d={wavePath} />
        <g className={`wave-figure__measure ${isWaving ? "is-visible" : ""}`} aria-hidden="true">
          <path d="M124 132V61M116 61H132M116 132H132M124 222H348M124 214V230M348 214V230" />
          <text x="139" y="100">
            A
          </text>
          <text x="224" y="247">
            λ
          </text>
        </g>
        <g className={`wave-figure__phasor ${isWaving ? "is-visible" : ""}`} aria-hidden="true">
          <circle cx="482" cy="58" r="25" />
          <path className="wave-figure__phasor-axis" d="M450 58H514M482 26V90" />
          <g className="wave-figure__phasor-arm">
            <path d="M482 58L507 58" />
            <circle cx="507" cy="58" r="3" />
          </g>
          <text x="452" y="108">
            cos ωt
          </text>
        </g>
        {impact && (
          <g className="wave-figure__drop" aria-hidden="true">
            <line x1={impact.x} x2={impact.x} y1="20" y2={dropY - 9} />
            <circle cx={impact.x} cy={dropY} r="7" />
          </g>
        )}
        {!impact && (
          <text className="wave-figure__prompt" x="280" y="116">
            click the surface to make a wave
          </text>
        )}
      </svg>
      <figcaption id="wave-figure-caption">
        <span className="wave-figure__equation">η(x,t) = A cos(kx − ωt)</span>
        <span className="wave-figure__legend">
          <i /> {isWaving ? "cosine ripple" : "click to drop"}
        </span>
      </figcaption>
    </figure>
  );
}

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
      <header className="lab-hero mb-8">
        <div className="lab-hero__glow" aria-hidden="true" />
        <div className="relative max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-primary">
              <span className="h-px w-8 bg-primary/75" />
              Ripple Lab
            </p>
            <span className="lab-hero__status">
              <span className="lab-hero__status-dot" />
              Interactive wave model
            </span>
          </div>

          <div className="mt-7 grid items-center gap-8 md:grid-cols-[minmax(0,0.95fr)_minmax(300px,0.8fr)] md:gap-8 lg:gap-10">
            <div>
              <h1 className="max-w-3xl font-display text-5xl leading-[0.94] font-light tracking-[-0.035em] md:text-6xl lg:text-7xl">
                The mathematics of a <em className="font-normal text-primary">splash</em>
              </h1>
              <p className="mt-7 max-w-2xl border-t border-border/80 pt-5 text-base leading-7 text-muted-foreground md:text-lg">
                Tune an object&apos;s size, mass, and drop height, then send it into the water.
                Watch a live nonlinear wave field turn impact into ripples, collisions, and breaking
                crests.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <span className="lab-hero__tag">Nonlinear</span>
                <span className="lab-hero__tag">Dispersive</span>
                <span className="lab-hero__tag">Real time</span>
              </div>
            </div>
            <WaveFigure />
          </div>
        </div>
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

      <PhysicsGuide object={object} water={water} im={im} />
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
