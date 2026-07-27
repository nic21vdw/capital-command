import React from "react";
import { ManifestoSlide } from "../components/ManifestoSlide";
import { SCRIPT } from "../data/script";

/** Slide 13 — THE PHILOSOPHY. Start slow, start early, compound. */
export const Slide13Philosophy: React.FC = () => (
  <ManifestoSlide copy={SCRIPT.slide13Philosophy} />
);
