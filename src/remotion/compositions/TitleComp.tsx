import React from "react";
import { AbsoluteFill } from "remotion";
import { colors } from "../theme";
import { TitleCard } from "../components/TitleCard";
import { LowerThird } from "../components/LowerThird";

/** 4s title segment: animated title reveal + presenter lower third. */
export const TitleComp: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <TitleCard
        kicker="Structural Failure · Explained"
        title="Manhattan Column Buckling, Explained"
        subtitle="Why the headlines got the failure mode wrong — and what actually happened."
      />
      <LowerThird name="Dr. Ada Vance" credential="Structural Engineer · P.E." delay={40} />
    </AbsoluteFill>
  );
};
