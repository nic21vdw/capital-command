import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { theme } from "../theme";

/**
 * Beamy — CoLateral's canvas buddy, ported pixel-for-pixel from the live app
 * (`CoLateral-AI/src/components/mascot/Beamy.js`). A purple pixel-art I-beam
 * pedestal wearing a domed cream hard hat with a purple "C" badge, tiny 8-bit
 * eyes and mouth, curved arms and angled feet.
 *
 * The app drives him from CSS (`beamy.css`); here every pose is frame-driven so
 * he can be scrubbed and rendered deterministically. Design grid is 32×34,
 * centred on x=16 — the same grid the app uses, so the silhouette matches
 * exactly.
 *
 * Position and entrance transforms are the PARENT's job — wrap this in a
 * positioned/animated <div>. Everything here is Beamy's own performance:
 * idle float, blink, wave, and a proper little dance.
 */

const COLS = 32;
const ROWS = 34;

export type BeamyMood = "happy" | "grin" | "wink" | "cool";
export type BeamyAction = "idle" | "think" | "inspect" | "approve" | "celebrate";

/** A pixel block on the 32×34 design grid. */
const P: React.FC<{ x: number; y: number; w: number; h: number; fill: string }> = ({
  x,
  y,
  w,
  h,
  fill,
}) => <rect x={x} y={y} width={w} height={h} fill={fill} />;

/** Two crossed blocks — the app's `sparkle()` helper. */
const Sparkle: React.FC<{ cx: number; cy: number; fill: string }> = ({ cx, cy, fill }) => (
  <>
    <P x={cx} y={cy - 1} w={1} h={3} fill={fill} />
    <P x={cx - 1} y={cy} w={3} h={1} fill={fill} />
  </>
);

export const Beamy: React.FC<{
  /** Rendered height in px (aspect ratio preserved). */
  size?: number;
  mood?: BeamyMood;
  action?: BeamyAction;
  /** Frame at which Beamy raises a hand and waves once. */
  waveFrom?: number;
  /** Frame at which Beamy starts dancing (runs until `danceUntil`). */
  danceFrom?: number;
  danceUntil?: number;
  /** Frames per dance beat — 15 @30fps = 120 BPM. */
  beat?: number;
  /** Phase offset so reused instances don't blink in lockstep. */
  phase?: number;
}> = ({
  size = 300,
  mood = "happy",
  action = "idle",
  waveFrom,
  danceFrom,
  danceUntil = Infinity,
  beat = 15,
  phase = 0,
}) => {
  const frame = useCurrentFrame() + phase;
  const { fps } = useVideoConfig();

  const px = size / ROWS;
  const w = COLS * px;
  const h = ROWS * px;

  const dancing = danceFrom != null && frame >= danceFrom && frame < danceUntil;
  const t = dancing ? frame - (danceFrom as number) : 0;

  // ---- idle float: the app's 6.5s hover, ±8px with a gentle rock ----------
  const idleBob = Math.sin((frame / fps) * Math.PI * 0.62) * (px * 0.42);
  const idleTilt = Math.sin((frame / fps) * Math.PI * 0.62) * 2;

  // ---- dance --------------------------------------------------------------
  // A four-beat 8-bit loop: step-left, step-right, hop, spin. Everything is a
  // function of the beat phase so it stays locked to `beat` regardless of fps.
  const beatIndex = Math.floor(t / beat);
  const beatPhase = (t % beat) / beat; // 0..1 within the current beat
  const inBar = beatIndex % 4;

  let danceX = 0;
  let danceY = 0;
  let danceRot = 0;
  let danceScaleX = 1;
  let danceScaleY = 1;

  if (dancing) {
    // side-to-side step on every beat, hop arc within each beat
    const side = inBar === 0 || inBar === 3 ? -1 : 1;
    danceX = side * px * 1.6 * Math.sin(beatPhase * Math.PI);
    danceY = -Math.abs(Math.sin(beatPhase * Math.PI)) * px * 1.5;
    danceRot = side * 7 * Math.sin(beatPhase * Math.PI);

    // squash on landing (start of each beat)
    const land = Math.max(0, 1 - beatPhase * 6);
    danceScaleY = 1 - 0.14 * land;
    danceScaleX = 1 + 0.11 * land;

    // beat 4 of each bar: a full 360° spin, done as a scaleX flip so the
    // pixel art never blurs through a rotation.
    if (inBar === 3) {
      danceScaleX *= Math.cos(beatPhase * Math.PI * 2);
    }
  }

  const bob = dancing ? danceY : idleBob;
  const tilt = dancing ? danceRot : idleTilt;

  // ---- blink: shut for ~4 frames every ~2.6s ------------------------------
  const blink = frame % 78 < 4 && !dancing;

  // ---- arms: idle sway, one-off wave, or alternating dance pumps ----------
  const idleSway = Math.sin((frame / fps) * Math.PI * 1.6) * 5;
  let armL = -idleSway;
  let armR = idleSway;

  if (dancing) {
    // arms alternate up on each beat, opposite to the step
    const pump = Math.sin(beatPhase * Math.PI) * 62;
    const up = inBar % 2 === 0;
    armL = up ? -pump : -6;
    armR = up ? 6 : pump;
  } else if (waveFrom != null && frame >= waveFrom) {
    const wt = frame - waveFrom;
    const waggle = Math.sin(wt * 0.9) * 32 * Math.max(0, 1 - wt / 26);
    const raise = interpolate(wt, [0, 6, 24, 32], [0, -54, -54, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    armR = raise + waggle;
  }

  // while dancing Beamy grins; celebrate sparkles ride along on the spin beat
  const activeMood: BeamyMood = dancing ? "grin" : mood;
  const activeAction: BeamyAction = dancing && inBar === 3 ? "celebrate" : action;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${COLS} ${ROWS}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Beamy — CoLateral's canvas buddy"
      style={{
        overflow: "visible",
        transform: `translate(${dancing ? danceX : 0}px, ${bob}px) rotate(${tilt}deg) scale(${danceScaleX}, ${danceScaleY})`,
        transformOrigin: "50% 100%",
        filter: `drop-shadow(0 ${px * 0.5}px ${px * 0.8}px rgba(0,0,0,0.45)) drop-shadow(0 0 ${px * 1.2}px ${theme.beamyGlow})`,
      }}
    >
      {/* ---- arms (behind the body, rotating about each shoulder) ---- */}
      <g transform={`rotate(${armL} 8 19)`}>
        <P x={7} y={19} w={2} h={1} fill={theme.beamyBody} />
        <P x={6} y={20} w={2} h={2} fill={theme.beamyBody} />
        <P x={6} y={20} w={1} h={1} fill={theme.beamyHi} />
      </g>
      <g transform={`rotate(${armR} 24 19)`}>
        <P x={23} y={19} w={2} h={1} fill={theme.beamyBody} />
        <P x={24} y={20} w={2} h={2} fill={theme.beamyBody} />
        <P x={25} y={20} w={1} h={1} fill={theme.beamyHi} />
      </g>

      {/* ---- I-beam pedestal body ---- */}
      <P x={9} y={13} w={14} h={2} fill={theme.beamyBody} />
      <P x={10} y={15} w={12} h={8} fill={theme.beamyBody} />
      <P x={8} y={23} w={16} h={2} fill={theme.beamyBody} />
      {/* highlights — top edges + left columns catch the light */}
      <P x={9} y={13} w={14} h={1} fill={theme.beamyHi} />
      <P x={10} y={15} w={1} h={8} fill={theme.beamyHi} />
      <P x={8} y={23} w={16} h={1} fill={theme.beamyHi} />
      {/* shadows — right columns + bottom edges fall away */}
      <P x={21} y={15} w={1} h={8} fill={theme.beamyShadow} />
      <P x={21} y={13} w={2} h={2} fill={theme.beamyShadow} />
      <P x={8} y={24} w={16} h={1} fill={theme.beamyShadow} />
      <P x={20} y={23} w={4} h={2} fill={theme.beamyShadow} />

      {/* ---- feet ---- */}
      <P x={11} y={25} w={3} h={1} fill={theme.beamyShadow} />
      <P x={10} y={26} w={3} h={1} fill={theme.beamyShadow} />
      <P x={18} y={25} w={3} h={1} fill={theme.beamyShadow} />
      <P x={19} y={26} w={3} h={1} fill={theme.beamyShadow} />

      {/* ---- hard hat: stepped dome, brim, and the purple "C" badge ---- */}
      <P x={13} y={4} w={6} h={1} fill={theme.beamyHat} />
      <P x={11} y={5} w={10} h={1} fill={theme.beamyHat} />
      <P x={10} y={6} w={12} h={1} fill={theme.beamyHat} />
      <P x={9} y={7} w={14} h={1} fill={theme.beamyHat} />
      <P x={9} y={8} w={14} h={1} fill={theme.beamyHat} />
      <P x={9} y={9} w={14} h={1} fill={theme.beamyHat} />
      <P x={19} y={6} w={3} h={1} fill={theme.beamyHatShade} />
      <P x={20} y={7} w={3} h={2} fill={theme.beamyHatShade} />
      <P x={7} y={10} w={18} h={1} fill={theme.beamyHat} />
      <P x={7} y={11} w={18} h={1} fill={theme.beamyHatShade} />
      <P x={14} y={5} w={5} h={1} fill={theme.beamyAccent} />
      <P x={14} y={6} w={2} h={1} fill={theme.beamyAccent} />
      <P x={14} y={7} w={2} h={1} fill={theme.beamyAccent} />
      <P x={14} y={8} w={5} h={1} fill={theme.beamyAccent} />

      {/* ---- eyes ---- */}
      {blink ? (
        <>
          <P x={13} y={18} w={2} h={1} fill={theme.beamyInk} />
          <P x={17} y={18} w={2} h={1} fill={theme.beamyInk} />
        </>
      ) : activeMood === "wink" ? (
        <>
          <P x={13} y={17} w={2} h={2} fill={theme.beamyInk} />
          <P x={17} y={18} w={2} h={1} fill={theme.beamyInk} />
        </>
      ) : activeMood === "cool" ? (
        <>
          <P x={12} y={17} w={3} h={2} fill={theme.beamyInk} />
          <P x={17} y={17} w={3} h={2} fill={theme.beamyInk} />
          <P x={15} y={17} w={2} h={1} fill={theme.beamyInk} />
          <P x={11} y={17} w={1} h={1} fill={theme.beamyInk} />
          <P x={20} y={17} w={1} h={1} fill={theme.beamyInk} />
        </>
      ) : (
        <>
          <P x={13} y={17} w={2} h={2} fill={theme.beamyInk} />
          <P x={17} y={17} w={2} h={2} fill={theme.beamyInk} />
        </>
      )}

      {/* ---- mouth ---- */}
      {activeMood === "grin" ? (
        <>
          <P x={13} y={20} w={6} h={1} fill={theme.beamyInk} />
          <P x={13} y={21} w={1} h={1} fill={theme.beamyInk} />
          <P x={18} y={21} w={1} h={1} fill={theme.beamyInk} />
          <P x={14} y={22} w={4} h={1} fill={theme.beamyInk} />
        </>
      ) : activeMood === "wink" ? (
        <>
          <P x={14} y={21} w={4} h={1} fill={theme.beamyInk} />
          <P x={18} y={20} w={1} h={1} fill={theme.beamyInk} />
        </>
      ) : activeMood === "cool" ? (
        <>
          <P x={13} y={20} w={1} h={1} fill={theme.beamyInk} />
          <P x={18} y={20} w={1} h={1} fill={theme.beamyInk} />
          <P x={13} y={21} w={6} h={1} fill={theme.beamyInk} />
        </>
      ) : (
        <>
          <P x={13} y={20} w={1} h={1} fill={theme.beamyInk} />
          <P x={18} y={20} w={1} h={1} fill={theme.beamyInk} />
          <P x={14} y={21} w={4} h={1} fill={theme.beamyInk} />
        </>
      )}

      {/* ---- mood sparkles ---- */}
      {(activeMood === "happy" || activeMood === "grin") && (
        <>
          <P x={6} y={14} w={1} h={3} fill={theme.beamyAccent} />
          <P x={5} y={15} w={3} h={1} fill={theme.beamyAccent} />
        </>
      )}
      {activeMood === "grin" && (
        <>
          <P x={26} y={16} w={1} h={3} fill={theme.beamyAccent} />
          <P x={25} y={17} w={3} h={1} fill={theme.beamyAccent} />
        </>
      )}

      {/* ---- action accessories ---- */}
      {activeAction === "think" && (
        <>
          <P x={22} y={8} w={1} h={1} fill={theme.beamyHatShade} />
          <P x={24} y={6} w={1} h={1} fill={theme.beamyHatShade} />
          <P x={25} y={2} w={5} h={3} fill={theme.beamyHat} />
          <P x={26} y={1} w={3} h={1} fill={theme.beamyHat} />
          <P x={29} y={2} w={1} h={3} fill={theme.beamyHatShade} />
        </>
      )}
      {activeAction === "inspect" && (
        <>
          <circle
            cx={14}
            cy={18}
            r={4.2}
            fill="rgba(189,147,249,0.14)"
            stroke={theme.beamyHi}
            strokeWidth={0.8}
          />
          <line
            x1={17}
            y1={21}
            x2={20}
            y2={24}
            stroke={theme.beamyHi}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        </>
      )}
      {activeAction === "approve" && (
        <>
          <P x={24} y={17} w={3} h={3} fill={theme.beamyBody} />
          <P x={24} y={17} w={1} h={1} fill={theme.beamyHi} />
          <P x={25} y={14} w={2} h={3} fill={theme.beamyBody} />
          <P x={25} y={14} w={1} h={1} fill={theme.beamyHi} />
        </>
      )}
      {activeAction === "celebrate" && (
        <>
          <Sparkle cx={5} cy={7} fill={theme.beamyAccent} />
          <Sparkle cx={27} cy={7} fill={theme.beamyAccent} />
          <Sparkle cx={16} cy={2} fill={theme.beamyHat} />
        </>
      )}
    </svg>
  );
};
