import React from "react";
import { AbsoluteFill } from "remotion";
import { colors } from "../theme";
import { HeadlineMontage } from "../components/HeadlineMontage";

/** 6s montage of fake headlines mislabelling the failed member a "beam". */
export const HeadlineComp: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <HeadlineMontage />
    </AbsoluteFill>
  );
};
