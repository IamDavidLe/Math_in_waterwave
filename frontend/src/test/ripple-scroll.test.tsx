import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";

import { RippleScroll } from "@/components/ripple-scroll";

// The closing chapter links into the lab. Routing is not what is under test
// here, and a real Link wants a router around it.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

/** A 2D context that accepts everything and draws nothing. */
function stubContext() {
  const noop = () => {};
  return new Proxy(
    {
      createImageData: (w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
      createRadialGradient: () => ({ addColorStop: noop }),
      measureText: () => ({ width: 10 }),
    } as Record<string, unknown>,
    {
      get: (t, k) => (k in t ? t[k as string] : noop),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

type Cb = (e: { isIntersecting: boolean }[]) => void;
let observers: Cb[] = [];

function harness() {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: Cb) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => stubContext());
  // jsdom gives everything a zero box, which would divide by zero.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1440,
    height: 820,
    top: 0,
    left: 0,
    right: 1440,
    bottom: 820,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return {
    /** Run the loop forward, as the browser would. */
    advance(steps: number, msEach = 16) {
      let t = performance.now();
      for (let i = 0; i < steps; i++) {
        const next = frames.shift();
        if (!next) return;
        t += msEach;
        next(t);
      }
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the scroll film", () => {
  it("renders a readable opening without the script, and the canvases with it", () => {
    const h = harness();
    const { container } = render(<RippleScroll />);
    h.advance(3);
    expect(screen.getByText(/Every splash writes a/)).toBeInTheDocument();
    expect(container.querySelector(".ripple-film__water")).toBeTruthy();
    expect(container.querySelector(".ripple-film__marks")).toBeTruthy();
  });

  it("drives the animation through CSS variables rather than a render each frame", () => {
    const h = harness();
    const { container } = render(<RippleScroll />);
    const stage = container.querySelector(".ripple-film__stage") as HTMLElement;

    window.scrollY = 900;
    h.advance(40);

    // The loop must be writing the smooth part onto the stage.
    for (const v of ["--in", "--out", "--progress"]) {
      const got = stage.style.getPropertyValue(v);
      expect(got, v).not.toBe("");
      expect(Number.isFinite(Number(got)), `${v} = ${got}`).toBe(true);
    }
    expect(Number(stage.style.getPropertyValue("--progress"))).toBeGreaterThan(0);
  });

  it("stops drawing once the film is behind you", () => {
    const h = harness();
    const { container } = render(<RippleScroll />);
    const stage = container.querySelector(".ripple-film__stage") as HTMLElement;

    window.scrollY = 900;
    h.advance(30);
    const moved = stage.style.getPropertyValue("--progress");

    observers.forEach((cb) => cb([{ isIntersecting: false }]));
    window.scrollY = 4000;
    h.advance(30);

    expect(stage.style.getPropertyValue("--progress"), "frozen while off screen").toBe(moved);

    // And picks the scroll straight back up on the way in, without sweeping.
    observers.forEach((cb) => cb([{ isIntersecting: true }]));
    h.advance(2);
    expect(Number(stage.style.getPropertyValue("--progress"))).toBeGreaterThan(Number(moved));
  });

  it("survives a run of frames without throwing", () => {
    const h = harness();
    render(<RippleScroll />);
    for (let y = 0; y < 26000; y += 650) {
      window.scrollY = y;
      h.advance(4);
    }
    expect(true).toBe(true);
  });
});
