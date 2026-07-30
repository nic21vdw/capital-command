import { describe, expect, it } from "vitest";
import {
  getCostBasis,
  getGainLoss,
  getGainLossPercent,
  getMarketValue,
  getMonthlyContributionRequired,
  getPortfolioWeight
} from "./portfolio";

describe("portfolio calculations", () => {
  it("values a holding from its quantity and price", () => {
    expect(getMarketValue(10, 25.5)).toBe(255);
    expect(getCostBasis(8, 12.25)).toBe(98);
  });

  it("reports gain and loss in dollars and percent", () => {
    expect(getGainLoss(255, 200)).toBe(55);
    expect(getGainLossPercent(55, 200)).toBe(27.5);
  });

  it("weights a holding against the portfolio total", () => {
    expect(getPortfolioWeight(250, 1000)).toBe(25);
  });

  it("asks for a positive monthly contribution when a goal is half funded", () => {
    const required = getMonthlyContributionRequired({
      id: "goal-1",
      goalName: "Emergency fund",
      targetAmount: 24000,
      currentAmount: 12000,
      targetDate: "2027-05-01"
    });
    expect(required).toBeGreaterThan(0);
  });
});
