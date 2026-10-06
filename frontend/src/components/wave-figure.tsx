import { useEffect, useMemo, useState } from "react";

type WaveImpact = { x: number; startedAt: number };

/* The cosine, in viewBox units. The drawing and the A and λ marks that label it
   both come from these, so the brackets measure what is actually on screen. */
const BASE = 132;
/** Crest height A. */
const AMP = 40;
/** Wavelength λ — crest to crest. Gentle enough that the curve reads as water. */
const LAMBDA = 96;
const K = (2 * Math.PI) / LAMBDA;
const OMEGA = 10;
/** How fast the leading edge travels. Close to ω/k, so crests ride with it. */
const FRONT = 155;
/** Where the A and λ brackets sit. */
const MARK_X = 124;

/**
 * A single slice of water, at rest until it is clicked. Dropping something in
 * sends out η = A cos(kx − ωt) and labels the two things the formula names: the
 * crest height A, and the wavelength λ between one crest and the next.
 *
 * It is the small, self-contained version of the idea — the investigation uses
 * it to show the cosine moving before sending anyone to the lab, and the lab
 * keeps it in its header as a key to the surface below.
 */
export function WaveFigure() {
  const [impact, setImpact] = useState<WaveImpact | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const dropDuration = 0.52;

  useEffect(() => {
    if (!impact) return;
    let frame = 0;
    const animate = () => {
      const age = (performance.now() - impact.startedAt) / 1000;
      if (age >= 6.5) {
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
    if (!impact) return `M20 ${BASE}H540`;
    const waveAge = Math.max(0, elapsed - dropDuration);
    const points: string[] = [];
    // One sample per unit of the viewBox. The figure is drawn several times
    // wider than its 560-unit box, so a coarser step turns every crest into a
    // visible corner.
    for (let x = 20; x <= 540; x += 1) {
      const distance = Math.abs(x - impact.x);
      const arrival = waveAge - distance / FRONT;
      let height = 0;
      if (arrival > 0) {
        // The front eases in over its first half-period instead of snapping up
        // to full height the instant it arrives, which left a step at the
        // leading edge.
        const t = Math.min(1, arrival / 0.32);
        const onset = t * t * (3 - 2 * t);
        height =
          AMP *
          onset *
          Math.exp(-distance / 220) *
          Math.exp(-arrival * 0.38) *
          Math.cos(arrival * OMEGA - distance * K);
      }
      points.push(`${x === 20 ? "M" : "L"}${x} ${(BASE - height).toFixed(2)}`);
    }
    return points.join(" ");
  }, [dropDuration, elapsed, impact]);

  const dropObject = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(20, Math.min(540, ((event.clientX - bounds.left) / bounds.width) * 560));
    setElapsed(0);
    setImpact({ x, startedAt: performance.now() });
  };

  const isWaving = Boolean(impact) && elapsed >= dropDuration;
  const fallProgress = Math.min(1, elapsed / dropDuration);
  const dropY = 18 + (132 - 18) * fallProgress ** 2;

  return (
    <figure className="wave-figure" aria-labelledby="wave-figure-caption">
      <div className="wave-figure__topline">
        <span>Wave equation</span>
        <span>
          {isWaving
            ? `t = ${(elapsed - dropDuration).toFixed(2)} s`
            : impact
              ? "object falling"
              : "surface at rest"}
        </span>
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
          <path
            d={
              `M${MARK_X} ${BASE}V${BASE - AMP}M${MARK_X - 8} ${BASE - AMP}H${MARK_X + 8}` +
              `M${MARK_X - 8} ${BASE}H${MARK_X + 8}` +
              `M${MARK_X} 222H${MARK_X + LAMBDA}M${MARK_X} 214V230M${MARK_X + LAMBDA} 214V230`
            }
          />
          <text x={MARK_X + 15} y={BASE - AMP / 2 + 4}>
            A
          </text>
          <text x={MARK_X + LAMBDA / 2} y="247" textAnchor="middle">
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
        {impact && elapsed <= dropDuration && (
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
