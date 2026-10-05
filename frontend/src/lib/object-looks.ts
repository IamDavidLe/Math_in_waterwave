/**
 * How an object looks, and one renderer that draws it everywhere it appears:
 * the sizing pad, falling and floating in the top view, and in profile in the
 * side view. Appearance is tied to what the thing is made of, so a cork and a
 * lead ball of the same size read as different objects before they land.
 *
 * Nothing here feeds the physics — density and radius do that. This is purely
 * what you see.
 */

export type Shape = "sphere" | "block" | "droplet";

export type Detail =
  "none" | "dimples" | "stripes" | "holes" | "stem" | "grain" | "speckle" | "facets";

export type Look = {
  id: string;
  /** mid tone, lit side, shadowed side */
  base: string;
  light: string;
  dark: string;
  shape: Shape;
  detail: Detail;
  /** 0 matte, 1 mirror — drives the size and hardness of the highlight */
  gloss: number;
  /** 0 opaque, 1 invisible */
  sheer: number;
};

const look = (
  id: string,
  base: string,
  light: string,
  dark: string,
  gloss: number,
  detail: Detail = "none",
  shape: Shape = "sphere",
  sheer = 0,
): Look => ({ id, base, light, dark, shape, detail, gloss, sheer });

/** What it is made of. Picking one keeps weight tied to volume. */
export const MATERIAL_LOOKS: Record<string, Look> = {
  Cork: look("cork", "#c08f5d", "#e6c091", "#7c5733", 0.04, "speckle"),
  Pine: look("pine", "#c9a46d", "#e8cf9f", "#8a6a3c", 0.14, "grain"),
  Ice: look("ice", "#bfe3ef", "#eafaff", "#7fb2c6", 0.72, "facets", "sphere", 0.42),
  Rubber: look("rubber", "#33383d", "#5d666e", "#15181b", 0.1),
  Glass: look("glass", "#b9dfeb", "#f2ffff", "#6f9fb3", 0.92, "facets", "sphere", 0.55),
  Granite: look("granite", "#8b8d92", "#c3c6cb", "#4e5055", 0.22, "speckle"),
  Steel: look("steel", "#a9b4c0", "#f4f8fb", "#4a5460", 0.95, "facets"),
  Lead: look("lead", "#6a6f78", "#a3a9b3", "#35383f", 0.38),
};

/** Ready-made objects, each with its own familiar surface. */
export const OBJECT_LOOKS: Record<string, Look> = {
  Raindrop: look("raindrop", "#9fd6ea", "#eafbff", "#5c93ad", 0.85, "none", "droplet", 0.45),
  Marble: look("marble", "#7fc7d9", "#f0ffff", "#3f7d92", 0.9, "facets", "sphere", 0.3),
  Pebble: look("pebble", "#8a8578", "#c0bbab", "#4b4840", 0.18, "speckle"),
  "Golf ball": look("golf", "#eef2f4", "#ffffff", "#9aa6ad", 0.5, "dimples"),
  Apple: look("apple", "#c0392f", "#f0785c", "#6d1a16", 0.55, "stem"),
  Brick: look("brick", "#a4553c", "#cf7d5f", "#5e2d1f", 0.08, "speckle", "block"),
  "Bowling ball": look("bowling", "#23262c", "#6a7280", "#0b0c0f", 0.88, "holes"),
  "Beach ball": look("beach", "#e8eef2", "#ffffff", "#9fb0ba", 0.45, "stripes"),
};

export const DEFAULT_LOOK = MATERIAL_LOOKS["Granite"]!;

export function lookByName(name: string | null): Look | null {
  if (!name) return null;
  return OBJECT_LOOKS[name] ?? MATERIAL_LOOKS[name] ?? null;
}

export function lookById(id: string | undefined): Look {
  if (!id) return DEFAULT_LOOK;
  for (const l of Object.values(OBJECT_LOOKS)) if (l.id === id) return l;
  for (const l of Object.values(MATERIAL_LOOKS)) if (l.id === id) return l;
  return DEFAULT_LOOK;
}

/** Stable pseudo-random in [0,1) — speckles must not crawl between frames. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Draw `look` as a body of radius `r` centred on (cx, cy). The light comes
 * from the upper left, matching the water's own shading.
 */
export function drawObject(
  g: CanvasRenderingContext2D,
  look: Look,
  cx: number,
  cy: number,
  r: number,
  opts: { alpha?: number; spin?: number } = {},
) {
  if (r <= 0) return;
  const alpha = opts.alpha ?? 1;
  const spin = opts.spin ?? 0;
  g.save();
  g.globalAlpha = alpha;
  g.translate(cx, cy);
  if (spin) g.rotate(spin);

  // silhouette
  g.beginPath();
  if (look.shape === "block") {
    const w = r * 1.75;
    const h = r * 1.15;
    const k = Math.min(w, h) * 0.16;
    g.roundRect(-w / 2, -h / 2, w, h, k);
  } else if (look.shape === "droplet") {
    g.moveTo(0, -r * 1.5);
    g.bezierCurveTo(r * 0.95, -r * 0.3, r, r * 0.45, 0, r);
    g.bezierCurveTo(-r, r * 0.45, -r * 0.95, -r * 0.3, 0, -r * 1.5);
  } else {
    g.arc(0, 0, r, 0, Math.PI * 2);
  }
  g.clip();

  // body shading: lit from the upper left, shadowed at the lower right
  const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r * 1.25);
  grad.addColorStop(0, look.light);
  grad.addColorStop(0.45, look.base);
  grad.addColorStop(1, look.dark);
  g.globalAlpha = alpha * (1 - look.sheer * 0.55);
  g.fillStyle = grad;
  g.fillRect(-r * 2, -r * 2, r * 4, r * 4);
  g.globalAlpha = alpha;

  switch (look.detail) {
    case "dimples": {
      g.fillStyle = "rgba(0,0,0,0.13)";
      const step = r * 0.3;
      for (let y = -r; y <= r; y += step) {
        for (let x = -r; x <= r; x += step) {
          const off = ((Math.round(y / step) % 2) * step) / 2;
          const px = x + off;
          if (px * px + y * y > r * r * 0.92) continue;
          g.beginPath();
          g.arc(px, y, step * 0.26, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case "stripes": {
      const colours = ["#e4534a", "#f0b429", "#2f8fd0", "#3fa96b"];
      for (let i = 0; i < 6; i++) {
        g.fillStyle = colours[i % colours.length]!;
        g.globalAlpha = alpha * 0.85;
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, r * 1.2, (i / 6) * Math.PI * 2, ((i + 0.72) / 6) * Math.PI * 2);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = alpha;
      break;
    }
    case "holes": {
      g.fillStyle = "rgba(0,0,0,0.72)";
      const holes: [number, number][] = [
        [-0.3, -0.34],
        [0.12, -0.42],
        [-0.08, -0.02],
      ];
      for (const [hx, hy] of holes) {
        g.beginPath();
        g.ellipse(hx * r, hy * r, r * 0.15, r * 0.17, 0.3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case "stem": {
      g.strokeStyle = "#5c3a22";
      g.lineWidth = Math.max(1, r * 0.11);
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(r * 0.04, -r * 0.82);
      g.quadraticCurveTo(r * 0.16, -r * 1.16, r * 0.3, -r * 1.22);
      g.stroke();
      g.fillStyle = "#4b7a35";
      g.beginPath();
      g.ellipse(r * 0.46, -r * 1.06, r * 0.26, r * 0.13, -0.5, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "grain": {
      g.strokeStyle = "rgba(90,60,28,0.33)";
      g.lineWidth = Math.max(0.6, r * 0.05);
      for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.moveTo(-r, i * r * 0.28);
        g.quadraticCurveTo(0, i * r * 0.28 + r * 0.16, r, i * r * 0.28);
        g.stroke();
      }
      break;
    }
    case "speckle": {
      const n = Math.max(10, Math.round(r * 2.2));
      for (let i = 0; i < n; i++) {
        const a = hash(i * 3.1) * Math.PI * 2;
        const d = Math.sqrt(hash(i * 7.7)) * r * 0.95;
        const s = (0.05 + hash(i * 5.3) * 0.09) * r;
        g.fillStyle = hash(i * 2.9) > 0.5 ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.26)";
        g.beginPath();
        g.arc(Math.cos(a) * d, Math.sin(a) * d, s, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case "facets": {
      g.strokeStyle = `rgba(255,255,255,${0.14 + look.gloss * 0.2})`;
      g.lineWidth = Math.max(0.6, r * 0.06);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.6;
        g.beginPath();
        g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        g.lineTo(Math.cos(a + 2.1) * r * 0.75, Math.sin(a + 2.1) * r * 0.75);
        g.stroke();
      }
      break;
    }
    case "none":
    default:
      break;
  }

  // highlight — tight and bright on metal and glass, broad and faint on cork
  if (r > 2) {
    const hr = r * (0.52 - look.gloss * 0.32);
    const spec = g.createRadialGradient(
      -r * 0.36,
      -r * 0.42,
      0,
      -r * 0.36,
      -r * 0.42,
      Math.max(hr, r * 0.12),
    );
    spec.addColorStop(0, `rgba(255,255,255,${0.2 + look.gloss * 0.72})`);
    spec.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = spec;
    g.fillRect(-r * 2, -r * 2, r * 4, r * 4);
  }

  // contact shadow inside the lower-right rim, which seats it in the water
  const rim = g.createRadialGradient(r * 0.3, r * 0.35, r * 0.4, r * 0.2, r * 0.25, r * 1.15);
  rim.addColorStop(0, "rgba(0,0,0,0)");
  rim.addColorStop(1, `rgba(0,0,0,${0.3 - look.sheer * 0.2})`);
  g.fillStyle = rim;
  g.fillRect(-r * 2, -r * 2, r * 4, r * 4);

  g.restore();
}
