import assert from "node:assert/strict";
import {
  getCostBasis,
  getGainLoss,
  getGainLossPercent,
  getMarketValue,
  getMonthlyContributionRequired,
  getPortfolioWeight
} from "./portfolio";

assert.equal(getMarketValue(10, 25.5), 255);
assert.equal(getCostBasis(8, 12.25), 98);
assert.equal(getGainLoss(255, 200), 55);
assert.equal(getGainLossPercent(55, 200), 27.5);
assert.equal(getPortfolioWeight(250, 1000), 25);
assert.ok(
  getMonthlyContributionRequired({
    id: "goal-1",
    goalName: "Emergency fund",
    targetAmount: 24000,
    currentAmount: 12000,
    targetDate: "2027-05-01"
  }) > 0
);

console.log("portfolio calculation tests passed");
