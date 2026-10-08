import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { buildProfile, makeProfile, type Profile, type Source } from "@/lib/ripple-field";
import {
  CHAPTERS,
  RADIUS,
  SPAN,
  STARTS,
  out3,
  periodAt,
  sceneAt,
  scrubPhase,
  split,
  toChapterSpace,
  track,
  win,
} from "@/lib/ripple-scene";
import { drawWater, exposureFor, type Exposure } from "@/lib/ripple-render";
import { drawOverlay, phaseSpeed, type View } from "@/lib/ripple-overlay";

/**
 * The overture: the whole investigation told once, in motion, as you scroll.
 *
 * One tall track holds a sticky stage. Scrolling past the track does not move
 * the stage — it moves a single number, and that number is the film. Every
 * chapter below is a window on it: the camera, the size of the thing falling in,
 * which overlays are drawn and how far each card has arrived are all read off
 * the same value, so the picture at a given scroll position is always the same
 * picture, forwards or backwards.
 *
 * The water is not a decoration bolted on beside the argument — it *is* the
 * argument, drawn from the closed-form ripple in `ripple-field.ts`. When the
 * film claims the cut through the rings is a cosine, the cosine on screen is the
 * same Float32Array the water behind it was shaded from.
 */

/* ── the one number ───────────────────────────────────────────────────────────
   Scrolling sets `target`; `current` chases it so a flick of the wheel arrives
   as a glide rather than a jump. React subscribes to it, but the canvas reads it
   straight out of the loop — a redraw a frame is not something to route through
   a render. */

const flow = { target: 0, current: 0, clock: 0, phase: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The chapter id, for anything that only cares which chapter we are in. */
function useStage(): string {
  return useSyncExternalStore(
    subscribe,
    () => split(flow.current).id,
    () => CHAPTERS[0]!.id,
  );
}

/** The full value, for anything that animates continuously with the scroll. */
function useFlow(): number {
  return useSyncExternalStore(
    subscribe,
    () => flow.current,
    () => 0,
  );
}

/** The numbers the cards quote, so they always agree with the water. */
function readoutAt(f: number) {
  const radius = track(f, RADIUS);
  const lambda = 2 * radius;
  return { radius, lambda, c: phaseSpeed(lambda) };
}

/* ── the canvas ───────────────────────────────────────────────────────────────
   One rAF loop owns everything: it advances the clock, chases the scroll,
   rebuilds the radial tables, shades the water and draws the marks. React is
   told the flow has moved so the cards can follow, but nothing about a frame
   goes through a render. */

function Stage({ trackRef }: { trackRef: React.RefObject<HTMLDivElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A smaller water buffer on a thin machine. The upscale reads as water
    // either way, so this costs the look very little.
    const lean = (navigator.hardwareConcurrency ?? 8) <= 4 || window.innerWidth < 720;
    const bufW = lean ? 288 : 400;

    const off = document.createElement("canvas");
    const offCtx = off.getContext("2d", { alpha: false });
    if (!offCtx) return;

    const pa = makeProfile();
    const pb = makeProfile();
    let img: ImageData | null = null;
    let cw = 0;
    let ch = 0;
    let dpr = 1;
    let yScale = 0.004;
    let relief = 20;

    const measure = () => {
      const r = host.getBoundingClientRect();
      cw = Math.max(1, Math.round(r.width));
      ch = Math.max(1, Math.round(r.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      const bh = Math.max(1, Math.round((bufW * ch) / cw));
      off.width = bufW;
      off.height = bh;
      img = offCtx.createImageData(bufW, bh);
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(host);

    let raf = 0;
    let prev = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - prev) / 1000));
      prev = now;
      if (!reduced) flow.clock += dt;

      // Where the scroll has got to, in chapter space.
      const el = trackRef.current;
      if (el) {
        const seen = -el.getBoundingClientRect().top / window.innerHeight;
        flow.target = toChapterSpace(Math.max(0, seen));
      }
      const before = flow.current;
      const gap = flow.target - flow.current;
      flow.current =
        reduced || Math.abs(gap) < 1e-4 ? flow.target : flow.current + gap * Math.min(1, dt * 5.5);

      // The pond's own cycle of drops — except in the drop chapter, where the
      // scroll is holding the stone.
      const scrub = scrubPhase(flow.current);
      if (scrub !== null) flow.phase = scrub;
      else if (!reduced) {
        flow.phase += dt / periodAt(flow.current);
        if (flow.phase > 1) flow.phase -= 1;
      }

      const scene = sceneAt(flow.current, flow.clock, flow.phase);

      // Tables have to reach the furthest corner of the view from each source,
      // or the rings would stop at an invisible wall.
      const half = scene.spanM * 0.5;
      const halfY = (half * ch) / cw;
      const reach = (s: Source) =>
        Math.hypot(Math.abs(s.x - scene.cx) + half, Math.abs(s.y - scene.cy) + halfY) * 1.04;

      const s0 = scene.sources[0]!;
      buildProfile(s0, reach(s0), pa);
      const s1 = scene.sources[1];
      let second: Profile | null = null;
      if (s1) {
        buildProfile(s1, reach(s1), pb);
        second = pb;
      }

      // Expose for the ripple in front of us, and ease into it, so a chapter
      // that changes the size of the object brightens over a beat rather than
      // stepping.
      const want = exposureFor(pa.peakSlope + (second ? second.peakSlope : 0), scene.swell);
      relief += (want.relief - relief) * Math.min(1, dt * 1.6);
      const ex: Exposure = { relief, swell: want.swell };

      if (img) {
        drawWater(img, scene, pa, second, ex);
        offCtx.putImageData(img, 0, 0);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(off, 0, 0, cw, ch);

      // The graph's vertical scale follows the ripple, but slowly, so the curve
      // fills the panel without the axis twitching every frame.
      const tall = Math.max(pa.peak * 1.25, 0.0002);
      yScale += (tall - yScale) * Math.min(1, dt * 2.2);

      const s = cw / scene.spanM;
      const view: View = {
        ctx,
        w: cw,
        h: ch,
        s,
        X: (wx) => (wx - scene.cx) * s + cw / 2,
        Y: (wy) => (wy - scene.cy) * s + ch / 2,
        u: Math.max(0.8, Math.min(1.3, cw / 1180)),
      };
      drawOverlay(view, scene, pa, yScale, flow.clock);

      if (flow.current !== before) emit();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [trackRef]);

  return <canvas ref={canvasRef} className="ripple-film__canvas" aria-hidden="true" />;
}

/* ── the words ────────────────────────────────────────────────────────────────
   One card to a chapter. Each arrives over the first twelfth of its chapter and
   leaves over the last, so there is a moment in the middle where the water has
   the screen to itself. */

function Card({
  p,
  step,
  title,
  children,
}: {
  p: number;
  step: string;
  title: string;
  children?: ReactNode;
}) {
  const inAt = out3(win(p, 0, 0.09));
  const outAt = win(p, 0.9, 1);
  return (
    <div
      className="ripple-film__card"
      style={{
        opacity: inAt * (1 - outAt),
        transform: `translateY(${(1 - inAt) * 26 - outAt * 26}px)`,
      }}
    >
      <p className="ripple-film__step">{step}</p>
      <h2 className="ripple-film__title">{title}</h2>
      {children}
    </div>
  );
}

const Eq = ({ children }: { children: ReactNode }) => <p className="ripple-film__eq">{children}</p>;

function Stat({ k, value }: { k: string; value: string }) {
  return (
    <div className="ripple-film__stat">
      <span>{k}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Words({ onJump }: { onJump: (i: number) => void }) {
  const f = useFlow();
  const { index, p } = split(f);
  const r = readoutAt(f);

  return (
    <>
      <div className="ripple-film__overlay">
        {index === 0 && (
          <div
            className="ripple-film__hero"
            style={{
              opacity: 1 - win(p, 0.55, 1),
              transform: `translateY(${-win(p, 0.4, 1) * 30}px)`,
            }}
          >
            <p className="ripple-film__kicker">A ripple investigation</p>
            <h1 className="ripple-film__display">
              Every splash writes a<br />
              different pattern.
            </h1>
            <p className="ripple-film__lede">
              I grew up near water, and I have wondered why since I was small. Here is the answer,
              drawn by the water itself — every ring below is integrated from the wave equation, not
              animated by hand.
            </p>
            <span className="ripple-film__cue">
              Scroll
              <i />
            </span>
          </div>
        )}

        {index === 1 && (
          <Card p={p} step="01 · The drop" title="Something touches the surface">
            <p>
              One object, one moment. From here on every number on this page is computed from
              <em> this</em> impact — the size of the thing that fell, and the water it fell into.
            </p>
            <div className="ripple-film__stats">
              <Stat k="object R" value={`${(r.radius * 100).toFixed(1)} cm`} />
              <Stat k="wavelength λ" value={`${(r.lambda * 100).toFixed(1)} cm`} />
            </div>
          </Card>
        )}

        {index === 2 && (
          <Card p={p} step="02 · The symmetry" title="Direction does not matter. Only distance.">
            <Eq>η(r, θ, t) = η(r, t)</Eq>
            <p>
              Put the origin at the impact. The height of the water does not depend on θ at all — so
              turn the picture by any angle you like and nothing changes. That is rotational
              symmetry of infinite order, and every line through the impact is a mirror.
            </p>
            <p className="ripple-film__quiet">
              The circles are not a coincidence. They are what “depends only on distance” looks like
              when you draw it.
            </p>
          </Card>
        )}

        {index === 3 && (
          <Card p={p} step="03 · The curve" title="Cut through the rings and you get a cosine">
            <Eq>η = A cos(kr − ωt)</Eq>
            <p>
              The curve in the panel is not a drawing of the water — it is the water, the same
              numbers the surface behind it was shaded from, read along the dashed cut.
            </p>
            <p>
              Two constants run it, and both are just “how many radians per unit”: k = 2π/λ per
              metre as you walk outward, ω = 2π/T per second as you stand still and wait.
            </p>
          </Card>
        )}

        {index === 4 && (
          <Card p={p} step="04 · Why it moves" title="Travelling outward is a translation">
            <Eq>kr − ωt = k(r − ct), &nbsp;c = ω/k</Eq>
            <p>
              Replacing r with r − ct is a horizontal shift of the graph, nothing more. The curve
              never changes shape; it is one fixed cosine slid further out as time passes.
            </p>
            <div className="ripple-film__stats">
              <Stat k="phase speed c" value={`${(r.c * 100).toFixed(0)} cm/s`} />
              <Stat k="period T" value={`${((r.lambda / r.c) * 1000).toFixed(0)} ms`} />
            </div>
          </Card>
        )}

        {index === 5 && (
          <Card p={p} step="05 · Why it flattens" title="Geometry, not friction">
            <Eq>A² × 2πr = constant &nbsp;⟹&nbsp; A ∝ 1/√r</Eq>
            <p>
              The same energy, shared around an ever longer circle. A wave's energy goes as the
              square of its height, so holding the total fixed leaves the crest falling as one over
              the root of the distance.
            </p>
            <p className="ripple-film__quiet">
              Double the distance and the crest is not half as tall but about 71% as tall. The extra
              damping is switched off for this chapter — nothing is helping the ring die.
            </p>
          </Card>
        )}

        {index === 6 && (
          <Card p={p} step="06 · The surprise" title="In water, speed depends on wavelength">
            <Eq>ω² = gk + σk³/ρ</Eq>
            <p>
              Two forces pull the surface flat, and they work on different scales: gravity on the
              long waves, surface tension on the tiny ones. So every wavelength travels at its own
              speed, and one impact fans out into a whole train.
            </p>
            <p className="ripple-film__quiet">
              Between the two régimes, at about 1.7 cm, water is at its slowest — the bottom of the
              curve in the panel.
            </p>
          </Card>
        )}

        {index === 7 && (
          <Card p={p} step="07 · The answer" title="The object sets λ, and λ sets everything else">
            <Eq>λ ≈ 2R</Eq>
            <p>
              This is what I had been seeing as a child. The object decides how wide a hole it
              punches, the hole decides the wavelength, and the wavelength decides the speed, the
              spacing and how far the rings get.
            </p>
            <div className="ripple-film__stats ripple-film__stats--3">
              <Stat k="R" value={`${(r.radius * 100).toFixed(1)} cm`} />
              <Stat k="λ" value={`${(r.lambda * 100).toFixed(1)} cm`} />
              <Stat k="c" value={`${(r.c * 100).toFixed(0)} cm/s`} />
            </div>
            <p className="ripple-film__quiet">
              A pebble and a boulder never looked alike because they are playing by two different
              halves of the same equation.
            </p>
          </Card>
        )}

        {index === 8 && (
          <Card p={p} step="08 · Two stones" title="Where they meet, they simply add">
            <p>
              Throw two and the surface does something lovelier. At every point the two heights add:
              crest on crest lifts the water twice as high, crest on trough leaves it flat.
            </p>
            <p className="ripple-film__quiet">
              Which it is depends on nothing but how much further one wave had to travel.
            </p>
          </Card>
        )}

        {index === 9 && (
          <Card p={p} step="09 · The conic" title="The still lanes are hyperbolas">
            <Eq>d₁ − d₂ = (n + ½)λ</Eq>
            <p>
              The water cancels wherever the two journeys differ by half a wavelength. “All the
              points whose distances to two fixed points differ by a constant” is the definition of
              a hyperbola — and the two impacts are its foci.
            </p>
            <p className="ripple-film__quiet">
              The amber lanes are not drawn over the water. They are the water: the shading is
              cos(πΔd/λ) evaluated at every pixel.
            </p>
          </Card>
        )}

        {index === 10 && (
          <div className="ripple-film__hero" style={{ opacity: out3(win(p, 0.05, 0.4)) }}>
            <p className="ripple-film__kicker">Your turn</p>
            <h2 className="ripple-film__display ripple-film__display--sm">
              Now throw something in yourself.
            </h2>
            <p className="ripple-film__lede">
              In the lab, every quantity in these formulas is worked out for whatever you drop, with
              the arithmetic written out — so you can check any of it by hand.
            </p>
            <p className="ripple-film__actions">
              <Link to="/lab" viewTransition className="ripple-film__btn">
                Open the lab →
              </Link>
              <a href="#investigation" className="ripple-film__btn ripple-film__btn--ghost">
                Read the investigation ↓
              </a>
            </p>
          </div>
        )}
      </div>

      <nav className="ripple-film__rail" aria-label="Jump to a chapter">
        {CHAPTERS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`ripple-film__dot${i === index ? " is-on" : ""}${i < index ? " is-done" : ""}`}
            onClick={() => onJump(i)}
            aria-label={`Chapter ${i + 1}: ${c.label}`}
            aria-current={i === index ? "true" : undefined}
          >
            <span aria-hidden="true">{c.label}</span>
          </button>
        ))}
      </nav>

      <div className="ripple-film__progress" aria-hidden="true">
        <div style={{ transform: `scaleX(${f / CHAPTERS.length})` }} />
      </div>
    </>
  );
}

/**
 * The film. The track is as tall as all the chapters put together; the stage
 * inside it is sticky, so scrolling the track scrolls the story rather than the
 * picture.
 *
 * The track only takes its full height once the script is running. Without it
 * the section is one ordinary screen — a title over still water — and the
 * written investigation below carries the whole argument on its own.
 */
export function RippleScroll() {
  const trackRef = useRef<HTMLDivElement>(null);
  const live = useLive();
  const stage = useStage();

  const jump = useCallback((i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + (STARTS[i]! + 0.03) * window.innerHeight, behavior: "smooth" });
  }, []);

  return (
    <section className="ripple-film" aria-label="The investigation, animated" data-stage={stage}>
      <div
        ref={trackRef}
        className="ripple-film__track"
        style={{ height: live ? `${(SPAN + 1) * 100}vh` : "100vh" }}
      >
        <div className="ripple-film__stage">
          {live && <Stage trackRef={trackRef} />}
          {live && <Words onJump={jump} />}
          {!live && (
            <div className="ripple-film__overlay">
              <div className="ripple-film__hero">
                <p className="ripple-film__kicker">A ripple investigation</p>
                <h1 className="ripple-film__display">
                  Every splash writes a<br />
                  different pattern.
                </h1>
                <p className="ripple-film__lede">
                  Why every splash is different, and the mathematics hiding in it.
                </p>
                <p className="ripple-film__actions">
                  <a href="#investigation" className="ripple-film__btn">
                    Read the investigation ↓
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Nothing ever changes, so the subscription never has to call back. */
const neverChanges = () => () => {};

/** True once the client is running, so the track may take its full height. */
function useLive(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
}
