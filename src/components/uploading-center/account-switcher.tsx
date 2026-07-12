"use client";

import { useState } from "react";
import { CheckCircle2, Plus, Trash2, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import {
  PLATFORM_LABELS,
  type SocialAccountView,
} from "@/components/uploading-center/use-uploading-center";
import type { PlatformId } from "@/lib/publisher/types";

const ADD_OPTION = "__add__";

/**
 * The per-platform account picker at the top of each Uploading Center tab:
 * a dropdown of every account connected (or planned) for the platform, an
 * "Add account…" entry, and — for YouTube — a Connect button when the
 * selected account hasn't run OAuth yet. Switching accounts switches the
 * whole calendar below to that account's schedule.
 */
export function AccountSwitcher({
  platform,
  accounts,
  activeAccount,
  onSelect,
  onAdd,
  onRemove,
  busy,
}: {
  platform: PlatformId;
  accounts: SocialAccountView[];
  activeAccount: SocialAccountView | null;
  onSelect: (accountId: string) => void;
  onAdd: (label: string) => Promise<boolean>;
  onRemove: (account: SocialAccountView) => Promise<boolean>;
  busy: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const working = busy === `add-account:${platform}` || busy === `remove-account:${activeAccount?.id}`;

  const submitAdd = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const ok = await onAdd(trimmed);
    if (ok) {
      setAdding(false);
      setLabel("");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        Account
      </span>
      <Select
        aria-label={`${PLATFORM_LABELS[platform]} account`}
        className="h-9 w-auto min-w-[14rem] flex-none"
        value={activeAccount?.id ?? ""}
        disabled={working}
        onChange={(event) => {
          const value = event.target.value;
          if (value === ADD_OPTION) {
            setAdding(true);
            // Keep the select on the current account; the switch happens
            // only once the new account is actually created.
            event.target.value = activeAccount?.id ?? "";
            return;
          }
          onSelect(value);
        }}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label}
            {account.platform === "youtube" && account.youtube ? ` — ${account.youtube.title}` : ""}
            {account.connected ? "" : " (not connected)"}
          </option>
        ))}
        <option value={ADD_OPTION}>＋ Add {PLATFORM_LABELS[platform]} account…</option>
      </Select>
      {activeAccount?.connected ? (
        <span className="flex items-center gap-1.5 text-xs text-emerald-300">
          {activeAccount.youtube?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote avatar host isn't in next.config images
            <img src={activeAccount.youtube.thumbnail} alt="" className="h-4 w-4 rounded-full" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {activeAccount.youtube ? `Connected as ${activeAccount.youtube.title}` : "Connected"}
        </span>
      ) : null}
      {platform === "youtube" && activeAccount && !activeAccount.connected ? (
        <Button
          variant="secondary"
          className="h-8 px-3 text-xs"
          disabled={working}
          onClick={() =>
            (window.location.href = `/api/auth/google?account=${encodeURIComponent(activeAccount.id)}`)
          }
        >
          <Youtube className="mr-1.5 h-3.5 w-3.5" /> Connect this account
        </Button>
      ) : null}
      <span className="flex-1" />
      {activeAccount && !activeAccount.primary ? (
        <Button
          variant="ghost"
          className="h-8 px-2.5 text-xs"
          title="Remove this account (its scheduled posts must be removed first)"
          disabled={working}
          onClick={() => void onRemove(activeAccount)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove account
        </Button>
      ) : null}

      {adding ? (
        <Modal
          open
          title={`Add a ${PLATFORM_LABELS[platform]} account`}
          description="Name it after the channel or handle it posts to — each account gets its own calendar of post times."
          onClose={() => setAdding(false)}
        >
          <div className="space-y-4">
            <input
              autoFocus
              value={label}
              maxLength={60}
              placeholder={platform === "youtube" ? "e.g. Clips channel" : "e.g. @secondaccount"}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitAdd();
              }}
              className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-white outline-none focus:border-[var(--accent)]"
            />
            {platform !== "youtube" ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Extra {PLATFORM_LABELS[platform]} accounts schedule posts as manual reminders for now — you post by
                hand at the slot time.
              </p>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">
                After adding it, hit “Connect this account” to sign in with that channel’s Google account so uploads
                run automatically.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="h-9 px-3 text-xs" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button className="h-9 px-3 text-xs" disabled={!label.trim() || working} onClick={() => void submitAdd()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add account
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
