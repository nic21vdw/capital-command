import type { BackgroundStyleId, Palette } from "@/lib/thumbnails/types";
import { THUMB_HEIGHT as H, THUMB_WIDTH as W } from "@/lib/thumbnails/types";

export type BackgroundStyle = {
  id: BackgroundStyleId;
  label: string;
  description: string;
  palettes: Palette[];
  /** Whether the uploaded image is consumed by the background itself. */
  usesImageAsBackdrop?: boolean;
  paint: (ctx: CanvasRenderingContext2D, palette: Palette, intensity: number, image: HTMLImageElement | null) => void;
};

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Deterministic pseudo-random in [0,1) so every render of a seed is identical. */
function rand(seed: number): number {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

const paintGradient: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, palette.bg1);
  gradient.addColorStop(1, palette.bg2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  // Diagonal accent sweep for contrast against the text side.
  ctx.save();
  ctx.globalAlpha = 0.18 * intensity;
  const sweep = ctx.createLinearGradient(0, H, W * 0.7, 0);
  sweep.addColorStop(0, palette.accent);
  sweep.addColorStop(1, "transparent");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

const paintTechGlow: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.72, H * 0.42, 40, W * 0.72, H * 0.42, W * 0.55);
  glow.addColorStop(0, palette.accent);
  glow.addColorStop(1, "transparent");
  ctx.save();
  ctx.globalAlpha = 0.5 * intensity;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // Fine horizontal scanlines.
  ctx.save();
  ctx.globalAlpha = 0.08 * intensity;
  ctx.fillStyle = palette.text;
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 1);
  ctx.restore();
};

const paintBlueprint: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = palette.bg2;
  ctx.globalAlpha = 0.5 * intensity;
  ctx.lineWidth = 1;
  const step = 56;
  for (let x = 0; x <= W; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  // Accent crosshair marks at a few intersections.
  ctx.globalAlpha = 0.9 * intensity;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  for (const [cx, cy] of [
    [step * 4, step * 3],
    [step * 14, step * 8],
    [step * 19, step * 2]
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy + 12);
    ctx.stroke();
  }
  ctx.restore();
};

const paintSpeedLines: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, palette.bg1);
  gradient.addColorStop(1, palette.bg2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  // Radial burst lines from the right third, where a subject usually sits.
  const cx = W * 0.72;
  const cy = H * 0.5;
  ctx.save();
  const count = Math.round(36 * intensity) + 12;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const inner = 130 + (i % 5) * 30;
    ctx.globalAlpha = (i % 3 === 0 ? 0.5 : 0.22) * intensity;
    ctx.strokeStyle = i % 4 === 0 ? palette.accent : palette.text;
    ctx.lineWidth = i % 4 === 0 ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * W, cy + Math.sin(angle) * W);
    ctx.stroke();
  }
  ctx.restore();
};

const paintBlurredFrame: BackgroundStyle["paint"] = (ctx, palette, intensity, image) => {
  if (image) {
    ctx.save();
    ctx.filter = `blur(${Math.round(14 * intensity)}px) brightness(0.6)`;
    // Overscan so blur edges don't show.
    const scale = Math.max((W * 1.1) / image.width, (H * 1.1) / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = palette.bg1;
    ctx.fillRect(0, 0, W, H);
  }
  // Darkening gradient keeps the left text area readable.
  const shade = ctx.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.72)");
  shade.addColorStop(0.55, "rgba(0,0,0,0.25)");
  shade.addColorStop(1, "rgba(0,0,0,0.1)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
};

const paintColorBlock: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = palette.accent;
  const blockWidth = W * (0.42 + 0.08 * intensity);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(blockWidth, 0);
  ctx.lineTo(blockWidth - 90, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  // Thin echo stripe.
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(blockWidth + 24, 0);
  ctx.lineTo(blockWidth + 50, 0);
  ctx.lineTo(blockWidth - 40, H);
  ctx.lineTo(blockWidth - 66, H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const paintSpotlight: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  const spot = ctx.createRadialGradient(W * 0.5, H * 0.42, 60, W * 0.5, H * 0.42, W * 0.5);
  spot.addColorStop(0, palette.bg2);
  spot.addColorStop(0.55, palette.bg1);
  spot.addColorStop(1, "#000000");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);
  // Soft accent rim.
  ctx.save();
  ctx.globalAlpha = 0.35 * intensity;
  const rim = ctx.createRadialGradient(W * 0.5, H * 0.42, W * 0.22, W * 0.5, H * 0.42, W * 0.34);
  rim.addColorStop(0, "transparent");
  rim.addColorStop(0.8, palette.accent);
  rim.addColorStop(1, "transparent");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

const paintSplitScreen: BackgroundStyle["paint"] = (ctx, palette, intensity, image) => {
  // Left: solid brand panel for text. Right: image (or secondary tone).
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  if (image) {
    drawCover(ctx, image, W * 0.5, 0, W * 0.5, H);
    const fade = ctx.createLinearGradient(W * 0.5, 0, W * 0.62, 0);
    fade.addColorStop(0, palette.bg1);
    fade.addColorStop(1, "transparent");
    ctx.fillStyle = fade;
    ctx.fillRect(W * 0.5, 0, W * 0.2, H);
  } else {
    ctx.fillStyle = palette.bg2;
    ctx.fillRect(W * 0.5, 0, W * 0.5, H);
  }
  ctx.save();
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = Math.min(1, 0.9 * intensity);
  ctx.fillRect(W * 0.5 - 6, 0, 12, H);
  ctx.restore();
};

const paintMinimalDark: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, palette.bg1);
  gradient.addColorStop(1, palette.bg2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  // Single restrained accent line under the text area.
  ctx.save();
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = Math.min(1, 0.95 * intensity);
  ctx.fillRect(80, H - 130, 220, 10);
  ctx.restore();
};

const paintPodcast: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  // Soft vignette + waveform bars along the bottom.
  const vignette = ctx.createRadialGradient(W * 0.5, H * 0.4, 100, W * 0.5, H * 0.5, W * 0.62);
  vignette.addColorStop(0, palette.bg2);
  vignette.addColorStop(1, palette.bg1);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.fillStyle = palette.accent;
  const barCount = 48;
  for (let i = 0; i < barCount; i++) {
    // Deterministic pseudo-random heights so renders are reproducible.
    const t = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const height = (18 + t * 70) * intensity;
    ctx.globalAlpha = 0.5 + t * 0.4;
    ctx.fillRect(40 + i * ((W - 80) / barCount), H - 64 - height, 10, height);
  }
  ctx.restore();
};

// --- AI-creator backgrounds -------------------------------------------------
// The AI content niche leans on a recognisable "intelligent machine" visual
// language: glowing node graphs, circuitry, falling data, particle depth, and
// holographic glass. We also include a couple of trend-aware looks — a muted
// "selective vibrancy" aurora and a cinematic film grain — plus one deliberately
// loud high-contrast pop layout for maximum-CTR tests.

const paintNeuralNet: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, palette.bg1);
  base.addColorStop(1, palette.bg2);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Build a field of nodes, weighted toward the left so a subject on the right
  // stays uncluttered.
  const count = Math.round(26 + 18 * intensity);
  const nodes = Array.from({ length: count }, (_, i) => ({
    x: rand(i + 1) * W * (0.1 + rand(i + 7) * 0.85),
    y: rand(i + 3) * H,
    r: 2 + rand(i + 5) * 4
  }));

  ctx.save();
  // Connect nearby nodes with faint accent lines.
  ctx.strokeStyle = palette.accent;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.hypot(dx, dy);
      if (dist < 220) {
        ctx.globalAlpha = (1 - dist / 220) * 0.32 * intensity;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.stroke();
      }
    }
  }
  // Glowing nodes on top.
  for (const node of nodes) {
    const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r * 5);
    glow.addColorStop(0, palette.accent);
    glow.addColorStop(1, "transparent");
    ctx.globalAlpha = 0.9 * intensity;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.text;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const paintCircuit: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.3, H * 0.5, 40, W * 0.3, H * 0.5, W * 0.6);
  glow.addColorStop(0, palette.bg2);
  glow.addColorStop(1, palette.bg1);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.strokeStyle = palette.accent;
  ctx.lineCap = "round";
  const traces = Math.round(16 + 10 * intensity);
  for (let i = 0; i < traces; i++) {
    let x = rand(i + 2) * W;
    let y = rand(i + 9) * H;
    ctx.globalAlpha = 0.45 * intensity;
    ctx.lineWidth = 1 + (i % 3 === 0 ? 1.6 : 0);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Right-angle "circuit trace" walk.
    const segs = 3 + Math.floor(rand(i + 4) * 4);
    for (let s = 0; s < segs; s++) {
      const len = 40 + rand(i * 7 + s) * 130;
      if (s % 2 === 0) x += rand(i + s) > 0.5 ? len : -len;
      else y += rand(i + s + 1) > 0.5 ? len : -len;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Solder pad at the end of the trace.
    ctx.globalAlpha = 0.95 * intensity;
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const paintDataStream: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, palette.bg2);
  wash.addColorStop(1, palette.bg1);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // Vertical "digital rain" columns of short dashes, brightest at the head.
  ctx.save();
  const colWidth = 26;
  const cols = Math.floor(W / colWidth);
  const cell = 22;
  for (let c = 0; c < cols; c++) {
    const x = c * colWidth + 6;
    const head = rand(c + 1) * H;
    const len = 6 + Math.floor(rand(c + 5) * 12);
    for (let k = 0; k < len; k++) {
      const y = (head + k * cell) % (H + cell);
      const t = 1 - k / len;
      ctx.globalAlpha = (0.12 + t * 0.7) * intensity;
      ctx.fillStyle = k === 0 ? palette.text : palette.accent;
      ctx.fillRect(x, y, 3, cell * 0.6);
    }
  }
  ctx.restore();
};

const paintParticles: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  const base = ctx.createRadialGradient(W * 0.4, H * 0.45, 60, W * 0.4, H * 0.5, W * 0.7);
  base.addColorStop(0, palette.bg2);
  base.addColorStop(1, palette.bg1);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Soft bokeh particles with depth — varied radius and alpha.
  ctx.save();
  const count = Math.round(30 + 26 * intensity);
  for (let i = 0; i < count; i++) {
    const x = rand(i + 1) * W;
    const y = rand(i + 13) * H;
    const r = 6 + rand(i + 4) * 70;
    const orb = ctx.createRadialGradient(x, y, 0, x, y, r);
    orb.addColorStop(0, i % 4 === 0 ? palette.text : palette.accent);
    orb.addColorStop(1, "transparent");
    ctx.globalAlpha = (0.08 + rand(i + 8) * 0.3) * intensity;
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const paintHolographic: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  // Chromatic wash so the panel reads as iridescent glass.
  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, palette.bg2);
  wash.addColorStop(0.5, palette.bg1);
  wash.addColorStop(1, palette.accent);
  ctx.save();
  ctx.globalAlpha = 0.35 * intensity;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Frosted glass panel anchored on the left for the headline.
  ctx.save();
  const px = 60;
  const py = 70;
  const pw = W * 0.5;
  const ph = H - py * 2;
  const radius = 28;
  ctx.beginPath();
  ctx.moveTo(px + radius, py);
  ctx.arcTo(px + pw, py, px + pw, py + ph, radius);
  ctx.arcTo(px + pw, py + ph, px, py + ph, radius);
  ctx.arcTo(px, py + ph, px, py, radius);
  ctx.arcTo(px, py, px + pw, py, radius);
  ctx.closePath();
  ctx.globalAlpha = 0.16 + 0.1 * intensity;
  ctx.fillStyle = palette.text;
  ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.accent;
  ctx.stroke();
  // Diagonal sheen across the glass.
  ctx.clip();
  const sheen = ctx.createLinearGradient(px, py, px + pw * 0.6, py + ph);
  sheen.addColorStop(0, "rgba(255,255,255,0.18)");
  sheen.addColorStop(0.5, "transparent");
  ctx.globalAlpha = intensity;
  ctx.fillStyle = sheen;
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();
};

const paintAurora: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  // Muted base with selective pops of colour ("selective vibrancy").
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const blobs: Array<[number, number, number, string]> = [
    [W * 0.25, H * 0.3, W * 0.45, palette.bg2],
    [W * 0.7, H * 0.6, W * 0.5, palette.accent],
    [W * 0.5, H * 0.85, W * 0.4, palette.bg2],
    [W * 0.85, H * 0.2, W * 0.35, palette.accent]
  ];
  for (const [x, y, r, color] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    ctx.globalAlpha = 0.45 * intensity;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  // Gentle darkening on the left keeps the headline legible.
  const shade = ctx.createLinearGradient(0, 0, W * 0.7, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.45)");
  shade.addColorStop(1, "transparent");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
};

const paintCinematic: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, palette.bg1);
  base.addColorStop(1, palette.bg2);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // Teal/orange-style edge wash for a graded film look.
  const grade = ctx.createRadialGradient(W * 0.5, H * 0.5, 80, W * 0.5, H * 0.5, W * 0.7);
  grade.addColorStop(0, "transparent");
  grade.addColorStop(1, palette.accent);
  ctx.save();
  ctx.globalAlpha = 0.18 * intensity;
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Film grain.
  ctx.save();
  const grains = Math.round(2200 * intensity);
  ctx.fillStyle = palette.text;
  for (let i = 0; i < grains; i++) {
    ctx.globalAlpha = rand(i + 1) * 0.06;
    ctx.fillRect(rand(i + 2) * W, rand(i + 3) * H, 1.4, 1.4);
  }
  ctx.restore();

  // Vignette + cinematic letterbox bars.
  const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.35, W * 0.5, H * 0.5, W * 0.65);
  vignette.addColorStop(0, "transparent");
  vignette.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  const bar = Math.round(58 * intensity);
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);
};

const paintMegaPop: BackgroundStyle["paint"] = (ctx, palette, intensity) => {
  // Deliberately loud, high-contrast layout for maximum-CTR experiments.
  ctx.fillStyle = palette.bg1;
  ctx.fillRect(0, 0, W, H);
  // Bright radial burst behind the subject side.
  const burst = ctx.createRadialGradient(W * 0.72, H * 0.5, 30, W * 0.72, H * 0.5, W * 0.6);
  burst.addColorStop(0, palette.accent);
  burst.addColorStop(0.5, palette.bg2);
  burst.addColorStop(1, palette.bg1);
  ctx.save();
  ctx.globalAlpha = 0.9 * Math.min(1, intensity);
  ctx.fillStyle = burst;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Sunburst rays.
  ctx.save();
  ctx.translate(W * 0.72, H * 0.5);
  const rays = 24;
  for (let i = 0; i < rays; i++) {
    ctx.rotate((Math.PI * 2) / rays);
    ctx.globalAlpha = i % 2 === 0 ? 0.12 * intensity : 0;
    ctx.fillStyle = palette.text;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, -40);
    ctx.lineTo(W, 40);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Bold attention ring on the subject + thick arrow pointing at it.
  ctx.save();
  ctx.lineWidth = 14;
  ctx.strokeStyle = palette.accent;
  ctx.globalAlpha = Math.min(1, intensity);
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.42, 150, 0, Math.PI * 2);
  ctx.stroke();

  ctx.translate(W * 0.5, H * 0.7);
  ctx.rotate(-0.32);
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(90, -20);
  ctx.lineTo(90, -45);
  ctx.lineTo(150, 0);
  ctx.lineTo(90, 45);
  ctx.lineTo(90, 20);
  ctx.lineTo(0, 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

export const BACKGROUND_STYLES: BackgroundStyle[] = [
  {
    id: "gradient",
    label: "High-contrast gradient",
    description: "Bold two-tone gradient with an accent sweep.",
    palettes: [
      { name: "Midnight lime", bg1: "#0b1d12", bg2: "#10331c", accent: "#c8f46d", text: "#ffffff" },
      { name: "Deep violet", bg1: "#150a2e", bg2: "#3b1670", accent: "#b9aaff", text: "#ffffff" },
      { name: "Ember", bg1: "#220b06", bg2: "#5c1a0a", accent: "#ff8a4c", text: "#ffffff" },
      { name: "Arctic", bg1: "#04222e", bg2: "#0a4a5e", accent: "#7ee9f2", text: "#ffffff" }
    ],
    paint: paintGradient
  },
  {
    id: "tech-glow",
    label: "Dark tech glow",
    description: "Near-black field with a neon glow and scanlines.",
    palettes: [
      { name: "Terminal green", bg1: "#04100a", bg2: "#0a1f12", accent: "#3dffa0", text: "#eafff3" },
      { name: "Cyber blue", bg1: "#040b18", bg2: "#0a1830", accent: "#4fa8ff", text: "#eaf3ff" },
      { name: "Synth pink", bg1: "#13040f", bg2: "#260a1f", accent: "#ff5fa2", text: "#ffeaf4" }
    ],
    paint: paintTechGlow
  },
  {
    id: "blueprint",
    label: "Blueprint grid",
    description: "Engineering grid with accent crosshairs.",
    palettes: [
      { name: "Classic blueprint", bg1: "#0a2540", bg2: "#16456e", accent: "#ffd34d", text: "#ffffff" },
      { name: "Graphite", bg1: "#13161a", bg2: "#2a3038", accent: "#c8f46d", text: "#ffffff" },
      { name: "Slate teal", bg1: "#04282b", bg2: "#0c4a4e", accent: "#ff8a4c", text: "#ffffff" }
    ],
    paint: paintBlueprint
  },
  {
    id: "speed-lines",
    label: "Speed lines burst",
    description: "Action burst radiating from the subject side.",
    palettes: [
      { name: "Crimson rush", bg1: "#2a0606", bg2: "#4d0b0b", accent: "#ffd34d", text: "#ffffff" },
      { name: "Voltage", bg1: "#101010", bg2: "#1f1f1f", accent: "#ffe14d", text: "#ffffff" },
      { name: "Royal", bg1: "#0b1030", bg2: "#1b2566", accent: "#7ee9f2", text: "#ffffff" }
    ],
    paint: paintSpeedLines
  },
  {
    id: "blurred-frame",
    label: "Blurred video frame",
    description: "Your uploaded image, blurred and darkened, behind the text.",
    palettes: [
      { name: "Neutral shade", bg1: "#101418", bg2: "#1b222a", accent: "#c8f46d", text: "#ffffff" },
      { name: "Warm shade", bg1: "#1a1410", bg2: "#2a201a", accent: "#ffb07a", text: "#ffffff" }
    ],
    usesImageAsBackdrop: true,
    paint: paintBlurredFrame
  },
  {
    id: "color-block",
    label: "Bold color block",
    description: "Angled solid block for text against a dark field.",
    palettes: [
      { name: "Lime block", bg1: "#0c1310", bg2: "#0c1310", accent: "#c8f46d", text: "#0c1308" },
      { name: "Signal red", bg1: "#101014", bg2: "#101014", accent: "#ff4d4d", text: "#ffffff" },
      { name: "Amber block", bg1: "#11100c", bg2: "#11100c", accent: "#ffc24d", text: "#1a1204" },
      { name: "Sky block", bg1: "#0a1016", bg2: "#0a1016", accent: "#5fc9ff", text: "#04141f" }
    ],
    paint: paintColorBlock
  },
  {
    id: "spotlight",
    label: "Spotlight glow",
    description: "Radial stage light with a soft accent rim.",
    palettes: [
      { name: "Stage white", bg1: "#0b0b0e", bg2: "#3a3a46", accent: "#ffd34d", text: "#ffffff" },
      { name: "Indigo stage", bg1: "#0a0a1a", bg2: "#2c2c5e", accent: "#9b87ff", text: "#ffffff" },
      { name: "Teal stage", bg1: "#06141a", bg2: "#155e6a", accent: "#7ee9f2", text: "#ffffff" }
    ],
    paint: paintSpotlight
  },
  {
    id: "split-screen",
    label: "Split-screen comparison",
    description: "Brand panel on the left, your image on the right.",
    palettes: [
      { name: "Ink + lime", bg1: "#0e1512", bg2: "#1d2a23", accent: "#c8f46d", text: "#ffffff" },
      { name: "Navy + gold", bg1: "#0a1530", bg2: "#15275a", accent: "#ffd34d", text: "#ffffff" },
      { name: "Charcoal + rose", bg1: "#15151a", bg2: "#26262e", accent: "#ff6f9f", text: "#ffffff" }
    ],
    paint: paintSplitScreen
  },
  {
    id: "minimal-dark",
    label: "Minimal premium dark",
    description: "Quiet dark gradient with one accent line.",
    palettes: [
      { name: "Onyx", bg1: "#0c0e12", bg2: "#15181f", accent: "#c8f46d", text: "#f4f7fa" },
      { name: "Espresso", bg1: "#120e0b", bg2: "#1d1712", accent: "#ffb07a", text: "#f8f3ee" },
      { name: "Deep sea", bg1: "#070f16", bg2: "#0e1c28", accent: "#5fd6e2", text: "#eef7fa" }
    ],
    paint: paintMinimalDark
  },
  {
    id: "podcast",
    label: "Creator / podcast",
    description: "Soft vignette with a waveform footer.",
    palettes: [
      { name: "Studio plum", bg1: "#170d1c", bg2: "#2e1a38", accent: "#ff8ad4", text: "#ffffff" },
      { name: "Mic amber", bg1: "#171107", bg2: "#2e2410", accent: "#ffc24d", text: "#ffffff" },
      { name: "Cool studio", bg1: "#0a1218", bg2: "#15242e", accent: "#7ee9f2", text: "#ffffff" }
    ],
    paint: paintPodcast
  },
  {
    id: "neural-net",
    label: "Neural network",
    description: "Glowing node-and-link mesh — the signature AI look.",
    palettes: [
      { name: "Synapse cyan", bg1: "#04101c", bg2: "#0a2540", accent: "#4fd6ff", text: "#eaf6ff" },
      { name: "Model green", bg1: "#05130c", bg2: "#0a2a18", accent: "#3dffa0", text: "#eafff3" },
      { name: "Neon violet", bg1: "#0c0820", bg2: "#1c1147", accent: "#b388ff", text: "#f2ecff" },
      { name: "Magenta core", bg1: "#16040f", bg2: "#330a24", accent: "#ff5fc8", text: "#ffeaf7" }
    ],
    paint: paintNeuralNet
  },
  {
    id: "circuit",
    label: "Circuit board",
    description: "Etched circuit traces with glowing solder pads.",
    palettes: [
      { name: "PCB green", bg1: "#04140c", bg2: "#0a2c18", accent: "#5fffb0", text: "#eafff3" },
      { name: "Gold trace", bg1: "#0c0a04", bg2: "#241c08", accent: "#ffcf4d", text: "#fff8e6" },
      { name: "Ice blue", bg1: "#040c16", bg2: "#0a2138", accent: "#5fc9ff", text: "#eaf6ff" }
    ],
    paint: paintCircuit
  },
  {
    id: "data-stream",
    label: "Data stream",
    description: "Falling digital rain of code columns.",
    palettes: [
      { name: "Matrix green", bg1: "#020a06", bg2: "#06170e", accent: "#3dff7a", text: "#eafff0" },
      { name: "Cyber blue", bg1: "#04091a", bg2: "#0a1430", accent: "#4fa8ff", text: "#eaf3ff" },
      { name: "Amber feed", bg1: "#120a02", bg2: "#241606", accent: "#ffb24d", text: "#fff4e6" }
    ],
    paint: paintDataStream
  },
  {
    id: "particles",
    label: "Particle field",
    description: "Soft bokeh particles with cinematic depth.",
    palettes: [
      { name: "Deep space", bg1: "#060814", bg2: "#141a3a", accent: "#7aa2ff", text: "#eef2ff" },
      { name: "Ember dust", bg1: "#140805", bg2: "#3a160c", accent: "#ff8a4c", text: "#fff0e8" },
      { name: "Aqua mist", bg1: "#04141a", bg2: "#0c3a44", accent: "#5fe9f2", text: "#eafdff" },
      { name: "Rose haze", bg1: "#150611", bg2: "#3a1030", accent: "#ff7ac8", text: "#ffeaf7" }
    ],
    paint: paintParticles
  },
  {
    id: "holographic",
    label: "Holographic glass",
    description: "Iridescent wash with a frosted glass headline panel.",
    palettes: [
      { name: "Prism blue", bg1: "#06091c", bg2: "#1a2a5e", accent: "#6fd6ff", text: "#f0f6ff" },
      { name: "Vapor pink", bg1: "#100722", bg2: "#3a1660", accent: "#ff8ad4", text: "#fbeaff" },
      { name: "Mint glass", bg1: "#04140f", bg2: "#0e3a2e", accent: "#7affd0", text: "#eafff6" }
    ],
    paint: paintHolographic
  },
  {
    id: "aurora",
    label: "Aurora mesh",
    description: "Muted base with selective pops of flowing colour.",
    palettes: [
      { name: "Northern teal", bg1: "#070f16", bg2: "#0e3a4a", accent: "#6ff2c0", text: "#eafdff" },
      { name: "Dusk violet", bg1: "#0a0818", bg2: "#2a1a55", accent: "#c89bff", text: "#f2ecff" },
      { name: "Sunset coral", bg1: "#140a0c", bg2: "#451a28", accent: "#ff9e6f", text: "#fff0ea" }
    ],
    paint: paintAurora
  },
  {
    id: "cinematic",
    label: "Cinematic film",
    description: "Graded film look with grain, vignette, and letterbox bars.",
    palettes: [
      { name: "Teal & orange", bg1: "#06141a", bg2: "#11363f", accent: "#ff9a4d", text: "#f6fbff" },
      { name: "Noir steel", bg1: "#0a0c10", bg2: "#1c222c", accent: "#9fb4c8", text: "#f2f6fa" },
      { name: "Crimson reel", bg1: "#120608", bg2: "#36101a", accent: "#ff5f6f", text: "#fff0f2" }
    ],
    paint: paintCinematic
  },
  {
    id: "mega-pop",
    label: "Mega pop (high CTR)",
    description: "Loud burst with attention ring and arrow for click tests.",
    palettes: [
      { name: "Volt yellow", bg1: "#0a0a0c", bg2: "#3a3408", accent: "#ffe14d", text: "#0c0c08" },
      { name: "Hot red", bg1: "#100406", bg2: "#4d0b14", accent: "#ff4d5f", text: "#ffffff" },
      { name: "Electric cyan", bg1: "#04101a", bg2: "#0a3a4a", accent: "#3df0ff", text: "#04121a" },
      { name: "Punch green", bg1: "#06140a", bg2: "#0e3a1a", accent: "#5fff5f", text: "#04140a" }
    ],
    paint: paintMegaPop
  }
];

export function getStyle(id: BackgroundStyleId): BackgroundStyle {
  return BACKGROUND_STYLES.find((style) => style.id === id) ?? BACKGROUND_STYLES[0];
}
