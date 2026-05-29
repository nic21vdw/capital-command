"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { prettyDateTime } from "@/lib/progress/date-utils";
import { sessionXP } from "@/lib/progress/calculations";
import type { Session } from "@/types/progress";

function toLocalInputValue(iso: string) {
  // datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
  return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm");
}

export function SessionHistory({
  sessions,
  onUpdate,
  onDelete
}: {
  sessions: Session[];
  onUpdate: (id: string, patch: Partial<Pick<Session, "startTime" | "endTime">>) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Session | null>(null);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");

  const ordered = [...sessions].sort((a, b) =>
    b.startTime.localeCompare(a.startTime)
  );

  const openEdit = (session: Session) => {
    setEditing(session);
    setDraftStart(toLocalInputValue(session.startTime));
    setDraftEnd(toLocalInputValue(session.endTime));
  };

  const closeEdit = () => setEditing(null);

  const saveEdit = () => {
    if (!editing) return;
    const startIso = new Date(draftStart).toISOString();
    const endIso = new Date(draftEnd).toISOString();
    if (new Date(endIso) <= new Date(startIso)) {
      return; // ignore invalid range
    }
    onUpdate(editing.id, { startTime: startIso, endTime: endIso });
    setEditing(null);
  };

  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">Recent sessions</p>
          <p className="mt-2 text-lg font-semibold text-white">Another brick in the empire</p>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">{sessions.length} total</p>
      </div>

      {ordered.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted-foreground)]">
          No sessions yet. Hit start when you sit down to build.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {ordered.slice(0, 20).map((session) => {
            const xp = sessionXP(session.durationMinutes);
            const hours = (session.durationMinutes / 60).toFixed(2);
            return (
              <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {prettyDateTime(session.startTime)}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {hours} h · {session.durationMinutes} min · +{xp} XP
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => openEdit(session)} className="px-2">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" onClick={() => onDelete(session.id)} className="px-2 text-red-300 hover:text-red-200">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={editing !== null}
        title="Edit session"
        description="Adjust the start or end time. Totals will recompute."
        onClose={closeEdit}
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm text-[var(--muted-foreground)]">
            Start
            <Input
              type="datetime-local"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-sm text-[var(--muted-foreground)]">
            End
            <Input
              type="datetime-local"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              className="mt-1"
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={closeEdit}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveEdit}>
              Save changes
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
