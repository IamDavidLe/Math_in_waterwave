import { useEffect, useRef, useState } from "react";

import { MATERIAL_LOOKS, drawObject } from "@/lib/object-looks";
import { impactOf } from "@/lib/water-physics";
import { WaterSim } from "@/lib/water-sim";

/** How long the splash plays before the page is uncovered. */
const HOLD_MS = 1750;
/** How long the cover takes to clear. */
const FADE_MS = 850;

const LOOK = MATERIAL_LOOKS["Steel"]!;
const OBJECT = { mass: 1.4, radius: 0.05, dropHeight: 2.2 };

/**
 * The landing animation: a steel ball falls into dark water, and the ripple it
 * throws off opens out into the page. It is the product's own solver doing it —
 * not a canned clip — so the first thing anyone sees is the real thing.
 *
 * It can be skipped with a click or any key, it never blocks the page beneath
 * for more than two seconds, and anyone who has asked their system for less
 * motion never sees it at all.
 */
export function IntroSplash() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);

  // One exit, however it is triggered.
  const dismiss = useRef(() => {});
  dismiss.current = () => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    window.setTimeout(() => setGone(true), FADE_MS);
  };

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done.current = true;
      setGone(true);
      return;
    }

    const skip = () => dismiss.current();
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    const timer = window.setTimeout(() => dismiss.current(), HOLD_MS);

    const cv = canvasRef.current;
    if (!cv) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const W = 400;
    const H = Math.max(160, Math.min(520, Math.round((W * vh) / Math.max(vw, 1))));
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d", { alpha: false })!;
    const img = g.createImageData(W, H);
    const px = img.data;

    const sim = new WaterSim({
      width: W,
      height: H,
      metersAcross: 1.9,
      reflect: false, // open water: nothing bounces back during the intro
      viscosity: 0.3,
    });
    const impact = impactOf(OBJECT);
    const body = sim.drop(0.5, 0.42, impact, LOOK.id);

    let raf = 0;
    const started = performance.now();
    const frame = () => {
      sim.step(2);
      const eta = sim.cur;
      const foam = sim.foam;

      // Exposure from the water itself, as the pool does.
      let sum = 0;
      let n = 0;
      for (let y = 2; y < H - 2; y += 3) {
        const row = y * W;
        for (let x = 2; x < W - 2; x += 3) {
          sum += Math.abs(eta[row + x - 1]! - eta[row + x + 1]!);
          n++;
        }
      }
      const gain = Math.min(90, Math.max(8, 1.9 * Math.pow(1 / Math.max(sum / n, 1e-7), 0.6)));

      for (let y = 1; y < H - 1; y++) {
        const row = y * W;
        for (let x = 1; x < W - 1; x++) {
          const i = row + x;
          const gx = (eta[i - 1]! - eta[i + 1]!) * gain;
          const gy = (eta[i - W]! - eta[i + W]!) * gain;
          const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
          const nx = -gx * inv;
          const ny = -gy * inv;

          const focus = eta[i - 1]! + eta[i + 1]! + eta[i - W]! + eta[i + W]! - 4 * eta[i]!;
          let caustic = focus > 0 ? focus * 60 * gain : focus * 22 * gain;
          if (caustic > 70) caustic = 70;
          else if (caustic < -70) caustic = -70;

          const grazing = 1 - inv;
          const g2 = grazing * grazing;
          const fres = 0.03 + 0.9 * g2 * g2 * grazing;

          const nh = nx * -0.2873 + ny * -0.4598 + inv * 0.8405;
          let spec = 0;
          if (nh > 0) {
            const t2 = nh * nh;
            const t4 = t2 * t2;
            const t8 = t4 * t4;
            const t16 = t8 * t8;
            const t32 = t16 * t16;
            spec = t32 * t32 * 120 * Math.min(1, 40 / gain);
          }

          // Deep, lit from above — no pool floor, just dark water.
          const depth = 1 - y / H;
          const fo = foam[i]!;
          const fw = fo * fo * 120;
          const o = i * 4;
          px[o]! = 6 + depth * 5 + fres * 70 + caustic * 0.3 + spec * 0.85 + fw;
          px[o + 1]! = 24 + depth * 16 + fres * 130 + caustic * 0.75 + spec + fw * 1.05;
          px[o + 2]! = 34 + depth * 24 + fres * 160 + caustic + spec + fw * 1.1;
          px[o + 3]! = 255;
        }
      }
      g.putImageData(img, 0, 0);

      // The ball itself, falling and then afloat.
      const sx = W / sim.w;
      const r = Math.max(4, (impact.craterRadius / sim.metersPerCell) * 0.6 * sx);
      if (body.state === "falling") {
        const near = 1 - Math.min(1, body.z / OBJECT.dropHeight);
        g.fillStyle = `rgba(2,10,16,${0.12 + near * 0.3})`;
        g.beginPath();
        g.ellipse(
          body.x * sx,
          body.y * sx,
          r * (2.6 - near * 1.4),
          r * (1.7 - near * 0.9),
          0,
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      const lift = body.state === "falling" ? (body.z * (H * 0.42)) / OBJECT.dropHeight : 0;
      const sink = body.state === "sinking" ? Math.min(1, -body.z / 0.35) : 0;
      if (sink < 1) {
        drawObject(
          g,
          LOOK,
          body.x * sx,
          body.y * sx - lift,
          r * (1 + (body.state === "falling" ? body.z * 0.25 : 0)) * (1 - sink * 0.5),
          {
            alpha: 1 - sink,
          },
        );
      }
      for (const d of sim.droplets) {
        g.fillStyle = `rgba(226,244,252,${0.5 + Math.min(0.4, Math.max(0, d.z) * 6)})`;
        g.beginPath();
        g.arc(
          d.x * sx,
          d.y * sx - Math.max(0, d.z) * H * 0.5,
          Math.max(0.8, d.r * sx),
          0,
          Math.PI * 2,
        );
        g.fill();
      }

      if (performance.now() - started < HOLD_MS + FADE_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, []);

  if (gone) return null;

  return (
    <>
      {/* The cover is cleared by script. Without script it would sit over the
          page forever, so hide it outright in that case. */}
      <noscript>
        <style>{`.intro-cover{display:none!important}`}</style>
      </noscript>
      <div
        aria-hidden="true"
        className="intro-cover fixed inset-0 z-50 overflow-hidden bg-[#06111a]"
        style={{
          opacity: leaving ? 0 : 1,
          // The ripple opens outward as it clears, so the page arrives through it.
          transform: leaving ? "scale(1.06)" : "scale(1)",
          transition: `opacity ${FADE_MS}ms ease-out, transform ${FADE_MS}ms ease-out`,
          pointerEvents: leaving ? "none" : "auto",
        }}
      >
        <canvas ref={canvasRef} className="h-full w-full object-cover" />
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
          style={{
            opacity: leaving ? 0 : 1,
            transition: `opacity ${FADE_MS / 2}ms ease-out`,
          }}
        >
          <p className="font-mono text-xs uppercase tracking-[0.4em] text-primary">Ripple Lab</p>
          <h1 className="font-display text-4xl font-light text-foreground md:text-6xl">
            The mathematics of a <em className="text-primary">splash</em>
          </h1>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            click to skip
          </p>
        </div>
      </div>
    </>
  );
}
