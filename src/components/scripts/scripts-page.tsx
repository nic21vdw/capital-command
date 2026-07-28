"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
  PenLine,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Volume2,
  X
} from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { KitSuggestionStatus, ScriptGraphic, VideoScript } from "@/types/domain";

/** The full spoken script as one copyable text (client-side mirror of the server helper). */
function scriptFullText(script: Pick<VideoScript, "title" | "sections">): string {
  return [script.title, "", ...script.sections.flatMap((section) => [`## ${section.name}`, "", section.content, ""])].join("\n");
}

/**
 * Scripts: generate a full script from a title (or arrive from the Idea Lab
 * with one already written), edit every section, and manage the production
 * kit — the AI-suggested graphics and SFX cues — by accepting or dismissing
 * each suggestion. The framework the generator follows is editable here too.
 */
export function ScriptsPage() {
  const { data, loading, refresh } = useAppData();
  const searchParams = useSearchParams();
  const router = useRouter();

  const scripts = useMemo(() => data.videoStudio?.scripts ?? [], [data.videoStudio]);
  const framework = data.videoStudio?.framework ?? "";

  const selectedId = searchParams.get("scriptId");
  const selected = scripts.find((script) => script.id === selectedId) ?? null;

  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(8);
  const [generating, setGenerating] = useState(false);
  const [showFramework, setShowFramework] = useState(false);

  const generate = async () => {
    if (!title.trim()) {
      toast.error("Give the script a title or topic first.");
      return;
    }
    setGenerating(true);
    try {
      const response = await fetch("/api/studio/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, targetMinutes: minutes })
      });
      const json = (await response.json()) as { script?: VideoScript; error?: string; reason?: string | null };
      if (!response.ok || !json.script) {
        toast.error(json.error ?? "Could not write the script.");
        return;
      }
      if (json.reason) toast.warning(json.reason);
      else toast.success("Script written.");
      setTitle("");
      await refresh();
      router.push(`/scripts?scriptId=${json.script.id}`);
    } catch {
      toast.error("Could not write the script.");
    } finally {
      setGenerating(false);
    }
  };

  if (selected) {
    return <ScriptDetail key={selected.id} script={selected} refresh={refresh} onBack={() => router.push("/scripts")} />;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Studio"
        title="Script Studio"
        description="Full scripts written in your voice, following your script framework — hook to CTA, with a production kit of suggested graphics and sound effects you accept or dismiss. Start from a saved idea in the Idea Lab, or straight from a title here."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Video title or topic"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !generating) void generate();
              }}
              className="sm:w-72"
            />
            <Select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} className="sm:w-28">
              {[3, 5, 8, 10, 12, 15, 20, 30].map((value) => (
                <option key={value} value={value}>
                  {value} min
                </option>
              ))}
            </Select>
            <Button onClick={() => void generate()} disabled={generating} className="shrink-0">
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {generating ? "Writing…" : "Write script"}
            </Button>
          </div>
        }
      />

      <div className="mb-6 flex justify-end">
        <Button variant="ghost" className="gap-2 text-xs" onClick={() => setShowFramework((value) => !value)}>
          <Settings2 className="h-4 w-4" /> {showFramework ? "Hide framework" : "Edit script framework"}
        </Button>
      </div>

      {showFramework ? <FrameworkEditor initial={framework} onSaved={() => void refresh()} /> : null}

      {scripts.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="h-8 w-8 text-[var(--accent)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {loading ? "Loading…" : "No scripts yet — write one from a title above, or from a saved idea in the Idea Lab."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {scripts.map((script) => (
            <Card key={script.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-white">{script.title}</h3>
                <Badge className={script.status === "ready" ? "text-[var(--accent)]" : undefined}>{script.status}</Badge>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                {script.sections.length} sections · ~{script.targetMinutes} min ·{" "}
                {script.graphics.filter((graphic) => graphic.status !== "dismissed").length} graphics ·{" "}
                {script.sfx.filter((cue) => cue.status !== "dismissed").length} SFX cues ·{" "}
                {new Date(script.updatedAt).toLocaleDateString()}
              </p>
              <div className="mt-auto flex gap-2 border-t border-[var(--border)] pt-3">
                <Button className="gap-1.5 px-3 py-1.5 text-xs" onClick={() => router.push(`/scripts?scriptId=${script.id}`)}>
                  <PenLine className="h-3.5 w-3.5" /> Open
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FrameworkEditor({ initial, onSaved }: { initial: string; onSaved: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/studio/framework", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framework: value })
      });
      if (!response.ok) throw new Error();
      toast.success("Framework saved — every future script follows it.");
      onSaved();
    } catch {
      toast.error("Could not save the framework.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Script framework</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            The structure and voice rules every generated script follows. Make it yours — clear the text and save to reset
            to the default.
          </p>
        </div>
        <Button className="gap-1.5 px-3 py-1.5 text-xs" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save framework
        </Button>
      </div>
      <Textarea value={value} onChange={(event) => setValue(event.target.value)} className="min-h-72 font-mono text-xs" />
    </Card>
  );
}

const KIND_LABELS: Record<ScriptGraphic["kind"], string> = {
  "b-roll": "B-roll",
  "screen-recording": "Screen",
  diagram: "Diagram",
  "text-overlay": "Text overlay",
  meme: "Meme",
  photo: "Photo"
};

function ScriptDetail({
  script,
  refresh,
  onBack
}: {
  script: VideoScript;
  refresh: () => Promise<void> | void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<VideoScript>(script);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Server refreshes (e.g. after suggestion toggles) replace the draft unless
  // there are unsaved text edits. State is adjusted during render (the
  // React-recommended pattern) instead of via an effect.
  const [lastScript, setLastScript] = useState(script);
  if (script !== lastScript) {
    setLastScript(script);
    if (!dirty) setDraft(script);
  }

  const patch = async (body: Partial<VideoScript>): Promise<VideoScript | null> => {
    try {
      const response = await fetch(`/api/studio/scripts/${script.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = (await response.json()) as { script?: VideoScript; error?: string };
      if (!response.ok || !json.script) {
        toast.error(json.error ?? "Could not save the script.");
        return null;
      }
      void refresh();
      return json.script;
    } catch {
      toast.error("Could not save the script.");
      return null;
    }
  };

  const save = async () => {
    setSaving(true);
    const saved = await patch({
      title: draft.title,
      status: draft.status,
      targetMinutes: draft.targetMinutes,
      sections: draft.sections
    });
    if (saved) {
      setDirty(false);
      toast.success("Script saved.");
    }
    setSaving(false);
  };

  const setSuggestionStatus = async (
    kind: "graphics" | "sfx",
    id: string,
    status: KitSuggestionStatus
  ) => {
    const next =
      kind === "graphics"
        ? { graphics: draft.graphics.map((entry) => (entry.id === id ? { ...entry, status } : entry)) }
        : { sfx: draft.sfx.map((entry) => (entry.id === id ? { ...entry, status } : entry)) };
    setDraft((current) => ({ ...current, ...next }));
    await patch(next);
  };

  const remove = async () => {
    if (!window.confirm("Delete this script? The source idea (if any) goes back to Saved.")) return;
    const response = await fetch(`/api/studio/scripts/${script.id}`, { method: "DELETE" });
    if (response.ok) {
      void refresh();
      onBack();
    } else {
      toast.error("Could not delete the script.");
    }
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(scriptFullText(draft));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable — select and copy the text manually.");
    }
  };

  const wordCount = draft.sections.reduce((total, section) => total + section.content.split(/\s+/).filter(Boolean).length, 0);

  const sectionName = (sectionId: string) => draft.sections.find((section) => section.id === sectionId)?.name ?? "Whole video";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className="gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> All scripts
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={draft.status}
            onChange={(event) => {
              setDraft((current) => ({ ...current, status: event.target.value as VideoScript["status"] }));
              void patch({ status: event.target.value as VideoScript["status"] });
            }}
            className="w-32"
          >
            <option value="draft">Draft</option>
            <option value="ready">Ready</option>
            <option value="produced">Produced</option>
          </Select>
          <Button variant="secondary" className="gap-1.5" onClick={() => void copyScript()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy full script
          </Button>
          <Button disabled={!dirty || saving} className="gap-1.5" onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
          <Button variant="danger" className="gap-1.5" onClick={() => void remove()}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <Input
          value={draft.title}
          onChange={(event) => {
            setDraft((current) => ({ ...current, title: event.target.value }));
            setDirty(true);
          }}
          className="text-lg font-semibold"
        />
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          ~{draft.targetMinutes} min target · {wordCount} words (~{Math.round(wordCount / 150)} min at speaking pace) ·{" "}
          {draft.source === "ai" ? "written by Claude" : "manual"}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {draft.sections.map((section) => (
            <Card key={section.id} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-white">{section.name}</h3>
                {section.purpose ? <p className="text-xs text-[var(--muted-foreground)]">{section.purpose}</p> : null}
              </div>
              <Textarea
                value={section.content}
                placeholder="Write this section…"
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    sections: current.sections.map((entry) =>
                      entry.id === section.id ? { ...entry, content: event.target.value } : entry
                    )
                  }));
                  setDirty(true);
                }}
                className="min-h-40"
              />
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="flex items-center gap-2 text-white">
              <ImageIcon className="h-4 w-4 text-[var(--accent)]" />
              <h3 className="text-sm font-semibold">Graphics</h3>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Suggested visuals per section — accept what you&apos;ll capture, dismiss the rest.
            </p>
            {draft.graphics.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">No graphic suggestions on this script.</p>
            ) : (
              draft.graphics.map((graphic) => (
                <SuggestionRow
                  key={graphic.id}
                  status={graphic.status}
                  onStatus={(status) => void setSuggestionStatus("graphics", graphic.id, status)}
                >
                  <p className="text-xs text-[var(--muted-foreground)]">
                    <span className="font-medium text-white/80">{KIND_LABELS[graphic.kind]}</span> · {sectionName(graphic.sectionId)}
                  </p>
                  <p className="text-sm text-white/90">{graphic.description}</p>
                </SuggestionRow>
              ))
            )}
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center gap-2 text-white">
              <Volume2 className="h-4 w-4 text-[var(--accent)]" />
              <h3 className="text-sm font-semibold">Sound effects</h3>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Suggested SFX cues — the editors place accepted sounds during the edit.
            </p>
            {draft.sfx.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">No SFX suggestions on this script.</p>
            ) : (
              draft.sfx.map((cue) => (
                <SuggestionRow key={cue.id} status={cue.status} onStatus={(status) => void setSuggestionStatus("sfx", cue.id, status)}>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    <span className="font-medium text-white/80">{cue.sound || "Sound"}</span> · {sectionName(cue.sectionId)}
                  </p>
                  <p className="text-sm text-white/90">{cue.cue}</p>
                </SuggestionRow>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function SuggestionRow({
  status,
  onStatus,
  children
}: {
  status: KitSuggestionStatus;
  onStatus: (status: KitSuggestionStatus) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "space-y-1 rounded-lg border px-3 py-2",
        status === "accepted"
          ? "border-emerald-400/40 bg-emerald-400/5"
          : status === "dismissed"
            ? "border-[var(--border)] opacity-45"
            : "border-[var(--border)]"
      )}
    >
      {children}
      <div className="flex gap-1.5 pt-1">
        {status !== "accepted" ? (
          <button
            type="button"
            onClick={() => onStatus("accepted")}
            className="flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-1 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-400/20"
          >
            <Check className="h-3 w-3" /> Accept
          </button>
        ) : null}
        {status !== "dismissed" ? (
          <button
            type="button"
            onClick={() => onStatus("dismissed")}
            className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-3 w-3" /> Dismiss
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onStatus("suggested")}
            className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
          >
            Restore
          </button>
        )}
      </div>
    </div>
  );
}
