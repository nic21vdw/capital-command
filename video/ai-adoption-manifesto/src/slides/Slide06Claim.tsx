import React from "react";
import { ManifestoSlide } from "../components/ManifestoSlide";
import { SCRIPT } from "../data/script";

/** Slide 06 — THE CLAIM. AI does the same, only faster. */
export const Slide06Claim: React.FC = () => (
  <ManifestoSlide copy={SCRIPT.slide06Claim} />
);
