"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/editor/controls";
import { CaptionLayer } from "@/components/editor/preview";
import { loadBrandKit, saveVideoLooks, useBrandKitState } from "@/lib/brand/client";
import { captureVideoLook, videoLookBrief, videoLookPatch, videoLookSchema, type VideoLook } from "@/lib/brand/video-look";
import type { ClipProject } from "@/types/domain";
import type { EditorApi } from "./types";

function CaptionSample({ project, label }: { project: ClipProject; label: string }) {
  const caption = project.captions.find((item) => item.enabled && item.end > item.start);
  const sample = caption ?? { id: "look-sample", start: 0, end: 3, text: "Make the useful moment clear", words: [], enabled: true };
  const time = sample.words[0]?.start ?? sample.start;
  return (
    <figure className="min-w-0 space-y-2">
      <figcaption className="text-sm font-medium">{label}</figcaption>
      <div className="relative mx-auto h-[280px] w-[158px] overflow-hidden rounded-xl border border-[var(--border)] bg-[#202a38]" aria-label={`${label} caption preview`}>
        <div className="absolute inset-x-3 top-4 text-center text-[10px] text-[#cbd5e1]">{caption ? "Words from this edit" : "Sample words"}</div>
        <CaptionLayer project={{ ...project, captions: [sample] }} video={null} fallbackTime={time} frameW={158} frameH={280} selected={false} onSelect={() => undefined} />
        {!project.captionsVisible ? <p className="absolute inset-x-3 top-1/2 text-center text-xs text-[#cbd5e1]">Captions hidden</p> : null}
      </div>
    </figure>
  );
}

function LookSummary({ look }: { look: VideoLook }) {
  return (
    <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
      {look.captionStyle.fontFamily.split(",")[0]} · {look.captionStyle.position.replace("-", " ")} · {look.captionsVisible ? "Captions visible" : "Captions hidden"} · {look.highlightCurrentWord ? "Word highlight on" : "Word highlight off"} · {look.burnCaptions ? "Burn on export" : "No burned captions"}
    </p>
  );
}

export function VideoLooks({ api }: { api: EditorApi }) {
  const state = useBrandKitState();
  const looks = state.kit.videoLooks ?? [];
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VideoLook | null>(null);
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = looks.find((look) => look.id === selectedId);
  const blocked = !state.loaded || state.refreshing || state.busy || Boolean(state.error) || state.issues.length > 0;

  const close = () => {
    if (state.busy) return;
    setOpen(false);
    setSelectedId(null);
    setDraft(null);
    setRemoving(false);
    setNotice(null);
  };
  const back = () => {
    setDraft(null);
    setSelectedId(null);
    setRemoving(false);
    setNotice(null);
  };
  const capture = () => {
    try {
      setDraft({ ...captureVideoLook(api.project, crypto.randomUUID(), "New look", ""), name: "" });
    } catch {
      setNotice("This edit has an unsupported caption setting. Choose a caption preset first, then save its look.");
    }
  };
  const save = async () => {
    if (!draft) return;
    const result = videoLookSchema.safeParse(draft);
    if (!result.success) {
      setNotice(result.error.issues[0]?.message ?? "Check the look's fields.");
      return;
    }
    const next = [...looks.filter((look) => look.id !== draft.id), result.data];
    if (await saveVideoLooks(next)) {
      setDraft(null);
      setSelectedId(result.data.id);
      setNotice("Saved in your brand kit. Existing edits stay as they are.");
    }
  };
  const remove = async () => {
    if (!selected) return;
    if (await saveVideoLooks(looks.filter((look) => look.id !== selected.id))) {
      back();
      setNotice("Look removed from the kit. Edits that used it keep their settings.");
    }
  };
  const copyBrief = async () => {
    if (!selected) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(videoLookBrief(selected));
      setNotice("Editing brief copied. Paste it into ChatGPT or your editor.");
    } catch {
      setNotice("Clipboard unavailable. Try again from a secure local browser.");
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3" aria-label="Brand video looks">
      <h3 className="text-sm font-semibold">Your video looks</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">Keep a caption look and editing brief in your brand kit, ready for the next video.</p>
      <Button className="mt-3 w-full" variant="secondary" onClick={() => { setOpen(true); void loadBrandKit(true); }}>Open video looks{looks.length ? ` (${looks.length})` : ""}</Button>
      <Modal open={open} title={draft ? (looks.some((look) => look.id === draft.id) ? "Edit look details" : "Save this video's look") : selected ? selected.name : "Your video looks"} description="Saved in your brand kit on this machine." onClose={close}>
        <div className="space-y-4 text-[var(--foreground)]">
          {state.error || state.issues.length ? (
            <div role="alert" className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <p>{state.error || state.issues.join(" ")}</p>
              <Button variant="secondary" className="mt-2" disabled={state.busy || state.refreshing} onClick={() => void loadBrandKit(true)}>Reload brand kit</Button>
            </div>
          ) : null}
          {notice ? <p role="status" className="text-sm">{notice}</p> : null}
          {!state.loaded || state.refreshing ? <p>Loading brand kit...</p> : draft ? (
            <>
              <Field label="Look name"><Input maxLength={60} value={draft.name} placeholder="For example: Product walkthrough" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Editing guidance" hint="Optional, for your editing brief"><Textarea rows={4} maxLength={1200} value={draft.guidance} placeholder="For example: Open on the result, leave room to read the screen, keep natural pauses." onChange={(e) => setDraft({ ...draft, guidance: e.target.value })} /></Field>
              <LookSummary look={draft} />
              <p className="text-xs text-[var(--muted-foreground)]">Saves caption styling, visibility, word highlighting and the burn-on-export setting. Guidance is a manual brief. Cuts, framing, media, audio and text are not saved in the look.</p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={blocked || !draft.name.trim()} onClick={() => void save()}>{state.busy ? "Saving..." : "Save look to brand kit"}</Button>
                <Button variant="ghost" disabled={state.busy} onClick={back}>Cancel</Button>
              </div>
            </>
          ) : selected ? (
            <>
              <LookSummary look={selected} />
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border)] p-3 max-[420px]:grid-cols-1">
                <CaptionSample project={api.project} label="Current edit" />
                <CaptionSample project={{ ...api.project, ...videoLookPatch(api.project, selected) }} label="With saved look" />
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">Caption style comparison on a sample frame, not a rendered video. Applying keeps custom caption placement, words, cuts, framing, overlays and audio. Undo in the editor restores the previous look.</p>
              {selected.guidance ? <div className="rounded-lg bg-[var(--background)] p-3"><h4 className="text-sm font-medium">Editing guidance</h4><p className="mt-1 whitespace-pre-wrap text-sm">{selected.guidance}</p><p className="mt-2 text-xs text-[var(--muted-foreground)]">Included in the copied brief. Not applied automatically.</p></div> : null}
              {removing ? (
                <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
                  <p className="text-sm">Remove this saved look? Existing edits keep their settings.</p>
                  <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={blocked} onClick={() => void remove()}>Remove saved look</Button><Button variant="secondary" disabled={state.busy} onClick={() => setRemoving(false)}>Keep look</Button></div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={blocked} onClick={() => { api.patch(videoLookPatch(api.project, selected)); close(); toast.success("Look applied to this edit. Export when you are ready."); }}>Apply to this edit</Button>
                  <Button variant="secondary" disabled={blocked} onClick={() => void copyBrief()}>Copy editing brief</Button>
                  <Button variant="ghost" disabled={blocked} onClick={() => { setDraft(structuredClone(selected)); setNotice(null); }}>Edit details</Button>
                  <Button variant="ghost" disabled={blocked} onClick={() => setRemoving(true)}>Remove look</Button>
                </div>
              )}
              <Button variant="ghost" disabled={state.busy} onClick={back}>Back to looks</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--muted-foreground)]">Style your captions once, then keep the look for a whole series. Review it against another edit before applying.</p>
              {looks.length ? <div className="grid gap-2 sm:grid-cols-2">{looks.map((look) => (
                <button key={look.id} type="button" disabled={blocked} onClick={() => { setSelectedId(look.id); setNotice(null); }} className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-left transition hover:border-[var(--accent)] disabled:opacity-50">
                  <div className="flex gap-1" aria-hidden="true">{[look.captionStyle.textColor, look.captionStyle.highlightColor, look.captionStyle.backgroundColor].map((color, i) => <span key={i} className="h-4 w-4 rounded-full border border-[var(--border)]" style={{ backgroundColor: color }} />)}</div>
                  <h4 className="break-words font-medium">{look.name}</h4><LookSummary look={look} /><p className="text-xs text-[var(--accent)]">Compare and apply</p>
                </button>
              ))}</div> : <p className="rounded-xl border border-dashed border-[var(--border)] p-5 text-sm">No saved looks yet. Capture the caption style of this edit to start your kit.</p>}
              <div className="flex flex-wrap gap-2"><Button disabled={blocked || looks.length >= 12} onClick={capture}>Save current look</Button><Button variant="ghost" disabled={state.busy} onClick={close}>Done</Button></div>
              {looks.length >= 12 ? <p className="text-xs">Your kit holds 12 looks. Remove one to make room.</p> : null}
            </>
          )}
        </div>
      </Modal>
    </section>
  );
}
