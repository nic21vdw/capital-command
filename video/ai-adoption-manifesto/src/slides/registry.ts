import React from "react";
import { DURATION_FRAMES } from "../config";
import { Slide01Hook } from "./Slide01Hook";
import { Slide02Split } from "./Slide02Split";
import { Slide03Fear } from "./Slide03Fear";
import { Slide04Reframe } from "./Slide04Reframe";
import { Slide05Internet } from "./Slide05Internet";
import { Slide06Claim } from "./Slide06Claim";
import { Slide07Faster } from "./Slide07Faster";
import { Slide08Choice } from "./Slide08Choice";
import { Slide09Pivot } from "./Slide09Pivot";
import { Slide10OnePerson } from "./Slide10OnePerson";
import { Slide11Colateral } from "./Slide11Colateral";
import { Slide12Enterprise } from "./Slide12Enterprise";
import { Slide13Philosophy } from "./Slide13Philosophy";
import { Slide14Close } from "./Slide14Close";

export interface SlideEntry {
  /** Composition id used by `remotion render <id>`. */
  id: string;
  component: React.FC;
  durationInFrames: number;
}

/**
 * The ordered slide manifest. Root.tsx registers one Composition per entry and
 * also stitches them into the FullVideo. Durations come from config so the
 * whole timeline retimes from one place.
 */
export const SLIDES: SlideEntry[] = [
  { id: "Slide01Hook", component: Slide01Hook, durationInFrames: DURATION_FRAMES.slide01Hook },
  { id: "Slide02Split", component: Slide02Split, durationInFrames: DURATION_FRAMES.slide02Split },
  { id: "Slide03Fear", component: Slide03Fear, durationInFrames: DURATION_FRAMES.slide03Fear },
  { id: "Slide04Reframe", component: Slide04Reframe, durationInFrames: DURATION_FRAMES.slide04Reframe },
  { id: "Slide05Internet", component: Slide05Internet, durationInFrames: DURATION_FRAMES.slide05Internet },
  { id: "Slide06Claim", component: Slide06Claim, durationInFrames: DURATION_FRAMES.slide06Claim },
  { id: "Slide07Faster", component: Slide07Faster, durationInFrames: DURATION_FRAMES.slide07Faster },
  { id: "Slide08Choice", component: Slide08Choice, durationInFrames: DURATION_FRAMES.slide08Choice },
  { id: "Slide09Pivot", component: Slide09Pivot, durationInFrames: DURATION_FRAMES.slide09Pivot },
  { id: "Slide10OnePerson", component: Slide10OnePerson, durationInFrames: DURATION_FRAMES.slide10OnePerson },
  { id: "Slide11Colateral", component: Slide11Colateral, durationInFrames: DURATION_FRAMES.slide11Colateral },
  { id: "Slide12Enterprise", component: Slide12Enterprise, durationInFrames: DURATION_FRAMES.slide12Enterprise },
  { id: "Slide13Philosophy", component: Slide13Philosophy, durationInFrames: DURATION_FRAMES.slide13Philosophy },
  { id: "Slide14Close", component: Slide14Close, durationInFrames: DURATION_FRAMES.slide14Close },
];
