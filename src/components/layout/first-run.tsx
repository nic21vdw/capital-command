"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/providers/app-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * The first thing a new install shows, once, before any screen.
 *
 * Opening this app used to mean landing straight on a dashboard already full
 * of data - which was the previous owner's - with nothing saying it was not
 * yours and no prompt to connect anything. A fresh document is empty now, and
 * an empty dashboard with no explanation is its own kind of dead end.
 *
 * So: who is this, and where may it post. Both are skippable, because someone
 * who wants to look around first should be able to, and both are reachable
 * afterwards in Settings. It shows while `setupCompletedAt` is absent, and
 * finishing or skipping is what sets it - not filling the fields in, so a
 * half-finished setup does not reappear every reload.
 */
export function FirstRun() {
  const { data, mutate } = useAppData();
  const router = useRouter();
  const [channelName, setChannelName] = useState(data.creatorProfile.channelName);
  const [handle, setHandle] = useState(data.creatorProfile.handle);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // `then` is where to go once setup is saved. Open Settings used to navigate
  // without finishing setup, and the setup screen covers every route but
  // /settings - so the first sign-in's return trip landed back on this screen.
  const complete = async (withProfile: boolean, then?: string) => {
    setSaving(true);
    setFailure(null);
    try {
      const name = channelName.trim();
      if (withProfile) {
        await mutate("updateCreatorProfile", {
          ...data.creatorProfile,
          channelName: name,
          handle: handle.trim()
        }, { rethrow: true });
      }
      await mutate("updateSettings", {
        ...data.settings,
        // The sidebar reads the display name, not the channel name, so without
        // this it keeps saying "Your channel" after the owner typed theirs.
        ...(withProfile && name ? { profile: { ...data.settings.profile, displayName: name } } : {}),
        setupCompletedAt: new Date().toISOString()
      }, { rethrow: true });
      if (then) router.push(then);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Setup could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          CoLateral Marketing
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">Let&rsquo;s set this up</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Two things and you are running. Both can be changed later in Settings, and nothing you enter leaves this
          machine.
        </p>
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-white">Whose channel is this?</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Signed onto the carousels this app renders. Leave it blank and they go out unsigned.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-[var(--muted-foreground)]">
            <span className="mb-1 block text-white/90">Channel name</span>
            <Input
              value={channelName}
              placeholder="Your channel"
              onChange={(event) => setChannelName(event.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted-foreground)]">
            <span className="mb-1 block text-white/90">Handle</span>
            <Input value={handle} placeholder="@you" onChange={(event) => setHandle(event.target.value)} />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-white">Where may it post?</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Nothing posts until you connect an account - start with YouTube, then add the rest in Settings.
        </p>
      </Card>

      {failure ? <p role="alert" className="break-words text-sm text-[var(--danger)]">{failure}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={saving} onClick={() => void complete(true, "/settings#accounts")}>
          {saving ? "Saving…" : "Connect YouTube"}
        </Button>
        <Button variant="secondary" disabled={saving} onClick={() => void complete(true)}>
          Start without connecting
        </Button>
        <Button variant="secondary" disabled={saving} onClick={() => void complete(false)}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
