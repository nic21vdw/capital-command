"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Loader2,
  Mic,
  MicOff,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentAction, AgentProviderId, AgentRoleId, AgentRun } from "@/lib/agents/types";

type AgentInfo = { id: AgentRoleId; name: string; shortName: string; purpose: string };
type ProviderInfo = { id: AgentProviderId; label: string; model: string; configured: boolean };
type Bootstrap = { agents: AgentInfo[]; providers: ProviderInfo[]; runs: AgentRun[] };
type QueueEntry = { id: string; text: string };

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
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function runStatusClass(status: AgentRun["status"]) {
  if (status === "completed") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (status === "failed") return "border-red-400/30 bg-red-400/10 text-red-200";
  return "border-blue-400/30 bg-blue-400/10 text-blue-200";
}

export function AgentCommandPage() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [provider, setProvider] = useState<AgentProviderId>("chatgpt");
  const [selectedAgents, setSelectedAgents] = useState<AgentRoleId[]>(["strategist", "researcher", "producer", "operator"]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const queueRef = useRef<QueueEntry[]>([]);

  const load = useCallback(async () => {
    const response = await fetch("/api/agents", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load Sourceflow Agents.");
    const data = (await response.json()) as Bootstrap;
    setBootstrap(data);
    setActiveRun((current) => current ?? data.runs[0] ?? null);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load().catch(() => toast.error("Could not load Sourceflow Agents.")));
    return () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, [load]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const providers = bootstrap?.providers ?? [];
  const agents = bootstrap?.agents ?? [];
  const currentProvider = providers.find((item) => item.id === provider);

  const speak = useCallback(
    (text: string) => {
      if (!speakReplies || typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const plain = text.replace(/[#*_`>\[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 2400);
      if (!plain) return;
      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.rate = 1.03;
      window.speechSynthesis.speak(utterance);
    },
    [speakReplies]
  );

  async function execute(text: string) {
    setRunning(true);
    setPrompt("");
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text, provider, agentIds: selectedAgents })
      });
      const json = (await response.json()) as { run?: AgentRun; error?: string };
      if (!json.run) throw new Error(json.error ?? "The agent team could not start.");
      setActiveRun(json.run);
      setBootstrap((current) =>
        current ? { ...current, runs: [json.run!, ...current.runs.filter((run) => run.id !== json.run!.id)] } : current
      );
      if (json.run.status === "failed") toast.error(json.run.error ?? "The agent run failed.");
      else {
        toast.success("The agent team finished.");
        speak(json.run.answer);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The agent run failed.");
    } finally {
      setRunning(false);
      const next = queueRef.current[0];
      if (next) {
        setQueue((items) => items.filter((item) => item.id !== next.id));
        queueMicrotask(() => void execute(next.text));
      }
    }
  }

  const submit = () => {
    const text = prompt.trim();
    if (!text) return;
    if (!currentProvider?.configured) {
      toast.error(`${currentProvider?.label ?? provider} needs its API key in .env.`);
      return;
    }
    if (running) {
      setQueue((items) => [...items, { id: crypto.randomUUID(), text }]);
      setPrompt("");
      toast.success("Prompt queued.");
      return;
    }
    void execute(text);
  };

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      toast.error("Voice input is not supported by this browser. You can still type your command.");
      return;
    }
    window.speechSynthesis?.cancel();
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-CA";
    let stable = prompt.trim();
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) stable = `${stable} ${result[0].transcript}`.trim();
        else interim += result[0].transcript;
      }
      setPrompt(`${stable}${interim ? ` ${interim}` : ""}`.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      toast.error("Voice input stopped. Your transcript is still editable.");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const reviewAction = async (action: AgentAction, decision: "approve" | "reject") => {
    if (!activeRun) return;
    const response = await fetch(`/api/agents/${activeRun.id}/actions/${action.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision })
    });
    const json = (await response.json()) as { run?: AgentRun; error?: string };
    if (!response.ok || !json.run) {
      toast.error(json.error ?? "Could not review that action.");
      return;
    }
    setActiveRun(json.run);
    setBootstrap((current) =>
      current ? { ...current, runs: current.runs.map((run) => (run.id === json.run!.id ? json.run! : run)) } : current
    );
    toast.success(decision === "approve" ? "Approved action completed." : "Action rejected.");
  };

  const elapsed = useMemo(() => {
    if (!activeRun) return "";
    const seconds = Math.max(0, Math.round((new Date(activeRun.updatedAt).getTime() - new Date(activeRun.createdAt).getTime()) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }, [activeRun]);

  return (
    <div>
      <PageHeader
        eyebrow="Agentic command centre"
        title="Sourceflow Agents"
        description="Give a goal to a coordinated team, watch each specialist work, and approve any change before it reaches your pipeline. Use the mic for an editable voice command and choose ChatGPT or Grok as the team brain."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setSpeakReplies((value) => !value)} title="Toggle spoken replies">
              {speakReplies ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
              Spoken reply
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="space-y-4">
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="font-semibold text-white">Brain</h2>
            </div>
            <div className="space-y-2">
              {providers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setProvider(item.id)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition",
                    provider === item.id
                      ? "border-[var(--accent)] bg-[var(--accent)]/10"
                      : "border-[var(--border)] bg-white/[0.03] hover:border-[var(--border-strong)]"
                  )}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium text-white">
                    {item.label}
                    <span className={cn("h-2 w-2 rounded-full", item.configured ? "bg-emerald-400" : "bg-amber-400")} />
                  </span>
                  <span className="mt-1 block truncate text-xs text-[var(--muted-foreground)]">{item.model}</span>
                </button>
              ))}
            </div>
            {!currentProvider?.configured ? (
              <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-2.5 text-xs text-amber-100">
                Add {provider === "grok" ? "XAI_API_KEY" : "OPENAI_API_KEY"} to the local .env file. Keys never enter the browser.
              </p>
            ) : null}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-white">Agent team</h2>
              <Badge>{selectedAgents.length} active</Badge>
            </div>
            <div className="space-y-2">
              {agents.map((agent) => {
                const selected = selectedAgents.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() =>
                      setSelectedAgents((current) =>
                        selected ? (current.length === 1 ? current : current.filter((id) => id !== agent.id)) : [...current, agent.id]
                      )
                    }
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition",
                      selected ? "border-[var(--accent)]/60 bg-[var(--accent)]/8" : "border-[var(--border)] opacity-60"
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-white">
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded", selected ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-white/5")}>
                        {selected ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      {agent.shortName}
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-[var(--muted-foreground)]">{agent.purpose}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        </aside>

        <main className="min-w-0 space-y-4">
          <Card className={cn("relative overflow-hidden", running && "border-[var(--accent)]/50")}>
            {running ? <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-[var(--accent)]" /> : null}
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="font-semibold text-white">Command the team</h2>
              </div>
              {running ? (
                <span className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Agents are working
                </span>
              ) : null}
            </div>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Example: Review my current pipeline and build a focused plan for next week's strongest YouTube video, clips, and supporting posts."
              className="min-h-36 resize-y pr-12"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <ShieldCheck className="h-4 w-4 text-emerald-300" /> Changes wait for your approval
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={listening ? "danger" : "secondary"}
                  onClick={toggleListening}
                  title="Voice is transcribed by your browser and remains editable before sending"
                >
                  {listening ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                  {listening ? "Stop listening" : "Voice"}
                </Button>
                <Button onClick={submit} disabled={!prompt.trim()}>
                  {running ? <Clock3 className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
                  {running ? "Queue" : "Send"}
                </Button>
              </div>
            </div>
          </Card>

          {queue.length > 0 ? (
            <Card className="p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Queued prompts</span>
                <button className="text-xs text-[var(--muted-foreground)] hover:text-white" onClick={() => setQueue([])}>Clear</button>
              </div>
              <div className="space-y-1.5">
                {queue.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
                    <Badge>{index + 1}</Badge>
                    <span className="min-w-0 flex-1 truncate text-white">{item.text}</span>
                    <button onClick={() => setQueue((items) => items.filter((entry) => entry.id !== item.id))} aria-label="Remove queued prompt">
                      <X className="h-4 w-4 text-[var(--muted-foreground)] hover:text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {activeRun ? (
            <Card>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={runStatusClass(activeRun.status)}>{activeRun.status}</Badge>
                    <Badge>{activeRun.provider === "grok" ? "Grok" : "ChatGPT"}</Badge>
                    <Badge>{activeRun.model}</Badge>
                    {elapsed ? <span className="text-xs text-[var(--muted-foreground)]">{elapsed}</span> : null}
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-white">{activeRun.goal}</h2>
                </div>
              </div>
              {activeRun.error ? <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{activeRun.error}</div> : null}
              {activeRun.answer ? <div className="whitespace-pre-wrap text-sm leading-7 text-white/90">{activeRun.answer}</div> : null}
            </Card>
          ) : (
            <Card className="flex min-h-56 flex-col items-center justify-center text-center">
              <Bot className="mb-3 h-9 w-9 text-[var(--accent)]" />
              <h2 className="font-semibold text-white">Your first agent run will appear here</h2>
              <p className="mt-1 max-w-md text-sm text-[var(--muted-foreground)]">The specialists run in parallel, then the orchestrator reconciles their work into one answer.</p>
            </Card>
          )}
        </main>

        <aside className="space-y-4">
          <Card>
            <h2 className="mb-3 font-semibold text-white">Live workforce</h2>
            {activeRun ? (
              <div className="space-y-2">
                {activeRun.steps.map((step) => (
                  <div key={step.id} className="rounded-lg border border-[var(--border)] bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white">{step.label}</span>
                      {step.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-300" /> : null}
                      {step.status === "completed" ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : null}
                      {step.status === "failed" ? <CircleStop className="h-3.5 w-3.5 text-red-300" /> : null}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{step.summary || step.error || step.status}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-[var(--muted-foreground)]">No team has run yet.</p>}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-white">Approval inbox</h2>
              <Badge>{activeRun?.actions.filter((action) => action.status === "proposed").length ?? 0}</Badge>
            </div>
            {activeRun?.actions.length ? (
              <div className="space-y-3">
                {activeRun.actions.map((action) => (
                  <div key={action.id} className="rounded-lg border border-[var(--border)] bg-white/[0.03] p-3">
                    <div className="flex items-start gap-2">
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{action.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{action.reason}</p>
                        <Badge className="mt-2">{action.type.replaceAll("_", " ")}</Badge>
                      </div>
                    </div>
                    {action.status === "proposed" ? (
                      <div className="mt-3 flex gap-2">
                        <Button className="flex-1 px-3 py-1.5 text-xs" onClick={() => void reviewAction(action, "approve")}>
                          <Play className="mr-1.5 h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => void reviewAction(action, "reject")}>Reject</Button>
                      </div>
                    ) : <p className="mt-3 text-xs text-[var(--muted-foreground)]">{action.result ?? action.status}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">Agent work stays read-only unless a proposed action appears here.</p>
            )}
          </Card>

          {bootstrap?.runs.length ? (
            <Card>
              <h2 className="mb-3 font-semibold text-white">Run history</h2>
              <div className="space-y-1">
                {bootstrap.runs.slice(0, 8).map((run) => (
                  <button key={run.id} onClick={() => setActiveRun(run)} className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.04]">
                    <span className="block truncate text-sm text-white">{run.goal}</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{new Date(run.createdAt).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
