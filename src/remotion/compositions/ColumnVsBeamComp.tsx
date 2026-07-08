import React from "react";
import { AbsoluteFill } from "remotion";
import { colors } from "../theme";
import { ColumnVsBeam } from "../components/ColumnVsBeam";

/** 8s side-by-side: axial-loaded column buckles, span-loaded beam sags. */
export const ColumnVsBeamComp: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <ColumnVsBeam />
    </AbsoluteFill>
  );
};
