"use client";

import { Loader2, TriangleAlert, UserRound } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { CreatorInfoState } from "@/components/uploading-center/use-tiktok-creator-info";
import {
  PROCESSING_NOTICE,
  TIKTOK_BRANDED_CONTENT_URL,
  TIKTOK_MUSIC_USAGE_URL,
  TIKTOK_PRIVACY_LABELS,
  brandedContentHint,
  consentBlocker,
  disclosureNotice,
  disclosureOn,
  emptyConsent,
  privacyOptionHint
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

function PolicyLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-white underline underline-offset-2">
      {children}
    </a>
  );
}

function Declaration({ branded }: { branded: boolean }) {
  return (
    <p className="text-[11px] text-[var(--muted-foreground)]">
      By posting, you agree to TikTok&apos;s{" "}
      {branded ? (
        <>
          <PolicyLink href={TIKTOK_BRANDED_CONTENT_URL}>Branded Content Policy</PolicyLink> and{" "}
        </>
      ) : null}
      <PolicyLink href={TIKTOK_MUSIC_USAGE_URL}>Music Usage Confirmation</PolicyLink>.
    </p>
  );
}

function longestVideo(seconds: number): string {
  return seconds % 60 === 0 && seconds >= 120 ? `${seconds / 60} minutes` : `${seconds} seconds`;
}

export function TiktokConsent({
  value,
  onChange,
  state,
  clipDurationSec
}: {
  value: TiktokPostOptions | undefined;
  onChange: (next: TiktokPostOptions | undefined) => void;
  state: CreatorInfoState;
  clipDurationSec?: number;
}) {
  const consent = value ?? { delivery: "inbox" as const };
  const direct = consent.delivery === "direct";
  const info = state.status === "ready" ? state.info : null;
  const audited = state.status === "ready" ? state.audited : true;
  const problem = direct && state.status === "ready" ? consentBlocker(consent, state, clipDurationSec) : null;
  const notice = disclosureNotice(consent);
  const disclosing = disclosureOn(consent);
  const who = info?.nickname ?? "your TikTok account";

  const set = (patch: Partial<TiktokPostOptions>) => onChange({ ...consent, ...patch, consentedAt: undefined });

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
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
            onChange={() => onChange(emptyConsent())}
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
        <p className="tone-warning tone-text flex items-start gap-2 text-[11px]">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {state.cannotPostNow
            ? `${state.message} Nothing can be scheduled straight to the profile until then.`
            : `${state.message} Nothing can be posted straight to the profile until TikTok answers — send it to the inbox instead.`}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
            {info?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- TikTok's avatar host isn't in next.config images
              <img src={info.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" />
            ) : (
              <UserRound className="h-5 w-5" aria-hidden />
            )}
            <span>
              Posting to <span className="text-white">{who}</span>
              {info?.handle ? ` (@${info.handle})` : ""}
              {info?.maxVideoSeconds ? ` · videos up to ${longestVideo(info.maxVideoSeconds)}` : ""}
            </span>
          </div>

          <Select
            value={consent.privacyLevel ?? ""}
            onChange={(event) =>
              set({ privacyLevel: (event.target.value || undefined) as TiktokPrivacyLevel | undefined })
            }
            className="h-9 text-xs"
            aria-label="Who can see this post"
          >
            <option value="">Who can see this post…</option>
            {(info?.privacyLevels ?? []).map((level) => {
              const hint = privacyOptionHint(level, consent);
              return (
                <option key={level} value={level} disabled={Boolean(hint)} title={hint ?? undefined}>
                  {TIKTOK_PRIVACY_LABELS[level]}
                </option>
              );
            })}
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
            label="Content disclosure setting"
            checked={disclosing}
            onChange={(next) =>
              set(next ? { disclosure: true } : { disclosure: false, brandOrganic: false, brandedContent: false })
            }
          />
          <p className="pl-5 text-[11px] text-[var(--muted-foreground)]">
            Turn on to disclose that this video promotes goods or services in exchange for something of value. It
            could promote yourself, a third party, or both.
          </p>
          {disclosing ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pl-5">
              <Toggle
                label="Your brand"
                checked={consent.brandOrganic === true}
                onChange={(next) => set({ brandOrganic: next })}
              />
              <Toggle
                label="Branded content"
                checked={consent.brandedContent === true}
                disabled={Boolean(brandedContentHint(consent))}
                hint={brandedContentHint(consent) ?? undefined}
                onChange={(next) => set({ brandedContent: next })}
              />
            </div>
          ) : null}
          {notice ? <p className="pl-5 text-[11px] text-white">{notice}</p> : null}

          <Declaration branded={consent.brandedContent === true} />

          <label className="flex items-start gap-2 text-xs text-white">
            <input
              type="checkbox"
              checked={Boolean(consent.consentedAt)}
              onChange={(event) =>
                onChange({ ...consent, consentedAt: event.target.checked ? new Date().toISOString() : undefined })
              }
              className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--border)] bg-[var(--surface-2)] accent-[var(--accent)]"
            />
            <span>
              I agree to this video being uploaded to {who} on TikTok at the time I schedule. Nothing is sent to
              TikTok before then.
            </span>
          </label>
          <p className="text-[11px] text-[var(--muted-foreground)]">{PROCESSING_NOTICE}</p>

          {!audited ? (
            <p className="tone-warning tone-text text-[11px]">
              The TikTok app review has not been approved, so TikTok only accepts a private post here. Anything
              wider has to go to the inbox until it is.
            </p>
          ) : null}
          {problem ? <p className="tone-warning tone-text text-[11px]">{problem}</p> : null}
        </div>
      )}
    </div>
  );
}
