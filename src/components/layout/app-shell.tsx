"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AtSign,
  Clapperboard,
  Image as ImageIcon,
  LayoutDashboard,
  Scissors,
  Settings,
  SquarePlay,
  Target,
  Wallet,
  Youtube,
  type LucideIcon
} from "lucide-react";
import { AppFooter } from "@/components/layout/app-footer";
import { useAppData } from "@/components/providers/app-provider";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/execution", label: "Execution", icon: Target },
      { href: "/finance", label: "Finances", icon: Wallet }
    ]
  },
  {
    label: "Creator tools",
    items: [
      { href: "/youtube", label: "YouTube", icon: Youtube },
      { href: "/thumbnails", label: "Thumbnails", icon: ImageIcon },
      { href: "/clips", label: "Clip Creator", icon: Scissors },
      { href: "/editor", label: "Clip Editor", icon: SquarePlay },
      { href: "/golf", label: "Golf", icon: Clapperboard },
      { href: "/x-strategy", label: "Reply Studio", icon: AtSign }
    ]
  }
];

const allNavItems = navGroups.flatMap((group) => group.items);

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#a855f7] to-[#7c3aed] text-sm font-bold tracking-tight text-white shadow-[0_2px_10px_rgba(124,58,237,0.45)]">
        NV
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-white">Nic Vandewetering</span>
        <span className="text-xs text-[var(--muted-foreground)]">Portfolio &amp; content</span>
      </span>
    </Link>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
        active
          ? "bg-white/8 font-medium text-white"
          : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-[var(--accent)]")} />
      {item.label}
    </Link>
  );
}

function ProfileFooter() {
  const { data } = useAppData();
  const profile = data.settings.profile;
  const displayName = profile?.displayName?.trim();
  const avatar = profile?.avatar;
  const initials = displayName ? initialsFrom(displayName) : "";

  return (
    <Link
      href="/settings"
      aria-label="Open profile settings"
      className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 transition hover:border-[var(--border-strong)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)] text-xs font-semibold text-[var(--accent-contrast)]">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          initials || "?"
        )}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
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

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] gap-6 px-4 py-4 lg:px-6">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-4 flex h-[calc(100vh-2rem)] flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="px-1 pb-4">
            <Brand />
          </div>
          <nav className="flex-1 space-y-6 overflow-y-auto">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={pathname === item.href} />
                ))}
              </div>
            ))}
          </nav>
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            <NavLink item={{ href: "/settings", label: "Settings", icon: Settings }} active={settingsActive} />
            <ProfileFooter />
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
        {children}
        <AppFooter />
      </main>
    </div>
  );
}
