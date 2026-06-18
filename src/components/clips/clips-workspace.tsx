"use client";

import { useState } from "react";
import { Scissors, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { ClippingAgentPage } from "@/components/clips/clipping-agent-page";
import { ClipEditor } from "@/components/clips/editor/clip-editor";

type Mode = "editor" | "auto";

/**
 * The Clip Creator has two modes that share the same storage:
 *  - Editor: a non-destructive timeline editor for Shorts and long-form video.
 *  - Auto clipper: the original VOD-URL → 9:16 clip-discovery agent.
 */
export function ClipsWorkspace() {
  const [mode, setMode] = useState<Mode>("editor");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Tools"
        title="Clip Creator"
        description="Import a video, trim and reframe it on a non-destructive timeline, or auto-clip a livestream VOD into ready-to-post shorts."
      />

      <div className="inline-flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1">
        {(
          [
            { id: "editor", label: "Editor", icon: Scissors },
            { id: "auto", label: "Auto Clipper", icon: Wand2 }
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm transition",
                active ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {mode === "editor" ? <ClipEditor /> : <AutoClipperEmbed />}
    </div>
  );
}

// The original agent renders its own PageHeader; strip it by rendering the page
// component directly under our shared header is acceptable — it adds context.
function AutoClipperEmbed() {
  return <ClippingAgentPage />;
}
