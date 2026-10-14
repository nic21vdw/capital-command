"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  AtSign,
  Bot,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Ear,
  Facebook,
  FileText,
  Handshake,
  Images,
  LayoutList,
  Lightbulb,
  Link2,
  Megaphone,
  Mic,
  Music4,
  Plus,
  Podcast,
  Presentation,
  Radar,
  Rocket,
  Scissors,
  Settings,
  Target,
  UploadCloud,
  Wand2,
  Workflow,
  type LucideIcon,
  WalletCards
} from "lucide-react";
import { AppFooter } from "@/components/layout/app-footer";
import { CommandBar } from "@/components/layout/command-bar";
import { FirstRun } from "@/components/layout/first-run";
import { ReleaseProvider } from "@/components/layout/release-provider";
import { UpdateBanner } from "@/components/layout/update-banner";
import { UpdateCheckButton } from "@/components/layout/update-check";
import { StreamBanner } from "@/components/layout/stream-banner";
import { StreamCard } from "@/components/layout/stream-card";
import { PipelineAttentionProvider, usePipelineAttention } from "@/components/pipeline/attention";
import { useAppData } from "@/components/providers/app-provider";
import { useColateralBridge } from "@/components/providers/colateral-bridge-provider";
import { StreamProvider, useStream } from "@/components/providers/stream-provider";
import { streamHref } from "@/lib/pipeline/streams";
import { reconnectBlocker, signInVerifiable } from "@/lib/publisher/connections";
import { PlatformIcon, PLATFORM_LABEL, type PlatformIconKey } from "@/components/ui/platform-icon";
import { cn } from "@/lib/utils";
import { ColateralMarketingMark } from "@/components/layout/colateral-marketing-mark";

type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * The sidebar IS the pipeline. CoLateral Marketing's whole point is one flow —
 * import a stream, fan it out into every format, check each one, mass-schedule
 * the lot, then manage it all on the calendar — so the nav reads as that flow,
 * top to bottom, with numbered stages on a connecting rail.
 */
type PipelineStage = { step: number; label: string; items: NavItem[] };

const PIPELINE_STAGES: PipelineStage[] = [
  {
    step: 1,
    label: "Import",
    items: [
      // One stream in (VOD link or file) → every format out, ready to schedule.
      // It is also the app's home screen, so it lives at "/" (/pipeline still
      // renders the same page for old bookmarks).
      { href: "/", label: "Stream Pipeline", icon: Workflow }
    ]
  },
  {
    step: 2,
    label: "Formats",
    items: [
      // Everything the stream trickles down into — manage, edit, and check
      // each output here before it goes anywhere.
      { href: "/longform", label: "Long-Form Video", icon: Clapperboard },
      { href: "/clips", label: "Short Clips", icon: Wand2 },
      { href: "/editor", label: "Clip Editor", icon: Scissors },
      { href: "/carousels", label: "Carousels & Images", icon: Images },
      // The long-form edit again as audio, delivered to Spotify by RSS.
      { href: "/podcast", label: "Podcast / Spotify", icon: Podcast },
      { href: "/x-posts", label: "Threads Autopilot", icon: AtSign },
      // Thread-format content engine for Facebook/Instagram (hook post +
      // numbered comment thread + CTA comment).
      { href: "/facebook", label: "FB / IG Post Library", icon: Facebook },
      // Product Hunt launch: a playbook dated backwards from launch day, the
      // listing copy, and the live standing once the listing is up.
      { href: "/launch", label: "Launch Pad", icon: Megaphone }
    ]
  },
  {
    step: 3,
    label: "Schedule",
    items: [
      // Mass-schedule the finished outputs across accounts and platforms.
      { href: "/uploading-center", label: "Uploading Center", icon: UploadCloud },
      { href: "/automations", label: "Automations", icon: Workflow },
      { href: "/distribution", label: "Distribution Centre", icon: Rocket }
    ]
  },
  {
    step: 4,
    label: "Calendar",
    items: [
      // The end of the line: everything scheduled, managed in one place.
      { href: "/master-calendar", label: "Master Calendar", icon: CalendarRange },
      // The same day read as a briefing rather than a grid.
      { href: "/day-summary", label: "Day Summary", icon: LayoutList }
    ]
  }
];

/** Supporting tools that feed the pipeline but sit outside the main flow. */
const STUDIO_ITEMS: NavItem[] = [
  { href: "/agents", label: "Sourceflow Agents", icon: Bot },
  { href: "/ideas", label: "Idea Lab", icon: Lightbulb },
  { href: "/scripts", label: "Scripts", icon: FileText },
  { href: "/outliers", label: "Outlier Radar", icon: Radar },
  // Public threads where someone is describing the problem CoLateral solves,
  // and the creators worth offering it to. Trackers only: neither page posts
  // or sends anything.
  { href: "/listening", label: "Listening", icon: Ear },
  { href: "/outreach", label: "Outreach", icon: Handshake },
  // Built, and reachable by URL alone until now: the recurring content,
  // networking and build goals that decide whether the pipeline gets fed.
  { href: "/execution", label: "Execution", icon: Target },
  { href: "/presentation", label: "Segment Deck", icon: Presentation },
  { href: "/voiceover", label: "Voiceover", icon: Mic },
  // Licensed music models (fal.ai) writing tracks into the shared library the
  // Long-Form Editor pulls from — a tool that feeds the flow, not a format.
  { href: "/music", label: "Music Studio", icon: Music4 }
];

/**
 * The personal finance screens, listed only on an install that has asked for
 * them. They were reachable by URL and by nothing else, which meant an owner
 * who wanted them had to remember the address and a buyer could stumble onto
 * them. Now the switch decides, and the switch puts them in the sidebar.
 */
const FINANCE_ITEM: NavItem = { href: "/finance", label: "Personal Finance", icon: WalletCards };
const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };

function studioItemsFor(personalDashboard: boolean | undefined): NavItem[] {
  return personalDashboard === true ? [...STUDIO_ITEMS, FINANCE_ITEM] : STUDIO_ITEMS;
}

const ALL_NAV_ITEMS = [...PIPELINE_STAGES.flatMap((stage) => stage.items), ...STUDIO_ITEMS, FINANCE_ITEM, SETTINGS_ITEM];
const SIDEBAR_COLLAPSED_KEY = "capital-command:sidebar-collapsed";
const STUDIO_OPEN_KEY = "capital-command:studio-open";
// Shown in the sidebar brand until a display name is saved in Settings.
const DEFAULT_BRAND_NAME = "Your channel";

/** "/" and "/pipeline" are the same screen, so either lights up Stream Pipeline. */
function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || (href === "/" && pathname === "/pipeline");
}

/**
 * The Stream Pipeline nav item, whichever of its two hrefs it was written with.
 * The attention count used to be gated on "/pipeline" while the item is "/",
 * which meant the badge this exists for never rendered once.
 */
function isPipelineHref(href: string): boolean {
  return href === "/" || href === "/pipeline";
}

/**
 * What the sidebar badges count for one nav item. The total in the window
 * title spans everything; each badge shows only what that page can fix, so a
 * failed post lights Uploading Center and a failed Threads post lights Threads
 * rather than all of them lighting the Pipeline.
 */
function navAttention(
  href: string,
  breakdown: { pipeline: number; publish: number; threads: number }
): { count: number; noun: string } {
  if (isPipelineHref(href)) return { count: breakdown.pipeline, noun: "needing attention" };
  if (href === "/uploading-center") return { count: breakdown.publish, noun: "failed" };
  if (href === "/x-posts") return { count: breakdown.threads, noun: "failed" };
  return { count: 0, noun: "" };
}

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// The brand mark is the profile set in Settings, not a fixed logo: the photo
// when one is uploaded, otherwise the display name's initials on the purple
// gradient badge. The line under it is the greeting — "Welcome, @handle" — so
// the first thing the sidebar says is which creator this session is posting as.
function Brand({ collapsed = false }: { collapsed?: boolean }) {
  const { data } = useAppData();
  const connections = useConnections();
  const profile = data.settings.profile;
  // The channel name typed at first-run is the fallback, so a name given there
  // is not shadowed by "Your channel" for want of a second field.
  const displayName = profile?.displayName?.trim() || data.creatorProfile.channelName.trim() || DEFAULT_BRAND_NAME;
  const avatar = profile?.avatar;
  const initials = initialsFrom(displayName) || "?";
  const handle = leadHandle(connections);

  return (
    <Link href="/" className={cn("flex items-center gap-3", collapsed && "justify-center")} title="Stream Pipeline">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-bold tracking-tight text-white",
          !avatar && "bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] text-[var(--accent-contrast)] shadow-[0_2px_10px_color-mix(in_srgb,var(--accent)_45%,transparent)]"
        )}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </span>
      <span className={cn("flex min-w-0 flex-col leading-tight", collapsed && "hidden")}>
        <span className="truncate text-sm font-semibold text-white">{displayName}</span>
        <span className="truncate text-xs text-[var(--muted-foreground)]">
          {handle ? `Welcome, @${handle}` : "Social media workspace"}
        </span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Connected publishing accounts                                       */
/* ------------------------------------------------------------------ */

type Profile = { title: string; thumbnail: string | null; handle?: string | null };

/** One platform's standing: who it posts as, and whether it can. */
type PlatformConnection = {
  platform: PlatformKey;
  profile: Profile | null;
  /** How many accounts on this platform are signed in. */
  connected: number;
  /** Signed in, but something still stops it publishing unattended. */
  blocker: string | null;
  /** The account whose last post died on an expired or revoked connection, if any. */
  reconnectAccountId: string | null;
};

type ChannelSummary = Profile & {
  /** How many other connected YouTube accounts exist beyond this one. */
  extraConnected: number;
  /** Set when this channel's last post failed on the connection: "connected" is no longer true in practice. */
  reconnect: boolean;
};

/** Every platform the app can publish as, and whether it is signed in. */
type Connections = {
  loaded: boolean;
  /** The YouTube channel this whole pipeline publishes as, when signed in. */
  channel: ChannelSummary | null;
  /** The non-YouTube platforms, in the order the sidebar lists them. */
  others: PlatformConnection[];
};

type AccountRow = {
  id: string;
  platform: string;
  primary: boolean;
  connected: boolean;
  profile?: Profile | null;
  blocker?: string | null;
  needsReconnect?: boolean;
  youtube: Profile | null;
  tiktok?: Profile | null;
};

type PlatformKey = PlatformIconKey;

const OTHER_PLATFORMS: PlatformKey[] = ["instagram", "tiktok", "facebook", "linkedin"];

const PLATFORM_STYLE: Record<PlatformKey, { label: string; tint: string; background: string }> = {
  youtube: { label: PLATFORM_LABEL.youtube, tint: "text-[#ff4d4d]", background: "bg-[#ff0000]/15" },
  instagram: { label: PLATFORM_LABEL.instagram, tint: "text-[#f0629b]", background: "bg-[#e1306c]/15" },
  tiktok: { label: PLATFORM_LABEL.tiktok, tint: "text-[#25f4ee]", background: "bg-[#25f4ee]/12" },
  facebook: { label: PLATFORM_LABEL.facebook, tint: "text-[#4f9bff]", background: "bg-[#1877f2]/20" },
  linkedin: { label: PLATFORM_LABEL.linkedin, tint: "text-[#5aa9ff]", background: "bg-[#0a66c2]/25" }
};

/**
 * The corner mark that says which network an account belongs to. A profile
 * photo is the same round picture on every platform, so without this a list of
 * connected accounts is a column of faces with no way to tell YouTube from
 * TikTok. A row with no photo shows the mark full size instead, so the badge
 * only rides on top of a picture.
 */
function PlatformBadge({ platform, className }: { platform: PlatformKey; className?: string }) {
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--panel)] bg-[var(--panel)]",
        PLATFORM_STYLE[platform].tint,
        className
      )}
    >
      <PlatformIcon platform={platform} className="h-2.5 w-2.5" />
    </span>
  );
}

const CHANNEL_CACHE_KEY = "capital-command:connected-accounts";
const CHANNEL_CACHE_TTL_MS = 60_000;

const EMPTY_CONNECTIONS: Connections = { loaded: false, channel: null, others: [] };

function profileOf(account: AccountRow): Profile | null {
  return account.profile ?? account.youtube ?? account.tiktok ?? null;
}

function connectedOn(accounts: AccountRow[], platform: string) {
  return accounts.filter((account) => account.platform === platform && account.connected);
}

function summarize(accounts: AccountRow[]): Connections {
  const youtube = connectedOn(accounts, "youtube").filter((account) => profileOf(account));
  // The primary channel is the face of the app; any primary-connected account
  // wins, otherwise the first connected one does.
  const lead = youtube.find((account) => account.primary) ?? youtube[0];
  const leadProfile = lead ? profileOf(lead) : null;
  return {
    loaded: true,
    channel: leadProfile
      ? { ...leadProfile, extraConnected: youtube.length - 1, reconnect: Boolean(lead?.needsReconnect) }
      : null,
    others: OTHER_PLATFORMS.map((platform) => {
      const signedIn = connectedOn(accounts, platform);
      return {
        platform,
        profile: signedIn.map(profileOf).find(Boolean) ?? null,
        connected: signedIn.length,
        blocker: signedIn.map((account) => account.blocker).find(Boolean) ?? null,
        reconnectAccountId: signedIn.find((account) => account.needsReconnect)?.id ?? null
      };
    })
  };
}

/** The @handle the greeting uses: the YouTube channel's, else any connected. */
function leadHandle(state: Connections): string | null {
  return state.channel?.handle || state.others.map((row) => row.profile?.handle).find(Boolean) || null;
}

/** What a row says it posts as: the @handle when the platform gives one. */
function handleLabel(profile: Profile | null, fallback: string): string {
  if (profile?.handle) return `@${profile.handle}`;
  return profile?.title ?? fallback;
}

// Both the brand line and the channel card ask for this on the same mount, so
// the request is shared rather than fired twice.
let inFlight: Promise<Connections> | null = null;

function loadConnections(): Promise<Connections> {
  if (!inFlight) {
    inFlight = (
      fetch("/api/publish/accounts", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`)))) as Promise<{ accounts?: AccountRow[] }>
    )
      .then((json) => summarize(json.accounts ?? []))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * Which publishing accounts are signed in, resolved through the local backend
 * (tokens never reach the browser). Cached briefly in sessionStorage so
 * page-to-page navigation doesn't flash the loading state or refetch every time.
 */
function useConnections(): Connections {
  const [state, setState] = useState<Connections>(EMPTY_CONNECTIONS);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(CHANNEL_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { at: number; state: Connections };
        if (Date.now() - cached.at < CHANNEL_CACHE_TTL_MS && cached.state?.loaded) {
          // Deferred like the sidebar-collapse read: a synchronous setState
          // inside an effect body triggers a cascading re-render lint error.
          queueMicrotask(() => setState(cached.state));
          return;
        }
      }
    } catch {
      // Bad cache — fall through to a fresh fetch.
    }
    let live = true;
    void loadConnections()
      .then((next) => {
        if (!live) return;
        setState(next);
        try {
          window.sessionStorage.setItem(CHANNEL_CACHE_KEY, JSON.stringify({ at: Date.now(), state: next }));
        } catch {
          // Non-critical cache write.
        }
      })
      .catch(() => {
        if (live) setState({ ...EMPTY_CONNECTIONS, loaded: true });
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}

/**
 * Whether any publishing account is connected at all. The "Connect accounts"
 * entry is for a brand-new install only: once one platform is up its chip
 * already says what is connected, and a YouTube-only prompt on every page read
 * like a login wall for an app that works without it.
 */
function nothingConnected(state: Connections): boolean {
  return !state.channel && state.others.every((row) => row.connected === 0);
}

/** The channel avatar circle, shared by the sidebar card and the mobile bar. */
function ChannelAvatar({ channel, className }: { channel: ChannelSummary; className?: string }) {
  return (
    <span className={cn("relative shrink-0", className)}>
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white/10 ring-2 ring-[#ff0000]/60">
        {channel.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
          <img src={channel.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <PlatformIcon platform="youtube" className="h-1/2 w-1/2 text-[#ff0000]" />
        )}
      </span>
      {channel.thumbnail && <PlatformBadge platform="youtube" />}
    </span>
  );
}

/**
 * The channel card right under the brand: who this whole pipeline publishes
 * as. Connected → avatar, channel name, live dot (opens the Uploading Center);
 * not connected → a sign-in call to action straight into Google OAuth.
 */
function ChannelCard({ collapsed = false }: { collapsed?: boolean }) {
  const state = useConnections();

  // The card is reserved at its connected height, in both the tall and the
  // short-screen layouts, before the connections arrive and after they do:
  // the skeleton, a connected channel, a "Connect accounts" prompt and a row of
  // platform chips are all different heights, and the nav under them moved by
  // the difference every time the fetch landed.
  const reserve = collapsed
    ? "min-h-[58px] [@media(max-height:960px)]:min-h-[42px]"
    : "min-h-[94px] [@media(max-height:960px)]:min-h-[42px]";

  if (!state.loaded) {
    return (
      <div className={reserve}>
        <div
          aria-hidden="true"
          className={cn(
            "flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.03] px-3 py-2.5 [@media(max-height:960px)]:py-1.5",
            collapsed && "justify-center px-2"
          )}
        >
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/10 [@media(max-height:960px)]:h-7 [@media(max-height:960px)]:w-7" />
          <span className={cn("flex min-w-0 flex-1 flex-col gap-1.5", collapsed && "hidden")}>
            <span className="h-2.5 w-24 animate-pulse rounded bg-white/10" />
            <span className="h-2 w-16 animate-pulse rounded bg-white/5 [@media(max-height:960px)]:hidden" />
          </span>
        </div>
      </div>
    );
  }

  const channel = state.channel;
  return (
    // On a short screen the account chips sit beside the channel instead of
    // under it: the row is worth more as height for the nav.
    <div className={cn("space-y-2", reserve, !collapsed && "[@media(max-height:960px)]:flex [@media(max-height:960px)]:items-center [@media(max-height:960px)]:gap-1.5 [@media(max-height:960px)]:space-y-0")}>
      {channel ? (
        <Link
          href={channel.reconnect ? "/api/auth/google" : "/uploading-center"}
          prefetch={channel.reconnect ? false : undefined}
          title={
            channel.reconnect
              ? reconnectBlocker("YouTube")
              : collapsed ? `${channel.title} — YouTube` : "Manage channel accounts in the Uploading Center"
          }
          className={cn(
            "group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-gradient-to-br from-white/[0.06] to-transparent px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:from-white/[0.09] [@media(max-height:960px)]:min-w-0 [@media(max-height:960px)]:flex-1 [@media(max-height:960px)]:py-1.5",
            collapsed && "justify-center px-2"
          )}
        >
          <ChannelAvatar channel={channel} className="h-9 w-9 [@media(max-height:960px)]:h-7 [@media(max-height:960px)]:w-7" />
          <span className={cn("flex min-w-0 flex-1 flex-col leading-tight", collapsed && "hidden")}>
            <span className="truncate text-sm font-semibold text-white">{channel.title}</span>
            <span className={cn("flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]", !channel.reconnect && "[@media(max-height:960px)]:hidden")}>
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", channel.reconnect ? "bg-amber-400" : "bg-emerald-400")} />
              <span className="truncate">{channel.reconnect ? "Reconnect YouTube" : handleLabel(channel, "YouTube")}</span>
              {channel.extraConnected > 0 ? <span className="shrink-0">+{channel.extraConnected}</span> : null}
            </span>
          </span>
        </Link>
      ) : nothingConnected(state) ? (
        <Link
          href="/settings#accounts"
          title="Connect accounts: pick where posts go. Start with YouTube."
          className={cn(
            "group flex items-center gap-2.5 rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 transition hover:border-[var(--accent)]/60 hover:bg-white/[0.04] [@media(max-height:960px)]:min-w-0 [@media(max-height:960px)]:flex-1",
            collapsed && "justify-center px-2"
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)] transition group-hover:bg-[var(--accent)]/25">
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className={cn("min-w-0 flex-1 truncate text-sm font-medium text-white", collapsed && "hidden")}>Connect accounts</span>
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]", collapsed && "hidden")} aria-hidden="true" />
        </Link>
      ) : null}
      <ConnectionRows state={state} collapsed={collapsed} />
    </div>
  );
}

/**
 * Where a platform chip goes. A not-connected chip leads to Settings > Accounts,
 * which is where every platform is connected; sending it to the Uploading Center
 * dropped people on a screen that cannot add credentials. A chip whose last post
 * died on the connection goes straight to that platform's sign-in where it has
 * one, and otherwise to Settings.
 */
function chipHref(row: PlatformConnection): string {
  if (row.reconnectAccountId) {
    return row.platform === "tiktok"
      ? `/api/auth/tiktok?account=${encodeURIComponent(row.reconnectAccountId)}`
      : "/settings#accounts";
  }
  return row.connected > 0 ? "/uploading-center" : "/settings#accounts";
}

/**
 * The other places a stream goes out. YouTube gets the card above because the
 * app publishes as that channel; Instagram, TikTok and Facebook get a line
 * each, showing the @handle they post as, so it is obvious at a glance which
 * of them can actually post without a person in the loop.
 *
 * A row has three states, not two. Green is posting unattended; amber is
 * signed in but held up by something outside the app (a permission the token
 * never got, an app still in review) — the case that otherwise only surfaces
 * as a failed upload hours later; grey is not connected at all.
 */
function ConnectionRows({ state, collapsed }: { state: Connections; collapsed: boolean }) {
  // Only platforms that are signed in (or held up) earn a chip. A "not
  // connected" row per platform used to stack three dashed boxes above the nav
  // and push half of it below the fold; the single Connect entry (nothing
  // connected) or the "+" chip (some connected) already leads to Accounts.
  const shown = state.others.filter((row) => row.connected > 0 || row.reconnectAccountId);
  if (shown.length === 0) return null;
  const hasUnconnected = state.others.some((row) => row.connected === 0 && !row.reconnectAccountId);
  return (
    <div className={cn("flex gap-1.5", collapsed ? "flex-col items-center" : "flex-row flex-wrap items-center px-0.5 [@media(max-height:960px)]:shrink-0 [@media(max-height:960px)]:flex-nowrap [@media(max-height:960px)]:px-0")}>
      {shown.map((row) => {
        const style = PLATFORM_STYLE[row.platform];
        const connected = row.connected > 0;
        const held = connected && Boolean(row.blocker);
        // Same notion Settings uses: a pasted token (Instagram, Facebook) is only
        // saved, never verified, so it must not read as a working green sign-in.
        const unverified = connected && !signInVerifiable(row.platform);
        const detail = row.reconnectAccountId
          ? `Reconnect ${style.label}`
          : connected
            ? unverified ? `${style.label} · saved, not verified` : handleLabel(row.profile, style.label)
            : `${style.label} · not connected`;
        const needsAttention = held || unverified || Boolean(row.reconnectAccountId);
        const dot = held || row.reconnectAccountId ? "bg-amber-400" : unverified ? "bg-white/30" : connected ? "bg-emerald-400" : "bg-white/20";
        return (
          <Link
            key={row.platform}
            href={chipHref(row)}
            prefetch={row.reconnectAccountId ? false : undefined}
            title={row.blocker ? `${style.label} — ${row.blocker}` : unverified ? detail : `${style.label} — ${detail}`}
            aria-label={detail}
            className={cn(
              "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition hover:border-[var(--border-strong)]",
              needsAttention ? "border-dashed border-amber-400/50" : "border-[var(--border)]"
            )}
          >
            <span
              className={cn(
                "flex h-full w-full items-center justify-center overflow-hidden rounded-full",
                style.background,
                style.tint,
                unverified && "opacity-60"
              )}
            >
              {row.profile?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
                <img src={row.profile.thumbnail} alt="" className="h-full w-full object-cover" />
              ) : (
                <PlatformIcon platform={row.platform} className="h-3.5 w-3.5" />
              )}
            </span>
            <span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-[var(--panel)]", dot)} />
          </Link>
        );
      })}
      {hasUnconnected && (
        <Link
          href="/settings#accounts"
          title="Connect another account"
          aria-label="Connect another account"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[var(--muted-foreground)] transition hover:border-[var(--accent)]/60 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function NavLink({ item, active, collapsed = false }: { item: NavItem; active: boolean; collapsed?: boolean }) {
  const Icon = item.icon;
  // A stage that broke overnight has to be visible from wherever he is, not
  // only from the run he would have to think to open.
  const { breakdown } = usePipelineAttention();
  const { count: attention, noun } = navAttention(item.href, breakdown);
  // Walking down the flow keeps the stream you are working on. Every screen
  // below used to open on everything the app had ever made, so following the
  // sidebar meant hunting for your own recording on each one.
  const { stream } = useStream();
  const href = streamHref(item.href, stream);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={
        attention > 0
          ? `${item.label}: ${attention} ${noun}`
          : collapsed
            ? item.label
            : undefined
      }
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1 text-sm transition [@media(max-height:960px)]:py-0.5",
        collapsed && "justify-center px-2 py-2",
        active
          ? "bg-white/8 font-medium text-white"
          : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white"
      )}
    >
      <span className="relative flex shrink-0 items-center">
        <Icon className={cn("h-4 w-4 shrink-0", active && "text-[var(--accent)]")} />
        {attention > 0 && collapsed && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400" />
        )}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {attention > 0 && !collapsed && (
        <span className="ml-auto shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
          {attention}
        </span>
      )}
    </Link>
  );
}

/**
 * The scrolling part of the sidebar. At laptop heights the header and footer
 * leave the nav a few hundred pixels, so two things keep the rest findable:
 * the active page is scrolled into view when the page opens, and a fade along
 * the bottom edge says there is more below while there is.
 */
function SidebarScroll({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const measure = () => setMoreBelow(nav.scrollHeight - nav.scrollTop - nav.clientHeight > 4);
    measure();
    nav.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(nav);
    if (nav.firstElementChild) observer?.observe(nav.firstElementChild);
    return () => {
      nav.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);

  // Same as scrollIntoView({ block: "nearest" }) but only ever moves the nav,
  // never the page behind it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nav = ref.current;
      const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!nav || !link) return;
      const navBox = nav.getBoundingClientRect();
      const linkBox = link.getBoundingClientRect();
      const margin = 24;
      if (linkBox.bottom > navBox.bottom - margin) nav.scrollTop += linkBox.bottom - navBox.bottom + margin;
      else if (linkBox.top < navBox.top + margin) nav.scrollTop -= navBox.top + margin - linkBox.top;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <nav ref={ref} aria-label="Marketing navigation" className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <div className="space-y-4 [@media(max-height:820px)]:space-y-2">{children}</div>
      </nav>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--panel)] to-transparent transition-opacity duration-200",
          moreBelow ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}

/** The numbered node on the pipeline rail; lights up while its stage is open. */
function StageNode({ step, active }: { step: number; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition",
        active
          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_55%,transparent)]"
          : "border-[var(--border-strong)] bg-[var(--panel)] text-[var(--muted-foreground)]"
      )}
    >
      {step}
    </span>
  );
}

/**
 * The tools that feed the pipeline without being part of it. They are opened a
 * few times a week and the flow above is opened every day, so they fold away
 * behind one row — open while you are on one of them, and remembered after.
 */
function StudioSection({
  items,
  pathname,
  collapsed
}: {
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
}) {
  const onStudioPage = items.some((item) => isActivePath(pathname, item.href));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        if (window.localStorage.getItem(STUDIO_OPEN_KEY) === "1") setOpen(true);
      } catch {
        // Non-critical preference read.
      }
    });
  }, []);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STUDIO_OPEN_KEY, next ? "1" : "0");
      } catch {
        // Non-critical preference persistence.
      }
      return next;
    });
  };

  if (collapsed) {
    return (
      <div>
        <div className="mx-3 border-t border-[var(--border)] pb-1" />
        <p className="sr-only">Studio</p>
        <div className="space-y-0.5">
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} collapsed />
          ))}
        </div>
      </div>
    );
  }

  const showItems = open || onStudioPage;
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={showItems}
        className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)] transition hover:text-white"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition", !showItems && "-rotate-90")} />
        <span className="flex-1 text-left">Studio</span>
        {!showItems && <span className="normal-case tracking-normal">{items.length}</span>}
      </button>
      {showItems && (
        <div className="mt-1 space-y-0.5">
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One pipeline stage: numbered node + connector on the rail, links beside. */
function StageGroup({
  stage,
  pathname,
  last
}: {
  stage: PipelineStage;
  pathname: string;
  last: boolean;
}) {
  const stageActive = stage.items.some((item) => isActivePath(pathname, item.href));
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <StageNode step={stage.step} active={stageActive} />
        {!last && (
          <span className={cn("w-px flex-1", stageActive ? "bg-[var(--accent)]/50" : "bg-[var(--border-strong)]")} />
        )}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-3 [@media(max-height:960px)]:pb-2 [@media(max-height:820px)]:pb-1")}>
        <p
          className={cn(
            "px-2.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider",
            stageActive ? "text-white" : "text-[var(--muted-foreground)]"
          )}
        >
          {stage.label}
        </p>
        <div className="mt-1 space-y-0.5 [@media(max-height:820px)]:space-y-0">
          {stage.items.map((item) => (
            <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Collapsed rail: step chips between icon runs keep the flow readable. */
function CollapsedPipeline({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-1">
      {PIPELINE_STAGES.map((stage) => (
        <div key={stage.step} className="space-y-1">
          <div className="flex justify-center pt-1" title={`Step ${stage.step} · ${stage.label}`}>
            <StageNode step={stage.step} active={stage.items.some((item) => isActivePath(pathname, item.href))} />
          </div>
          {stage.items.map((item) => (
            <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} collapsed />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Below `lg` the app is often living in a quarter of a screen — a pane in
 * CoLateral, a snapped window — where the old strip of twenty-three tabs meant
 * scrolling sideways to reach anything. One row instead: which screen you are
 * on, opening a grouped menu of all of them, with the accounts and settings
 * beside it.
 */
function NarrowChrome({ pathname }: { pathname: string }) {
  const { data: appData } = useAppData();
  const studioItems = studioItemsFor(appData.settings.personalDashboard);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector<HTMLAnchorElement>("a[aria-current='page']")
      ?? menuRef.current?.querySelector<HTMLAnchorElement>("a");
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  const current = ALL_NAV_ITEMS.find((item) => isActivePath(pathname, item.href)) ?? ALL_NAV_ITEMS[0];
  const CurrentIcon = current.icon;

  return (
    <div className="relative z-50 mb-3 lg:hidden">
      <div className="glass-inset relative flex items-center gap-2 rounded-xl border p-1.5">
        <ColateralMarketingMark collapsed className="pl-1" />
        <div className="min-w-0 flex-1">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={`${current.label} — ${menuOpen ? "close" : "open"} navigation`}
            className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5"
          >
            <CurrentIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{current.label}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition", menuOpen && "rotate-180")} />
          </button>
          {menuOpen && (
              <nav
                ref={menuRef}
                id={menuId}
                aria-label="Marketing navigation"
                className="glass-popover absolute inset-x-0 top-full z-50 mt-1.5 max-h-[70dvh] overflow-y-auto rounded-xl border p-2"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) {
                    setMenuOpen(false);
                  }
                }}
              >
                {PIPELINE_STAGES.map((stage) => (
                  <div key={stage.step} className="pb-1.5">
                    <p className="flex items-center gap-1.5 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      <StageNode step={stage.step} active={stage.items.some((item) => isActivePath(pathname, item.href))} />
                      {stage.label}
                    </p>
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                      {stage.items.map((item) => (
                        <NarrowNavItem
                          key={item.href}
                          item={item}
                          active={isActivePath(pathname, item.href)}
                          onSelect={() => setMenuOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="border-t border-[var(--border)] pt-1.5">
                  <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Studio
                  </p>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {studioItems.map((item) => (
                      <NarrowNavItem
                        key={item.href}
                        item={item}
                        active={isActivePath(pathname, item.href)}
                        onSelect={() => setMenuOpen(false)}
                      />
                    ))}
                    <NarrowNavItem
                      item={SETTINGS_ITEM}
                      active={pathname === "/settings"}
                      onSelect={() => setMenuOpen(false)}
                    />
                  </div>
                </div>
              </nav>
          )}
        </div>
        <MobileChannelChip />
      </div>
    </div>
  );
}

function NarrowNavItem({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: () => void }) {
  const Icon = item.icon;
  const { breakdown } = usePipelineAttention();
  const { stream } = useStream();
  const { count: attention } = navAttention(item.href, breakdown);
  return (
    <Link
      href={streamHref(item.href, stream)}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-2 text-xs transition max-sm:min-h-10",
        active ? "bg-white/8 font-medium text-white" : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-[var(--accent)]")} />
      <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
      {attention > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
    </Link>
  );
}

function ProfileFooter({ collapsed = false }: { collapsed?: boolean }) {
  const { data } = useAppData();
  const profile = data.settings.profile;
  const displayName = profile?.displayName?.trim();
  const avatar = profile?.avatar;
  const initials = displayName ? initialsFrom(displayName) : "";

  // The brand block at the top already shows this name and photo, so repeating
  // it here cost a row of nav height for nothing. Expanded, this row only
  // appears to ask for the name; the collapsed rail keeps the avatar.
  if (!collapsed && displayName) return null;

  return (
    <Link
      href="/settings"
      aria-label="Open profile settings"
      title={collapsed ? displayName || "Profile settings" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 transition hover:border-[var(--border-strong)]",
        collapsed && "justify-center px-2"
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)] text-xs font-semibold text-[var(--accent-contrast)]">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          initials || "?"
        )}
      </span>
      <span className={cn("flex min-w-0 flex-col leading-tight", collapsed && "hidden")}>
        <span className="truncate text-sm font-medium text-white">{displayName || "Set up profile"}</span>
        <span className="truncate text-xs text-[var(--muted-foreground)]">
          {displayName ? "View settings" : "Add your name & photo"}
        </span>
      </span>
    </Link>
  );
}

export function AppShell({ children, frame = false }: { children: React.ReactNode; frame?: boolean }) {
  return (
    <ReleaseProvider>
      <PipelineAttentionProvider>
        <StreamProvider>
          <SetupGate>
            <AppChrome frame={frame}>{children}</AppChrome>
          </SetupGate>
        </StreamProvider>
      </PipelineAttentionProvider>
    </ReleaseProvider>
  );
}

/**
 * An install that has never been set up gets the setup screen instead of the
 * app, whichever URL it was opened on. It is one check against one field, and
 * that field is only ever written by finishing or skipping setup - so this
 * cannot latch on for someone who simply has not filled their profile in.
 */
function SetupGate({ children }: { children: React.ReactNode }) {
  const { data } = useAppData();
  const pathname = usePathname();
  const oauthReturn = useSyncExternalStore(subscribeNever, hasOauthResult, () => false);
  // Latched for the rest of the visit: the landing screen clears the query once
  // its toast has shown, and the setup screen must not swallow it a moment later.
  const [sawOauthReturn, setSawOauthReturn] = useState(false);
  if (oauthReturn && !sawOauthReturn) setSawOauthReturn(true);
  // Setup itself offers Open Settings, so that recovery route must remain
  // reachable before setup is finished. A route reached from a sign-in callback
  // is exempt too: the callbacks land on the Uploading Center and the Podcast
  // page, and covering them hides the "connected" or "connect failed" toast the
  // person has just been sent there to read.
  if (!data.settings.setupCompletedAt && pathname !== "/settings" && !sawOauthReturn) return <FirstRun />;
  return <>{children}</>;
}

// The address bar is read directly rather than through useSearchParams, which
// would force every page under this shell to prerender as an empty fallback.
const subscribeNever = () => () => undefined;

function hasOauthResult(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has("connected") || params.has("connect_error");
}

function AppChrome({ children, frame }: { children: React.ReactNode; frame: boolean }) {
  const pathname = usePathname();
  const settingsActive = pathname === "/settings";
  const { data } = useAppData();
  const studioItems = studioItemsFor(data.settings.personalDashboard);
  // Inside a CoLateral Marketing Card the window is a card on a canvas, not a
  // browser tab. A 288px sidebar is most of a small card, so the host says how
  // much room it has and the shell sheds chrome to match: `compact` starts the
  // rail collapsed (everything still reachable, it just stops costing half the
  // card) and `bare` drops the rail and the footer entirely, because the host
  // is drawing its own route rail above the frame.
  const { hosted, chrome } = useColateralBridge();
  const hostedBare = hosted && chrome === "bare";
  const hostedCompact = hosted && chrome === "compact";
  // Read the stored preference after mount: reading localStorage inside the
  // useState initializer makes the client's first render disagree with the
  // server HTML and triggers a React hydration error.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setSidebarCollapsed(true);
      } catch {
        // Non-critical preference read.
      }
    });
  }, []);

  // A card that shrinks to `compact` collapses the rail; one that grows back
  // to `full` leaves it wherever the engineer last put it, because re-opening
  // a rail somebody deliberately closed is the more annoying of the two
  // mistakes.
  useEffect(() => {
    if (hostedCompact) setSidebarCollapsed(true);
  }, [hostedCompact]);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Non-critical preference persistence.
      }
      return next;
    });
  };

  return (
    <div
      data-sidebar={hostedBare ? "none" : sidebarCollapsed ? "collapsed" : "expanded"}
      data-hosted={hosted ? "true" : undefined}
      className={cn(
        "marketing-shell flex min-h-screen gap-6 px-2 py-2 sm:px-4 sm:py-4 lg:px-6",
        frame && "app-frame",
        hosted && "gap-4 px-2 py-2 sm:px-3 sm:py-3 lg:px-3"
      )}
    >
      {/* First stop in the tab order: the rail and the mobile bar are a couple
          of dozen stops before the page itself, so a keyboard gets a way past. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--accent-contrast)] focus:shadow-lg"
      >
        Skip to content
      </a>
      <aside
        className={cn(
          "hidden shrink-0 transition-[width] duration-300 lg:block",
          sidebarCollapsed ? "w-20" : "w-72",
          hostedBare && "lg:hidden"
        )}
      >
        <div className="marketing-sidebar glass glass-panel sticky top-4 flex h-[calc(100dvh-2rem)] flex-col rounded-xl border p-4">
          {/* When collapsed the rail is too narrow for the brand and the toggle
              side by side, so stack them instead of letting them overflow. */}
          <div className={cn("flex pb-3 [@media(max-height:820px)]:pb-2", sidebarCollapsed ? "flex-col items-center gap-2" : "items-center justify-between gap-2 px-1")}>
            <ColateralMarketingMark collapsed={sidebarCollapsed} />
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <div className={cn("pb-3 [@media(max-height:820px)]:hidden", !sidebarCollapsed && "px-1")}>
            <Brand collapsed={sidebarCollapsed} />
          </div>

          {/* Who this pipeline publishes as — front and centre. */}
          <div className="pb-3 [@media(max-height:820px)]:pb-2">
            <ChannelCard collapsed={sidebarCollapsed} />
          </div>

          {/* …and WHICH recording the whole flow below is about. */}
          <div className="pb-3 [@media(max-height:960px)]:pb-2">
            <StreamCard collapsed={sidebarCollapsed} />
          </div>

          <SidebarScroll pathname={pathname}>
            <div>
              <p
                className={cn(
                  "px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)] [@media(max-height:820px)]:sr-only",
                  sidebarCollapsed && "sr-only"
                )}
              >
                Pipeline
              </p>
              {sidebarCollapsed ? (
                <CollapsedPipeline pathname={pathname} />
              ) : (
                <div>
                  {PIPELINE_STAGES.map((stage, index) => (
                    <StageGroup
                      key={stage.step}
                      stage={stage}
                      pathname={pathname}
                      last={index === PIPELINE_STAGES.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>

            <StudioSection items={studioItems} pathname={pathname} collapsed={sidebarCollapsed} />
          </SidebarScroll>

          <div className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
            <UpdateCheckButton collapsed={sidebarCollapsed} />
            <NavLink
              item={SETTINGS_ITEM}
              active={settingsActive}
              collapsed={sidebarCollapsed}
            />
            <ProfileFooter collapsed={sidebarCollapsed} />
          </div>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className={cn("min-w-0 flex-1 focus:outline-none", frame && "app-frame-pane")}>
        {/* Above everything, on every page: a release waiting on `dev` is the
            one thing worth interrupting whatever is on screen for. */}
        <UpdateBanner />
        {!hosted && <NarrowChrome key={`navigation:${pathname}`} pathname={pathname} />}
        {/* Keyed on the route so each navigation pushes the new page in with an
            iOS-style transition. Query-param changes (e.g. tab switches) keep
            the same key and don't re-animate. */}
        <div key={pathname} className={cn("page-enter", frame && "app-frame-pane", !hostedBare && !frame && "min-h-dvh")}>
          {/* Which recording this screen is showing, on every screen that can
              show one. Without it a Formats page is an undated pile of work. */}
          <StreamBanner />
          {children}
        </div>
        {!hostedBare && <div className={cn(frame && "app-frame-hide")}><AppFooter /></div>}
        {/* Bare cards still have a command bar. Only a framed page with its
            own padded scroll pane can replace this clearance. */}
        <div aria-hidden="true" className={cn("marketing-command-clearance shrink-0", frame && "app-frame-hide")} />
      </main>
      <CommandBar />
    </div>
  );
}

/** The connected accounts, shrunk to avatar chips for the mobile top bar. */
function MobileChannelChip() {
  const state = useConnections();
  if (!state.loaded) return <span className="h-7 w-7 animate-pulse rounded-full bg-white/10" />;

  const others = state.others.filter((row) => row.connected > 0);

  return (
    <span className="flex items-center gap-1.5">
      {state.channel ? (
        <Link
          href={state.channel.reconnect ? "/api/auth/google" : "/uploading-center"}
          prefetch={state.channel.reconnect ? false : undefined}
          aria-label={state.channel.reconnect ? reconnectBlocker("YouTube") : `${state.channel.title} — YouTube`}
          title={state.channel.reconnect ? "Reconnect YouTube" : handleLabel(state.channel, "YouTube")}
          className="-my-1.5 flex shrink-0 p-1.5"
        >
          <ChannelAvatar channel={state.channel} className="h-7 w-7" />
        </Link>
      ) : nothingConnected(state) ? (
        <Link
          href="/settings#accounts"
          aria-label="Connect accounts"
          title="Connect accounts"
          className="group -m-1.5 flex h-10 w-10 items-center justify-center"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)] transition group-hover:bg-[var(--accent)]/25">
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </Link>
      ) : null}
      {others.map((row) => {
        const style = PLATFORM_STYLE[row.platform];
        const label = `${style.label} — ${row.blocker ?? handleLabel(row.profile, style.label)}`;
        return (
          <Link
            key={row.platform}
            href={chipHref(row)}
            prefetch={row.reconnectAccountId ? false : undefined}
            aria-label={label}
            title={label}
            className="relative -my-2 block h-10 w-10 shrink-0 p-2"
          >
            <span
              className={cn(
                "flex h-full w-full items-center justify-center overflow-hidden rounded-full",
                style.background,
                style.tint
              )}
            >
              {row.profile?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
                <img src={row.profile.thumbnail} alt="" className="h-full w-full object-cover" />
              ) : (
                <PlatformIcon platform={row.platform} className="h-3.5 w-3.5" />
              )}
            </span>
            {row.profile?.thumbnail && <PlatformBadge platform={row.platform} className="h-3.5 w-3.5" />}
          </Link>
        );
      })}
    </span>
  );
}

