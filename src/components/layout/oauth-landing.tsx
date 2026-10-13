"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { describeOAuthLanding, OAUTH_LANDING_PARAMS, type OAuthLanding } from "@/lib/publisher/oauthLanding";

/**
 * The result of a sign-in, read from the address the provider sent us back to.
 *
 * Returns the landing for an inline banner and also raises a toast. The toast
 * is deferred past the first paint on purpose: the page's effect runs in the
 * same pass that mounts the toaster, so a toast raised straight from it is
 * dropped. The banner is what makes the result impossible to miss.
 *
 * `strip: false` leaves the address alone for a screen that tidies it itself.
 */
export function useOAuthLanding({
  strip = true,
  action,
  defaultPlatform
}: {
  strip?: boolean;
  action?: { label: string; href: string };
  /** The platform a failure belongs to when the address does not say (a screen that only ever signs in one). */
  defaultPlatform?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const [landing, setLanding] = useState<OAuthLanding | null>(null);

  useEffect(() => {
    // Read now (before any sibling effect tidies the address), publish after.
    const search = new URLSearchParams(window.location.search);
    const read = new URLSearchParams(search);
    if (defaultPlatform && read.has("connect_error") && !read.has("connect")) read.set("connect", defaultPlatform);
    const found = describeOAuthLanding(read);
    if (!found) return;
    const hash = window.location.hash;
    queueMicrotask(() => setLanding(found));
    const timer = window.setTimeout(() => {
      if (found.tone === "success") toast.success(`${found.title}. ${found.detail}`);
      else toast.error(found.detail, { duration: 12000, action: action ? { label: action.label, onClick: () => router.push(action.href) } : undefined });
      if (strip) {
        for (const key of OAUTH_LANDING_PARAMS) search.delete(key);
        const rest = search.toString();
        router.replace(`${pathname}${rest ? `?${rest}` : ""}${hash}`, { scroll: false });
      }
    }, 250);
    return () => window.clearTimeout(timer);
    // The landing is read once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { landing, dismiss: () => setLanding(null) };
}

export function OAuthLandingBanner({
  landing,
  onDismiss,
  settingsLink = true
}: {
  landing: OAuthLanding | null;
  onDismiss: () => void;
  /** Offer "Open Settings > Accounts" on a failure. Off on Settings itself. */
  settingsLink?: boolean;
}) {
  if (!landing) return null;
  const ok = landing.tone === "success";
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={ok ? "status" : "alert"}
      data-oauth-landing={landing.tone}
      className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${
        ok ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-amber-400/40 bg-amber-400/10 text-amber-100"
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? "text-emerald-300" : "text-amber-300"}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white">{landing.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-90">{landing.detail}</p>
        {!ok && settingsLink ? (
          <Link href="/settings#accounts" className="mt-1.5 inline-block text-xs font-medium text-white underline underline-offset-2">
            Open Settings → Accounts
          </Link>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss this message"
        className="shrink-0 rounded p-1 text-current opacity-80 hover:bg-white/10 hover:opacity-100"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
