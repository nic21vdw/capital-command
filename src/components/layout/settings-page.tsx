"use client";

import { useTheme } from "next-themes";
import { ProfileSettings } from "@/components/layout/profile-settings";
import { ThemePicker } from "@/components/finance/theme-picker";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";

export function SettingsPage() {
  const { data, apiStatus, mutate } = useAppData();
  const { setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Control theme, currency, refresh behavior, and data exports."
      />
      <ProfileSettings />
      <ThemePicker />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold text-white">Preferences</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm text-[var(--muted-foreground)]">Currency</p>
              <Select
                value={data.settings.currency}
                onChange={(event) =>
                  void mutate(
                    "updateSettings",
                    { ...data.settings, currency: event.target.value },
                    { successMessage: "Currency updated." }
                  )
                }
              >
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </Select>
            </div>
            <div>
              <p className="mb-2 text-sm text-[var(--muted-foreground)]">Theme</p>
              <Select
                value={data.settings.theme}
                onChange={(event) => {
                  const theme = event.target.value as "light" | "dark" | "system";
                  setTheme(theme);
                  void mutate("updateSettings", { ...data.settings, theme }, { successMessage: "Theme updated." });
                }}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </Select>
            </div>
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-white">Market data</h2>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 p-4">
              <div>
                <p className="text-sm text-white">Alpha Vantage API key</p>
                <p className="text-sm text-[var(--muted-foreground)]">Status only. The actual key is never displayed.</p>
              </div>
              <Badge className={apiStatus.hasAlphaVantageKey ? "text-emerald-300" : "text-amber-200"}>
                {apiStatus.hasAlphaVantageKey ? "Configured" : "Using mock fallback"}
              </Badge>
            </div>
            <Button variant="secondary" onClick={() => void mutate("refreshPrices", undefined, { successMessage: "Data refreshed." })}>
              Refresh market data
            </Button>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold text-white">Export data</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Download a full JSON export or a CSV bundle containing all tracked entities.</p>
          <div className="mt-4 flex gap-2">
            <a href="/api/data?format=json"><Button>Export JSON</Button></a>
            <a href="/api/data?format=csv"><Button variant="secondary">Export CSV</Button></a>
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-white">Danger zone</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Delete all tracked data with confirmation, or restore the seeded mock dataset.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="danger"
              onClick={() => {
                const confirmed = window.prompt('Type DELETE to remove all data.');
                if (confirmed === "DELETE") {
                  void mutate("deleteAllData", undefined, { successMessage: "All data deleted." });
                }
              }}
            >
              Delete all data
            </Button>
            <Button variant="secondary" onClick={() => void mutate("resetData", undefined, { successMessage: "Mock seed data restored." })}>
              Restore mock data
            </Button>
          </div>
        </Card>
      </div>
      <Card>
        <h2 className="text-xl font-semibold text-white">Disclaimer</h2>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          This app is for personal tracking and educational organization only. It does not provide financial, tax, legal,
          or investment advice.
        </p>
      </Card>
    </div>
  );
}
