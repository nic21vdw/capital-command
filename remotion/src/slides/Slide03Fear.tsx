import React from "react";
import { ManifestoSlide } from "../components/ManifestoSlide";
import { SCRIPT } from "../data/script";

/** Slide 03 — THE FEAR. Quiet, muted; validate before the reframe. */
export const Slide03Fear: React.FC = () => (
  <ManifestoSlide copy={SCRIPT.slide03Fear} ambientNodes={16} />
);
