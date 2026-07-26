import { Easing, interpolate, spring } from "remotion";

/**
 * iOS motion system for the B-roll clips.
 *
 * The app's CSS already decelerates everything on UIKit's curve
 * (`--ease-ios` in `globals.css`); these are the Remotion equivalents so the
 * footage moves the way the product does. Rule of thumb: things that ENTER use
 * a spring, things that MOVE or FADE use `easeIOS`, and nothing ever moves on
 * a linear ramp.
 */

/** UIKit default deceleration — the exact curve behind `--ease-ios`. */
export const easeIOS = Easing.bezier(0.32, 0.72, 0, 1);

/** Slight overshoot, for chips/badges that should feel springy — `--ease-ios-spring`. */
export const easeIOSSpring = Easing.bezier(0.175, 0.885, 0.32, 1.1);

/** Critically damped: glides in and settles, no wobble. Sheets, cards, screens. */
export const SPRING_SMOOTH = { damping: 26, stiffness: 110, mass: 0.9 } as const;

/** A little bounce at the end. Icons, counters, pills. */
export const SPRING_POP = { damping: 13, stiffness: 150, mass: 0.8 } as const;

/** Heavier, slower settle. Big hero elements. */
export const SPRING_HERO = { damping: 30, stiffness: 80, mass: 1.1 } as const;

/**
 * A 0 → 1 entrance value that starts at `delay` frames. Clamped, so it is safe
 * to read before the delay (returns 0) and after it settles (returns 1).
 */
export const enter = (
  frame: number,
  fps: number,
  delay = 0,
  config: { damping: number; stiffness: number; mass: number } = SPRING_SMOOTH
) => spring({ frame: frame - delay, fps, config });

/** Staggered entrance for list/grid items — index * `step` frames apart. */
export const stagger = (
  frame: number,
  fps: number,
  index: number,
  delay = 0,
  step = 4,
  config: { damping: number; stiffness: number; mass: number } = SPRING_SMOOTH
) => enter(frame, fps, delay + index * step, config);

/** Eased 0 → 1 ramp between two frames. */
export const ramp = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeIOS,
  });

/**
 * Fade up at the start of the clip and back down at the end, so any clip can be
 * dropped into a timeline and butt-cut against another without a hard flash.
 * `total` is the clip length in frames.
 */
export const clipFade = (frame: number, total: number, frames = 10) =>
  Math.min(ramp(frame, 0, frames), 1 - ramp(frame, total - frames, total));

/** Slow, endless drift — for parallax and breathing. Returns roughly -1 → 1. */
export const drift = (frame: number, periodFrames: number, phase = 0) =>
  Math.sin(((frame / periodFrames) * Math.PI * 2) + phase);
