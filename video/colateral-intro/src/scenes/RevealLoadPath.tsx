import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Beamy } from "../components/Beamy";
import { Wordmark } from "../components/Wordmark";
import { Eyebrow } from "../components/Type";
import { theme, copy, fontFamily } from "../theme";

/**
 * Reveal 2 — "Load Path" (6s). The signature one: a reveal only a structural
 * engineering brand can run.
 *
 * A simply-supported beam spans the frame. Point loads drop onto it, it
 * deflects, and the bending-moment diagram traces out underneath. Then the
 * beam snaps back straight, the moment diagram collapses into the underline
 * rule, and "CoLateral" resolves on top of it. Beamy inspects the span, then
 * approves.
 */

const X0 = 430; // left support
const X1 = 1490; // right support
const YB = 620; // beam line
const MID = (X0 + X1) / 2;
const BEAMY_X = 590; // where Beamy stands on the span (left of the first load)

export const RevealLoadPath: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 1. beam draws in
  const beam = spring({ frame: frame - 6, fps, config: { damping: 20 } });

  // 2. three point loads drop on, staggered
  const loadAt = (i: number) =>
    spring({ frame: frame - (26 + i * 7), fps, config: { damping: 13, mass: 0.7 } });

  // 3. deflection builds as the loads land, then snaps out at frame 96
  const loaded = interpolate(frame, [34, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const release = spring({ frame: frame - 96, fps, config: { damping: 11, mass: 0.5 } });
  const sag = 62 * loaded * (1 - release);

  // 4. moment diagram traces under the beam, then collapses into the rule
  const moment = interpolate(frame, [56, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const momentFade = 1 - release;

  // 5. wordmark letters spawn as the beam straightens
  const styleFor = (i: number) => {
    const s = spring({
      frame: frame - 100 - i * 2.5,
      fps,
      config: { damping: 13, mass: 0.5 },
    });
    return {
      opacity: s,
      transform: `translateY(${interpolate(s, [0, 1], [34, 0])}px) scale(${interpolate(s, [0, 1], [0.86, 1])})`,
    };
  };

  const eyebrow = spring({ frame: frame - 128, fps, config: { damping: 18 } });

  // deflected beam path (quadratic — the classic sagging span)
  const beamPath = `M ${X0} ${YB} Q ${MID} ${YB + sag * 2} ${X1} ${YB}`;
  // moment diagram: parabola hanging below the beam
  const mDepth = 150 * moment * momentFade;
  const momentPath = `M ${X0} ${YB + 34} Q ${MID} ${YB + 34 + mDepth * 2} ${X1} ${YB + 34} Z`;

  // beam y at a given x, so the loads and Beamy ride the deflection
  const beamY = (x: number) => {
    const t = (x - X0) / (X1 - X0);
    return YB + 2 * sag * t * (1 - t) * 2;
  };

  const loadXs = [MID - 260, MID + 60, MID + 350];

  return (
    <AbsoluteFill>
      <Backdrop grid={0.55} />

      <AbsoluteFill>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {/* --- bending-moment diagram --- */}
          {moment > 0 && momentFade > 0.01 && (
            <>
              <path d={momentPath} fill={`rgba(189,147,249,${0.16 * momentFade})`} />
              <path
                d={`M ${X0} ${YB + 34} Q ${MID} ${YB + 34 + mDepth * 2} ${X1} ${YB + 34}`}
                fill="none"
                stroke={theme.indigo}
                strokeWidth={2.5}
                opacity={0.75 * momentFade}
                strokeLinecap="round"
              />
              <text
                x={MID}
                y={YB + 34 + mDepth + 46}
                textAnchor="middle"
                fill={theme.tx3}
                fontFamily={fontFamily}
                fontSize={20}
                letterSpacing="0.18em"
                opacity={0.9 * momentFade}
              >
                BENDING MOMENT
              </text>
            </>
          )}

          {/* --- the beam --- */}
          <path
            d={beamPath}
            fill="none"
            stroke={theme.brand}
            strokeWidth={12}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - beam}
            style={{ filter: "drop-shadow(0 0 18px rgba(189,147,249,.45))" }}
          />

          {/* --- supports: pin (left) and roller (right) --- */}
          <g opacity={beam}>
            <polygon
              points={`${X0},${YB + 10} ${X0 - 26},${YB + 62} ${X0 + 26},${YB + 62}`}
              fill="none"
              stroke={theme.tx2}
              strokeWidth={3}
            />
            <polygon
              points={`${X1},${YB + 10} ${X1 - 26},${YB + 56} ${X1 + 26},${YB + 56}`}
              fill="none"
              stroke={theme.tx2}
              strokeWidth={3}
            />
            <circle cx={X1 - 14} cy={YB + 64} r={7} fill="none" stroke={theme.tx2} strokeWidth={3} />
            <circle cx={X1 + 14} cy={YB + 64} r={7} fill="none" stroke={theme.tx2} strokeWidth={3} />
          </g>

          {/* --- point loads dropping onto the span --- */}
          {loadXs.map((x, i) => {
            const p = loadAt(i);
            if (p <= 0.001) return null;
            // arrowhead tips out just above the (deflected) beam line
            const yTop = interpolate(p, [0, 1], [-160, beamY(x) - 150]);
            return (
              <g key={i} opacity={Math.min(1, p * 1.6) * (1 - release)}>
                <line
                  x1={x}
                  y1={yTop}
                  x2={x}
                  y2={yTop + 108}
                  stroke={theme.amber}
                  strokeWidth={5}
                  strokeLinecap="round"
                />
                <polygon
                  points={`${x},${yTop + 132} ${x - 15},${yTop + 100} ${x + 15},${yTop + 100}`}
                  fill={theme.amber}
                />
              </g>
            );
          })}
        </svg>

        {/* --- Beamy stands on the span, inspects, then approves --- */}
        {/* his feet sit at row 27 of the 34-row sprite, so offset by 27/34 of
            the render height to plant him on the (deflecting) beam line */}
        <div
          style={{
            position: "absolute",
            left: BEAMY_X - 93,
            top: beamY(BEAMY_X) - 186 * (27 / 34) - 6,
            opacity: spring({ frame: frame - 44, fps, config: { damping: 14 } }),
          }}
        >
          <Beamy
            size={186}
            mood={frame > 100 ? "cool" : "happy"}
            action={frame > 100 ? "approve" : frame > 60 ? "inspect" : "idle"}
          />
        </div>

        {/* --- the wordmark resolves above the straightened beam ---
            kept clear of the load arrows (which live from y≈470 down to the
            beam at y=620) so nothing ever crosses the type */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 206,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 26,
          }}
        >
          <Wordmark fontSize={176} styleFor={styleFor} />
          <Eyebrow
            fontSize={24}
            style={{
              opacity: eyebrow,
              transform: `translateY(${interpolate(eyebrow, [0, 1], [14, 0])}px)`,
            }}
          >
            {copy.eyebrow}
          </Eyebrow>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
