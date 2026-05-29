"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartPie, Flag, LayoutDashboard, NotebookText, Rocket, Settings, Sparkles, WalletCards } from "lucide-react";
import { useTheme } from "next-themes";
import { AppFooter } from "@/components/layout/app-footer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/holdings", label: "Holdings", icon: WalletCards },
  { href: "/watchlist", label: "Watchlist", icon: ChartPie },
  { href: "/notes", label: "Research Notes", icon: NotebookText },
  { href: "/goals", label: "Goals", icon: Flag },
  { href: "/insights", label: "Insights", icon: Sparkles },
  { href: "/progress", label: "Founder Mode", icon: Rocket },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { setTheme } = useTheme();

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] gap-6 px-4 py-4 lg:px-6">
      <aside className="hidden w-72 shrink-0 lg:block">
        <div className="sticky top-4 rounded-[32px] border border-white/10 bg-[var(--panel)] p-6 shadow-2xl">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">Capital Command</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">Your investing command center</h1>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition",
                    active ? "bg-white text-black" : "text-[var(--muted-foreground)] hover:bg-white/6 hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-8 rounded-3xl border border-white/10 bg-black/20 p-4">
            <p className="text-sm text-white">Calm, clear, and built for long-term thinking.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => setTheme("dark")} className="flex-1">
                Dark
              </Button>
              <Button variant="ghost" onClick={() => setTheme("light")} className="flex-1">
                Light
              </Button>
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-2 overflow-x-auto rounded-3xl border border-white/8 bg-[var(--panel)] p-2 lg:hidden">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "whitespace-nowrap rounded-2xl px-4 py-2 text-sm",
                  active ? "bg-white text-black" : "text-[var(--muted-foreground)]"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        {children}
        <AppFooter />
      </main>
    </div>
  );
}
