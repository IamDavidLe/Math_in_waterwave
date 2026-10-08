import { describe, expect, it } from "vitest";

import { buildProfile, makeProfile } from "@/lib/ripple-field";
import { drawOverlay, type View } from "@/lib/ripple-overlay";
import { CHAPTERS, sceneAt } from "@/lib/ripple-scene";

/**
 * A 2D context that draws nothing and remembers where it was asked to draw.
 *
 * The annotation layer is the one part of the film with no pixels to inspect
 * afterwards, so this is how we know a panel has not wandered off the edge of
 * the frame or been handed a NaN.
 */
function recorder() {
  const pts: { x: number; y: number; what: string }[] = [];
  const put =
    (what: string) =>
    (...n: number[]) => {
      for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i]!, y: n[i + 1]!, what });
    };
  const text = (what: string) => (_s: string, x: number, y: number) => {
    pts.push({ x, y, what });
  };
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    stroke() {},
    fill() {},
    closePath() {},
    setLineDash() {},
    moveTo: put("moveTo"),
    lineTo: put("lineTo"),
    fillRect: put("fillRect"),
    rect: put("rect"),
    arc: (x: number, y: number) => pts.push({ x, y, what: "arc" }),
    ellipse: (x: number, y: number) => pts.push({ x, y, what: "ellipse" }),
    roundRect: (x: number, y: number, w: number, h: number) => {
      pts.push({ x, y, what: "panel" }, { x: x + w, y: y + h, what: "panel" });
    },
    fillText: text("fillText"),
    strokeText: text("strokeText"),
    createRadialGradient: () => ({ addColorStop() {} }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, pts };
}

function paint(f: number, w: number, h: number) {
  const scene = sceneAt(f, 4.2, 0.55);
  const pa = makeProfile();
  buildProfile(scene.sources[0]!, scene.spanM * 1.2, pa);
  const { ctx, pts } = recorder();
  const s = w / scene.spanM;
  const view: View = {
    ctx,
    w,
    h,
    s,
    X: (wx) => (wx - scene.cx) * s + w / 2,
    Y: (wy) => (wy - scene.cy) * s + h / 2,
    u: Math.max(0.8, Math.min(1.3, w / 1180)),
  };
  drawOverlay(view, scene, pa, Math.max(pa.peak * 1.25, 0.0002), 4.2);
  return { pts, scene };
}

const SIZES: [string, number, number][] = [
  ["desktop", 1440, 820],
  ["laptop", 1100, 700],
  ["phone", 390, 780],
];

describe("the marks drawn over the water", () => {
  for (const [label, w, h] of SIZES) {
    it(`never draws off the frame or with a NaN on ${label}`, () => {
      for (let f = 0; f < CHAPTERS.length - 0.01; f += 0.05) {
        const { pts } = paint(f, w, h);
        for (const p of pts) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.what} at ${f}`).toBe(true);
        }
        // Panels carry the readouts, so they must be wholly on screen.
        for (const p of pts.filter((q) => q.what === "panel")) {
          expect(p.x, `panel x at ${f} (${label})`).toBeGreaterThanOrEqual(0);
          expect(p.y, `panel y at ${f} (${label})`).toBeGreaterThanOrEqual(0);
          expect(p.x, `panel right at ${f} (${label})`).toBeLessThanOrEqual(w);
          expect(p.y, `panel bottom at ${f} (${label})`).toBeLessThanOrEqual(h);
        }
        // Labels are no use half off the edge either.
        for (const p of pts.filter((q) => q.what === "fillText")) {
          expect(p.x, `label x at ${f} (${label})`).toBeGreaterThan(-w * 0.1);
          expect(p.x, `label x at ${f} (${label})`).toBeLessThan(w * 1.1);
          expect(p.y, `label y at ${f} (${label})`).toBeGreaterThan(-h * 0.1);
          expect(p.y, `label y at ${f} (${label})`).toBeLessThan(h * 1.1);
        }
      }
    });
  }

  it("draws the mark each chapter promises", () => {
    // A chapter whose overlay never appears is a chapter that silently lost its
    // illustration, which is exactly the kind of thing a keyframe typo causes.
    const drew = (f: number) => paint(f, 1440, 820).pts.length;
    expect(drew(0.5), "still water is bare").toBe(0);
    // The falling drop is a single ellipse; everything else is a construction.
    expect(drew(1.1), "the drop").toBeGreaterThan(0);
    for (const [name, f] of [
      ["symmetry", 2.5],
      ["the cosine", 3.5],
      ["the translation", 4.5],
      ["the envelope", 5.5],
      ["dispersion", 6.5],
      ["the size dial", 7.5],
      ["two stones", 8.5],
      ["the hyperbolas", 9.5],
    ] as [string, number][]) {
      expect(drew(f), name).toBeGreaterThan(4);
    }
  });
});
