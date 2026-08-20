"use client";

import { useEffect, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Select } from "@/components/ui/select";
import {
  TIKTOK_PRIVACY_LABELS,
  complianceStatement,
  consentProblem,
  disclosureLabel,
  emptyConsent,
  type TiktokCreatorPostingInfo
} from "@/lib/publisher/tiktokPost";
import type { TiktokPostOptions, TiktokPrivacyLevel } from "@/lib/publisher/types";

/**
 * The choices TikTok requires a creator to make themselves before a clip can
 * be posted straight to their profile: who may see it, which interactions are
 * allowed, and whether it promotes anything. Nothing here starts selected —
 * TikTok's content sharing guidelines forbid a default on any of it, which is
 * why the audience list opens empty and every toggle opens off.
 *
 * The other route needs none of it. "Send to my TikTok inbox" uploads the clip
 * as a draft and the creator makes these same choices inside TikTok, which is
 * what the app has always done and what it still does when this panel is left
 * alone.
 */

type CreatorInfoState =
  | { status: "loading" }
  | { status: "ready"; info: TiktokCreatorPostingInfo; audited: boolean }
  | { status: "error"; message: string };

// Keyed by account: two connected profiles have different audiences and
// different interaction settings, and one must never answer for the other.
const creatorInfoRequests = new Map<string, Promise<CreatorInfoState>>();

async function loadCreatorInfo(accountId: string): Promise<CreatorInfoState> {
  let creatorInfoRequest = creatorInfoRequests.get(accountId);
  if (!creatorInfoRequest) {
    creatorInfoRequest = (async (): Promise<CreatorInfoState> => {
    try {
      const response = await fetch(`/api/publish/tiktok/creator-info?account=${encodeURIComponent(accountId)}`);
      const payload = await response.json();
      if (!response.ok) return { status: "error", message: payload?.error ?? "TikTok would not answer." };
      const { audited, ...info } = payload as TiktokCreatorPostingInfo & { audited: boolean };
      return { status: "ready", info, audited };
    } catch {
      return { status: "error", message: "Could not reach TikTok." };
    }
    })();
    creatorInfoRequests.set(accountId, creatorInfoRequest);
  }
  const settled = await creatorInfoRequest;
  // A failed lookup must not be cached forever — the account may just have
  // been connected, or the network may have blinked.
  if (settled.status === "error") creatorInfoRequests.delete(accountId);
  return settled;
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={
        disabled
          ? "flex items-center gap-2 text-xs text-[var(--muted-foreground)] opacity-50"
          : "flex items-center gap-2 text-xs text-white"
      }
      title={hint}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 rounded border-[var(--border)] bg-[var(--surface-2)] accent-[var(--accent)]"
      />
      <span>{label}</span>
      {disabled && hint ? <span className="text-[10px]">({hint})</span> : null}
    </label>
  );
}

export function TiktokConsent({
  value,
  onChange,
  accountId
}: {
  value: TiktokPostOptions | undefined;
  onChange: (next: TiktokPostOptions | undefined) => void;
  accountId: string;
}) {
  const [state, setState] = useState<CreatorInfoState>({ status: "loading" });
  const consent = value ?? { delivery: "inbox" as const };
  const direct = consent.delivery === "direct";

  useEffect(() => {
    if (!direct) return;
    let cancelled = false;
    void loadCreatorInfo(accountId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
      // Back to loading for the next time the panel is opened, so a stale
      // answer is never shown as if it were this account's.
      setState({ status: "loading" });
    };
  }, [direct, accountId]);

  const info = state.status === "ready" ? state.info : null;
  const audited = state.status === "ready" ? state.audited : true;
  const levels: TiktokPrivacyLevel[] =
    info && info.privacyLevels.length > 0
      ? info.privacyLevels
      : (Object.keys(TIKTOK_PRIVACY_LABELS) as TiktokPrivacyLevel[]);
  const problem = direct ? consentProblem(consent, info) : null;
  const compliance = complianceStatement(consent);
  const disclosed = disclosureLabel(consent);

  const set = (patch: Partial<TiktokPostOptions>) => onChange({ ...consent, ...patch });

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium text-white">TikTok</span>
        <label className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
          <input
            type="radio"
            checked={!direct}
            onChange={() => onChange(undefined)}
            className="h-3 w-3 accent-[var(--accent)]"
          />
          Send to my TikTok inbox
        </label>
        <label className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
          <input
            type="radio"
            checked={direct}
            onChange={() => onChange({ ...emptyConsent(), consentedAt: new Date().toISOString() })}
            className="h-3 w-3 accent-[var(--accent)]"
          />
          Post straight to my profile
        </label>
      </div>

      {!direct ? (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          The clip arrives in TikTok as a draft. You pick the audience, the interaction settings and any
          disclosure there, then post it yourself.
        </p>
      ) : state.status === "loading" ? (
        <p className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading what this TikTok account allows…
        </p>
      ) : state.status === "error" ? (
        <p className="flex items-start gap-2 text-[11px] text-amber-200">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {state.message} Nothing can be posted straight to the profile until TikTok answers — send it to the
          inbox instead.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Posting to {info?.nickname ?? "your TikTok account"}
            {info?.handle ? ` (@${info.handle})` : ""}.
          </p>

          <Select
            value={consent.privacyLevel ?? ""}
            onChange={(event) =>
              set({ privacyLevel: (event.target.value || undefined) as TiktokPrivacyLevel | undefined })
            }
            className="h-9 text-xs"
            aria-label="Who can see this post"
          >
            <option value="">Who can see this post…</option>
            {levels.map((level) => (
              <option key={level} value={level}>
                {TIKTOK_PRIVACY_LABELS[level]}
              </option>
            ))}
          </Select>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <Toggle
              label="Allow comments"
              checked={consent.allowComment === true}
              disabled={info?.commentDisabled}
              hint={info?.commentDisabled ? "off in your TikTok settings" : undefined}
              onChange={(next) => set({ allowComment: next })}
            />
            <Toggle
              label="Allow Duet"
              checked={consent.allowDuet === true}
              disabled={info?.duetDisabled}
              hint={info?.duetDisabled ? "off in your TikTok settings" : undefined}
              onChange={(next) => set({ allowDuet: next })}
            />
            <Toggle
              label="Allow Stitch"
              checked={consent.allowStitch === true}
              disabled={info?.stitchDisabled}
              hint={info?.stitchDisabled ? "off in your TikTok settings" : undefined}
              onChange={(next) => set({ allowStitch: next })}
            />
          </div>

          <Toggle
            label="This post promotes a brand, product or service"
            checked={consent.brandOrganic === true || consent.brandedContent === true}
            onChange={(next) => set(next ? { brandOrganic: true } : { brandOrganic: false, brandedContent: false })}
          />
          {consent.brandOrganic || consent.brandedContent ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pl-5">
              <Toggle
                label="Your brand"
                checked={consent.brandOrganic === true}
                onChange={(next) => set({ brandOrganic: next })}
              />
              <Toggle
                label="Branded content"
                checked={consent.brandedContent === true}
                onChange={(next) => set({ brandedContent: next })}
              />
            </div>
          ) : null}
          {disclosed ? (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Your post will be labelled <span className="text-white">{disclosed}</span>.
            </p>
          ) : null}
          {compliance ? <p className="text-[11px] text-[var(--muted-foreground)]">{compliance}</p> : null}
          {!audited ? (
            <p className="text-[11px] text-amber-200">
              The TikTok app review has not been approved, so TikTok only accepts a private post here. Anything
              wider has to go to the inbox until it is.
            </p>
          ) : null}
          {problem ? <p className="text-[11px] text-amber-200">{problem}</p> : null}
        </div>
      )}
    </div>
  );
}
