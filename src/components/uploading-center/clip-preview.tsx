"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { Modal } from "@/components/ui/modal";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Clip thumbnail with in-place previews: hovering swaps the poster for a
 * muted, looping mini preview of the render; clicking opens the full clip
 * (with sound and controls) in a modal, so you never leave the page.
 */
export function ClipPreview({
  thumbnailUrl,
  previewUrl,
  headline,
  durationSec
}: {
  thumbnailUrl: string;
  previewUrl: string;
  headline: string;
  durationSec: number;
}) {
  const [hovering, setHovering] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={`Preview clip: ${headline}`}
        onClick={() => setOpen(true)}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        className="group relative block w-full cursor-pointer overflow-hidden rounded-lg border border-[var(--border)] bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnailUrl} alt="" className="aspect-[9/16] w-full object-cover" loading="lazy" />
        {hovering ? (
          <video
            src={previewUrl}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
          <Play
            className="h-6 w-6 text-white opacity-0 drop-shadow transition group-hover:opacity-90"
            fill="currentColor"
          />
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
          {formatDuration(durationSec)}
        </span>
      </button>
      <Modal open={open} title={headline} description="Full preview" onClose={() => setOpen(false)}>
        <div className="flex justify-center">
          {open ? (
            <video
              src={previewUrl}
              controls
              autoPlay
              playsInline
              className="max-h-[70vh] rounded-xl border border-[var(--border)] bg-black"
            />
          ) : null}
        </div>
      </Modal>
    </>
  );
}
