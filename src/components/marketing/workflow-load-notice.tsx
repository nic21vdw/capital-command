"use client";

import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A persistent recovery action; failed background refreshes preserve the work on screen. */
export function WorkflowLoadNotice({
  title,
  message,
  onRetry,
  retrying = false,
  retained = false,
}: {
  title: string;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  retained?: boolean;
}) {
  return (
    <div className="tone-warning tone-edge tone-soft flex flex-wrap items-start gap-3 rounded-xl border p-3">
      <AlertTriangle
        className="tone-warning tone-text mt-0.5 h-4 w-4 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 basis-40" role="status" aria-live="polite">
        <p className="tone-warning tone-text text-sm font-medium">{title}</p>
        <p className="mt-1 break-words text-xs text-[var(--muted-foreground)]">
          {message}
          {retained
            ? " Your last loaded data is still shown; it may be out of date."
            : ""}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="h-8 shrink-0 px-3 text-xs"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? (
          <Loader2
            className="mr-1.5 h-3.5 w-3.5 animate-spin"
            aria-hidden="true"
          />
        ) : (
          <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        )}
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
