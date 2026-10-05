import { useRef } from "react";

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
};

/**
 * Drag anywhere on the pad to resize the object: the drag distance from the
 * centre *is* the radius, drawn against a centimetre rule so the size stays
 * physical rather than abstract.
 */
export function ObjectDial({ radius, mass, density, floats, onRadius, min, max }: Props) {
  const padRef = useRef<HTMLDivElement>(null);

  const resize = (e: React.PointerEvent) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const cm = (Math.hypot(dx, dy) / (rect.width / 2)) * (PAD_CM / 2);
    onRadius(Math.min(max, Math.max(min, cm / 100)));
  };

  const frac = Math.min(1, (radius * 100) / (PAD_CM / 2));
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

        <div className="absolute inset-0 grid place-items-center">
          <div
            className="rounded-full border transition-[width,height] duration-75"
            style={{
              width: `${frac * 90}%`,
              height: `${frac * 90}%`,
              background: floats
                ? "radial-gradient(circle at 35% 30%, oklch(0.92 0.06 200), oklch(0.68 0.08 210))"
                : "radial-gradient(circle at 35% 30%, oklch(0.72 0.05 240), oklch(0.32 0.04 250))",
              borderColor: "oklch(0.9 0.04 200 / 0.4)",
              boxShadow: "0 8px 24px oklch(0.1 0.04 240 / 0.5)",
            }}
          />
        </div>
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
