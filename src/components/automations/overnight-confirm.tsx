"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { OVERNIGHT_CONFIRM_TEXT, OVERNIGHT_CONFIRM_TITLE } from "@/lib/automations/overnight";

/**
 * The confirmation in front of "Auto-book overnight streams". Turning it off
 * needs none; only turning it ON lets an unattended run queue posts.
 */
export function OvernightConfirmDialog({ open, busy = false, onConfirm, onCancel }: { open: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} title={OVERNIGHT_CONFIRM_TITLE} onClose={onCancel}>
      <div className="max-w-xl">
        <p className="text-sm text-white">{OVERNIGHT_CONFIRM_TEXT}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" autoFocus disabled={busy} onClick={onCancel}>Keep it off</Button>
          <Button disabled={busy} onClick={onConfirm}>Turn on auto-booking</Button>
        </div>
      </div>
    </Modal>
  );
}
