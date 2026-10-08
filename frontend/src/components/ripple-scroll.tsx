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

const flow = { target: 0, current: 0, clock: 0, phase: 0, snap: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * What React is actually told.
 *
 * The cards' arrival and departure, the progress bar and the readouts all move
 * continuously with the scroll, but re-rendering them sixty times a second is
 * sixty style recalculations a second over the whole overlay. So the smooth
 * part is handed to CSS custom properties, which the frame loop writes
 * directly, and React is only woken when the chapter changes or a printed
 * number would actually read differently.
 */
function cardKey(f: number): string {
  return `${split(f).index}:${Math.round(track(f, RADIUS) * 1000)}`;
}

function useCardKey(): string {
  return useSyncExternalStore(
    subscribe,
    () => cardKey(flow.current),
    () => cardKey(0),
  );
}

/** The chapter id, for anything that only cares which chapter we are in. */
function useStage(): string {
  return useSyncExternalStore(
    subscribe,
    () => split(flow.current).id,
    () => CHAPTERS[0]!.id,
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

/**
 * How wide the water buffer may be. The surface is drawn at this width and then
 * stretched to the stage by the compositor, which is free and gives the bilinear
 * softening that reads as water anyway. Starting in the middle lets the governor
 * below find the right size within a second either way.
 */
const BUF_MIN = 240;
const BUF_MAX = 460;
const BUF_START = 360;
/** Over this, and the surface is costing more than a frame can afford. */
const BUDGET_MS = 9;
const EASY_MS = 5;

function Stage({ trackRef }: { trackRef: React.RefObject<HTMLDivElement | null> }) {
  const waterRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const water = waterRef.current;
    const marks = marksRef.current;
    const host = water?.parentElement;
    if (!water || !marks || !host) return;

    // The water canvas is sized to its buffer and stretched by CSS, so the
    // frame ends at `putImageData` — there is no second, full-resolution blit.
    // Only the marks are drawn at device resolution, and they are thin strokes
    // on transparency.
    const wctx = water.getContext("2d", { alpha: false });
    const mctx = marks.getContext("2d");
    if (!wctx || !mctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lean = (navigator.hardwareConcurrency ?? 8) <= 4;

    const pa = makeProfile();
    const pb = makeProfile();
    let img: ImageData | null = null;
    let cw = 0;
    let ch = 0;
    let dpr = 1;
    let bufW = lean ? BUF_MIN : BUF_START;
    let yScale = 0.004;
    let relief = 20;
    // Where the track starts, cached: reading it inside the loop would force a
    // layout every frame, on a page the browser is already busy scrolling.
    let trackTop = 0;
    let onScreen = true;
    let cost = 6;
    let settle = 0;
    let lastKey = "";

    const sizeWater = () => {
      const bh = Math.max(1, Math.round((bufW * ch) / cw));
      water.width = bufW;
      water.height = bh;
      img = wctx.createImageData(bufW, bh);
    };

    const measure = () => {
      const r = host.getBoundingClientRect();
      cw = Math.max(1, Math.round(r.width));
      ch = Math.max(1, Math.round(r.height));
      // Marks are hairlines and type, so they want device pixels — but a 3×
      // phone does not need all of them to look sharp.
      dpr = Math.min(1.75, window.devicePixelRatio || 1);
      marks.width = Math.round(cw * dpr);
      marks.height = Math.round(ch * dpr);
      const el = trackRef.current;
      trackTop = el ? el.getBoundingClientRect().top + window.scrollY : 0;
      sizeWater();
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(host);
    // A sticky stage leaves the viewport once the track is behind you. Without
    // this the film goes on drawing at sixty frames a second underneath the
    // whole written investigation.
    const io = new IntersectionObserver(([e]) => {
      const now = e?.isIntersecting ?? true;
      // Coming back to the film, take up the scroll's position rather than
      // sweeping to it from wherever we left off.
      if (now && !onScreen) flow.snap = true;
      onScreen = now;
    });
    io.observe(host);
    const onResize = () => measure();
    window.addEventListener("resize", onResize, { passive: true });

    let raf = 0;
    let prev = performance.now();
    let drawn = -1;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (now - prev) / 1000));
      prev = now;
      if (!onScreen) return;
      if (!reduced) flow.clock += dt;

      flow.target = toChapterSpace(Math.max(0, (window.scrollY - trackTop) / window.innerHeight));

      // Chase the scroll. The decay is written against elapsed time rather than
      // per frame, so a dropped frame is caught up with instead of being left
      // behind — which is what makes a long scroll feel even.
      const before = flow.current;
      const gap = flow.target - flow.current;
      flow.current =
        reduced || flow.snap || Math.abs(gap) < 1e-4
          ? flow.target
          : flow.current + gap * (1 - Math.exp(-7 * dt));
      flow.snap = false;

      // The pond's own cycle of drops — except in the drop chapter, where the
      // scroll is holding the stone.
      const scrub = scrubPhase(flow.current);
      if (scrub !== null) flow.phase = scrub;
      else if (reduced) {
        // No animation, but no empty pond either: hold every chapter at a point
        // in the cycle where a ring train is in flight.
        flow.phase = 0.55;
      } else {
        flow.phase += dt / periodAt(flow.current);
        if (flow.phase > 1) flow.phase -= 1;
      }

      // Nothing moving and nothing scrolled: there is no new frame to draw.
      if (reduced && flow.current === drawn) return;
      drawn = flow.current;

      const t0 = performance.now();
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
      relief += (want.relief - relief) * (1 - Math.exp(-2 * dt));
      const ex: Exposure = { relief, swell: want.swell };

      if (img) {
        drawWater(img, scene, pa, second, ex);
        wctx.putImageData(img, 0, 0);
      }

      // The graph's vertical scale follows the ripple, but slowly, so the curve
      // fills the panel without the axis twitching every frame.
      const tall = Math.max(pa.peak * 1.25, 0.0002);
      yScale += (tall - yScale) * (1 - Math.exp(-2.6 * dt));

      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, cw, ch);
      const s = cw / scene.spanM;
      const view: View = {
        ctx: mctx,
        w: cw,
        h: ch,
        s,
        X: (wx) => (wx - scene.cx) * s + cw / 2,
        Y: (wy) => (wy - scene.cy) * s + ch / 2,
        u: Math.max(0.8, Math.min(1.3, cw / 1180)),
      };
      drawOverlay(view, scene, pa, yScale, flow.clock);

      // Keep the surface inside its budget on whatever machine this is. A
      // rolling average decides, and a cooldown keeps it from hunting.
      cost += (performance.now() - t0 - cost) * 0.1;
      if (settle > 0) settle--;
      else if (cost > BUDGET_MS && bufW > BUF_MIN) {
        bufW = Math.max(BUF_MIN, Math.round(bufW * 0.85));
        sizeWater();
        settle = 45;
      } else if (cost < EASY_MS && bufW < BUF_MAX && !lean) {
        bufW = Math.min(BUF_MAX, Math.round(bufW * 1.12));
        sizeWater();
        settle = 45;
      }

      // The smooth part, straight onto the element the cards inherit from.
      if (flow.current !== before) {
        const { index, p } = split(flow.current);
        const hero = index === 0 || index === CHAPTERS.length - 1;
        host.style.setProperty("--in", String(out3(win(p, 0, 0.09))));
        host.style.setProperty("--out", String(win(p, 0.9, 1)));
        host.style.setProperty(
          "--hero-in",
          hero && index > 0 ? String(out3(win(p, 0.05, 0.4))) : "1",
        );
        host.style.setProperty("--hero-out", hero && index === 0 ? String(win(p, 0.55, 1)) : "0");
        host.style.setProperty("--progress", String(flow.current / CHAPTERS.length));
        const key = cardKey(flow.current);
        if (key !== lastKey) {
          lastKey = key;
          emit();
        }
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [trackRef]);

  return (
    <>
      <canvas ref={waterRef} className="ripple-film__water" aria-hidden="true" />
      <canvas ref={marksRef} className="ripple-film__marks" aria-hidden="true" />
    </>
  );
}

/* ── the words ────────────────────────────────────────────────────────────────
   One card to a chapter. Each arrives over the first twelfth of its chapter and
   leaves over the last, so there is a moment in the middle where the water has
   the screen to itself. */

function Card({ step, title, children }: { step: string; title: string; children?: ReactNode }) {
  // Arrival and departure are CSS, driven by variables the frame loop writes —
  // see `cardKey`.
  return (
    <div className="ripple-film__card">
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
  // Re-rendered only when the chapter or a printed number changes; everything
  // that moves every frame is CSS.
  const index = Number(useCardKey().split(":")[0]);
  const r = readoutAt(flow.current);

  return (
    <>
      <div className="ripple-film__overlay">
        {index === 0 && (
          <div className="ripple-film__hero">
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
          <Card step="01 · The drop" title="Something touches the surface">
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
          <Card step="02 · The symmetry" title="Direction does not matter. Only distance.">
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
          <Card step="03 · The curve" title="Cut through the rings and you get a cosine">
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
          <Card step="04 · Why it moves" title="Travelling outward is a translation">
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
          <Card step="05 · Why it flattens" title="Geometry, not friction">
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
          <Card step="06 · The surprise" title="In water, speed depends on wavelength">
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
          <Card step="07 · The answer" title="The object sets λ, and λ sets everything else">
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
          <Card step="08 · Two stones" title="Where they meet, they simply add">
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
          <Card step="09 · The conic" title="The still lanes are hyperbolas">
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
          <div className="ripple-film__hero">
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
        <div />
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
