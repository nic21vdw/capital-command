import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT,
  computeLoads,
  designRebar,
  designSlab,
  computePunching,
} from "./design";

describe("computeLoads", () => {
  it("applies self weight and NBCC 1.25D + 1.5L", () => {
    const loads = computeLoads(DEFAULT_INPUT);
    // 0.25 m * 24 kN/m^3 = 6.0 kPa self weight.
    expect(loads.selfWeight).toBeCloseTo(6, 3);
    expect(loads.dead).toBeCloseTo(7, 3); // + 1 kPa SDL
    // 1.25*7 + 1.5*2.4 = 8.75 + 3.6 = 12.35 kPa.
    expect(loads.factored).toBeCloseTo(12.35, 3);
  });
});

describe("designSlab (DDM)", () => {
  const result = designSlab(DEFAULT_INPUT);

  it("splits the static moment 65/35 negative/positive", () => {
    expect(result.x.negTotal / result.x.mo).toBeCloseTo(0.65, 6);
    expect(result.x.posTotal / result.x.mo).toBeCloseTo(0.35, 6);
  });

  it("gives the column strip a larger share than the middle strip", () => {
    expect(result.x.columnStrip.negPerMetre).toBeGreaterThan(result.x.middleStrip.negPerMetre);
  });

  it("produces a moment diagram that hogs at supports and sags at midspan", () => {
    const d = result.x.columnStrip.diagram;
    expect(d[0].m).toBeLessThan(0); // support: hogging (negative)
    expect(d[d.length - 1].m).toBeLessThan(0);
    expect(d[10].m).toBeGreaterThan(0); // midspan: sagging (positive)
  });

  it("keeps utilisations and punching within a sane engineering range", () => {
    expect(result.maxStripUtil).toBeGreaterThan(0.2);
    expect(result.maxStripUtil).toBeLessThan(2);
    expect(result.punching.ratio).toBeGreaterThan(0.1);
    expect(result.punching.ratio).toBeLessThan(2);
  });
});

describe("designRebar", () => {
  it("never falls below the slab minimum steel and caps spacing", () => {
    const r = designRebar(1, DEFAULT_INPUT, DEFAULT_INPUT.coverTop); // tiny moment
    const asMin = 0.002 * 1000 * DEFAULT_INPUT.h;
    expect(r.asProvided).toBeGreaterThanOrEqual(asMin * 0.95);
    expect(r.spacing).toBeLessThanOrEqual(Math.min(3 * DEFAULT_INPUT.h, 500));
  });

  it("scales steel up with moment", () => {
    const light = designRebar(30, DEFAULT_INPUT, DEFAULT_INPUT.coverTop);
    const heavy = designRebar(120, DEFAULT_INPUT, DEFAULT_INPUT.coverTop);
    expect(heavy.asRequired).toBeGreaterThan(light.asRequired);
  });
});

describe("computePunching", () => {
  it("uses the corner-column coefficient and a two-sided perimeter", () => {
    const loads = computeLoads(DEFAULT_INPUT);
    const p = computePunching(DEFAULT_INPUT, loads.factored);
    expect(p.bo).toBeGreaterThan(0);
    expect(p.vc).toBeGreaterThan(0);
    expect(p.positions).toHaveLength(4);
  });
});
