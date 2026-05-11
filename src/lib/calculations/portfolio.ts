import { differenceInCalendarMonths, parseISO } from "date-fns";
import type { Goal, Holding, PortfolioSnapshot, WatchlistItem } from "@/types/domain";

export interface EnrichedHolding extends Holding {
  resolvedPrice: number;
  marketValue: number;
  costBasis: number;
  gainLoss: number;
  gainLossPercent: number;
  portfolioWeight: number;
  annualDividendIncome: number;
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getResolvedPrice(holding: Holding): number {
  return holding.manualPrice ?? holding.currentPrice ?? 0;
}

export function getMarketValue(quantity: number, currentPrice: number): number {
  return roundCurrency(quantity * currentPrice);
}

export function getCostBasis(quantity: number, averageCost: number): number {
  return roundCurrency(quantity * averageCost);
}

export function getGainLoss(marketValue: number, costBasis: number): number {
  return roundCurrency(marketValue - costBasis);
}

export function getGainLossPercent(gainLoss: number, costBasis: number): number {
  if (costBasis === 0) return 0;
  return roundCurrency((gainLoss / costBasis) * 100);
}

export function getPortfolioWeight(marketValue: number, totalPortfolioValue: number): number {
  if (totalPortfolioValue === 0) return 0;
  return roundCurrency((marketValue / totalPortfolioValue) * 100);
}

export function getEstimatedAnnualDividendIncome(quantity: number, price: number, dividendYield?: number): number {
  if (!dividendYield) return 0;
  return roundCurrency(quantity * price * (dividendYield / 100));
}

export function getMonthlyContributionRequired(goal: Goal): number {
  if (!goal.targetDate) return 0;
  const months = Math.max(differenceInCalendarMonths(parseISO(goal.targetDate), new Date()), 1);
  const remaining = Math.max(goal.targetAmount - goal.currentAmount, 0);
  return roundCurrency(remaining / months);
}

export function enrichHoldings(holdings: Holding[]): EnrichedHolding[] {
  const firstPass = holdings.map((holding) => {
    const resolvedPrice = getResolvedPrice(holding);
    const marketValue = getMarketValue(holding.quantity, resolvedPrice);
    const costBasis = getCostBasis(holding.quantity, holding.averageCost);
    const gainLoss = getGainLoss(marketValue, costBasis);
    const gainLossPercent = getGainLossPercent(gainLoss, costBasis);
    const annualDividendIncome = getEstimatedAnnualDividendIncome(
      holding.quantity,
      resolvedPrice,
      holding.dividendYield
    );

    return {
      ...holding,
      resolvedPrice,
      marketValue,
      costBasis,
      gainLoss,
      gainLossPercent,
      annualDividendIncome,
      portfolioWeight: 0
    };
  });

  const total = firstPass.reduce((sum, holding) => sum + holding.marketValue, 0);

  return firstPass.map((holding) => ({
    ...holding,
    portfolioWeight: getPortfolioWeight(holding.marketValue, total)
  }));
}

export function getDailyChange(snapshots: PortfolioSnapshot[]): { amount: number; percent: number } {
  if (snapshots.length < 2) return { amount: 0, percent: 0 };
  const latest = snapshots[snapshots.length - 1]!;
  const previous = snapshots[snapshots.length - 2]!;
  const amount = roundCurrency(latest.totalValue - previous.totalValue);
  const percent = previous.totalValue === 0 ? 0 : roundCurrency((amount / previous.totalValue) * 100);
  return { amount, percent };
}

export function groupByAssetClass(holdings: EnrichedHolding[]) {
  return Object.entries(
    holdings.reduce<Record<string, number>>((acc, holding) => {
      acc[holding.assetClass] = (acc[holding.assetClass] ?? 0) + holding.marketValue;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value: roundCurrency(value) }));
}

export function groupByAccount(holdings: EnrichedHolding[]) {
  return Object.entries(
    holdings.reduce<Record<string, number>>((acc, holding) => {
      acc[holding.account] = (acc[holding.account] ?? 0) + holding.marketValue;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value: roundCurrency(value) }));
}

export function getBiggestMovers(holdings: EnrichedHolding[]) {
  return [...holdings].sort((a, b) => Math.abs(b.gainLossPercent) - Math.abs(a.gainLossPercent)).slice(0, 5);
}

export function getTopHoldings(holdings: EnrichedHolding[]) {
  return [...holdings].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5);
}

export function getConcentrationRisk(holdings: EnrichedHolding[]): string {
  const largest = getLargestPositionPercentage(holdings);
  if (largest >= 25) return "High";
  if (largest >= 15) return "Moderate";
  return "Low";
}

export function getLargestPositionPercentage(holdings: EnrichedHolding[]): number {
  return holdings.reduce((max, holding) => Math.max(max, holding.portfolioWeight), 0);
}

export function getCashPercentage(holdings: EnrichedHolding[]): number {
  return roundCurrency(
    holdings.filter((holding) => holding.assetClass === "Cash").reduce((sum, holding) => sum + holding.portfolioWeight, 0)
  );
}

export function getEstimatedAnnualDividends(holdings: EnrichedHolding[]): number {
  return roundCurrency(holdings.reduce((sum, holding) => sum + holding.annualDividendIncome, 0));
}

export function getSimplePerformance(snapshots: PortfolioSnapshot[]) {
  if (snapshots.length < 2) return 0;
  const start = snapshots[0]!.totalValue;
  const end = snapshots[snapshots.length - 1]!.totalValue;
  if (start === 0) return 0;
  return roundCurrency(((end - start) / start) * 100);
}

export function getHoldingsMissingData(holdings: Holding[]) {
  return holdings.filter((holding) => !holding.currentPrice && !holding.manualPrice);
}

export function getWatchlistRiskSummary(items: WatchlistItem[]) {
  return items.reduce<Record<number, number>>((acc, item) => {
    acc[item.riskRating] = (acc[item.riskRating] ?? 0) + 1;
    return acc;
  }, {});
}
