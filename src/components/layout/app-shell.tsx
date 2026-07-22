"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Facebook,
  FileText,
  Images,
  Lightbulb,
  Mic,
  Presentation,
  Radar,
  Rocket,
  Settings,
  Sparkles,
  UploadCloud,
  Wand2,
  type LucideIcon
} from "lucide-react";
import { AppFooter } from "@/components/layout/app-footer";
import { useAppData } from "@/components/providers/app-provider";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

// The nav reads as the pipeline, top to bottom: plan the video, make it,
// then get it (and its side outputs) out everywhere.
const navGroups: NavGroup[] = [
  {
    label: "Plan",
    items: [
      // Keyword research → scored video ideas, saved to a board.
      { href: "/ideas", label: "Idea Lab", icon: Lightbulb },
      // Full scripts following the channel framework + graphics/SFX kit.
      { href: "/scripts", label: "Scripts", icon: FileText },
      // Watchlist of other channels with baseline stats and outlier flagging.
      { href: "/outliers", label: "Outlier Radar", icon: Radar }
    ]
  },
  {
    label: "Create",
    items: [
      { href: "/longform", label: "Long-Form Editor", icon: Clapperboard },
      { href: "/clips", label: "Clip Generator", icon: Wand2 },
      // The Clip Editor has no nav tab of its own: every clip is edited from
      // its card in the Clip Generator, which deep-links into /editor.
      // Auto-playing deck of the Remotion diagram/title segments.
      { href: "/presentation", label: "Segment Deck", icon: Presentation },
      // Higgsfield-generated avatar videos (real footage, AI avatar, no lines).
      { href: "/avatar", label: "Higgsfield Avatar", icon: Sparkles },
      // AI voiceover clips in Nic's cloned voice, from typed dialogue.
      { href: "/voiceover", label: "Voiceover", icon: Mic }
    ]
  },
  {
    label: "Distribute",
    items: [
      // The start-to-finish pipeline board.
      { href: "/distribution", label: "Distribution Centre", icon: Rocket },
      { href: "/uploading-center", label: "Uploading Center", icon: UploadCloud },
      // Instagram carousel images generated from scripts/videos.
      { href: "/carousels", label: "Carousels", icon: Images },
      // On-demand pack of suggested X/Threads posts + replies (suggestion-only).
      { href: "/x-posts", label: "X / Threads Posts", icon: AtSign },
      // Thread-format content engine for Facebook/Instagram (hook post +
      // numbered comment thread + CTA comment).
      { href: "/facebook", label: "FB / IG Threads", icon: Facebook }
    ]
  }
];

const allNavItems = navGroups.flatMap((group) => group.items);
const SIDEBAR_COLLAPSED_KEY = "capital-command:sidebar-collapsed";

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link href="/" className={cn("flex items-center gap-3", collapsed && "justify-center")} title="Dashboard">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#a855f7] to-[#7c3aed] text-sm font-bold tracking-tight text-white shadow-[0_2px_10px_rgba(124,58,237,0.45)]">
        NV
      </span>
      <span className={cn("flex flex-col leading-tight", collapsed && "hidden")}>
        <span className="text-sm font-semibold text-white">Nic Vandewetering</span>
        <span className="text-xs text-[var(--muted-foreground)]">YouTube creator tools</span>
      </span>
    </Link>
  );
}

function NavLink({ item, active, collapsed = false }: { item: NavItem; active: boolean; collapsed?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
        collapsed && "justify-center px-2",
        active
          ? "bg-white/8 font-medium text-white"
          : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-[var(--accent)]")} />
      {!collapsed && item.label}
    </Link>
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
      <aside className={cn("hidden shrink-0 transition-[width] duration-300 lg:block", sidebarCollapsed ? "w-20" : "w-64")}>
        <div className="sticky top-4 flex h-[calc(100vh-2rem)] flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          {/* When collapsed the rail is too narrow for the brand and the toggle
              side by side, so stack them instead of letting them overflow. */}
          <div className={cn("flex pb-4", sidebarCollapsed ? "flex-col items-center gap-2" : "items-center justify-between gap-2 px-1")}>
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
          <nav className="flex-1 space-y-6 overflow-y-auto">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className={cn("px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]", sidebarCollapsed && "sr-only")}>
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={pathname === item.href} collapsed={sidebarCollapsed} />
                ))}
              </div>
            ))}
          </nav>
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            <NavLink item={{ href: "/settings", label: "Settings", icon: Settings }} active={settingsActive} collapsed={sidebarCollapsed} />
            <ProfileFooter collapsed={sidebarCollapsed} />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {/* Mobile top bar + nav */}
        <div className="mb-4 lg:hidden">
          <div className="mb-3 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
            <Brand />
            <Link
              href="/settings"
              aria-label="Open settings"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1">
            {allNavItems.map((item) => {
              const active = pathname === item.href;
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
