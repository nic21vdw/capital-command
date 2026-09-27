"use client";

import { useState } from "react";
import { AtSign, Download, Palette, Send, SlidersHorizontal, UserRound } from "lucide-react";
import { ConnectionsSettings } from "@/components/layout/connections-settings";
import { ProfileSettings } from "@/components/layout/profile-settings";
import { ThemePicker } from "@/components/finance/theme-picker";
import { useAppData } from "@/components/providers/app-provider";
import { useThemePreset } from "@/components/providers/theme-preset-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";

const SECTIONS = [
  { href: "#profile", label: "Profile", icon: UserRound },
  { href: "#accounts", label: "Accounts", icon: AtSign },
  { href: "#publishing", label: "Publishing", icon: Send },
  { href: "#more", label: "More", icon: SlidersHorizontal }
];

export function SettingsPage() {
  const { data, apiStatus, mutate } = useAppData();
  const { hosted } = useThemePreset();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Your identity, connected channels and publishing controls."
      />
      <nav aria-label="Settings sections" className="flex flex-wrap gap-2 pb-1">
        {SECTIONS.map(({ href, label, icon: Icon }) => (
          <a key={href} href={href} className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2 text-sm font-medium text-white/90 transition hover:border-[var(--accent)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
            <Icon className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>

      <ProfileSettings />
      <ConnectionsSettings />

      <Card id="publishing" className="scroll-mt-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
            <Send className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-white">Publishing</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Control what the app may schedule and post automatically.
            </p>
          </div>
        </div>
        <div className="mt-5 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] px-4">
          <label className="flex cursor-pointer items-start justify-between gap-4 py-4 text-sm text-white">
            <span>
              <span className="block font-medium">Allow posting</span>
              <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                Turn off to stop every automatic post. Work can still be created and queued.
              </span>
            </span>
            <input
              type="checkbox"
              checked={apiStatus.publishingEnabled === true}
              onChange={(event) => void mutate("updateSettings", { ...data.settings, publishingEnabled: event.target.checked }, {
                successMessage: event.target.checked ? "Publishing is on." : "Publishing is off."
              })}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-4 py-4 text-sm text-white">
            <span>
              <span className="block font-medium">Schedule overnight results</span>
              <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                When off, stream content waits for review in the Stream Pipeline.
              </span>
            </span>
            <input
              type="checkbox"
              checked={data.settings.autoScheduleOvernight === true}
              onChange={(event) => void mutate("updateSettings", { ...data.settings, autoScheduleOvernight: event.target.checked }, {
                successMessage: event.target.checked ? "Overnight scheduling is on." : "Overnight results will wait for review."
              })}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
          </label>
        </div>
        {apiStatus.bookingBlockers?.length ? (
          <p className="mt-3 text-xs text-amber-200">{apiStatus.bookingBlockers[0]}</p>
        ) : null}
        <ClipDescriptionCard />
        <CarouselThemeCard />
      </Card>

      <Card id="more" className="scroll-mt-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-white">More settings</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Appearance, optional screens and data tools.</p>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          <details className="rounded-xl border border-[var(--border)] p-4">
            <summary className="flex cursor-pointer items-center gap-2 font-medium text-white">
              <Palette className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" /> Appearance
            </summary>
            <div className="mt-4">
              {hosted ? (
                <p className="text-sm text-[var(--muted-foreground)]">
                  This screen follows the theme selected in CoLateral settings.
                </p>
              ) : <ThemePicker compact />}
            </div>
          </details>
          <details className="rounded-xl border border-[var(--border)] p-4">
            <summary className="cursor-pointer font-medium text-white">Personal finance screens</summary>
            <label className="mt-4 flex cursor-pointer items-start justify-between gap-4 text-sm text-white">
              <span>
                Show finance in the sidebar
                <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                  Hiding the screens keeps your finance data.
                </span>
              </span>
              <input
                type="checkbox"
                checked={data.settings.personalDashboard === true}
                onChange={(event) => void mutate("updateSettings", { ...data.settings, personalDashboard: event.target.checked }, {
                  successMessage: event.target.checked ? "Finance is visible." : "Finance is hidden."
                })}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
              />
            </label>
          </details>
          <details className="rounded-xl border border-[var(--border)] p-4">
            <summary className="flex cursor-pointer items-center gap-2 font-medium text-white">
              <Download className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" /> Data tools
            </summary>
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">Download a copy of your app data.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="/api/data?format=json" className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)]">Export JSON</a>
              <a href="/api/data?format=csv" className="inline-flex rounded-lg border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">Export CSV</a>
            </div>
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="text-sm font-medium text-red-200">Reset data</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">Both actions replace your current data. Export it first if you need a copy.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => {
                  if (window.prompt("Type DELETE to remove all data.") === "DELETE") {
                    void mutate("deleteAllData", undefined, { successMessage: "All data deleted." });
                  }
                }}>Delete all data</Button>
                <Button variant="secondary" onClick={() => {
                  if (window.confirm("Replace your current data with demo data?")) {
                    void mutate("resetData", undefined, { successMessage: "Demo data loaded." });
                  }
                }}>Load demo data</Button>
              </div>
            </div>
          </details>
        </div>
      </Card>
    </div>
  );
}

const CAROUSEL_THEMES = [
  { id: "black", label: "Black", hint: "Near-black with CoLateral blue and violet glows" },
  { id: "light", label: "Light", hint: "White with a soft blue grid, like colateralai.com" }
] as const;

function CarouselThemeCard() {
  const { data, mutate } = useAppData();
  const current = data.settings.carouselTheme ?? "black";
  return (
    <details className="mt-4 rounded-xl border border-[var(--border)] p-4">
      <summary className="cursor-pointer font-medium text-white">Carousel look</summary>
      <p className="mt-3 text-sm text-[var(--muted-foreground)]">
        The background every carousel slide is painted on. Decks already rendered repaint in the new look.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {CAROUSEL_THEMES.map((theme) => (
          <Button
            key={theme.id}
            variant={current === theme.id ? "primary" : "secondary"}
            title={theme.hint}
            onClick={() => void mutate("updateSettings", { ...data.settings, carouselTheme: theme.id }, { successMessage: "Carousel look saved." })}
          >
            {theme.label}
          </Button>
        ))}
      </div>
    </details>
  );
}

function ClipDescriptionCard() {
  const { data, mutate } = useAppData();
  const saved = data.settings.clipDescription ?? "";
  const [draft, setDraft] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);

  if (lastSaved !== saved) {
    setLastSaved(saved);
    setDraft(saved);
  }

  return (
    <details className="mt-4 rounded-xl border border-[var(--border)] p-4">
      <summary className="cursor-pointer font-medium text-white">Description added to every clip</summary>
      <p className="mt-3 text-sm text-[var(--muted-foreground)]">
        Add your links and handles below each clip upload. Leave it empty to add nothing.
      </p>
      <Textarea
        className="mt-4 min-h-32"
        value={draft}
        spellCheck={false}
        placeholder={"Follow along at example.com\n\nYouTube: @yourchannel"}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={draft === saved} onClick={() => void mutate("updateSettings", { ...data.settings, clipDescription: draft }, { successMessage: "Description saved." })}>
          Save description
        </Button>
        {draft !== saved ? <Button variant="secondary" onClick={() => setDraft(saved)}>Discard</Button> : null}
      </div>
    </details>
  );
}
