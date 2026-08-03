"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AtSign,
  Bot,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Facebook,
  FileText,
  Images,
  Instagram,
  Lightbulb,
  Megaphone,
  Mic,
  Music4,
  Presentation,
  Radar,
  Rocket,
  Scissors,
  Settings,
  Sparkles,
  UploadCloud,
  Wand2,
  Workflow,
  Youtube,
  type LucideIcon
} from "lucide-react";
import { AppFooter } from "@/components/layout/app-footer";
import { useAppData } from "@/components/providers/app-provider";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * The sidebar IS the pipeline. Capital Command's whole point is one flow —
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
      { href: "/x-posts", label: "X / Threads Posts", icon: AtSign },
      // Thread-format content engine for Facebook/Instagram (hook post +
      // numbered comment thread + CTA comment).
      { href: "/facebook", label: "FB / IG Threads", icon: Facebook },
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
      { href: "/distribution", label: "Distribution Centre", icon: Rocket }
    ]
  },
  {
    step: 4,
    label: "Calendar",
    items: [
      // The end of the line: everything scheduled, managed in one place.
      { href: "/master-calendar", label: "Master Calendar", icon: CalendarRange }
    ]
  }
];

/** Supporting tools that feed the pipeline but sit outside the main flow. */
const STUDIO_ITEMS: NavItem[] = [
  { href: "/agents", label: "Sourceflow Agents", icon: Bot },
  { href: "/ideas", label: "Idea Lab", icon: Lightbulb },
  { href: "/scripts", label: "Scripts", icon: FileText },
  { href: "/outliers", label: "Outlier Radar", icon: Radar },
  { href: "/presentation", label: "Segment Deck", icon: Presentation },
  { href: "/avatar", label: "Higgsfield Avatar", icon: Sparkles },
  { href: "/voiceover", label: "Voiceover", icon: Mic },
  // Licensed music models (fal.ai) writing tracks into the shared library the
  // Long-Form Editor pulls from — a tool that feeds the flow, not a format.
  { href: "/music", label: "Music Studio", icon: Music4 }
];

const ALL_NAV_ITEMS = [...PIPELINE_STAGES.flatMap((stage) => stage.items), ...STUDIO_ITEMS];
const SIDEBAR_COLLAPSED_KEY = "capital-command:sidebar-collapsed";
// Shown in the sidebar brand until a display name is saved in Settings.
const DEFAULT_BRAND_NAME = "Nic Vandewetering";

/** "/" and "/pipeline" are the same screen, so either lights up Stream Pipeline. */
function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || (href === "/" && pathname === "/pipeline");
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
  const displayName = profile?.displayName?.trim() || DEFAULT_BRAND_NAME;
  const avatar = profile?.avatar;
  const initials = initialsFrom(displayName) || "?";
  const handle = leadHandle(connections);

  return (
    <Link href="/" className={cn("flex items-center gap-3", collapsed && "justify-center")} title="Dashboard">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-bold tracking-tight text-white",
          !avatar && "bg-gradient-to-br from-[#a855f7] to-[#7c3aed] shadow-[0_2px_10px_rgba(124,58,237,0.45)]"
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
          {handle ? `Welcome, @${handle}` : "YouTube creator tools"}
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
};

type ChannelSummary = Profile & {
  /** How many other connected YouTube accounts exist beyond this one. */
  extraConnected: number;
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
  youtube: Profile | null;
  tiktok?: Profile | null;
};

type PlatformKey = "youtube" | "instagram" | "tiktok" | "facebook";

const OTHER_PLATFORMS: PlatformKey[] = ["instagram", "tiktok", "facebook"];

const PLATFORM_STYLE: Record<PlatformKey, { label: string; icon: LucideIcon; tint: string; background: string }> = {
  youtube: { label: "YouTube", icon: Youtube, tint: "text-[#ff4d4d]", background: "bg-[#ff0000]/15" },
  instagram: { label: "Instagram", icon: Instagram, tint: "text-[#e1306c]", background: "bg-[#e1306c]/15" },
  tiktok: { label: "TikTok", icon: Music4, tint: "text-[#25f4ee]", background: "bg-[#25f4ee]/12" },
  facebook: { label: "Facebook", icon: Facebook, tint: "text-[#4267b2]", background: "bg-[#4267b2]/20" }
};

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
    channel: leadProfile ? { ...leadProfile, extraConnected: youtube.length - 1 } : null,
    others: OTHER_PLATFORMS.map((platform) => {
      const signedIn = connectedOn(accounts, platform);
      return {
        platform,
        profile: signedIn.map(profileOf).find(Boolean) ?? null,
        connected: signedIn.length,
        blocker: signedIn.map((account) => account.blocker).find(Boolean) ?? null
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
    inFlight = fetch("/api/publish/accounts", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((json: { accounts?: AccountRow[] }) => summarize(json.accounts ?? []))
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

/** The channel avatar circle, shared by the sidebar card and the mobile bar. */
function ChannelAvatar({ channel, className }: { channel: ChannelSummary; className?: string }) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 ring-2 ring-[#ff0000]/60",
        className
      )}
    >
      {channel.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
        <img src={channel.thumbnail} alt="" className="h-full w-full object-cover" />
      ) : (
        <Youtube className="h-1/2 w-1/2 text-[#ff0000]" />
      )}
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

  if (!state.loaded) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.03] px-3 py-2.5",
          collapsed && "justify-center px-2"
        )}
      >
        <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/10" />
        <span className={cn("flex min-w-0 flex-1 flex-col gap-1.5", collapsed && "hidden")}>
          <span className="h-2.5 w-24 animate-pulse rounded bg-white/10" />
          <span className="h-2 w-16 animate-pulse rounded bg-white/5" />
        </span>
      </div>
    );
  }

  const channel = state.channel;
  return (
    <div className="space-y-2">
      {channel ? (
        <Link
          href="/uploading-center"
          title={collapsed ? `${channel.title} — YouTube` : "Manage channel accounts in the Uploading Center"}
          className={cn(
            "group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-gradient-to-br from-white/[0.06] to-transparent px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:from-white/[0.09]",
            collapsed && "justify-center px-2"
          )}
        >
          <ChannelAvatar channel={channel} className="h-9 w-9" />
          <span className={cn("flex min-w-0 flex-1 flex-col leading-tight", collapsed && "hidden")}>
            <span className="truncate text-sm font-semibold text-white">{channel.title}</span>
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span className="truncate">{handleLabel(channel, "YouTube")}</span>
              {channel.extraConnected > 0 ? <span className="shrink-0">+{channel.extraConnected}</span> : null}
            </span>
          </span>
        </Link>
      ) : (
        <a
          href="/api/auth/google"
          title={collapsed ? "Sign in with YouTube" : undefined}
          className={cn(
            "group flex items-center gap-3 rounded-xl border border-dashed border-[var(--border-strong)] px-3 py-2.5 transition hover:border-[#ff0000]/60 hover:bg-white/[0.04]",
            collapsed && "justify-center px-2"
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ff0000]/15 text-[#ff4d4d] transition group-hover:bg-[#ff0000]/25">
            <Youtube className="h-4.5 w-4.5" />
          </span>
          <span className={cn("flex min-w-0 flex-1 flex-col leading-tight", collapsed && "hidden")}>
            <span className="text-sm font-semibold text-white">Sign in with YouTube</span>
            <span className="text-xs text-[var(--muted-foreground)]">Connect your channel to publish</span>
          </span>
        </a>
      )}
      <ConnectionRows state={state} collapsed={collapsed} />
    </div>
  );
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
  return (
    <div className={cn("flex gap-1.5", collapsed ? "flex-col items-center" : "flex-col")}>
      {state.others.map((row) => {
        const style = PLATFORM_STYLE[row.platform];
        const Icon = style.icon;
        const connected = row.connected > 0;
        const held = connected && Boolean(row.blocker);
        const detail = connected ? handleLabel(row.profile, style.label) : `${style.label} · not connected`;
        const dot = held ? "bg-amber-400" : connected ? "bg-emerald-400" : "bg-white/20";
        return (
          <Link
            key={row.platform}
            href="/uploading-center"
            title={row.blocker ? `${style.label} — ${row.blocker}` : `${style.label} — ${detail}`}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition hover:border-[var(--border-strong)] hover:bg-white/[0.04]",
              connected ? "border-[var(--border)]" : "border-dashed border-[var(--border)]",
              collapsed && "justify-center px-2"
            )}
          >
            <span
              className={cn(
                "relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full",
                style.background,
                style.tint,
                !connected && "opacity-50"
              )}
            >
              {row.profile?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
                <img src={row.profile.thumbnail} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              {collapsed && connected && (
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--panel)]",
                    held ? "bg-amber-400" : "bg-emerald-400"
                  )}
                />
              )}
            </span>
            <span className={cn("flex min-w-0 flex-1 items-center gap-1.5 leading-tight", collapsed && "hidden")}>
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
              <span className="truncate text-xs text-[var(--muted-foreground)]">{detail}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function NavLink({ item, active, collapsed = false }: { item: NavItem; active: boolean; collapsed?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition",
        collapsed && "justify-center px-2 py-2",
        active
          ? "bg-white/8 font-medium text-white"
          : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-[var(--accent)]")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
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
      <div className={cn("min-w-0 flex-1", !last && "pb-4")}>
        <p
          className={cn(
            "px-2.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider",
            stageActive ? "text-white" : "text-[var(--muted-foreground)]"
          )}
        >
          {stage.label}
        </p>
        <div className="mt-1 space-y-0.5">
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

function ProfileFooter({ collapsed = false }: { collapsed?: boolean }) {
  const { data } = useAppData();
  const profile = data.settings.profile;
  const displayName = profile?.displayName?.trim();
  const avatar = profile?.avatar;
  const initials = displayName ? initialsFrom(displayName) : "";

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settingsActive = pathname === "/settings";
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
    <div className="flex min-h-screen gap-6 px-4 py-4 lg:px-6">
      <aside className={cn("hidden shrink-0 transition-[width] duration-300 lg:block", sidebarCollapsed ? "w-20" : "w-72")}>
        <div className="sticky top-4 flex h-[calc(100vh-2rem)] flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          {/* When collapsed the rail is too narrow for the brand and the toggle
              side by side, so stack them instead of letting them overflow. */}
          <div className={cn("flex pb-3", sidebarCollapsed ? "flex-col items-center gap-2" : "items-center justify-between gap-2 px-1")}>
            <Brand collapsed={sidebarCollapsed} />
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

          {/* Who this pipeline publishes as — front and centre. */}
          <div className="pb-4">
            <ChannelCard collapsed={sidebarCollapsed} />
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto pr-0.5">
            <div>
              <p
                className={cn(
                  "px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]",
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

            <div className={cn(!sidebarCollapsed && "border-t border-[var(--border)] pt-4")}>
              {sidebarCollapsed ? <div className="mx-3 border-t border-[var(--border)] pb-1" /> : null}
              <p
                className={cn(
                  "px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]",
                  sidebarCollapsed && "sr-only"
                )}
              >
                Studio
              </p>
              <div className="space-y-0.5">
                {STUDIO_ITEMS.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActivePath(pathname, item.href)}
                    collapsed={sidebarCollapsed}
                  />
                ))}
              </div>
            </div>
          </nav>

          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            <NavLink
              item={{ href: "/settings", label: "Settings", icon: Settings }}
              active={settingsActive}
              collapsed={sidebarCollapsed}
            />
            <ProfileFooter collapsed={sidebarCollapsed} />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {/* Mobile top bar + nav */}
        <div className="mb-4 lg:hidden">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
            <Brand />
            <div className="flex items-center gap-2">
              <MobileChannelChip />
              <Link
                href="/settings"
                aria-label="Open settings"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
              >
                <Settings className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1">
            {ALL_NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "whitespace-nowrap rounded-md px-3 py-2 text-sm transition",
                    active
                      ? "bg-white/8 font-medium text-white"
                      : "text-[var(--muted-foreground)]"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        {/* Keyed on the route so each navigation pushes the new page in with an
            iOS-style transition. Query-param changes (e.g. tab switches) keep
            the same key and don't re-animate. */}
        <div key={pathname} className="page-enter">
          {children}
        </div>
        <AppFooter />
      </main>
    </div>
  );
}

/** The connected accounts, shrunk to avatar chips for the mobile top bar. */
function MobileChannelChip() {
  const state = useConnections();
  if (!state.loaded) return <span className="h-9 w-9 animate-pulse rounded-full bg-white/10" />;

  const others = state.others.filter((row) => row.connected > 0);

  return (
    <span className="flex items-center gap-1.5">
      {state.channel ? (
        <Link
          href="/uploading-center"
          aria-label={`${state.channel.title} — YouTube`}
          title={handleLabel(state.channel, "YouTube")}
        >
          <ChannelAvatar channel={state.channel} className="h-9 w-9" />
        </Link>
      ) : (
        <a
          href="/api/auth/google"
          aria-label="Sign in with YouTube"
          title="Sign in with YouTube"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ff0000]/15 text-[#ff4d4d] transition hover:bg-[#ff0000]/25"
        >
          <Youtube className="h-4 w-4" />
        </a>
      )}
      {others.map((row) => {
        const style = PLATFORM_STYLE[row.platform];
        const Icon = style.icon;
        const label = `${style.label} — ${row.blocker ?? handleLabel(row.profile, style.label)}`;
        return (
          <Link
            key={row.platform}
            href="/uploading-center"
            aria-label={label}
            title={label}
            className={cn(
              "flex h-7 w-7 items-center justify-center overflow-hidden rounded-full",
              style.background,
              style.tint
            )}
          >
            {row.profile?.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
              <img src={row.profile.thumbnail} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
          </Link>
        );
      })}
    </span>
  );
}
