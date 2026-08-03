"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { derivePortfolioSummary } from "@/lib/derive";
import { localDateKey } from "@/lib/x-strategy/analytics";
import { defaultXStrategy } from "@/lib/storage/schemas";
import type { AppData, ContentItem, CreatorProfile, ExecutionCategory, ExecutionGoal, Expense, FbPost, Goal, Holding, ResearchNote, Settings, WatchlistItem, XActivity, XActivityType } from "@/types/domain";

interface BootstrapPayload {
  data: AppData;
  summary: ReturnType<typeof derivePortfolioSummary>;
  apiStatus: {
    hasAlphaVantageKey: boolean;
  };
}

interface AppContextValue extends BootstrapPayload {
  loading: boolean;
  mutate: (action: string, payload?: unknown, options?: { successMessage?: string }) => Promise<void>;
  refresh: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

async function readBootstrap(): Promise<BootstrapPayload> {
  const response = await fetch("/api/bootstrap", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load app data");
  }
  return response.json();
}

/** "upsertHolding" -> "upsert holding", so a toast names what actually failed. */
function describeAction(action: string): string {
  return action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/**
 * What went wrong, in the server's own words. The route answers a rejected
 * action with `{ error }`; an unhandled throw comes back as Next's HTML error
 * page, which is worth nothing in a toast, so that falls back to the status.
 */
async function describeFailure(response: Response, action: string): Promise<string> {
  try {
    const body = await response.text();
    const parsed = body.trimStart().startsWith("{") ? (JSON.parse(body) as { error?: unknown }) : null;
    if (typeof parsed?.error === "string" && parsed.error) {
      return parsed.error;
    }
  } catch {
    // Unreadable body - the status line is still worth reporting.
  }
  return `the server answered ${response.status} for "${action}"`;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await readBootstrap();
      // Clear `loading` in the same transition that commits the payload —
      // if it cleared first, consumers would briefly see "loaded" state with
      // stale data and could mount from local fallbacks (e.g. editor drafts).
      startTransition(() => {
        setPayload(next);
        setLoading(false);
      });
    } catch {
      toast.error("Unable to load Nic Vandewetering data.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refresh]);

  const mutate = useCallback(async (action: string, payload?: unknown, options?: { successMessage?: string }) => {
    try {
      const response = await fetch("/api/data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action, payload })
      });

      if (!response.ok) {
        throw new Error(await describeFailure(response, action));
      }

      const json = (await response.json()) as Partial<BootstrapPayload> & { duplicates?: string[] };
      startTransition(() =>
        setPayload((current) => ({
          data: json.data ?? current?.data ?? payloadFallback.data,
          summary: json.summary ?? current?.summary ?? payloadFallback.summary,
          apiStatus: current?.apiStatus ?? payloadFallback.apiStatus
        }))
      );

      if (json.duplicates?.length) {
        toast.warning(`Skipped duplicates: ${json.duplicates.join(", ")}`);
      }

      if (options?.successMessage) {
        toast.success(options.successMessage);
      }
    } catch (error) {
      console.error(`[capital-command] ${action} failed`, error);
      // A TypeError here is fetch itself failing: the local server is down or
      // still rebuilding. Saying so beats blaming the action.
      const reason =
        error instanceof TypeError
          ? "the app server is not responding - is it still rebuilding?"
          : error instanceof Error
            ? error.message
            : "";
      toast.error(reason ? `Could not ${describeAction(action)}: ${reason}` : `Could not ${describeAction(action)}.`);
    }
  }, []);

  if (!payload) {
    return (
      <AppContext.Provider value={{ ...payloadFallback, loading, mutate, refresh }}>
        {children}
      </AppContext.Provider>
    );
  }

  return <AppContext.Provider value={{ ...payload, loading, mutate, refresh }}>{children}</AppContext.Provider>;
}

const emptyCreatorProfile: CreatorProfile = {
  channelName: "",
  platform: "YouTube",
  subscribers: 0,
  totalViews: 0,
  watchHours: 0,
  monetized: false,
  subscriberGoal: 1000,
  monthlyRevenueGoal: 0,
  updatedAt: new Date(0).toISOString()
};

const emptyAppData: AppData = {
  holdings: [],
  watchlist: [],
  researchNotes: [],
  goals: [],
  accounts: [],
  portfolioSnapshots: [],
  expenses: [],
  contentItems: [],
  creatorProfile: emptyCreatorProfile,
  xStrategy: defaultXStrategy,
  settings: {
    currency: "CAD",
    themePreset: "slate"
  },
  executionGoals: [],
  executionCompletions: [],
  executionPeriods: [],
  executionDebt: [],
  savedThumbnails: [],
  clipProjects: [],
  videoProjects: []
};

const payloadFallback: BootstrapPayload = {
  data: emptyAppData,
  summary: derivePortfolioSummary(emptyAppData),
  apiStatus: {
    hasAlphaVantageKey: false
  }
};

export function useAppData() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppData must be used inside AppProvider");
  }
  return context;
}

export function makeHolding(input?: Partial<Holding>): Holding {
  return {
    id: input?.id ?? `holding-${crypto.randomUUID()}`,
    ticker: input?.ticker ?? "",
    name: input?.name ?? "",
    assetClass: input?.assetClass ?? "Stocks",
    account: input?.account ?? "Wealthsimple TFSA",
    quantity: input?.quantity ?? 0,
    averageCost: input?.averageCost ?? 0,
    currentPrice: input?.currentPrice,
    manualPrice: input?.manualPrice,
    dividendYield: input?.dividendYield,
    notes: input?.notes ?? "",
    updatedAt: new Date().toISOString()
  };
}

export function makeWatchlistItem(input?: Partial<WatchlistItem>): WatchlistItem {
  return {
    id: input?.id ?? `watchlist-${crypto.randomUUID()}`,
    ticker: input?.ticker ?? "",
    name: input?.name ?? "",
    assetClass: input?.assetClass ?? "Stocks",
    currentPrice: input?.currentPrice,
    targetBuyPrice: input?.targetBuyPrice,
    reason: input?.reason ?? "",
    riskRating: input?.riskRating ?? 3,
    convictionRating: input?.convictionRating ?? 3,
    notes: input?.notes ?? "",
    dateAdded: input?.dateAdded ?? new Date().toISOString()
  };
}

export function makeResearchNote(input?: Partial<ResearchNote>): ResearchNote {
  const now = new Date().toISOString();
  return {
    id: input?.id ?? `note-${crypto.randomUUID()}`,
    title: input?.title ?? "",
    relatedTicker: input?.relatedTicker ?? "",
    thesis: input?.thesis ?? "",
    bullCase: input?.bullCase ?? "",
    bearCase: input?.bearCase ?? "",
    keyRisks: input?.keyRisks ?? "",
    valuationThoughts: input?.valuationThoughts ?? "",
    sourceLinks: input?.sourceLinks ?? [],
    tags: input?.tags ?? [],
    body: input?.body ?? "",
    createdAt: input?.createdAt ?? now,
    updatedAt: now
  };
}

export function makeGoal(input?: Partial<Goal>): Goal {
  return {
    id: input?.id ?? `goal-${crypto.randomUUID()}`,
    goalName: input?.goalName ?? "",
    targetAmount: input?.targetAmount ?? 0,
    currentAmount: input?.currentAmount ?? 0,
    targetDate: input?.targetDate,
    monthlyContribution: input?.monthlyContribution,
    notes: input?.notes ?? ""
  };
}

export function makeSettings(input?: Partial<Settings>): Settings {
  return {
    currency: input?.currency ?? "CAD",
    themePreset: input?.themePreset ?? "slate",
    profile: input?.profile
  };
}

export function makeExpense(input?: Partial<Expense>): Expense {
  const now = new Date().toISOString();
  return {
    id: input?.id ?? `expense-${crypto.randomUUID()}`,
    name: input?.name ?? "",
    vendor: input?.vendor ?? "",
    category: input?.category ?? "AI Subscription",
    frequency: input?.frequency ?? "monthly",
    amount: input?.amount ?? 0,
    currency: input?.currency ?? "USD",
    date: input?.date ?? now.slice(0, 10),
    active: input?.active ?? true,
    notes: input?.notes ?? "",
    createdAt: input?.createdAt ?? now,
    updatedAt: now
  };
}

export function makeContentItem(input?: Partial<ContentItem>): ContentItem {
  const now = new Date().toISOString();
  return {
    id: input?.id ?? `content-${crypto.randomUUID()}`,
    title: input?.title ?? "",
    type: input?.type ?? "Video",
    platform: input?.platform ?? "YouTube",
    status: input?.status ?? "Idea",
    publishDate: input?.publishDate,
    url: input?.url ?? "",
    views: input?.views,
    likes: input?.likes,
    comments: input?.comments,
    watchHours: input?.watchHours,
    revenue: input?.revenue,
    notes: input?.notes ?? "",
    createdAt: input?.createdAt ?? now,
    updatedAt: now
  };
}

export function makeExecutionGoal(input?: Partial<ExecutionGoal>): ExecutionGoal {
  const now = new Date().toISOString();
  const frequency = input?.frequency ?? "weekly";
  const dailyTarget = input?.dailyTarget ?? (frequency === "daily" ? 1 : 0);
  const weeklyTarget = input?.weeklyTarget ?? (frequency === "daily" ? dailyTarget * 7 : 1);
  return {
    id: input?.id ?? `xgoal-${crypto.randomUUID()}`,
    title: input?.title ?? "",
    description: input?.description ?? "",
    category: (input?.category ?? "CoLateral") as ExecutionCategory,
    frequency,
    dailyTarget,
    weeklyTarget,
    icon: input?.icon ?? "Target",
    displayOrder: input?.displayOrder ?? 0,
    active: input?.active ?? true,
    createdAt: input?.createdAt ?? now,
    updatedAt: now,
    archivedAt: input?.archivedAt
  };
}

export function makeCreatorProfile(input?: Partial<CreatorProfile>): CreatorProfile {
  return {
    channelName: input?.channelName ?? "",
    platform: input?.platform ?? "YouTube",
    subscribers: input?.subscribers ?? 0,
    totalViews: input?.totalViews ?? 0,
    watchHours: input?.watchHours ?? 0,
    monetized: input?.monetized ?? false,
    subscriberGoal: input?.subscriberGoal ?? 1000,
    monthlyRevenueGoal: input?.monthlyRevenueGoal ?? 0,
    updatedAt: new Date().toISOString()
  };
}

export function makeFbPost(input?: Partial<FbPost>): FbPost {
  const now = new Date().toISOString();
  return {
    id: input?.id ?? `fb-${crypto.randomUUID()}`,
    platform: input?.platform ?? "facebook",
    format: input?.format ?? "text",
    status: input?.status ?? "draft",
    date: input?.date ?? localDateKey(),
    hook: input?.hook ?? "",
    body: input?.body ?? "",
    mediaUrl: input?.mediaUrl,
    mediaName: input?.mediaName,
    threadComments: input?.threadComments ?? [],
    cta: input?.cta ?? "",
    views: input?.views,
    reactions: input?.reactions,
    comments: input?.comments,
    shares: input?.shares,
    notes: input?.notes ?? "",
    createdAt: input?.createdAt ?? now,
    updatedAt: now
  };
}

export function makeXActivity(input?: Partial<XActivity>): XActivity {
  const now = new Date().toISOString();
  return {
    id: input?.id ?? `x-${crypto.randomUUID()}`,
    type: (input?.type as XActivityType) ?? "reply",
    date: input?.date ?? localDateKey(),
    account: input?.account ?? "",
    topic: input?.topic ?? "",
    text: input?.text ?? "",
    engagement: input?.engagement ?? "",
    createdAt: input?.createdAt ?? now
  };
}
