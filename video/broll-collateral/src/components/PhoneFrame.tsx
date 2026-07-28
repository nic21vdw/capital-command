import React from "react";
import { theme, fontFamily } from "../theme";
import { Bar, Glyph, hexA, Text } from "./ui";

/** Native size of the phone's screen area. Scale the whole frame, not this. */
export const PHONE_SCREEN = { width: 430, height: 932 } as const;
const BEZEL = 14;

/**
 * An iPhone-shaped frame with a Dynamic Island, a status bar, and whatever
 * screen you hand it. Used for the vertical B-roll where the product needs to
 * read as "this is a real app on a real phone".
 */
export const PhoneFrame: React.FC<{
  children?: React.ReactNode;
  scale?: number;
  x?: number;
  y?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  opacity?: number;
  blur?: number;
  glow?: string;
}> = ({ children, scale = 1, x = 0, y = 0, rotateX = 0, rotateY = 0, rotateZ = 0, opacity = 1, blur = 0, glow = theme.accent }) => {
  const w = PHONE_SCREEN.width + BEZEL * 2;
  const h = PHONE_SCREEN.height + BEZEL * 2;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: w,
        height: h,
        marginLeft: -w / 2,
        marginTop: -h / 2,
        opacity,
        filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
        transform: `translate3d(${x}px, ${y}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale})`,
        transformStyle: "preserve-3d",
      }}
    >
      {/* light thrown on the room */}
      <div
        style={{
          position: "absolute",
          inset: "-30%",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${hexA(glow, 0.3)} 0%, transparent 66%)`,
          filter: "blur(70px)",
          zIndex: -1,
        }}
      />
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 58,
          padding: BEZEL,
          background: "linear-gradient(150deg, #3a4152 0%, #12161f 42%, #05070c 70%, #2b3242 100%)",
          boxShadow: `0 ${70 / scale}px ${150 / scale}px ${-24 / scale}px rgba(0,0,0,0.9)`,
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 46,
            overflow: "hidden",
            background: "#000",
            fontFamily,
          }}
        >
          {children}
          <StatusBar />
          <DynamicIsland />
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 9,
              marginLeft: -70,
              width: 140,
              height: 5,
              borderRadius: 3,
              background: "rgba(255,255,255,0.55)",
            }}
          />
        </div>
      </div>
    </div>
  );
};

const StatusBar: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 54,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 30px",
      zIndex: 3,
    }}
  >
    <Text size={15} weight={600}>
      9:41
    </Text>
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <Bar w={15} h={9} radius={2} color="rgba(255,255,255,0.75)" />
      <Bar w={13} h={9} radius={2} color="rgba(255,255,255,0.75)" />
      <Bar w={22} h={10} radius={3} color="rgba(255,255,255,0.75)" />
    </div>
  </div>
);

const DynamicIsland: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 12,
      left: "50%",
      marginLeft: -62,
      width: 124,
      height: 35,
      borderRadius: 18,
      background: "#000",
      zIndex: 4,
    }}
  />
);

const FEED = [
  { title: "This one prompt replaced my whole workflow", views: "482K", tint: theme.accent },
  { title: "Why your AI agent keeps forgetting", views: "213K", tint: theme.violet },
  { title: "Claude made my SaaS build 4x faster", views: "1.1M", tint: theme.cyan },
  { title: "The vibe coding mistake everyone makes", views: "796K", tint: theme.pink },
];

/**
 * A short-form feed screen for the phone — the format the Clip Generator
 * actually ships to. `offset` scrolls it (in screen-heights), `active` picks
 * which card shows its play state.
 */
export const PhoneFeed: React.FC<{ offset?: number }> = ({ offset = 0 }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      transform: `translateY(${-offset * PHONE_SCREEN.height}px)`,
    }}
  >
    {FEED.map((item, i) => (
      <div
        key={item.title}
        style={{
          position: "absolute",
          top: i * PHONE_SCREEN.height,
          left: 0,
          width: "100%",
          height: PHONE_SCREEN.height,
          background: `linear-gradient(165deg, ${hexA(item.tint, 0.6)} 0%, ${theme.bgDeep} 58%, #000 100%)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "0 26px 84px",
        }}
      >
        {/* pretend footage: soft light shapes behind the caption */}
        <div
          style={{
            position: "absolute",
            top: "22%",
            left: "50%",
            marginLeft: -150,
            width: 300,
            height: 300,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${hexA("#ffffff", 0.16)}, transparent 66%)`,
          }}
        />
        {/* playback progress, tucked under the status bar rather than through it */}
        <div
          style={{
            position: "absolute",
            top: 74,
            left: 26,
            right: 26,
            height: 3,
            borderRadius: 2,
            overflow: "hidden",
            background: "rgba(255,255,255,0.14)",
          }}
        >
          <div style={{ width: `${28 + i * 17}%`, height: "100%", background: "rgba(255,255,255,0.7)" }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              background: `linear-gradient(135deg, ${theme.brandLight}, ${theme.violet})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            NV
          </div>
          <Text size={15} weight={600}>
            @nicvandewetering
          </Text>
        </div>
        <Text size={27} weight={700} style={{ lineHeight: 1.2, maxWidth: 340 }}>
          {item.title}
        </Text>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <Glyph kind="play" size={14} color="rgba(255,255,255,0.8)" />
          <Text size={14} color="rgba(255,255,255,0.8)">
            {item.views} views
          </Text>
        </div>
      </div>
    ))}
  </div>
);
