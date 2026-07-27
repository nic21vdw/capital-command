import React from "react";
import { ManifestoSlide } from "../components/ManifestoSlide";
import { SCRIPT } from "../data/script";

/** Slide 07 — THE CONSEQUENCE. The world moves faster than ever. */
export const Slide07Faster: React.FC = () => (
  <ManifestoSlide copy={SCRIPT.slide07Faster} ambientNodes={34} />
);
