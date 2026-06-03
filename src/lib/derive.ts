import {
  enrichHoldings,
  getBiggestMovers,
  getCashPercentage,
  getConcentrationRisk,
  getDailyChange,
  getEstimatedAnnualDividends,
  getHoldingsMissingData,
  getLargestPositionPercentage,
  getSimplePerformance,
  getTopHoldings,
  groupByAccount,
  groupByAssetClass
} from "@/lib/calculations/portfolio";
import { deriveExpenseSummary } from "@/lib/calculations/expenses";
import type { AppData } from "@/types/domain";

export function derivePortfolioSummary(data: AppData) {
  const holdings = enrichHoldings(data.holdings);
  const totalPortfolioValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const totalCostBasis = holdings.reduce((sum, holding) => sum + holding.costBasis, 0);
  const totalGainLoss = holdings.reduce((sum, holding) => sum + holding.gainLoss, 0);

  return {
    holdings,
    expenseSummary: deriveExpenseSummary(data.expenses ?? [], data.settings.currency),
    totalPortfolioValue,
    totalCostBasis,
    totalGainLoss,
    dailyChange: getDailyChange(data.portfolioSnapshots),
    assetAllocation: groupByAssetClass(holdings),
    accountAllocation: groupByAccount(holdings),
    topHoldings: getTopHoldings(holdings),
    biggestMovers: getBiggestMovers(holdings),
    estimatedAnnualDividends: getEstimatedAnnualDividends(holdings),
    concentrationRisk: getConcentrationRisk(holdings),
    largestPositionPercentage: getLargestPositionPercentage(holdings),
    cashPercentage: getCashPercentage(holdings),
    simplePerformance: getSimplePerformance(data.portfolioSnapshots),
    holdingsMissingData: getHoldingsMissingData(data.holdings)
  };
}
