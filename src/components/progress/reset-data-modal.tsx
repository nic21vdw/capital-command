"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";

export function ResetDataModal({
  open,
  onClose,
  onConfirm
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const matches = confirm.trim().toUpperCase() === "RESET";

  return (
    <Modal
      open={open}
      title="Reset all progress data?"
      description="This deletes every session, every XP event, your streak, and your level. There is no undo."
      onClose={() => {
        setConfirm("");
        onClose();
      }}
    >
      <div className="flex flex-col gap-3">
        <label className="text-sm text-[var(--muted-foreground)]">
          Type <span className="font-mono text-white">RESET</span> to confirm.
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="RESET"
            className="mt-1"
          />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setConfirm("");
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!matches}
            onClick={() => {
              onConfirm();
              setConfirm("");
            }}
          >
            Wipe everything
          </Button>
        </div>
      </div>
    </Modal>
  );
}
