"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Radio, ShieldCheck, Sparkles, Unlock, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Line = { id: string; role: "user" | "assistant"; text: string };
type ToolLine = { id: string; name: string; ok: boolean };
type ProviderInfo = { provider: string; model: string; free: boolean };

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function FreeVoicePanel({ onWorkStarted }: { onWorkStarted?: () => void }) {
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [allowActions, setAllowActions] = useState(false);
  const [grantId, setGrantId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [toolLines, setToolLines] = useState<ToolLine[]>([]);
  const [heard, setHeard] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetch("/api/voice/ask", { cache: "no-store" })
        .then((response) => response.json())
        .then((data: ProviderInfo) => setInfo(data))
        .catch(() => setInfo(null));
    });
    return () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!speakReplies || typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const plain = text.replace(/[#*_`>[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 2400);
      if (!plain) return;
      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.rate = 1.03;
      window.speechSynthesis.speak(utterance);
    },
    [speakReplies]
  );

  const ask = useCallback(
    async (utterance: string) => {
      const value = utterance.trim();
      if (!value) return;
      setLines((current) => [...current, { id: crypto.randomUUID(), role: "user" as const, text: value }].slice(-30));
      setThinking(true);
      try {
        const response = await fetch("/api/voice/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ utterance: value, grantId: grantId ?? undefined, history: historyRef.current.slice(-6) })
        });
        const data = (await response.json()) as {
          reply?: string;
          toolRuns?: Array<{ name: string; result: { ok?: boolean } }>;
          error?: string;
        };
        if (!response.ok || !data.reply) throw new Error(data.error ?? "No answer came back.");
        setLines((current) => [...current, { id: crypto.randomUUID(), role: "assistant" as const, text: data.reply! }].slice(-30));
        historyRef.current = [
          ...historyRef.current,
          { role: "user" as const, content: value },
          { role: "assistant" as const, content: data.reply }
        ].slice(-6);
        const runs = data.toolRuns ?? [];
        if (runs.length) {
          setToolLines((current) =>
            [...runs.map((run) => ({ id: crypto.randomUUID(), name: run.name, ok: run.result?.ok !== false })), ...current].slice(0, 10)
          );
          if (runs.some((run) => run.result?.ok !== false)) onWorkStarted?.();
        }
        speak(data.reply);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That turn failed.");
      } finally {
        setThinking(false);
      }
    },
    [grantId, onWorkStarted, speak]
  );

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      toast.error("This browser has no speech recognition. Chrome has it.");
      return;
    }
    window.speechSynthesis?.cancel();
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-CA";
    let final = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) final = `${final} ${result[0].transcript}`.trim();
        else interim += result[0].transcript;
      }
      setHeard(`${final}${interim ? ` ${interim}` : ""}`.trim());
    };
    recognition.onend = () => {
      setListening(false);
      setHeard("");
      if (final.trim()) void ask(final);
    };
    recognition.onerror = () => {
      setListening(false);
      setHeard("");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  async function toggleActions() {
    if (allowActions) {
      setAllowActions(false);
      setGrantId(null);
      return;
    }
    const response = await fetch("/api/voice/ask", { method: "PUT" });
    const data = (await response.json()) as { grantId?: string };
    if (!data.grantId) {
      toast.error("Could not arm actions.");
      return;
    }
    setGrantId(data.grantId);
    setAllowActions(true);
  }

  return (
    <Card className={cn("relative overflow-hidden", listening && "border-[var(--accent)]/50")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="font-semibold text-white">Talk to it</h2>
          {info ? <Badge className={info.free ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : ""}>{info.free ? "free" : info.provider}</Badge> : null}
          {thinking ? (
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> working
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setSpeakReplies((value) => !value)}>
            {speakReplies ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </Button>
          <Button variant={listening ? "danger" : "primary"} onClick={toggleListening} disabled={thinking}>
            {listening ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
            {listening ? "Listening — click when done" : "Hold a conversation"}
          </Button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void toggleActions()}
        className={cn(
          "flex w-full items-start gap-2 rounded-lg border p-3 text-left transition",
          allowActions ? "border-amber-400/40 bg-amber-400/10" : "border-[var(--border)] bg-white/[0.03]"
        )}
      >
        {allowActions ? <Unlock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />}
        <span className="text-xs leading-relaxed text-[var(--muted-foreground)]">
          <span className="block text-sm font-medium text-white">{allowActions ? "Actions armed" : "Read-only"}</span>
          {allowActions
            ? "It can scan the channel, put a stream through the pipeline and start an agent team. It still cannot publish, schedule, delete or touch a token."
            : "It can look at everything and answer. Say the word and arm it to let it start work."}
        </span>
      </button>

      {heard ? <p className="mt-3 text-sm italic text-[var(--muted-foreground)]">{heard}</p> : null}

      {lines.length ? (
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
          {lines.map((line) => (
            <div
              key={line.id}
              className={cn(
                "rounded-lg px-3 py-2 text-sm leading-relaxed",
                line.role === "user" ? "bg-white/[0.04] text-white" : "border border-[var(--accent)]/25 bg-[var(--accent)]/8 text-white/90"
              )}
            >
              {line.text}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          Click the mic and say something — try &ldquo;check my channel for anything new&rdquo;.
        </p>
      )}

      {toolLines.length ? (
        <div className="mt-3 space-y-1 rounded-lg border border-[var(--border)] bg-white/[0.02] p-2.5">
          {toolLines.map((line) => (
            <div key={line.id} className="flex items-center gap-2 text-xs">
              <Radio className={cn("h-3 w-3 shrink-0", line.ok ? "text-emerald-300" : "text-red-300")} />
              <span className="text-white">{line.name.replaceAll("_", " ")}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
