import { NextRequest, NextResponse } from "next/server";
import { formatISO } from "date-fns";
import { derivePortfolioSummary } from "@/lib/derive";
import { getMarketDataProvider } from "@/lib/marketData";
import { seedData } from "@/lib/mockData/seed";
import { appDataSchema, expenseSchema, goalSchema, holdingSchema, importHoldingSchema, researchNoteSchema, settingsSchema, watchlistSchema } from "@/lib/storage/schemas";
import { readAppData, resetAppData, writeAppData } from "@/lib/storage/store";
import type { AppData, Holding } from "@/types/domain";

function success(data: AppData) {
  return NextResponse.json({
    data,
    summary: derivePortfolioSummary(data)
  });
}

function toCsv(data: AppData) {
  const rows = [
    ["collection", "id", "name", "payload"],
    ...data.holdings.map((item) => ["holdings", item.id, item.name, JSON.stringify(item)]),
    ...data.watchlist.map((item) => ["watchlist", item.id, item.name, JSON.stringify(item)]),
    ...data.researchNotes.map((item) => ["researchNotes", item.id, item.title, JSON.stringify(item)]),
    ...data.goals.map((item) => ["goals", item.id, item.goalName, JSON.stringify(item)])
  ];

  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}

function buildHoldingFromImport(item: Record<string, unknown>): Holding {
  const parsed = importHoldingSchema.parse(item);
  return holdingSchema.parse({
    id: `holding-${crypto.randomUUID()}`,
    ticker: parsed.ticker.toUpperCase(),
    name: parsed.name,
    assetClass: parsed.assetClass,
    account: parsed.account,
    quantity: parsed.quantity,
    averageCost: parsed.averageCost,
    currentPrice: parsed.currentPrice,
    notes: parsed.notes,
    updatedAt: new Date().toISOString()
  });
}

async function refreshPrices(data: AppData) {
  const provider = getMarketDataProvider();
  const holdings = await Promise.all(
    data.holdings.map(async (holding) => {
      try {
        const quote = await provider.getQuote(holding.ticker);
        return {
          ...holding,
          currentPrice: quote.price,
          updatedAt: quote.lastUpdated
        };
      } catch {
        return holding;
      }
    })
  );

  const snapshots = [
    ...data.portfolioSnapshots.filter((snapshot) => snapshot.date !== formatISO(new Date(), { representation: "date" })),
    {
      date: formatISO(new Date(), { representation: "date" }),
      totalValue: holdings.reduce(
        (sum, holding) => sum + holding.quantity * (holding.manualPrice ?? holding.currentPrice ?? 0),
        0
      )
    }
  ].slice(-60);

  return appDataSchema.parse({
    ...data,
    holdings,
    portfolioSnapshots: snapshots
  });
}

export async function GET(request: NextRequest) {
  const data = await readAppData();
  const format = request.nextUrl.searchParams.get("format");

  if (format === "json") {
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=capital-command-export.json"
      }
    });
  }

  if (format === "csv") {
    return new NextResponse(toCsv(data), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=capital-command-export.csv"
      }
    });
  }

  return success(data);
}

export async function POST(request: NextRequest) {
  const { action, payload } = (await request.json()) as { action: string; payload?: unknown };
  let data = await readAppData();

  switch (action) {
    case "upsertHolding": {
      const parsed = holdingSchema.parse(payload);
      const exists = data.holdings.some((holding) => holding.id === parsed.id);
      data = {
        ...data,
        holdings: exists
          ? data.holdings.map((holding) => (holding.id === parsed.id ? parsed : holding))
          : [parsed, ...data.holdings]
      };
      break;
    }
    case "deleteHolding": {
      const id = String(payload);
      data = { ...data, holdings: data.holdings.filter((holding) => holding.id !== id) };
      break;
    }
    case "upsertWatchlistItem": {
      const parsed = watchlistSchema.parse(payload);
      const exists = data.watchlist.some((item) => item.id === parsed.id);
      data = {
        ...data,
        watchlist: exists ? data.watchlist.map((item) => (item.id === parsed.id ? parsed : item)) : [parsed, ...data.watchlist]
      };
      break;
    }
    case "deleteWatchlistItem": {
      const id = String(payload);
      data = { ...data, watchlist: data.watchlist.filter((item) => item.id !== id) };
      break;
    }
    case "moveWatchlistToHolding": {
      const item = watchlistSchema.parse(payload);
      const holding = holdingSchema.parse({
        id: `holding-${crypto.randomUUID()}`,
        ticker: item.ticker,
        name: item.name,
        assetClass: item.assetClass,
        account: "Wealthsimple TFSA",
        quantity: 0,
        averageCost: item.targetBuyPrice ?? item.currentPrice ?? 0,
        currentPrice: item.currentPrice,
        notes: item.notes ?? item.reason,
        updatedAt: new Date().toISOString()
      });
      data = {
        ...data,
        holdings: [holding, ...data.holdings],
        watchlist: data.watchlist.filter((entry) => entry.id !== item.id)
      };
      break;
    }
    case "upsertResearchNote": {
      const parsed = researchNoteSchema.parse(payload);
      const exists = data.researchNotes.some((item) => item.id === parsed.id);
      data = {
        ...data,
        researchNotes: exists
          ? data.researchNotes.map((item) => (item.id === parsed.id ? parsed : item))
          : [parsed, ...data.researchNotes]
      };
      break;
    }
    case "deleteResearchNote": {
      const id = String(payload);
      data = { ...data, researchNotes: data.researchNotes.filter((item) => item.id !== id) };
      break;
    }
    case "upsertGoal": {
      const parsed = goalSchema.parse(payload);
      const exists = data.goals.some((item) => item.id === parsed.id);
      data = { ...data, goals: exists ? data.goals.map((item) => (item.id === parsed.id ? parsed : item)) : [parsed, ...data.goals] };
      break;
    }
    case "deleteGoal": {
      const id = String(payload);
      data = { ...data, goals: data.goals.filter((item) => item.id !== id) };
      break;
    }
    case "upsertExpense": {
      const parsed = expenseSchema.parse(payload);
      const exists = data.expenses.some((item) => item.id === parsed.id);
      data = {
        ...data,
        expenses: exists
          ? data.expenses.map((item) => (item.id === parsed.id ? parsed : item))
          : [parsed, ...data.expenses]
      };
      break;
    }
    case "deleteExpense": {
      const id = String(payload);
      data = { ...data, expenses: data.expenses.filter((item) => item.id !== id) };
      break;
    }
    case "updateSettings": {
      data = { ...data, settings: settingsSchema.parse(payload) };
      break;
    }
    case "importHoldings": {
      const rows = Array.isArray(payload) ? payload : [];
      const duplicates: string[] = [];
      const imports = rows.map((row) => buildHoldingFromImport(row as Record<string, unknown>)).filter((row) => {
        const duplicate = data.holdings.find(
          (existing) =>
            existing.ticker.toUpperCase() === row.ticker.toUpperCase() &&
            existing.account.toLowerCase() === row.account.toLowerCase()
        );
        if (duplicate) {
          duplicates.push(`${row.ticker} / ${row.account}`);
          return false;
        }
        return true;
      });

      data = {
        ...data,
        holdings: [...imports, ...data.holdings]
      };

      await writeAppData(data);
      return NextResponse.json({
        data,
        summary: derivePortfolioSummary(data),
        duplicates
      });
    }
    case "refreshPrices": {
      data = await refreshPrices(data);
      break;
    }
    case "resetData": {
      data = await resetAppData();
      return success(data);
    }
    case "deleteAllData": {
      data = { ...seedData, holdings: [], watchlist: [], researchNotes: [], goals: [], portfolioSnapshots: [], expenses: [] };
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  await writeAppData(data);
  return success(data);
}
