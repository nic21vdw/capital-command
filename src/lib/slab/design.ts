/**
 * Concrete flat-plate slab design engine.
 * -----------------------------------------------------------------------------
 * Implements a single-panel Direct Design Method (DDM) check to CSA A23.3-19
 * with factored loads from NBCC 2020. The panel is a rectangular bay carried on
 * four corner columns (the common first-pass flat-plate case). Everything here
 * is pure and unit-tested; the UI layer only renders the results.
 *
 * Unit conventions
 *   geometry ....... millimetres (mm) on input, metres (m) inside span maths
 *   loads .......... kPa (kN/m^2)
 *   moments ........ kN*m (totals) and kN*m/m (per-metre design strips)
 *   stresses ....... MPa
 * Resistance factors (CSA 8.4.2): phi_c = 0.65 (concrete), phi_s = 0.85 (steel).
 */

export const PHI_C = 0.65;
export const PHI_S = 0.85;
const CONCRETE_UNIT_WEIGHT = 24; // kN/m^3, normal-density concrete

export type Direction = "x" | "y";
export type StripKind = "column" | "middle";

/** Standard Canadian reinforcing bars, smallest first. */
export const BARS = [
  { name: "10M", area: 100, dia: 11.3 },
  { name: "15M", area: 200, dia: 16.0 },
  { name: "20M", area: 300, dia: 19.5 },
  { name: "25M", area: 500, dia: 25.2 },
] as const;

export type Bar = (typeof BARS)[number];

/** NBCC 2020 specified live loads (kPa) for common occupancies (Table 4.1.5.3). */
export const OCCUPANCIES: { label: string; live: number }[] = [
  { label: "Offices (above first floor) (2.4 kPa)", live: 2.4 },
  { label: "Offices / first floor & corridors (4.8 kPa)", live: 4.8 },
  { label: "Residential — dwelling units (1.9 kPa)", live: 1.9 },
  { label: "Assembly — fixed seating (2.4 kPa)", live: 2.4 },
  { label: "Assembly — no fixed seating (4.8 kPa)", live: 4.8 },
  { label: "Retail / mercantile (4.8 kPa)", live: 4.8 },
  { label: "Storage — light (4.8 kPa)", live: 4.8 },
  { label: "Storage — heavy (7.2 kPa)", live: 7.2 },
  { label: "Roof — snow (simplified) (1.6 kPa)", live: 1.6 },
];

export interface SlabInput {
  /** Panel dimensions, column centre to column centre (mm). */
  lx: number;
  ly: number;
  /** Slab thickness (mm). */
  h: number;
  /** Square column side (mm). */
  columnSize: number;
  /** Concrete and steel strengths (MPa). */
  fc: number;
  fy: number;
  /** Clear cover to reinforcement (mm). */
  coverTop: number;
  coverBottom: number;
  /** Concrete density factor lambda (1.0 normal-density). */
  lambda: number;
  /** Superimposed dead load (kPa) and specified live load (kPa). */
  sdl: number;
  live: number;
}

export const DEFAULT_INPUT: SlabInput = {
  lx: 8000,
  ly: 6000,
  h: 250,
  columnSize: 400,
  fc: 25,
  fy: 400,
  coverTop: 20,
  coverBottom: 20,
  lambda: 1,
  sdl: 1,
  live: 2.4,
};

export interface LoadResult {
  selfWeight: number; // kPa
  dead: number; // kPa (self weight + SDL)
  liveLoad: number; // kPa
  factored: number; // kPa, 1.25D + 1.5L (NBCC 4.1.3.2)
}

export interface RebarResult {
  bar: Bar;
  spacing: number; // mm centre to centre
  asRequired: number; // mm^2 per metre width
  asProvided: number; // mm^2 per metre width
  d: number; // effective depth (mm)
  mr: number; // factored moment resistance (kN*m/m)
  utilisation: number; // Mf / Mr
}

export interface StripResult {
  direction: Direction;
  kind: StripKind;
  label: string;
  width: number; // strip width (m)
  span: number; // clear span ln along the direction (m)
  negTotal: number; // total negative moment carried by the strip (kN*m)
  posTotal: number; // total positive moment carried by the strip (kN*m)
  negPerMetre: number; // design negative moment (kN*m/m)
  posPerMetre: number; // design positive moment (kN*m/m)
  peakMoment: number; // governing (max magnitude) design moment (kN*m/m)
  rebar: RebarResult; // governing bar selection
  utilisation: number; // governing utilisation
  /** Sampled bending-moment diagram along the span, kN*m/m (sag positive). */
  diagram: { t: number; m: number }[];
}

export interface DirectionResult {
  direction: Direction;
  span: number; // clear span ln (m)
  transverse: number; // l2 (m)
  mo: number; // total static moment (kN*m)
  negTotal: number; // 0.65 Mo
  posTotal: number; // 0.35 Mo
  columnStripWidth: number; // m
  middleStripWidth: number; // m
  columnStrip: StripResult;
  middleStrip: StripResult;
}

export interface PunchingResult {
  vf: number; // factored shear force at the column (kN)
  bo: number; // critical-section perimeter (mm)
  d: number; // effective depth used (mm)
  vfStress: number; // factored shear stress (MPa)
  vc: number; // factored shear resistance (MPa)
  ratio: number; // vf / vc
  /** Column positions (fraction of panel) the ratio applies to, for drawing. */
  positions: { fx: number; fy: number }[];
}

export interface DeflectionResult {
  hMin: number; // minimum thickness ln/30 (mm)
  hProvided: number; // mm
  ok: boolean;
}

export interface SlabResult {
  loads: LoadResult;
  x: DirectionResult;
  y: DirectionResult;
  punching: PunchingResult;
  deflection: DeflectionResult;
  /** Worst strip utilisation across all four strips (0..1+). */
  maxStripUtil: number;
  strips: StripResult[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** alpha1 per CSA 10.1.7 (equivalent rectangular stress block). */
const alpha1 = (fc: number) => Math.max(0.67, 0.85 - 0.0015 * fc);

/** Factored loads per NBCC 2020: 1.25 dead + 1.5 live. */
export function computeLoads(input: SlabInput): LoadResult {
  const selfWeight = (input.h / 1000) * CONCRETE_UNIT_WEIGHT;
  const dead = selfWeight + input.sdl;
  const liveLoad = input.live;
  const factored = 1.25 * dead + 1.5 * liveLoad;
  return { selfWeight, dead, liveLoad, factored };
}

/**
 * Size flexural reinforcement for a per-metre moment (kN*m/m). Iterates the
 * stress block, applies the slab minimum (0.002 Ag, CSA 7.8.1) and the maximum
 * spacing (min(3h, 500), CSA 13.10.4), then picks the smallest bar that keeps a
 * buildable spacing.
 */
export function designRebar(
  moment: number,
  input: SlabInput,
  cover: number,
): RebarResult {
  const b = 1000; // per metre width
  const a1 = alpha1(input.fc);
  const maxSpacing = Math.min(3 * input.h, 500);
  const asMin = 0.002 * b * input.h; // shrinkage & temperature / slab minimum
  const mfNmm = Math.abs(moment) * 1e6; // kN*m/m -> N*mm per metre width

  let best: RebarResult | null = null;

  for (const bar of BARS) {
    const d = input.h - cover - bar.dia / 2;
    if (d <= 0) continue;

    // Iterate As with the rectangular stress block (a = As*phi_s*fy / (phi_c*a1*fc*b)).
    let as = mfNmm / (PHI_S * input.fy * 0.92 * d);
    for (let i = 0; i < 6; i += 1) {
      const a = (as * PHI_S * input.fy) / (PHI_C * a1 * input.fc * b);
      const lever = d - a / 2;
      as = mfNmm / (PHI_S * input.fy * Math.max(lever, 0.5 * d));
    }
    const asReq = Math.max(as, asMin);

    // Spacing that supplies asReq, rounded down to a 25 mm module and capped.
    let spacing = Math.floor((bar.area * b) / asReq / 25) * 25;
    spacing = clamp(spacing, 50, maxSpacing);
    const asProv = (bar.area * b) / spacing;

    const aProv = (asProv * PHI_S * input.fy) / (PHI_C * a1 * input.fc * b);
    const mr = (PHI_S * asProv * input.fy * (d - aProv / 2)) / 1e6; // kN*m/m
    const utilisation = mr > 0 ? Math.abs(moment) / mr : 99;

    const candidate: RebarResult = {
      bar,
      spacing,
      asRequired: asReq,
      asProvided: asProv,
      d,
      mr,
      utilisation,
    };

    // Prefer the smallest bar that lands on a comfortable spacing (>= 100 mm).
    if (spacing >= 100 && utilisation <= 1) return candidate;
    if (!best || utilisation < best.utilisation) best = candidate;
  }

  return best as RebarResult;
}

function buildStrip(
  direction: Direction,
  kind: StripKind,
  width: number,
  span: number,
  negTotal: number,
  posTotal: number,
  input: SlabInput,
): StripResult {
  const negPerMetre = negTotal / width;
  const posPerMetre = posTotal / width;
  const peakMoment = Math.max(negPerMetre, posPerMetre);
  // Negative steel sits at the top (top cover), positive steel at the bottom.
  const negBar = designRebar(negPerMetre, input, input.coverTop);
  const posBar = designRebar(posPerMetre, input, input.coverBottom);
  const rebar = negBar.utilisation >= posBar.utilisation ? negBar : posBar;
  const utilisation = Math.max(negBar.utilisation, posBar.utilisation);

  // Bending-moment diagram: hogging (negPerMetre) at both supports, sagging
  // (posPerMetre) at midspan. m(t) = 4(pos+neg)*t*(1-t) - neg, sag positive.
  const diagram: { t: number; m: number }[] = [];
  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    diagram.push({ t, m: 4 * (posPerMetre + negPerMetre) * t * (1 - t) - negPerMetre });
  }

  const dirLabel = direction === "x" ? "X" : "Y";
  const kindLabel = kind === "column" ? "Column strip" : "Middle strip";
  return {
    direction,
    kind,
    label: `${kindLabel} · ${dirLabel}`,
    width,
    span,
    negTotal,
    posTotal,
    negPerMetre,
    posPerMetre,
    peakMoment,
    rebar,
    utilisation,
    diagram,
  };
}

function analyseDirection(
  direction: Direction,
  l1mm: number, // span in this direction (mm)
  l2mm: number, // transverse span (mm)
  factored: number,
  input: SlabInput,
): DirectionResult {
  const c = input.columnSize;
  const ln = (l1mm - c) / 1000; // clear span (m)
  const l2 = l2mm / 1000;

  // Total factored static moment (CSA 13.9.2.2 / DDM).
  const mo = (factored * l2 * ln * ln) / 8;

  // Longitudinal distribution (DDM interior-span coefficients).
  const negTotal = 0.65 * mo;
  const posTotal = 0.35 * mo;

  // Column strip half-width = 0.25 * min(l1, l2) each side of the column line.
  const halfColumn = 0.25 * Math.min(l1mm, l2mm) / 1000;
  const columnStripWidth = Math.min(2 * halfColumn, l2);
  const middleStripWidth = Math.max(l2 - columnStripWidth, 0.001);

  // Transverse distribution for a flat plate without beams (CSA 13.11):
  // column strip takes 75% of negative and 60% of positive moment.
  const csNeg = 0.75 * negTotal;
  const csPos = 0.6 * posTotal;
  const msNeg = negTotal - csNeg;
  const msPos = posTotal - csPos;

  return {
    direction,
    span: ln,
    transverse: l2,
    mo,
    negTotal,
    posTotal,
    columnStripWidth,
    middleStripWidth,
    columnStrip: buildStrip(direction, "column", columnStripWidth, ln, csNeg, csPos, input),
    middleStrip: buildStrip(direction, "middle", middleStripWidth, ln, msNeg, msPos, input),
  };
}

/** Two-way (punching) shear at a corner column, CSA 13.3.4.1. */
export function computePunching(input: SlabInput, factored: number): PunchingResult {
  const c = input.columnSize;
  const cover = (input.coverTop + input.coverBottom) / 2;
  // Average effective depth across the two reinforcement layers.
  const d = input.h - cover - BARS[1].dia;
  // Corner column: critical section is two sides at d/2 from the column face.
  const bo = 2 * (c + d / 2);

  // Tributary area of a corner column is a quarter panel; drop the load that
  // falls inside the critical perimeter.
  const tributary = (input.lx / 2000) * (input.ly / 2000); // m^2
  const insideCrit = Math.pow((c + d / 2) / 1000, 2); // m^2
  const vf = factored * Math.max(tributary - insideCrit, 0); // kN

  const sqrtFc = Math.sqrt(input.fc);
  const base = input.lambda * PHI_C * sqrtFc;
  const betaC = 1; // square column
  const alphaS = 2; // corner column
  const vc = Math.min(
    (1 + 2 / betaC) * 0.19 * base,
    ((alphaS * d) / bo + 0.19) * base,
    0.38 * base,
  );
  const vfStress = (vf * 1000) / (bo * d); // MPa

  return {
    vf,
    bo,
    d,
    vfStress,
    vc,
    ratio: vc > 0 ? vfStress / vc : 99,
    positions: [
      { fx: 0, fy: 0 },
      { fx: 1, fy: 0 },
      { fx: 0, fy: 1 },
      { fx: 1, fy: 1 },
    ],
  };
}

/** Minimum thickness for a flat plate without drop panels (CSA 13.2, ln/30). */
export function computeDeflection(input: SlabInput): DeflectionResult {
  const c = input.columnSize;
  const lnLong = Math.max(input.lx, input.ly) - c; // longer clear span (mm)
  const hMin = lnLong / 30;
  return { hMin, hProvided: input.h, ok: input.h >= hMin - 0.5 };
}

export function designSlab(input: SlabInput): SlabResult {
  const loads = computeLoads(input);
  const x = analyseDirection("x", input.lx, input.ly, loads.factored, input);
  const y = analyseDirection("y", input.ly, input.lx, loads.factored, input);
  const punching = computePunching(input, loads.factored);
  const deflection = computeDeflection(input);
  const strips = [x.columnStrip, x.middleStrip, y.columnStrip, y.middleStrip];
  const maxStripUtil = Math.max(...strips.map((s) => s.utilisation));
  return { loads, x, y, punching, deflection, maxStripUtil, strips };
}
