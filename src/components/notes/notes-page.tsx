"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus } from "lucide-react";
import { makeResearchNote, useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import type { ResearchNote } from "@/types/domain";

export function NotesPage() {
  const { data, mutate } = useAppData();
  const [editing, setEditing] = useState<ResearchNote | null>(null);
  const [showModal, setShowModal] = useState(false);

  const saveNote = async (formData: FormData) => {
    const note = makeResearchNote(editing ?? undefined);
    note.title = String(formData.get("title") ?? "");
    note.relatedTicker = String(formData.get("relatedTicker") ?? "");
    note.thesis = String(formData.get("thesis") ?? "");
    note.bullCase = String(formData.get("bullCase") ?? "");
    note.bearCase = String(formData.get("bearCase") ?? "");
    note.keyRisks = String(formData.get("keyRisks") ?? "");
    note.valuationThoughts = String(formData.get("valuationThoughts") ?? "");
    note.sourceLinks = String(formData.get("sourceLinks") ?? "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    note.tags = String(formData.get("tags") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    note.body = String(formData.get("body") ?? "");
    note.updatedAt = new Date().toISOString();
    await mutate("upsertResearchNote", note, { successMessage: editing ? "Note updated." : "Note added." });
    setEditing(null);
    setShowModal(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Research Notes"
        title="Research notes"
        description="Keep thesis notes, bull and bear cases, valuations, and supporting links together."
        actions={
          <Button onClick={() => { setEditing(makeResearchNote()); setShowModal(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Add note
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <div className="space-y-3">
            {data.researchNotes.map((note) => (
              <button
                key={note.id}
                className="w-full rounded-2xl border border-white/8 bg-[var(--well)] p-4 text-left transition hover:bg-white/6"
                onClick={() => setEditing(note)}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-white">{note.title}</p>
                  {note.relatedTicker ? <Badge>{note.relatedTicker}</Badge> : null}
                </div>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">{note.thesis}</p>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          {editing ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold text-white">{editing.title}</h2>
                  <p className="text-sm text-[var(--muted-foreground)]">Updated {new Date(editing.updatedAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setShowModal(true)}>Edit</Button>
                  <Button variant="danger" onClick={() => void mutate("deleteResearchNote", editing.id, { successMessage: "Note deleted." })}>Delete</Button>
                </div>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <InfoBlock label="Thesis" value={editing.thesis} />
                <InfoBlock label="Valuation thoughts" value={editing.valuationThoughts} />
                <InfoBlock label="Bull case" value={editing.bullCase} />
                <InfoBlock label="Bear case" value={editing.bearCase} />
                <InfoBlock label="Key risks" value={editing.keyRisks} />
                <InfoBlock label="Source links" value={editing.sourceLinks.join("\n") || "None"} />
              </div>
              <div className="mt-6 rounded-3xl border border-white/8 bg-[var(--well)] p-5">
                <p className="mb-3 text-sm uppercase tracking-[0.2em] text-[var(--muted-foreground)]">Markdown preview</p>
                <div className="prose prose-invert max-w-none text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{editing.body}</ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-80 items-center justify-center rounded-3xl border border-dashed border-white/10 bg-[var(--well)] text-center">
              <div>
                <p className="text-lg font-medium text-white">Select a note</p>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">Your research details and markdown preview will appear here.</p>
              </div>
            </div>
          )}
        </Card>
      </div>
      <Modal
        open={showModal}
        title={editing?.id ? "Edit research note" : "Add research note"}
        description="Markdown is supported in the main note body."
        onClose={() => setShowModal(false)}
      >
        <form action={saveNote} className="grid gap-3 md:grid-cols-2">
          <Input name="title" placeholder="Title" defaultValue={editing?.title} required />
          <Input name="relatedTicker" placeholder="Related ticker or asset" defaultValue={editing?.relatedTicker} />
          <div className="md:col-span-2"><Textarea name="thesis" placeholder="Thesis" defaultValue={editing?.thesis} required /></div>
          <Textarea name="bullCase" placeholder="Bull case" defaultValue={editing?.bullCase} required />
          <Textarea name="bearCase" placeholder="Bear case" defaultValue={editing?.bearCase} required />
          <Textarea name="keyRisks" placeholder="Key risks" defaultValue={editing?.keyRisks} required />
          <Textarea name="valuationThoughts" placeholder="Valuation thoughts" defaultValue={editing?.valuationThoughts} required />
          <Textarea name="sourceLinks" placeholder="Source links, one per line" defaultValue={editing?.sourceLinks.join("\n")} />
          <Input name="tags" placeholder="Tags, comma separated" defaultValue={editing?.tags.join(", ")} />
          <div className="md:col-span-2"><Textarea name="body" placeholder="Markdown body" defaultValue={editing?.body} required className="min-h-48" /></div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit">Save note</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[var(--well)] p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-white">{value}</p>
    </div>
  );
}
