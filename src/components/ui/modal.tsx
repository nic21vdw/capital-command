"use client";

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { PropsWithChildren } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const subscribe = () => () => {};

/**
 * A dialog. It is PORTALLED to `document.body`: a card with `backdrop-filter`,
 * `transform`, `filter` or opacity becomes the containing block of every
 * `position: fixed` descendant, so a modal left inside one appears mid-page,
 * scrolls with it and gets painted over by the next card (the carousel
 * Schedule dialog lost its Cancel / Book buttons that way). Out at the body it
 * is always viewport-fixed and above the command bar (z-40).
 *
 * The panel is capped to the viewport and scrolls inside, so whatever the
 * caller puts at the end of `children` stays reachable on a phone.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children
}: PropsWithChildren<{ open: boolean; title: string; description?: string; onClose: () => void }>) {
  // False on the server and during hydration, true after: a portal needs a document.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const visible = open && mounted;

  // Escape closes the dialog; Tab stays inside it.
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onCloseRef.current();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Move focus in unless a child already took it (autoFocus).
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous && previous.isConnected) previous.focus();
    };
  }, [visible, onKey]);

  if (!visible) return null;

  return createPortal(
    <div
      className="modal-backdrop-enter fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-panel-enter flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-modal)] outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div>
            <h2 id={titleId} className="text-xl font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-white/8 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}
