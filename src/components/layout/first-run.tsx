"use client";

import { useState } from "react";
import Link from "next/link";
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
  const [channelName, setChannelName] = useState(data.creatorProfile.channelName);
  const [handle, setHandle] = useState(data.creatorProfile.handle);
  const [saving, setSaving] = useState(false);

  const complete = async (withProfile: boolean) => {
    setSaving(true);
    try {
      if (withProfile) {
        await mutate("updateCreatorProfile", {
          ...data.creatorProfile,
          channelName: channelName.trim(),
          handle: handle.trim()
        });
      }
      await mutate("updateSettings", {
        ...data.settings,
        setupCompletedAt: new Date().toISOString()
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          Capital Command
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
          YouTube, TikTok, Spotify, Instagram, Facebook and Threads are each connected in Settings, and this app posts
          to none of them until you do. You can come back to it — nothing is queued in the meantime.
        </p>
        <div className="mt-4">
          <Link href="/settings">
            <Button variant="secondary">Open Settings</Button>
          </Link>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={saving} onClick={() => void complete(true)}>
          {saving ? "Saving…" : "Start"}
        </Button>
        <Button variant="secondary" disabled={saving} onClick={() => void complete(false)}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
