"use client";

import { useState } from "react";
import { ConnectionsSettings } from "@/components/layout/connections-settings";
import { ProfileSettings } from "@/components/layout/profile-settings";
import { ThemePicker } from "@/components/finance/theme-picker";
import { useAppData } from "@/components/providers/app-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";

export function SettingsPage() {
  const { data, apiStatus, mutate } = useAppData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Who this channel is, which accounts it may post to, how it looks, and what it does unattended."
      />
      <ProfileSettings />
      <ThemePicker />
      <ConnectionsSettings />
      <ClipDescriptionCard />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-white">Overnight posting</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            The nightly channel scan turns every new stream into clips, a long-form edit, a podcast episode, a carousel
            and text posts on its own. This decides whether it also SCHEDULES them — into the upload queue and the
            Threads queue — while you are asleep, with titles and copy written by AI that you have not read yet.
          </p>
          <label className="mt-4 flex items-start gap-2.5 text-sm text-white/90">
            <input
              type="checkbox"
              checked={apiStatus.publishingEnabled === true}
              onChange={(event) =>
                void mutate(
                  "updateSettings",
                  { ...data.settings, publishingEnabled: event.target.checked },
                  {
                    successMessage: event.target.checked
                      ? "Publishing is on."
                      : "Publishing is off — nothing will be posted."
                  }
                )
              }
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span>
              Let the app post at all
              <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                Off: everything can still be made and queued, but the publish runner posts nothing. This used to mean
                editing <code>.env</code> and restarting.
              </span>
            </span>
          </label>
          {apiStatus.bookingBlockers?.length ? (
            <p className="mt-3 text-xs text-amber-300/90">{apiStatus.bookingBlockers[0]}</p>
          ) : null}
          <label className="mt-4 flex items-start gap-2.5 text-sm text-white/90">
            <input
              type="checkbox"
              checked={data.settings.autoScheduleOvernight === true}
              onChange={(event) =>
                void mutate(
                  "updateSettings",
                  { ...data.settings, autoScheduleOvernight: event.target.checked },
                  {
                    successMessage: event.target.checked
                      ? "Overnight runs will schedule themselves."
                      : "Overnight runs will stop at ready to schedule."
                  }
                )
              }
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span>
              Schedule what an overnight stream produces
              <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                Off: everything is made and waits for you on the Stream Pipeline. Nothing reaches a channel unread.
              </span>
            </span>
          </label>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-white">Export data</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Download a full JSON export or a CSV bundle containing all tracked entities.</p>
          <div className="mt-4 flex gap-2">
            <a href="/api/data?format=json"><Button>Export JSON</Button></a>
            <a href="/api/data?format=csv"><Button variant="secondary">Export CSV</Button></a>
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-white">Danger zone</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Delete everything this app tracks, or load a small demo document to see what a populated screen looks like. Loading the demo replaces what is there.</p>
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
            <Button variant="secondary" onClick={() => void mutate("resetData", undefined, { successMessage: "Demo data loaded." })}>
              Load demo data
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * The block of copy that closes every clip this app generates - the links and
 * handles that go under an upload. It was hardcoded to one person's, so a
 * buyer's videos credited his accounts; it is now theirs to write, and empty
 * until they do.
 */
function ClipDescriptionCard() {
  const { data, mutate } = useAppData();
  const saved = data.settings.clipDescription ?? "";
  const [draft, setDraft] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);

  // Adjusting state during render rather than in an effect: what was saved is a
  // prop as far as this box is concerned, and re-syncing the draft to it in an
  // effect renders the stale text once before correcting it.
  if (lastSaved !== saved) {
    setLastSaved(saved);
    setDraft(saved);
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-white">Standing clip description</h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Added under every clip this app uploads — your links, your handles, whatever you want on all of them. Leave it
        empty and clips go out with no standing description.
      </p>
      <Textarea
        className="mt-4 min-h-40"
        value={draft}
        spellCheck={false}
        placeholder="Follow along at example.com&#10;&#10;YouTube: @yourchannel&#10;Instagram: @yourhandle"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="mt-3 flex items-center gap-2">
        <Button
          disabled={draft === saved}
          onClick={() =>
            void mutate(
              "updateSettings",
              { ...data.settings, clipDescription: draft },
              { successMessage: "Saved." }
            )
          }
        >
          Save
        </Button>
        {draft === saved ? null : (
          <Button variant="secondary" onClick={() => setDraft(saved)}>
            Discard
          </Button>
        )}
      </div>
    </Card>
  );
}
