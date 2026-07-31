import { NextRequest, NextResponse } from "next/server";
import { formatISO } from "date-fns";
import { derivePortfolioSummary } from "@/lib/derive";
import { ensureExecution } from "@/lib/execution/server";
import { todayLocal } from "@/lib/execution/dates";
import { getMarketDataProvider } from "@/lib/marketData";
import { seedData } from "@/lib/mockData/seed";
import { appDataSchema, brandAssetsSchema, clipProjectSchema, contentItemSchema, creatorProfileSchema, defaultCreatorProfile, defaultFbStrategy, executionCompletionSchema, executionGoalSchema, expenseSchema, fbPostSchema, fbStrategySchema, goalSchema, holdingSchema, importHoldingSchema, productLaunchSchema, researchNoteSchema, savedThumbnailSchema, settingsSchema, videoProjectSchema, watchlistSchema, xActivitySchema, xStrategySchema } from "@/lib/storage/schemas";
import { readAppData, resetAppData, writeAppData } from "@/lib/storage/store";
import type { AppData, ExecutionGoal, Holding } from "@/types/domain";

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
    case "updateBrandAssets": {
      data = { ...data, brandAssets: brandAssetsSchema.parse(payload) };
      break;
    }
    case "updateSettings": {
      data = { ...data, settings: settingsSchema.parse(payload) };
      break;
    }
    case "upsertContentItem": {
      const parsed = contentItemSchema.parse(payload);
      const exists = data.contentItems.some((item) => item.id === parsed.id);
      data = {
        ...data,
        contentItems: exists
          ? data.contentItems.map((item) => (item.id === parsed.id ? parsed : item))
          : [parsed, ...data.contentItems]
      };
      break;
    }
    case "deleteContentItem": {
      const id = String(payload);
      data = { ...data, contentItems: data.contentItems.filter((item) => item.id !== id) };
      break;
    }
    case "upsertSavedThumbnail": {
      const parsed = savedThumbnailSchema.parse(payload);
      const exists = data.savedThumbnails.some((item) => item.id === parsed.id);
      data = {
        ...data,
        savedThumbnails: exists
          ? data.savedThumbnails.map((item) => (item.id === parsed.id ? parsed : item))
          : [parsed, ...data.savedThumbnails]
      };
      break;
    }
    case "deleteSavedThumbnail": {
      const id = String(payload);
      data = { ...data, savedThumbnails: data.savedThumbnails.filter((item) => item.id !== id) };
      break;
    }
    case "upsertClipProject": {
      const parsed = clipProjectSchema.parse(payload);
      const exists = data.clipProjects.some((item) => item.id === parsed.id);
      data = {
        ...data,
        clipProjects: exists
          ? data.clipProjects.map((item) => (item.id === parsed.id ? parsed : item))
          : [parsed, ...data.clipProjects]
      };
      break;
    }
    case "deleteClipProject": {
      const id = String(payload);
      data = { ...data, clipProjects: data.clipProjects.filter((item) => item.id !== id) };
      break;
    }
    case "upsertVideoProject": {
      const parsed = videoProjectSchema.parse(payload);
      const exists = data.videoProjects.some((item) => item.id === parsed.id);
      data = {
        ...data,
        videoProjects: exists
          ? data.videoProjects.map((item) => (item.id === parsed.id ? parsed : item))
          : [parsed, ...data.videoProjects]
      };
      break;
    }
    case "deleteVideoProject": {
      const id = String(payload);
      data = { ...data, videoProjects: data.videoProjects.filter((item) => item.id !== id) };
      break;
    }
    case "updateCreatorProfile": {
      data = { ...data, creatorProfile: creatorProfileSchema.parse(payload) };
      break;
    }
    case "logXActivity": {
      const parsed = xActivitySchema.parse(payload);
      data = {
        ...data,
        xStrategy: {
          ...data.xStrategy,
          activities: [parsed, ...data.xStrategy.activities]
        }
      };
      break;
    }
    case "deleteXActivity": {
      const id = String(payload);
      data = {
        ...data,
        xStrategy: {
          ...data.xStrategy,
          activities: data.xStrategy.activities.filter((item) => item.id !== id)
        }
      };
      break;
    }
    case "updateXBrief": {
      const brief = xStrategySchema.shape.brief.parse((payload as { brief?: unknown })?.brief);
      data = { ...data, xStrategy: { ...data.xStrategy, brief } };
      break;
    }
    case "updateXTargets": {
      const input = (payload ?? {}) as { dailyReplyTarget?: unknown; dailyPostTarget?: unknown };
      const dailyReplyTarget = xStrategySchema.shape.dailyReplyTarget.parse(input.dailyReplyTarget);
      const dailyPostTarget = xStrategySchema.shape.dailyPostTarget.parse(input.dailyPostTarget);
      data = { ...data, xStrategy: { ...data.xStrategy, dailyReplyTarget, dailyPostTarget } };
      break;
    }
    case "upsertFbPost": {
      const parsed = fbPostSchema.parse(payload);
      const strategy = data.fbStrategy ?? defaultFbStrategy;
      const exists = strategy.posts.some((post) => post.id === parsed.id);
      data = {
        ...data,
        fbStrategy: {
          ...strategy,
          posts: exists ? strategy.posts.map((post) => (post.id === parsed.id ? parsed : post)) : [parsed, ...strategy.posts]
        }
      };
      break;
    }
    case "deleteFbPost": {
      const id = String(payload);
      const strategy = data.fbStrategy ?? defaultFbStrategy;
      data = { ...data, fbStrategy: { ...strategy, posts: strategy.posts.filter((post) => post.id !== id) } };
      break;
    }
    case "updateFbBrief": {
      const brief = fbStrategySchema.shape.brief.parse((payload as { brief?: unknown })?.brief);
      data = { ...data, fbStrategy: { ...(data.fbStrategy ?? defaultFbStrategy), brief } };
      break;
    }
    case "upsertProductLaunch": {
      const parsed = productLaunchSchema.parse({ ...(payload as object), updatedAt: new Date().toISOString() });
      const launches = data.productLaunches ?? [];
      const exists = launches.some((launch) => launch.id === parsed.id);
      data = {
        ...data,
        productLaunches: exists ? launches.map((launch) => (launch.id === parsed.id ? parsed : launch)) : [parsed, ...launches]
      };
      break;
    }
    case "deleteProductLaunch": {
      const id = String(payload);
      data = { ...data, productLaunches: (data.productLaunches ?? []).filter((launch) => launch.id !== id) };
      break;
    }
    case "toggleLaunchTask": {
      const input = (payload ?? {}) as { launchId?: string; taskId?: string; done?: boolean };
      const launch = (data.productLaunches ?? []).find((entry) => entry.id === input.launchId);
      if (!launch || !input.taskId) {
        return NextResponse.json({ error: "Unknown launch task" }, { status: 400 });
      }
      const completed = new Set(launch.completedTasks);
      if (input.done === false) completed.delete(input.taskId);
      else completed.add(input.taskId);
      data = {
        ...data,
        productLaunches: (data.productLaunches ?? []).map((entry) =>
          entry.id === launch.id
            ? { ...entry, completedTasks: [...completed], updatedAt: new Date().toISOString() }
            : entry
        )
      };
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
    case "reconcileExecution":
    case "seedExecution": {
      const today = typeof (payload as { today?: string })?.today === "string" ? (payload as { today: string }).today : todayLocal();
      data = ensureExecution(data, today).data;
      break;
    }
    case "upsertExecutionGoal": {
      const parsed = executionGoalSchema.parse(payload);
      // Keep daily/weekly targets consistent: a daily goal's weekly baseline is
      // always dailyTarget * 7; a weekly goal has no per-day target.
      const normalized: ExecutionGoal =
        parsed.frequency === "daily"
          ? { ...parsed, weeklyTarget: parsed.dailyTarget * 7, updatedAt: new Date().toISOString() }
          : { ...parsed, dailyTarget: 0, updatedAt: new Date().toISOString() };
      const exists = data.executionGoals.some((goal) => goal.id === normalized.id);
      data = {
        ...data,
        executionGoals: exists
          ? data.executionGoals.map((goal) => (goal.id === normalized.id ? normalized : goal))
          : [...data.executionGoals, normalized],
        executionSeededAt: data.executionSeededAt ?? new Date().toISOString()
      };
      break;
    }
    case "archiveExecutionGoal": {
      const id = String(payload);
      const now = new Date().toISOString();
      data = {
        ...data,
        executionGoals: data.executionGoals.map((goal) =>
          goal.id === id ? { ...goal, active: false, archivedAt: goal.archivedAt ?? now, updatedAt: now } : goal
        )
      };
      break;
    }
    case "reactivateExecutionGoal": {
      const id = String(payload);
      const now = new Date().toISOString();
      data = {
        ...data,
        executionGoals: data.executionGoals.map((goal) =>
          goal.id === id ? { ...goal, active: true, archivedAt: undefined, updatedAt: now } : goal
        )
      };
      break;
    }
    case "deleteExecutionGoal": {
      // Hard delete (destructive, confirmed client-side). Archiving is preferred
      // and preserves history; deletion removes the goal and all of its records.
      const id = String(payload);
      data = {
        ...data,
        executionGoals: data.executionGoals.filter((goal) => goal.id !== id),
        executionCompletions: data.executionCompletions.filter((entry) => entry.goalId !== id),
        executionPeriods: data.executionPeriods.filter((entry) => entry.goalId !== id),
        executionDebt: data.executionDebt.filter((entry) => entry.goalId !== id)
      };
      break;
    }
    case "reorderExecutionGoals": {
      const order = Array.isArray(payload) ? (payload as string[]) : [];
      const rank = new Map(order.map((id, index) => [id, index]));
      data = {
        ...data,
        executionGoals: data.executionGoals.map((goal) =>
          rank.has(goal.id) ? { ...goal, displayOrder: rank.get(goal.id)!, updatedAt: new Date().toISOString() } : goal
        )
      };
      break;
    }
    case "logCompletion": {
      const input = (payload ?? {}) as { goalId?: string; date?: string; quantity?: number; note?: string; today?: string };
      const goal = data.executionGoals.find((entry) => entry.id === input.goalId);
      if (!goal) {
        return NextResponse.json({ error: "Unknown goal" }, { status: 400 });
      }
      const today = typeof input.today === "string" ? input.today : todayLocal();
      const nowIso = new Date().toISOString();
      const completion = executionCompletionSchema.parse({
        id: `xcompletion-${crypto.randomUUID()}`,
        goalId: goal.id,
        date: input.date ?? today,
        timestamp: nowIso,
        quantity: input.quantity ?? 1,
        source: "manual",
        note: input.note,
        createdAt: nowIso
      });
      data = { ...data, executionCompletions: [...data.executionCompletions, completion] };
      // Reconcile in case the completion lands in (or follows) an ended week.
      data = ensureExecution(data, today).data;
      break;
    }
    case "undoCompletion": {
      const input = (payload ?? {}) as { id?: string; goalId?: string; date?: string; today?: string };
      let removedId = input.id ?? null;
      if (!removedId && input.goalId && input.date) {
        // Remove the most recently logged completion for this goal on this date.
        const candidates = data.executionCompletions
          .filter((entry) => entry.goalId === input.goalId && entry.date === input.date)
          .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
        removedId = candidates[0]?.id ?? null;
      }
      if (!removedId) {
        return NextResponse.json({ error: "Nothing to undo" }, { status: 400 });
      }
      data = {
        ...data,
        executionCompletions: data.executionCompletions.filter((entry) => entry.id !== removedId)
      };
      break;
    }
    case "resetData": {
      data = await resetAppData();
      return success(data);
    }
    case "deleteAllData": {
      data = { ...seedData, holdings: [], watchlist: [], researchNotes: [], goals: [], portfolioSnapshots: [], expenses: [], contentItems: [], creatorProfile: defaultCreatorProfile, executionGoals: [], executionCompletions: [], executionPeriods: [], executionDebt: [], savedThumbnails: [], clipProjects: [], videoProjects: [], executionSeededAt: new Date().toISOString() };
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  await writeAppData(data);
  return success(data);
}
