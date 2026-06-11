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
  }
];

export function getStyle(id: BackgroundStyleId): BackgroundStyle {
  return BACKGROUND_STYLES.find((style) => style.id === id) ?? BACKGROUND_STYLES[0];
}
