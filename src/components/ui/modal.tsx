"use client";

import type { PropsWithChildren } from "react";
import { Button } from "@/components/ui/button";

export function Modal({
  open,
  title,
  description,
  onClose,
  children
}: PropsWithChildren<{ open: boolean; title: string; description?: string; onClose: () => void }>) {
  if (!open) return null;

  return (
    <div className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="modal-panel-enter w-full max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p> : null}
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
