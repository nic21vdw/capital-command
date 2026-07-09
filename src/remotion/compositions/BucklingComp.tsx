import React from "react";
import { AbsoluteFill } from "remotion";
import { colors } from "../theme";
import { BucklingDiagram } from "../components/BucklingDiagram";

/** 6s Euler-buckling diagram: straight, then bows into an S past P_cr. */
export const BucklingComp: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <BucklingDiagram />
    </AbsoluteFill>
  );
};
