"use client";

import { useMemo, useState } from "react";
import { Loader2, Mic, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import type { Voiceover } from "@/types/domain";

/** AI voiceover: typed dialogue synthesized in Nic's cloned voice (ElevenLabs). */

export function VoiceoverPage() {
  const { data, loading, refresh } = useAppData();
  const voiceovers = useMemo(() => data.voiceovers ?? [], [data.voiceovers]);

  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    if (!script.trim()) return void toast.error("Type the dialogue you want spoken.");
    setGenerating(true);
    try {
      const response = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "Voiceover", script })
      });
      const json = (await response.json()) as { voiceover?: Voiceover; error?: string };
      if (!response.ok || !json.voiceover) {
        toast.error(json.error ?? "Could not generate the voiceover.");
        return;
      }
      if (json.voiceover.status === "failed") {
        toast.error(json.voiceover.error ?? "Could not generate the voiceover.");
      } else {
        toast.success("Voiceover ready.");
        setTitle("");
        setScript("");
      }
      void refresh();
    } catch {
      toast.error("Could not generate the voiceover.");
    } finally {
      setGenerating(false);
    }
  };

  useColateralSurface({
    route: "/voiceover",
    title: "Voiceover",
    summary: "Type any dialogue and generate it in your own cloned voice for narration, avatar dubbing, or quick VO drops.",
    fields: [
      { id: "title", label: "Voiceover title", value: title, kind: "text" },
      { id: "script", label: "Script", value: script, kind: "longtext" }
    ],
    controls: [
      {
        id: "generate",
        label: "Generate voiceover",
        group: "Generate",
        disabled: generating || !script.trim(),
        destructive: true,
        hint: "Synthesizes audio through ElevenLabs — an external, billed API."
      }
    ],
    readings: [
      { label: "Voiceovers", value: String(voiceovers.length) },
      { label: "Latest status", value: voiceovers[0]?.status ?? "—" }
    ],
    setField: (id, value) => {
      if (typeof value !== "string") return false;
      if (id === "title") {
        setTitle(value);
        return true;
      }
      if (id === "script") {
        setScript(value);
        return true;
      }
      return false;
    },
    click: (id) => {
      if (id !== "generate") return false;
      if (generating || !script.trim()) return false;
      void generate();
      return true;
    }
  });

  return (
    <div>
      <PageHeader
        eyebrow="Studio"
        title="Voiceover"
        description="Type any dialogue and generate it in your own cloned voice — for narration, avatar dubbing, or quick VO drops into an edit."
      />

      <Card className="mb-6 space-y-3">
        <Input placeholder="Voiceover title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} />
        <Textarea placeholder="Type what you want said…" value={script} onChange={(event) => setScript(event.target.value)} />
        <div className="flex justify-end">
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generating ? "Generating…" : "Generate"}
          </Button>
        </div>
      </Card>

      {voiceovers.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Mic className="h-8 w-8 text-[var(--accent)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {loading ? "Loading…" : "No voiceovers yet — type some dialogue above to generate one."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {voiceovers.map((voiceover) => (
            <VoiceoverCard key={voiceover.id} voiceover={voiceover} refresh={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function VoiceoverCard({ voiceover, refresh }: { voiceover: Voiceover; refresh: () => Promise<void> | void }) {
  const remove = async () => {
    if (!window.confirm("Delete this voiceover?")) return;
    const response = await fetch(`/api/voiceover/${voiceover.id}`, { method: "DELETE" });
    if (response.ok) void refresh();
    else toast.error("Could not delete the voiceover.");
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">{voiceover.title}</h3>
          <p className="text-xs text-[var(--muted-foreground)]">{new Date(voiceover.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-2">
          {voiceover.status === "failed" ? (
            <Badge tone="danger">Failed</Badge>
          ) : (
            <Badge tone="success">Ready</Badge>
          )}
          <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => void remove()}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">{voiceover.script}</p>
      {voiceover.status === "completed" && voiceover.audioUrl ? (
        <audio src={voiceover.audioUrl} controls className="w-full" />
      ) : voiceover.status === "failed" ? (
        <p className="tone-danger tone-edge tone-soft tone-text rounded-lg border p-2 text-xs">{voiceover.error}</p>
      ) : null}
    </Card>
  );
}
