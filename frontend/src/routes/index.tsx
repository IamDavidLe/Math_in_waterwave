import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ripple Lab — The Math of Water Waves" },
      { name: "description", content: "Drop objects into water and watch the live physics: impact energy, dispersion, wavelength and wave speed." },
      { property: "og:title", content: "Ripple Lab — The Math of Water Waves" },
      { property: "og:description", content: "Interactive water ripple simulator with live wave equations driven by object size and weight." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const g = 9.81, RHO = 1000, SIGMA = 0.0728, EPS = 0.05;

const PRESETS = [
  { name: "Raindrop", m: 0.00005, r: 0.002 },
  { name: "Pebble", m: 0.02, r: 0.012 },
  { name: "Apple", m: 0.18, r: 0.04 },
  { name: "Brick", m: 2.5, r: 0.09 },
  { name: "Bowling ball", m: 6.5, r: 0.11 },
];

function physics(m: number, r: number, h: number) {
  const v = Math.sqrt(2 * g * h);
  const E = m * g * h;
  const vol = (4 / 3) * Math.PI * r ** 3;
  const rhoObj = m / vol;
  const Fr = v * v / (g * r);
  const Rc = r * Math.cbrt(Math.max(rhoObj / RHO, 0.05)) * Math.pow(Fr, 0.25); // crater radius
  const lambda = 4 * Rc;
  const k = (2 * Math.PI) / lambda;
  const omega = Math.sqrt(g * k + (SIGMA / RHO) * k ** 3);
  const c = omega / k;
  const cg = (g + (3 * SIGMA * k * k) / RHO) / (2 * omega);
  const A0 = Math.sqrt((2 * EPS * E) / (RHO * g * Math.PI * Rc * lambda));
  const T = (2 * Math.PI) / omega;
  return { v, E, rhoObj, Fr, Rc, lambda, k, omega, c, cg, A0, T, p: m * v };
}
type Phys = ReturnType<typeof physics>;

const fmt = (x: number, d = 3) => (Math.abs(x) >= 1000 || (Math.abs(x) < 0.001 && x !== 0) ? x.toExponential(2) : x.toFixed(d));

function Index() {
  const [m, setM] = useState(0.18);
  const [r, setR] = useState(0.04);
  const [h, setH] = useState(1);
  const [drop, setDrop] = useState<{ phys: Phys; t0: number; x: number; y: number } | null>(null);
  const live = useMemo(() => physics(m, r, h), [m, r, h]);
  const shown = drop?.phys ?? live;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef<{ drop: (x: number, y: number, rad: number, amp: number) => void } | null>(null);
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const pending = useRef<{ x: number; y: number; t: number; rad: number }[]>([]);

  useEffect(() => {
    const cv = canvasRef.current!;
    const W = 240, H = 150;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    let a = new Float32Array(W * H), b = new Float32Array(W * H);
    sim.current = {
      drop: (x, y, rad, amp) => {
        const cx = x * W, cy = y * H;
        for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
          const d2 = i * i + j * j;
          if (d2 > rad * rad) continue;
          const px = Math.round(cx + i), py = Math.round(cy + j);
          if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue;
          a[py * W + px] = a[py * W + px]! - amp * Math.cos((Math.sqrt(d2) / rad) * Math.PI / 2);
        }
      },
    };
    let raf = 0;
    const loop = () => {
      for (let s = 0; s < 2; s++) {
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          b[i] = ((a[i - 1]! + a[i + 1]! + a[i - W]! + a[i + W]!) / 2 - b[i]!) * 0.986;
        }
        [a, b] = [b, a];
      }
      const d = img.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const nx = (a[i - 1] ?? 0) - (a[i + 1] ?? 0);
        const ny = (a[i - W] ?? 0) - (a[i + W] ?? 0);
        const depth = y / H;
        const light = Math.max(0, nx * 0.6 + ny * 0.8);
        const spec = Math.pow(Math.min(light / 30, 1), 2) * 255;
        const caustic = Math.min(Math.abs(a[i]!) * 2, 60);
        d[i * 4] = 8 + depth * 6 + spec * 0.9 + caustic * 0.3;
        d[i * 4 + 1] = 58 + depth * 30 + spec + caustic * 0.8 + ny * 0.6;
        d[i * 4 + 2] = 82 + depth * 40 + spec + caustic + nx * 0.6;
        d[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      // falling objects shadows
      const now = performance.now();
      pending.current = pending.current.filter((p) => {
        const k = (now - p.t) / 450;
        if (k >= 1) return false;
        ctx.fillStyle = `rgba(0,0,0,${0.15 + k * 0.35})`;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.rad * (2 - k), 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      drawGraph();
      raf = requestAnimationFrame(loop);
    };
    const drawGraph = () => {
      const gc = graphRef.current; if (!gc) return;
      const gx = gc.getContext("2d")!;
      const GW = (gc.width = gc.clientWidth * 2), GH = (gc.height = 280);
      gx.clearRect(0, 0, GW, GH);
      gx.strokeStyle = "rgba(200,230,240,0.15)";
      gx.beginPath(); gx.moveTo(0, GH / 2); gx.lineTo(GW, GH / 2); gx.stroke();
      const dr = dropRef.current; if (!dr) return;
      const P = dr.phys;
      const t = (performance.now() - dr.t0) / 1000;
      const Rmax = Math.max(P.lambda * 12, P.cg * t * 1.3, 0.2);
      const gamma = 0.6;
      gx.lineWidth = 3; gx.strokeStyle = "oklch(0.82 0.12 195)";
      gx.beginPath();
      for (let px = 0; px < GW; px++) {
        const rr = (px / GW) * Rmax + 1e-4;
        const front = P.cg * t;
        const env = Math.exp(-(((rr - front) / (P.lambda * 3)) ** 2));
        const eta = P.A0 * Math.sqrt(P.Rc / Math.max(rr, P.Rc)) * Math.exp(-gamma * t) * env * Math.cos(P.k * rr - P.omega * t);
        const y = GH / 2 - (eta / P.A0) * (GH * 0.42);
        px ? gx.lineTo(px, y) : gx.moveTo(px, y);
      }
      gx.stroke();
      gx.fillStyle = "rgba(200,230,240,0.6)"; gx.font = "20px JetBrains Mono";
      gx.fillText(`r → ${Rmax.toFixed(2)} m`, GW - 190, GH - 12);
      gx.fillText(`t = ${t.toFixed(2)} s`, 12, 26);
    };
    loop();
    sim.current.drop(0.5, 0.5, 6, 500);
    const drip = setInterval(() => sim.current?.drop(Math.random(), Math.random(), 1, 60), 900);
    return () => { cancelAnimationFrame(raf); clearInterval(drip); };
  }, []);

  const onDrop = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
    const P = physics(m, r, h);
    const rad = Math.max(1, Math.min(14, Math.round(r * 120)));
    const amp = Math.min(900, 40 + Math.sqrt(P.E) * 120);
    pending.current.push({ x, y, t: performance.now(), rad });
    setTimeout(() => {
      sim.current?.drop(x, y, rad, amp);
      setDrop({ phys: P, t0: performance.now(), x, y });
    }, 450);
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:py-12">
      <header className="mb-8 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Ripple Lab</p>
        <h1 className="mt-2 font-display text-4xl md:text-6xl font-light leading-tight">
          The mathematics of a <em className="text-primary">splash</em>
        </h1>
        <p className="mt-3 text-muted-foreground">Pick an object, set its size and weight, then click the water to drop it. Every number below is computed from that impact.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="space-y-6">
          <div className="glass overflow-hidden p-0">
            <canvas ref={canvasRef} onClick={onDrop} className="block aspect-[8/5] w-full cursor-crosshair" style={{ imageRendering: "auto" }} />
          </div>
          <div className="glass p-5">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-display text-xl">Cross-section η(r, t)</h2>
              <span className="font-mono text-xs text-muted-foreground">{drop ? "last drop" : "drop something to plot"}</span>
            </div>
            <canvas ref={graphRef} className="h-[140px] w-full" />
          </div>
        </section>

        <aside className="glass space-y-5 p-5">
          <div>
            <h2 className="font-display text-xl">Object</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => { setM(p.m); setR(p.r); }}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${m === p.m && r === p.r ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <Slider label="Mass m" value={m} unit="kg" min={-4.3} max={1} log onChange={setM} />
          <Slider label="Radius r" value={r} unit="m" min={-2.7} max={-0.8} log onChange={setR} />
          <Slider label="Drop height h" value={h} unit="m" min={0.05} max={5} onChange={setH} />
          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <Stat k="ρ_obj" v={`${fmt(live.rhoObj, 0)} kg/m³`} />
            <Stat k="E impact" v={`${fmt(live.E)} J`} />
          </div>
          {live.rhoObj < RHO && <p className="text-xs text-accent">Less dense than water — it will float after impact.</p>}
        </aside>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Eq title="1 · Impact velocity" f="v = √(2gh)" r={`= ${fmt(shown.v)} m/s`} note={`momentum p = mv = ${fmt(shown.p)} kg·m/s`} />
        <Eq title="2 · Impact energy" f="E = m g h" r={`= ${fmt(shown.E)} J`} note={`≈${EPS * 100}% of it becomes surface waves`} />
        <Eq title="3 · Crater radius" f="R_c ≈ r (ρ_o/ρ_w)^⅓ Fr^¼" r={`= ${fmt(shown.Rc * 100)} cm`} note={`Froude Fr = v²/(gr) = ${fmt(shown.Fr, 1)}`} />
        <Eq title="4 · Dominant wavelength" f="λ ≈ 4 R_c,  k = 2π/λ" r={`λ = ${fmt(shown.lambda * 100)} cm`} note={`k = ${fmt(shown.k, 1)} rad/m`} />
        <Eq title="5 · Dispersion relation" f="ω² = g k + (σ/ρ) k³" r={`ω = ${fmt(shown.omega)} rad/s`} note={`period T = 2π/ω = ${fmt(shown.T)} s · ${shown.k > 370 ? "capillary (surface-tension) regime" : "gravity regime"}`} />
        <Eq title="6 · Wave speeds" f="c = ω/k,  c_g = dω/dk" r={`c = ${fmt(shown.c)} · c_g = ${fmt(shown.cg)} m/s`} note="the ring front travels at the group speed c_g" />
        <Eq title="7 · Initial amplitude" f="A₀ = √(2εE / (ρ g π R_c λ))" r={`= ${fmt(shown.A0 * 1000)} mm`} note="energy balance: ½ρgA² over the first ring" />
        <Eq title="8 · Ripple profile" f="η = A₀ √(R_c/r) e^(−γt) cos(kr − ωt)" r="cylindrical spreading" note="amplitude falls as 1/√r; viscosity damps by e^(−γt)" wide />
      </section>

      <footer className="mt-10 text-center font-mono text-xs text-muted-foreground">
        g = 9.81 m/s² · ρ_water = 1000 kg/m³ · σ = 0.0728 N/m · simplified scaling laws for illustration
      </footer>
    </main>
  );
}

function Slider({ label, value, unit, min, max, log, onChange }: { label: string; value: number; unit: string; min: number; max: number; log?: boolean; onChange: (v: number) => void }) {
  const pos = log ? Math.log10(value) : value;
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-primary">{fmt(value)} {unit}</span>
      </div>
      <input type="range" min={min} max={max} step={(max - min) / 200} value={pos}
        onChange={(e) => onChange(log ? 10 ** +e.target.value : +e.target.value)} />
    </label>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-secondary p-2">
      <div className="text-muted-foreground">{k}</div>
      <div className="text-foreground">{v}</div>
    </div>
  );
}

function Eq({ title, f, r, note, wide }: { title: string; f: string; r: string; note: string; wide?: boolean }) {
  return (
    <div className={`glass p-5 animate-fade-in ${wide ? "lg:col-span-2" : ""}`}>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{title}</p>
      <p className="mt-3 font-display text-2xl italic">{f}</p>
      <p className="mt-2 font-mono text-lg text-primary">{r}</p>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
