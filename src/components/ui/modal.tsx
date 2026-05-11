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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[32px] border border-white/10 bg-[var(--panel)] p-6 shadow-2xl">
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
