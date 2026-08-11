"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Radio } from "lucide-react";
import { Suspense } from "react";
import { useStream } from "@/components/providers/stream-provider";
import { screenTakesStream, streamLinkFor, streamProgressLabel } from "@/lib/pipeline/streams";
import { cn } from "@/lib/utils";

/**
 * The line at the top of every screen that can show one recording: which stream
 * you are working on, and whether what is below is narrowed to it.
 *
 * The sidebar says what you picked; this says what you are ACTUALLY looking at.
 * They are not the same question — arriving from a bookmark, or clicking
 * "Every stream" here, leaves the pick intact while the list shows everything,
 * and a screen that quietly disagreed with the sidebar would be worse than one
 * that never mentioned the stream at all.
 */
export function StreamBanner() {
  return (
    <Suspense fallback={null}>
      <StreamBannerBody />
    </Suspense>
  );
}

function StreamBannerBody() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { stream } = useStream();

  // The Pipeline page is where a stream is chosen and it names the run itself.
  if (pathname === "/" || pathname === "/pipeline") return null;
  if (!screenTakesStream(pathname)) return null;
  if (!stream) return null;

  const link = streamLinkFor(pathname, stream);
  const filtered = Boolean(link && searchParams.get(link.param) === link.value);

  const show = () => {
    if (!link) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set(link.param, link.value);
    router.push(`${pathname}?${next.toString()}`);
  };

  const showAll = () => {
    if (!link) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete(link.param);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
      <Radio className={cn("h-4 w-4 shrink-0", filtered ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]")} />
      <span className="text-[var(--muted-foreground)]">Working on</span>
      <Link href={`/?run=${encodeURIComponent(stream.id)}`} className="truncate font-medium text-white hover:text-[var(--accent)]">
        {stream.name}
      </Link>
      <span className="text-xs text-[var(--muted-foreground)]">{streamProgressLabel(stream)}</span>
      {link ? (
        <button
          type="button"
          onClick={filtered ? showAll : show}
          className="ml-auto shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
        >
          {filtered ? "Show every stream" : "Show only this stream"}
        </button>
      ) : (
        <span className="ml-auto shrink-0 text-xs text-[var(--muted-foreground)]">
          Nothing from this stream here yet
        </span>
      )}
    </div>
  );
}
