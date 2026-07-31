"use client";

import { useMemo, useState } from "react";
import { Ban, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StatusChip } from "@/components/uploading-center/status-chip";
import { lockedPlatforms, openPlatforms, PLATFORM_LABELS } from "@/lib/publisher/revise";
import type { RevisePatch } from "@/lib/publisher/revise";
import { ALL_PLATFORMS, type PlatformId, type QueueItem, type Visibility } from "@/lib/publisher/types";
import { cn } from "@/lib/utils";

/**
 * Revising one scheduled post: when it goes out, what it says, who it posts
 * as, and where. Before this the only edit was the title, so changing a
 * publish time meant deleting the post and rebuilding its caption from scratch.
 *
 * Time moves by NUDGES rather than a date picker on purpose. The queue stores
 * UTC instants but the creator thinks in the publish timezone, and a
 * datetime-local bound across that gap is a reliable source of off-by-an-hour
 * bugs; "+1 hour" is unambiguous in both, and the resulting local time is shown
 * before anything is saved. Moving a whole day at once lives on the day band.
 */

const NUDGES: { label: string; minutes: number }[] = [
  { label: "−1 day", minutes: -1440 },
  { label: "−1 hr", minutes: -60 },
  { label: "−15 m", minutes: -15 },
  { label: "+15 m", minutes: 15 },
  { label: "+1 hr", minutes: 60 },
  { label: "+1 day", minutes: 1440 }
];

const VISIBILITIES: Visibility[] = ["public", "private", "unlisted"];

type Account = { id: string; platform: PlatformId; label: string };

export function RevisePostModal({
  item,
  timeZone,
  accounts,
  busy,
  onClose,
  onSave,
  onSkip
}: {
  item: QueueItem;
  timeZone: string;
  accounts: Account[];
  busy: boolean;
  onClose: () => void;
  onSave: (patch: RevisePatch) => Promise<boolean>;
  onSkip: () => Promise<boolean>;
}) {
  const locked = useMemo(() => lockedPlatforms(item), [item]);
  const open = useMemo(() => openPlatforms(item), [item]);
  // A post that has left the app can still be renamed — YouTube's videos.update
  // genuinely renames a live video — but nothing else here can reach it.
  const deliveryLocked = locked.length > 0;

  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.caption);
  const [hashtags, setHashtags] = useState(item.hashtags.join(" "));
  const [visibility, setVisibility] = useState<Visibility>(item.visibility);
  const [accountId, setAccountId] = useState(item.accountId ?? "");
  const [targets, setTargets] = useState<PlatformId[]>(Object.keys(item.platforms) as PlatformId[]);
  const [shiftMinutes, setShiftMinutes] = useState(0);

  const publishAt = useMemo(
    () => new Date(new Date(item.publishAt).getTime() + shiftMinutes * 60_000),
    [item.publishAt, shiftMinutes]
  );
  const publishLabel = publishAt.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  const toggleTarget = (platform: PlatformId) => {
    setTargets((current) =>
      current.includes(platform) ? current.filter((p) => p !== platform) : [...current, platform]
    );
  };

  const patch = useMemo(() => {
    const next: RevisePatch = {};
    if (title.trim() !== item.title) next.title = title.trim();
    if (deliveryLocked) return next;

    if (shiftMinutes !== 0) next.publishAt = publishAt.toISOString();
    if (caption !== item.caption) next.caption = caption;
    const tags = hashtags.split(/\s+/).filter(Boolean);
    if (tags.join(" ") !== item.hashtags.join(" ")) next.hashtags = tags;
    if (visibility !== item.visibility) next.visibility = visibility;
    if (accountId && accountId !== item.accountId) next.accountId = accountId;
    const current = Object.keys(item.platforms) as PlatformId[];
    if (targets.length !== current.length || targets.some((p) => !current.includes(p))) {
      next.platforms = targets;
    }
    return next;
  }, [
    title,
    caption,
    hashtags,
    visibility,
    accountId,
    targets,
    shiftMinutes,
    publishAt,
    item,
    deliveryLocked
  ]);

  const dirty = Object.keys(patch).length > 0;

  return (
    <Modal
      open
      title="Revise post"
      description={
        deliveryLocked
          ? `Already on ${locked.map((p) => PLATFORM_LABELS[p]).join(" and ")} — only the title can change from here.`
          : "Change when this goes out, what it says, or where it lands."
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(item.platforms) as PlatformId[]).map((platform) => (
            <span key={platform} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1">
              <span className="text-xs text-white">{PLATFORM_LABELS[platform]}</span>
              <StatusChip status={item.platforms[platform]!.status} />
            </span>
          ))}
        </div>

        <label className="block">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={100}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
          />
        </label>

        <fieldset disabled={deliveryLocked} className={cn("space-y-4", deliveryLocked && "opacity-50")}>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Goes out</span>
              <span className="text-sm font-semibold text-white">
                {publishLabel}
                {shiftMinutes !== 0 ? (
                  <span className="ml-1.5 text-xs font-normal text-[var(--accent)]">
                    ({shiftMinutes > 0 ? "+" : ""}
                    {shiftMinutes} min)
                  </span>
                ) : null}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {NUDGES.map((nudge) => (
                <button
                  key={nudge.label}
                  type="button"
                  onClick={() => setShiftMinutes((current) => current + nudge.minutes)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
                >
                  {nudge.label}
                </button>
              ))}
              {shiftMinutes !== 0 ? (
                <button
                  type="button"
                  onClick={() => setShiftMinutes(0)}
                  className="rounded-lg px-2.5 py-1 text-xs text-[var(--accent)] transition hover:underline"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Caption</span>
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              rows={4}
              className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Hashtags</span>
            <input
              value={hashtags}
              onChange={(event) => setHashtags(event.target.value)}
              placeholder="#ai #vibecoding"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Visibility</span>
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as Visibility)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2 text-sm capitalize text-white outline-none focus:border-[var(--accent)]"
              >
                {VISIBILITIES.map((option) => (
                  <option key={option} value={option} className="bg-[var(--panel)]">
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Account</span>
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
              >
                <option value="" className="bg-[var(--panel)]">
                  Primary
                </option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id} className="bg-[var(--panel)]">
                    {account.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Goes to</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ALL_PLATFORMS.map((platform) => {
                const on = targets.includes(platform);
                const held = locked.includes(platform);
                return (
                  <button
                    key={platform}
                    type="button"
                    disabled={held}
                    onClick={() => toggleTarget(platform)}
                    title={held ? `${PLATFORM_LABELS[platform]} already has this post` : undefined}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      on
                        ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white",
                      held && "cursor-not-allowed opacity-60"
                    )}
                  >
                    {held ? <Lock className="h-3 w-3" /> : null}
                    {PLATFORM_LABELS[platform]}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-4">
          {open.length > 0 ? (
            <Button
              onClick={() => void onSkip().then((ok) => ok && onClose())}
              disabled={busy}
              className="border border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:border-red-400/40 hover:text-red-300"
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" />
              Skip this post
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button onClick={onClose} className="border border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:text-white">
              Cancel
            </Button>
            <Button onClick={() => void onSave(patch).then((ok) => ok && onClose())} disabled={!dirty || busy}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
