import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { WaveFigure } from "@/components/wave-figure";

/**
 * The landing page: why this investigation exists, and the mathematics behind
 * what it shows. The lab is its own page, reached from the links here.
 *
 * Colour in the diagrams does one job. Each figure plots a single thing, so it
 * wears the site's own wave colour and nothing else needs a legend; axes and
 * annotation wear text tokens. Where a second mark is unavoidable (the nodal
 * curves) it is the site's accent, and it is directly labelled, so identity is
 * never carried by colour alone.
 */

const WAVE = "var(--primary)";
const INK = "oklch(0.68 0.04 215)";
const FAINT = "oklch(0.85 0.05 210 / 0.18)";
const NODE = "var(--accent)";

function Figure({
  caption,
  children,
  viewBox,
}: {
  caption: ReactNode;
  children: ReactNode;
  viewBox: string;
}) {
  return (
    <figure className="mt-5">
      <svg
        viewBox={viewBox}
        className="mx-auto block w-full max-w-xl"
        role="img"
        aria-label={String(caption)}
      >
        {children}
      </svg>
      <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

function Part({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section className="glass p-6 md:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <h3 className="mt-2 font-display text-2xl font-light md:text-3xl">{title}</h3>
      <div className="mt-4 space-y-4 leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

const V = ({ children }: { children: ReactNode }) => (
  <i className="font-display italic text-foreground">{children}</i>
);

function Eq({ children }: { children: ReactNode }) {
  return (
    <p className="my-4 text-center font-display text-xl italic text-foreground md:text-2xl">
      {children}
    </p>
  );
}

/* ── figure 1 · the rings, and the cut through them ───────────────────────── */
function RingsAndCosine() {
  const cx = 108;
  const cy = 105;
  const radii = [20, 40, 60, 80];
  // The cut is straightened out to the right of the rings, on the same scale,
  // so a crest in the graph sits at the same distance as a ring in the picture.
  const x0 = 236;
  const span = 200;
  const pts: string[] = [];
  for (let i = 0; i <= span; i += 2) {
    const r = i;
    const env = 1 / Math.sqrt(Math.max(r, 20) / 20);
    const y = 105 - Math.cos((r / 20) * Math.PI) * 30 * env;
    pts.push(`${i === 0 ? "M" : "L"}${x0 + i} ${y.toFixed(1)}`);
  }
  return (
    <Figure
      viewBox="0 0 450 210"
      caption="Left: the rings seen from above. Right: the same thing cut along the dashed line and straightened out — a cosine, whose height falls the further it travels."
    >
      {radii.map((r, i) => (
        <circle
          key={r}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={WAVE}
          strokeWidth={1.8}
          opacity={0.9 - i * 0.16}
        />
      ))}
      <circle cx={cx} cy={cy} r={3} fill={INK} />
      <line x1={cx} y1={cy} x2={212} y2={cy} stroke={INK} strokeWidth={1} strokeDasharray="4 4" />
      <text
        x={cx}
        y={cy + 98}
        fill={INK}
        fontSize={9}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
      >
        impact
      </text>

      <line x1={x0} y1={105} x2={x0 + span} y2={105} stroke={FAINT} strokeWidth={1} />
      <line x1={x0} y1={60} x2={x0} y2={150} stroke={FAINT} strokeWidth={1} />
      <path d={pts.join(" ")} fill="none" stroke={WAVE} strokeWidth={2} />
      <text x={x0 - 14} y={64} fill={INK} fontSize={9} fontFamily="ui-monospace, monospace">
        η
      </text>
      <text x={x0 + span - 4} y={166} fill={INK} fontSize={9} fontFamily="ui-monospace, monospace">
        r
      </text>
      <line x1={x0 + 20} y1={158} x2={x0 + 60} y2={158} stroke={NODE} strokeWidth={1.5} />
      <line x1={x0 + 20} y1={154} x2={x0 + 20} y2={162} stroke={NODE} strokeWidth={1.5} />
      <line x1={x0 + 60} y1={154} x2={x0 + 60} y2={162} stroke={NODE} strokeWidth={1.5} />
      <text x={x0 + 35} y={174} fill={NODE} fontSize={10} fontFamily="ui-monospace, monospace">
        λ
      </text>
    </Figure>
  );
}

/* ── figure 2 · two sets of rings, and the curves where they cancel ───────── */
function Interference() {
  const W = 320;
  const H = 200;
  const a = 70; // half the distance between the two impacts
  const cx = W / 2;
  const cy = H / 2;
  const lam = 20;

  // A point where the two distances differ by a constant sits on a hyperbola
  // whose foci are the two impacts: x = ±A·cosh t, y = B·sinh t.
  const hyperbola = (half: number) => {
    const A = half;
    const B2 = a * a - A * A;
    if (B2 <= 0) return "";
    const B = Math.sqrt(B2);
    // Stop each branch inside the frame. Left to run they shoot through the
    // label band at the top and straight off the bottom edge.
    const limit = H / 2 - 10;
    const branch = (sign: number) => {
      const out: string[] = [];
      for (let t = -2.6; t <= 2.6; t += 0.05) {
        const y = B * Math.sinh(t);
        if (Math.abs(y) > limit) continue;
        const x = cx + sign * A * Math.cosh(t);
        out.push(`${out.length ? "L" : "M"}${x.toFixed(1)} ${(cy + y).toFixed(1)}`);
      }
      return out.join(" ");
    };
    return `${branch(1)} ${branch(-1)}`;
  };

  return (
    <Figure
      viewBox={`0 -26 ${W} ${H + 26}`}
      caption="Two stones, two sets of rings. Along the amber curves the two waves always arrive half a wavelength apart and cancel — and those curves are hyperbolas, with the two impact points as their foci."
    >
      {[-a, a].map((dx) =>
        [1, 2, 3, 4, 5, 6, 7].map((n) => (
          <circle
            key={`${dx}-${n}`}
            cx={cx + dx}
            cy={cy}
            r={n * lam}
            fill="none"
            stroke={WAVE}
            strokeWidth={1}
            opacity={0.3}
          />
        )),
      )}
      {[0.5, 1.5, 2.5].map((n) => (
        <path
          key={n}
          d={hyperbola(n * lam * 0.5)}
          fill="none"
          stroke={NODE}
          strokeWidth={1.8}
          opacity={0.9}
        />
      ))}
      {[-a, a].map((dx) => (
        <circle key={dx} cx={cx + dx} cy={cy} r={4} fill={INK} />
      ))}
      <text
        x={cx}
        y={-12}
        fill={NODE}
        fontSize={10}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
      >
        where they cancel
      </text>
    </Figure>
  );
}

/* ── figure 3 · why the rings flatten as they spread ──────────────────────── */
function Spreading() {
  const pts: string[] = [];
  const up: string[] = [];
  const dn: string[] = [];
  // Start a little way out: at r → 0 the 1/√r envelope runs off the top, and
  // clamping it there leaves a flat segment that reads as a drawing error.
  for (let x = 12; x <= 300; x += 2) {
    const env = Math.min(36, 36 / Math.sqrt(x / 26));
    const y = 70 - Math.cos((x / 26) * Math.PI) * env;
    const first = x === 12 ? "M" : "L";
    pts.push(`${first}${x} ${y.toFixed(1)}`);
    up.push(`${first}${x} ${(70 - env).toFixed(1)}`);
    dn.push(`${first}${x} ${(70 + env).toFixed(1)}`);
  }
  return (
    <Figure
      viewBox="0 0 300 130"
      caption="The same energy, spread around an ever longer circle. The dashed envelope is 1/√r — the ring does not lose energy, it only has further to share it."
    >
      <line x1={0} y1={70} x2={300} y2={70} stroke={FAINT} strokeWidth={1} />
      <path d={up.join(" ")} fill="none" stroke={NODE} strokeWidth={1.3} strokeDasharray="5 4" />
      <path d={dn.join(" ")} fill="none" stroke={NODE} strokeWidth={1.3} strokeDasharray="5 4" />
      <path d={pts.join(" ")} fill="none" stroke={WAVE} strokeWidth={2} />
      <text x={238} y={30} fill={NODE} fontSize={9} fontFamily="ui-monospace, monospace">
        A ∝ 1/√r
      </text>
      <text x={286} y={112} fill={INK} fontSize={9} fontFamily="ui-monospace, monospace">
        r
      </text>
    </Figure>
  );
}

/* ── the opening demo · a slice of water to drop something into ───────────── */
function WaveDemo() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-primary/40 px-5 py-2 font-mono text-xs uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/10"
        >
          Drop something in ↓
        </button>
      </p>
    );
  }

  return (
    <div className="page-enter mt-5">
      <WaveFigure />
      <p className="mt-4 text-sm">
        That is one slice, one object, one wavelength. The lab does the whole surface — any object
        you like, with every quantity in the formulas worked out as it goes.
      </p>
      <p className="mt-4">
        <Link
          to="/lab"
          viewTransition
          className="inline-flex items-center gap-2 rounded-full border border-primary/40 px-5 py-2 font-mono text-xs uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/10"
        >
          Open the lab →
        </Link>
      </p>
    </div>
  );
}

export function Landing() {
  return (
    <div className="page-enter mx-auto max-w-5xl px-4 pt-10 pb-16 md:pt-16">
      <header className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-primary">
          A ripple investigation
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight font-light md:text-6xl">
          Rings on a lake, and the <em className="text-primary">mathematics</em> hiding in them
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          I grew up near water, and I have wondered about this since I was small. This page is my
          answer — and in the lab, a lake you can throw things into yourself.
        </p>
        {/* The lab is also offered at the end, and beside the demo. This one is
            for anyone who would rather play first and read afterwards. */}
        <p className="mt-7">
          <Link
            to="/lab"
            viewTransition
            className="inline-flex items-center gap-2 rounded-full border border-primary/40 px-5 py-2 font-mono text-xs uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/10"
          >
            Open the lab →
          </Link>
        </p>
      </header>

      <div className="mt-10 space-y-5">
        <Part label="Section 1 · What I observed" title="Every object wrote a different pattern">
          <p>
            When I was a kid I used to spend hours playing with water, or just walking around the
            lake. That is when I started noticing the ripples — every single time something touched
            the surface, rings spread out from the place it landed. A leaf, a raindrop, my own hand,
            a stone I threw as far as I could.
          </p>
          <p>
            What I kept noticing was that they were never the same rings. The{" "}
            <strong className="text-foreground">shape and the height</strong> of the pattern changed
            depending on the size of whatever had touched the water. Something small left fine,
            tightly packed rings that raced away and vanished almost at once. Something big and
            heavy left a few wide, slow, rolling rings that crossed half the lake before they faded.
            Same water, same lake, completely different pattern — and the only thing I had changed
            was the object.
          </p>
        </Part>

        <Part
          label="Section 1 · Why it caught my attention"
          title="It looked like my maths homework"
        >
          <p>
            Two things kept pulling me back. The first was how{" "}
            <strong className="text-foreground">symmetrical</strong> it was. Water is messy, but
            what came out of it was almost perfect: circles inside circles, evenly spaced, growing
            outward at the same rate in every direction. Something chaotic was producing something
            very ordered, and I wanted to know what was enforcing that order.
          </p>
          <p>
            The second was that it looked <strong className="text-foreground">familiar</strong>.
            When I looked across the surface at eye level, the ripples rose and fell in a shape I
            had already seen — the sine and cosine curves from class. I had drawn that shape dozens
            of times on graph paper without ever expecting to find it in a lake. That was the moment
            the question became a maths question rather than just something nice to look at: if the
            water really is drawing a cosine, then what decides how tall it is, how far apart the
            crests sit, and how fast it travels?
          </p>
          <p>I am still curious about it. This whole page is me chasing that question down.</p>
        </Part>

        <Part label="Section 1 · A visual" title="What I see, in one picture — and then in motion">
          <p>
            Here is the thing I noticed, drawn twice: once from above the way you see it on a lake,
            and once as a slice through the middle, which is where the cosine appears.
          </p>
          <RingsAndCosine />
          <p>
            A still picture can only show one instant, so here is a slice of water you can actually
            disturb. Drop something in and watch the cosine appear, travel, and die away.
          </p>
          <WaveDemo />
        </Part>

        <Part
          label="Section 2 · Explain the mathematics"
          title="1 · The symmetry: direction does not matter, only distance"
        >
          <p>
            The first piece of structure is the one that makes the pattern look so ordered. Put the
            origin at the point of impact and describe any spot on the surface by how far out it is,{" "}
            <V>r</V>, and which way round it is, <V>θ</V>. The height of the water turns out not to
            depend on <V>θ</V> at all:
          </p>
          <Eq>
            η(<V>r</V>, <V>θ</V>, <V>t</V>) = η(<V>r</V>, <V>t</V>)
          </Eq>
          <p>
            That one fact is the whole symmetry. Rotate the picture about the impact point by any
            angle you like and it is unchanged — rotational symmetry of infinite order — and every
            straight line drawn through the impact point is a line of reflection symmetry. The
            circles are not a coincidence; they are what "depends only on distance" looks like when
            you draw it. The water is symmetrical because nothing in the situation points in any
            particular direction: the stone came straight down, and gravity and surface tension pull
            the same way everywhere.
          </p>
        </Part>

        <Part label="Section 2" title="2 · The curve itself is a cosine">
          <p>Take that slice and the shape is exactly the function I recognised:</p>
          <Eq>
            η = <V>A</V> cos(<V>kr</V> − <V>ωt</V>)
          </Eq>
          <p>
            Two numbers control it, and both are just "how many radians per unit": <V>k</V> = 2π/
            <V>λ</V> counts radians per metre as you walk outward, and <V>ω</V> = 2π/
            <V>T</V> counts radians per second as you stand still and wait. So the surface is
            periodic in two different ways at once — repeating every <V>λ</V> metres in space, and
            every <V>T</V> seconds in time. On the lake, <V>λ</V> is the gap between one ring and
            the next, and <V>T</V> is how long you wait for the next crest to reach your foot.
          </p>
        </Part>

        <Part label="Section 2" title="3 · Travelling outward is a translation">
          <p>Why does the pattern move? Factor the inside of the cosine:</p>
          <Eq>
            <V>kr</V> − <V>ωt</V> = <V>k</V>(<V>r</V> − <V>ct</V>), &nbsp; where <V>c</V> = <V>ω</V>
            /<V>k</V>
          </Eq>
          <p>
            Replacing <V>r</V> with <V>r</V> − <V>ct</V> is a{" "}
            <strong className="text-foreground">horizontal translation</strong> of the graph. The
            curve never changes shape; it is the same cosine slid further out as time passes, at a
            steady speed <V>c</V>. The expanding rings I was watching are one fixed shape being
            translated — which is also why the rings stay circles however big they get.
          </p>
        </Part>

        <Part label="Section 2" title="4 · Why the rings flatten: a proportion argument">
          <p>
            The rings get lower as they widen, and that is not friction — it is geometry. The energy
            the stone gave the water is spread around the ring, and a ring of radius <V>r</V> has
            circumference 2π<V>r</V>. A wave's energy goes as the square of its height, so energy
            per unit length of the ring is proportional to <V>A</V>
            <sup className="text-[0.62em]">2</sup>, and keeping the total fixed means
          </p>
          <Eq>
            <V>A</V>
            <sup className="text-[0.62em]">2</sup> × 2π<V>r</V> = constant &nbsp; ⟹ &nbsp; <V>A</V>{" "}
            ∝ 1/√<V>r</V>
          </Eq>
          <p>
            Double the distance and the crest is not half as tall but 1/√2 — about 71% — of what it
            was. The ring is not losing anything; it simply has further and further to share it.
          </p>
          <Spreading />
        </Part>

        <Part label="Section 2" title="5 · Why the object's size changes the pattern">
          <p>
            This is the part I was most curious about as a kid. The object sets the size of the hole
            it punches, the hole sets the wavelength, and the wavelength sets everything else. The
            cavity is about as wide as the object, or as wide as its energy can afford, whichever is
            larger — and one full wave spans roughly that hole:
          </p>
          <Eq>
            <V>λ</V> ≈ 2<V>R</V>
          </Eq>
          <p>
            Then comes the part that genuinely surprised me: in water, speed depends on wavelength.
            The two forces that pull the surface flat — gravity and surface tension — act on
            different scales, and they give
          </p>
          <Eq>
            <V>ω</V>
            <sup className="text-[0.62em]">2</sup> = <V>gk</V> + <V>σk</V>
            <sup className="text-[0.62em]">3</sup>/<V>ρ</V>
          </Eq>
          <p>
            Gravity dominates for long waves, so a big stone's wide rings roll fast. Surface tension
            dominates for tiny ones, so a raindrop's fine rings are fast in a completely different
            way, for a completely different reason. In between, at about 1.7 cm, water is at its
            slowest. So the pattern an object writes is not just bigger or smaller — a big object
            and a small one are playing by two different halves of the same equation. That is why a
            pebble and a boulder never looked alike.
          </p>
        </Part>

        <Part
          label="Section 2"
          title="6 · When two sets of rings cross, the maths draws a hyperbola"
        >
          <p>
            Throw two stones and the surface does something lovelier still. At any point the two
            waves add. Where a crest meets a crest the water lifts twice as high; where a crest
            meets a trough they cancel and the surface stays flat.
          </p>
          <p>
            Which points cancel? The ones where the two journeys differ by half a wavelength, or one
            and a half, or two and a half — so the condition is on the{" "}
            <strong className="text-foreground">difference of two distances</strong>:
          </p>
          <Eq>
            <V>d</V>
            <sub className="text-[0.62em]">1</sub> − <V>d</V>
            <sub className="text-[0.62em]">2</sub> = (<V>n</V> + ½)<V>λ</V>
          </Eq>
          <p>
            "All the points whose distances to two fixed points differ by a constant" is the
            definition of a <strong className="text-foreground">hyperbola</strong>, with the two
            impact points as its foci. So the still lanes you can see running across the water
            between two splashes are conic sections, drawn by the lake. I did not expect to find
            hyperbolas in a pond.
          </p>
          <Interference />
        </Part>

        <Part label="Section 2 · The point" title="Measure it yourself">
          <p>
            None of this is something you have to take my word for. In the lab, every quantity in
            these formulas is computed for whatever you drop and shown with the arithmetic written
            out, so you can check it by hand. Change the size and watch <V>λ</V> move. Change the
            weight and watch the crest height move. Drop two things at once and look for the
            hyperbolas.
          </p>
          <p>
            The thing I find satisfying is that the question I had as a kid — why is every splash
            different? — has an answer that is only a few lines long, and I can now watch it happen.
          </p>
          <p>
            <Link
              to="/lab"
              viewTransition
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 px-5 py-2 font-mono text-xs uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/10"
            >
              Open the lab →
            </Link>
          </p>
        </Part>
      </div>
    </div>
  );
}
