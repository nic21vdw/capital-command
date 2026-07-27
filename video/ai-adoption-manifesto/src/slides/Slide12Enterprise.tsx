import React from "react";
import { ManifestoSlide } from "../components/ManifestoSlide";
import { SCRIPT } from "../data/script";

/** Slide 12 — THE VISION. An enterprise of tools; a lasting brand. */
export const Slide12Enterprise: React.FC = () => (
  <ManifestoSlide copy={SCRIPT.slide12Enterprise} ambientNodes={36} />
);
