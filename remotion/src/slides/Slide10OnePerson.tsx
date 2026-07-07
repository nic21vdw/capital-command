import React from "react";
import { ManifestoSlide } from "../components/ManifestoSlide";
import { SCRIPT } from "../data/script";

/** Slide 10 — THE UNLOCK. One person, the work of hundreds. */
export const Slide10OnePerson: React.FC = () => (
  <ManifestoSlide copy={SCRIPT.slide10OnePerson} />
);
