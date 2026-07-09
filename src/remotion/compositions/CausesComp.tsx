import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { AlertTriangle, Droplets, HardHat, Ruler } from "lucide-react";
import { colors, fonts, SAFE_MARGIN, type } from "../theme";
import { CauseCard } from "../components/CauseCard";

const CARD_FRAMES = 90; // 3s each at 30fps

const CAUSES = [
  {
    icon: HardHat,
    heading: "Overload beyond design capacity",
    line: "Loads exceeded what the column was sized to carry — added floors, storage, or misjudged live loads.",
    accent: colors.pink
  },
  {
    icon: Ruler,
    heading: "Slenderness & effective length",
    line: "Too slender for its unbraced length: the critical load drops with the square of that length.",
    accent: colors.purple
  },
  {
    icon: Droplets,
    heading: "Corrosion & section loss",
    line: "Water intrusion thinned the steel, shrinking the moment of inertia that resists buckling.",
    accent: colors.cyan
  },
  {
    icon: AlertTriangle,
    heading: "Connection or bracing failure",
    line: "A lost brace or slipped connection increased the effective length and triggered instability.",
    accent: colors.red
  }
] as const;

/** 12s segment: sequences four likely-cause cards, 3s each. */
export const CausesComp: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, fontFamily: fonts.family }}>
      {/* persistent section header */}
      <div
        style={{
          position: "absolute",
          top: SAFE_MARGIN,
          left: SAFE_MARGIN,
          right: SAFE_MARGIN,
          fontSize: type.heading,
          fontWeight: fonts.weight.black,
          color: colors.foreground
        }}
      >
        Four likely causes
        <span style={{ color: colors.purple }}>.</span>
      </div>

      {CAUSES.map((c, i) => (
        <Sequence key={i} from={i * CARD_FRAMES} durationInFrames={CARD_FRAMES}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <CauseCard
              icon={c.icon}
              index={i + 1}
              total={CAUSES.length}
              heading={c.heading}
              line={c.line}
              accent={c.accent}
            />
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
