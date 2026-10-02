"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { usePathname } from "next/navigation";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { routeLabel } from "@/lib/colateral/routes";
import { derivePortfolioSummary } from "@/lib/derive";
import { setSlideSignature, setSlideTheme } from "@/lib/carousels/render";
import { setClipDescription } from "@/lib/clipping/editor";
import { localDateKey } from "@/lib/x-strategy/analytics";
import { defaultXStrategy } from "@/lib/storage/schemas";
import { DEFAULT_THEME } from "@/lib/themes";
import type { AppData, ContentItem, CreatorProfile, ExecutionCategory, ExecutionGoal, Expense, FbPost, Goal, Holding, ResearchNote, Settings, WatchlistItem, XActivity, XActivityType } from "@/types/domain";

interface BootstrapPayload {
  data: AppData;
  summary: ReturnType<typeof derivePortfolioSummary>;
  apiStatus: {
    hasAlphaVantageKey: boolean;
    publishingEnabled?: boolean;
    /** Why an unattended run would book nothing, if anything would stop it. */
    bookingBlockers?: string[];
  };
}

interface AppContextValue extends BootstrapPayload {
  loading: boolean;
  mutate: (action: string, payload?: unknown, options?: { successMessage?: string; rethrow?: boolean; signal?: AbortSignal }) => Promise<void>;
  refresh: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

interface GoodSnapshot {
  savedAt: string;
  bytes: number;
}

/** A data file the server refused to read, with what it said about it. */
export class DataUnreadable extends Error {
  constructor(
    message: string,
    readonly copyName: string | null,
    readonly snapshot: GoodSnapshot | null
  ) {
    super(message);
  }
}

async function readBootstrap(): Promise<BootstrapPayload> {
  const response = await fetch("/api/bootstrap", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    if (response.status === 503) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; unreadable?: boolean; copyName?: string | null; snapshot?: GoodSnapshot | null }
        | null;
      if (body?.unreadable) {
        throw new DataUnreadable(
          body.error ?? "The app data file could not be read.",
          body.copyName ?? null,
          body.snapshot ?? null
        );
      }
    }
    throw new Error(`The app server could not load your data (HTTP ${response.status}).`);
  }
  const payload = await response.json() as BootstrapPayload;
  if (!payload?.data?.settings || !payload.data.creatorProfile || !payload.summary || !payload.apiStatus) {
    throw new Error("The app server returned an incomplete data response.");
  }
  return payload;
}

function describeSnapshotAge(savedAt: string): string {
  const when = new Date(savedAt);
  if (Number.isNaN(when.getTime())) return "an earlier save";
  const minutes = Math.max(0, Math.round((Date.now() - when.getTime()) / 60000));
  const ago =
    minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
  return `${when.toLocaleString()} — ${ago}`;
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

function UnreadableScreen({ problem, onRetry, loading, loadError }: { problem: DataUnreadable; onRetry: () => Promise<void>; loading: boolean; loadError: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const snapshot = problem.snapshot;

  const restore = async () => {
    setRestoring(true);
    setFailure(null);
    try {
      const response = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restoreLastGoodSnapshot" })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The server answered ${response.status}.`);
      }
      window.location.reload();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The restore did not finish.");
      setRestoring(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-lg rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-6">
        <h1 className="text-lg font-semibold text-white">Your data file could not be read</h1>
        <p className="mt-2 text-sm text-amber-100/90">{problem.message}</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          The damaged file is still at <code>data\capital-command.json</code>, exactly as it was.
          {problem.copyName ? (
            <> The <code>.unreadable-…</code> copy beside it is a copy of the DAMAGED file — evidence to look at, not a backup to restore.</>
          ) : null}
        </p>

        {snapshot ? (
          confirming ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm text-white">This replaces the file the app cannot read.</p>
              <ul className="mt-2 space-y-1 text-sm text-[var(--muted-foreground)]">
                <li>
                  Replacing: <code>data\capital-command.json</code> (unreadable)
                </li>
                <li>With the copy saved {describeSnapshotAge(snapshot.savedAt)}</li>
                <li>Anything saved after that copy is not in it.</li>
              </ul>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => void restore()}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-contrast)] transition hover:opacity-90 disabled:opacity-60"
                >
                  {restoring ? "Restoring…" : "Yes, restore it"}
                </button>
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
              {failure ? <p className="mt-2 text-sm text-rose-300">{failure}</p> : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-4 block rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-contrast)] transition hover:opacity-90"
            >
              Restore the last good copy (saved {describeSnapshotAge(snapshot.savedAt)})
            </button>
          )
        ) : (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            There is no verified copy to restore from yet. Restore your own backup over{" "}
            <code>data\capital-command.json</code>, then try again.
          </p>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={() => void onRetry()}
          className="mt-4 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/5"
        >
          {loading ? "Trying again..." : "Try again"}
        </button>
        {loadError ? <p role="alert" className="mt-2 break-words text-sm text-[var(--danger)]">{loadError}</p> : null}
      </div>
    </div>
  );
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState<DataUnreadable | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await readBootstrap();
      // Clear `loading` in the same transition that commits the payload —
      // if it cleared first, consumers would briefly see "loaded" state with
      // stale data and could mount from local fallbacks (e.g. editor drafts).
      startTransition(() => {
        setPayload(next);
        setUnreadable(null);
        setLoading(false);
      });
    } catch (error) {
      // A file that could not be READ is not an empty app. Mounting every
      // screen from defaults made a corrupt document look like a brand-new
      // install, down to a "set up your profile" prompt.
      if (error instanceof DataUnreadable) {
        setUnreadable(error);
        setLoading(false);
        return;
      }
      setLoadError(error instanceof Error && error.name === "TimeoutError"
        ? "The app server took too long to load your data. Check that CoLateral Marketing is running, then try again."
        : error instanceof TypeError
          ? "The app server is not responding. Check that CoLateral Marketing is running, then try again."
          : error instanceof Error ? error.message : "Your data could not be loaded. Try again.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Whose install this is, pushed into the two renderers that sign their
  // output. Both used to hold one person's name as a constant, so anything
  // anyone exported went out under it. They default to empty and this is what
  // fills them - from the document, so it follows what Settings saved.
  useEffect(() => {
    if (!payload) return;
    setSlideSignature({
      name: payload.data.creatorProfile.channelName,
      handle: payload.data.creatorProfile.handle
    });
    setClipDescription(payload.data.settings.clipDescription ?? "");
    setSlideTheme(payload.data.settings.carouselTheme);
  }, [payload]);

  const mutate = useCallback(async (action: string, payload?: unknown, options?: { successMessage?: string; rethrow?: boolean; signal?: AbortSignal }) => {
    try {
      options?.signal?.throwIfAborted();
      const response = await fetch("/api/data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action, payload }),
        signal: options?.signal
      });

      if (!response.ok) {
        throw new Error(await describeFailure(response, action));
      }

      const json = (await response.json()) as Partial<BootstrapPayload> & { duplicates?: string[] };
      // Caller cancellation cannot undo a server write already accepted, but
      // its late response must not replace the user's newer editor/app state.
      options?.signal?.throwIfAborted();
      startTransition(() =>
        setPayload((current) => ({
          data: json.data ?? current?.data ?? payloadFallback.data,
          summary: json.summary ?? current?.summary ?? payloadFallback.summary,
          apiStatus: json.apiStatus ?? current?.apiStatus ?? payloadFallback.apiStatus
        }))
      );

      if (json.duplicates?.length) {
        toast.warning(`Skipped duplicates: ${json.duplicates.join(", ")}`);
      }

      if (options?.successMessage) {
        toast.success(options.successMessage);
      }
    } catch (error) {
      if (options?.signal?.aborted) {
        if (options.rethrow) throw error;
        return;
      }
      console.error(`[CoLateral Marketing] ${action} failed`, error);
      // A TypeError here is fetch itself failing: the local server is down or
      // still rebuilding. Saying so beats blaming the action.
      const reason =
        error instanceof TypeError
          ? "the app server is not responding - is it still rebuilding?"
          : error instanceof Error
            ? error.message
            : "";
      toast.error(reason ? `Could not ${describeAction(action)}: ${reason}` : `Could not ${describeAction(action)}.`);
      if (options?.rethrow) throw error;
    }
  }, []);

  if (unreadable) {
    return <UnreadableScreen problem={unreadable} onRetry={refresh} loading={loading} loadError={loadError} />;
  }

  if (!payload) {
    return <BootstrapScreen loadError={loadError} onRetry={refresh} />;
  }

  return <AppContext.Provider value={{ ...payload, loading, mutate, refresh }}>
    {loadError ? <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--foreground)]">
      <p className="min-w-0 flex-1 break-words">{loadError} Showing the last loaded data.</p>
      <button type="button" onClick={() => void refresh()} className="rounded-lg border border-[var(--border)] px-3 py-1.5">Try again</button>
    </div> : null}
    {children}
  </AppContext.Provider>;
}

function BootstrapScreen({ loadError, onRetry }: { loadError: string | null; onRetry: () => Promise<void> }) {
  const route = usePathname() || "/";
  useColateralSurface({
    route,
    title: routeLabel(route),
    summary: loadError ? "The workspace data could not load. Retry before editing." : "The workspace data is loading. Wait before editing.",
    fields: [],
    controls: loadError ? [{ id: "retry-workspace", label: "Try again" }] : [],
    readings: [{ label: "Workspace data", value: loadError || "Loading saved workspace" }],
    click: (id) => id === "retry-workspace" ? onRetry() : false
  });
  return <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <h1 className="text-lg font-semibold text-[var(--foreground)]">
            {loadError ? "CoLateral Marketing could not load" : "Loading CoLateral Marketing"}
          </h1>
          <p role={loadError ? "alert" : "status"} className="mt-2 break-words text-sm text-[var(--muted-foreground)]">
            {loadError || "Opening your saved workspace..."}
          </p>
          {loadError ? <button type="button" onClick={() => void onRetry()}
            className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)]">
            Try again
          </button> : null}
        </div>
      </main>;
}

const emptyCreatorProfile: CreatorProfile = {
  channelName: "",
  handle: "",
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
    themePreset: DEFAULT_THEME
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
    hasAlphaVantageKey: false,
    publishingEnabled: false,
    bookingBlockers: []
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
    themePreset: input?.themePreset ?? DEFAULT_THEME,
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
    handle: input?.handle ?? "",
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

