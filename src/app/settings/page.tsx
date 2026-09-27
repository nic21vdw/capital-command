"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SettingsPage } from "@/components/layout/settings-page";
import { useAppData } from "@/components/providers/app-provider";
import { useThemePreset } from "@/components/providers/theme-preset-provider";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { themePresets } from "@/lib/themes";
import { CONNECTIONS } from "@/lib/publisher/connections";

/**
 * `SettingsPage` itself lives in `components/layout`, outside this pass's
 * scope, so the canvas surface for `/settings` is registered here instead —
 * against the exact same `useAppData`/`useThemePreset` state and the exact
 * same `mutate`/`setTheme` calls the real controls in there use. Nothing that
 * could hold a credential is exposed: the connections cards further down
 * Settings only ever answer with how many accounts are connected, never a
 * key, a token or even a masked value.
 */
export default function Page() {
  const { data, apiStatus, mutate } = useAppData();
  const { theme, setTheme, hosted } = useThemePreset();
  const [connected, setConnected] = useState<{ ready: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connections")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { present?: Record<string, boolean> } | null) => {
        if (cancelled || !body?.present) return;
        const present = body.present;
        const ready = CONNECTIONS.filter((connection) =>
          connection.fields.every((field) => present[field.name])
        ).length;
        setConnected({ ready, total: CONNECTIONS.length });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTheme = themePresets.find((preset) => preset.id === theme);

  useColateralSurface({
    route: "/settings",
    title: "Settings",
    summary: "Profile, theme, feature switches and data controls for this install.",
    fields: [
      {
        id: "displayName",
        label: "Display name",
        value: data.settings.profile?.displayName ?? "",
        kind: "text"
      },
      {
        id: "themePreset",
        label: "Theme",
        value: activeTheme?.label ?? theme,
        kind: "select",
        options: themePresets.map((preset) => preset.label),
        readOnly: hosted,
        hint: hosted ? "CoLateral is choosing the theme for this frame." : undefined
      },
      {
        id: "personalDashboard",
        label: "Show personal finance screens",
        value: data.settings.personalDashboard === true,
        kind: "boolean"
      },
      {
        id: "publishingEnabled",
        label: "Let the app post at all",
        value: apiStatus.publishingEnabled === true,
        kind: "boolean"
      },
      {
        id: "autoScheduleOvernight",
        label: "Schedule what an overnight stream produces",
        value: data.settings.autoScheduleOvernight === true,
        kind: "boolean"
      },
      {
        id: "clipDescription",
        label: "Standing clip description",
        value: data.settings.clipDescription ?? "",
        kind: "longtext",
        hint: "Appended under every clip this app uploads."
      }
    ],
    // Never a credential/token here: connections stay a read-only count below.
    controls: [
      { id: "load-demo-data", label: "Load demo data", group: "Danger zone", destructive: true },
      { id: "delete-all-data", label: "Delete all data", group: "Danger zone", destructive: true }
    ],
    readings: [
      { label: "Connected accounts", value: connected ? `${connected.ready} of ${connected.total}` : "Checking…" },
      { label: "Booking blocker", value: apiStatus.bookingBlockers?.[0] ?? "None" }
    ],
    setField: (id, value) => {
      switch (id) {
        case "displayName": {
          if (typeof value !== "string") return false;
          void mutate(
            "updateSettings",
            { ...data.settings, profile: { ...data.settings.profile, displayName: value } },
            { successMessage: "Profile updated." }
          );
          return true;
        }
        case "themePreset": {
          if (hosted || typeof value !== "string") return false;
          const preset = themePresets.find((option) => option.label === value || option.id === value);
          if (!preset) return false;
          setTheme(preset.id);
          void mutate("updateSettings", { ...data.settings, themePreset: preset.id });
          return true;
        }
        case "personalDashboard": {
          if (typeof value !== "boolean") return false;
          void mutate(
            "updateSettings",
            { ...data.settings, personalDashboard: value },
            {
              successMessage: value
                ? "Personal finance is on, and in the sidebar."
                : "Personal finance is hidden. Nothing was deleted."
            }
          );
          return true;
        }
        case "publishingEnabled": {
          if (typeof value !== "boolean") return false;
          void mutate(
            "updateSettings",
            { ...data.settings, publishingEnabled: value },
            { successMessage: value ? "Publishing is on." : "Publishing is off — nothing will be posted." }
          );
          return true;
        }
        case "autoScheduleOvernight": {
          if (typeof value !== "boolean") return false;
          void mutate(
            "updateSettings",
            { ...data.settings, autoScheduleOvernight: value },
            {
              successMessage: value
                ? "Overnight runs will schedule themselves."
                : "Overnight runs will stop at ready to schedule."
            }
          );
          return true;
        }
        case "clipDescription": {
          if (typeof value !== "string") return false;
          void mutate("updateSettings", { ...data.settings, clipDescription: value }, { successMessage: "Saved." });
          return true;
        }
        default:
          return false;
      }
    },
    click: (id) => {
      switch (id) {
        // The host already warns before pressing a `destructive` control, so
        // the browser-native `window.prompt` confirmation the real button
        // shows (which an iframe-driven click could never answer) is skipped
        // here — the write below is the same `mutate` call that prompt guards.
        case "delete-all-data":
          void mutate("deleteAllData", undefined, { successMessage: "All data deleted." });
          return true;
        case "load-demo-data":
          void mutate("resetData", undefined, { successMessage: "Demo data loaded." });
          return true;
        default:
          return false;
      }
    }
  });

  return (
    <AppShell>
      <SettingsPage />
    </AppShell>
  );
}
