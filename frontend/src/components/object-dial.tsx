import { useEffect, useRef } from "react";

import { type Look, drawObject } from "@/lib/object-looks";

/** cm of tank shown across the pad, so the object is drawn to scale */
const PAD_CM = 50;

type Props = {
  /** sphere radius, metres */
  radius: number;
  /** kg */
  mass: number;
  /** kg/m³ */
  density: number;
  floats: boolean;
  onRadius: (r: number) => void;
  min: number;
  max: number;
  /** how the object is drawn — set by what it is, or what it is made of */
  look: Look;
};

/**
 * Drag anywhere on the pad to resize the object: the drag distance from the
 * centre *is* the radius, drawn against a centimetre rule so the size stays
 * physical rather than abstract.
 */
export function ObjectDial({ radius, mass, density, floats, onRadius, min, max, look }: Props) {
  const padRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // The pad shows the object at true scale against the rule, drawn with the
  // same renderer the water uses, so the thing you size is the thing you drop.
  useEffect(() => {
    const cv = previewRef.current;
    const pad = padRef.current;
    if (!cv || !pad) return;
    const box = pad.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.max(1, Math.round(box.width * dpr));
    cv.width = size;
    cv.height = size;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, size, size);
    const px = ((radius * 100) / (PAD_CM / 2)) * (size / 2) * 0.9;
    drawObject(g, look, size / 2, size / 2, Math.max(2, px));

    // A pea-sized object is a dot at true scale, which is honest but hides
    // what it is made of — so show it enlarged in the corner, and say by how
    // much rather than quietly drawing it the wrong size.
    const MIN = size * 0.1;
    if (px < MIN) {
      const inset = size * 0.16;
      const cx = size - inset - size * 0.07;
      const cy = inset + size * 0.07;
      g.save();
      g.strokeStyle = "rgba(190,225,240,0.22)";
      g.lineWidth = Math.max(1, size * 0.004);
      g.beginPath();
      g.arc(cx, cy, inset * 1.35, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      drawObject(g, look, cx, cy, inset);
      g.fillStyle = "rgba(190,225,240,0.6)";
      g.font = `${size * 0.045}px JetBrains Mono, monospace`;
      g.textAlign = "center";
      g.fillText(`×${Math.round(inset / Math.max(px, 0.4))}`, cx, cy + inset * 1.95);
      g.textAlign = "left";
    }
  }, [radius, look]);

  const resize = (e: React.PointerEvent) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const cm = (Math.hypot(dx, dy) / (rect.width / 2)) * (PAD_CM / 2);
    onRadius(Math.min(max, Math.max(min, cm / 100)));
  };

  const weight =
    mass >= 1 ? `${mass.toFixed(2)} kg` : `${(mass * 1000).toFixed(mass < 0.01 ? 2 : 0)} g`;

  return (
    <div className="space-y-2">
      <div
        ref={padRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          resize(e);
        }}
        onPointerMove={(e) => (e.buttons === 1 ? resize(e) : undefined)}
        className="relative aspect-square w-full cursor-ew-resize touch-none rounded-xl border border-border bg-secondary/40"
        role="slider"
        aria-label="Object radius — drag to resize"
        aria-valuemin={min * 100}
        aria-valuemax={max * 100}
        aria-valuenow={+(radius * 100).toFixed(1)}
        aria-valuetext={`radius ${(radius * 100).toFixed(1)} centimetres`}
        tabIndex={0}
        onKeyDown={(e) => {
          const stepUp = e.key === "ArrowRight" || e.key === "ArrowUp";
          const stepDown = e.key === "ArrowLeft" || e.key === "ArrowDown";
          if (!stepUp && !stepDown) return;
          e.preventDefault();
          const factor = stepUp ? 1.08 : 1 / 1.08;
          onRadius(Math.min(max, Math.max(min, radius * factor)));
        }}
      >
        {/* centimetre rule */}
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between">
          {Array.from({ length: 11 }, (_, i) => (
            <span
              key={i}
              className="w-px bg-foreground/25"
              style={{ height: i % 5 === 0 ? 10 : 5 }}
            />
          ))}
        </div>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[10px] text-muted-foreground">
          {PAD_CM} cm
        </span>

        <canvas ref={previewRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <div className="pointer-events-none absolute left-2 top-2 font-mono text-[10px] leading-4 text-muted-foreground">
          <div>r = {(radius * 100).toFixed(radius < 0.01 ? 2 : 1)} cm</div>
          <div>m = {weight}</div>
          <div>ρ = {density >= 1000 ? density.toFixed(0) : density.toPrecision(3)} kg/m³</div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Drag the pad to resize {floats ? "— it floats and will bob" : "— it sinks after impact"}.
      </p>
    </div>
  );
}
