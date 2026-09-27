"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { StoryPayload } from "@/app/api/story/[id]/route";
import type { StoryStatus } from "@/lib/story/store";
import type { EdlSegment, Unit } from "@/lib/story/types";

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fileUrl(id: string, relative: string, bust?: string) {
  return `/api/story/${id}/file?path=${encodeURIComponent(relative)}${bust ? `&v=${encodeURIComponent(bust)}` : ""}`;
}

const SECTION_COLORS: Record<string, string> = {
  hook: "bg-amber-400/20 text-amber-200",
  setup: "bg-sky-400/15 text-sky-200",
  development: "bg-violet-400/15 text-violet-200",
  payoff: "bg-emerald-400/15 text-emerald-200",
  close: "bg-rose-400/15 text-rose-200"
};

function Score({ label, value }: { label: string; value: number }) {
  return (
    <span className="whitespace-nowrap text-[11px] text-[var(--muted-foreground)]">
      {label} <span className="font-mono text-white">{value.toFixed(2)}</span>
    </span>
  );
}

export function StoryEditorPage() {
  const [projects, setProjects] = useState<StoryStatus[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [data, setData] = useState<StoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch("/api/story")
      .then((response) => response.json())
      .then((body: { projects: StoryStatus[] }) => {
        setProjects(body.projects);
        setOpenId((current) => current ?? body.projects[0]?.id ?? null);
      })
      .catch(() => setError("Could not list story edits."));
  }, []);

  const load = useCallback(async (id: string) => {
    const response = await fetch(`/api/story/${id}`);
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Could not load the project.");
    else {
      setError(null);
      setData(body);
    }
  }, []);

  useEffect(() => {
    if (!openId) return;
    let live = true;
    fetch(`/api/story/${openId}`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (ok) setData(body);
        else setError(body.error ?? "Could not load the project.");
      })
      .catch(() => live && setError("Could not load the project."));
    return () => {
      live = false;
    };
  }, [openId]);

  const busy = data?.status.busy ?? false;
  useEffect(() => {
    if (!busy || !openId) return;
    const timer = setInterval(() => void load(openId), 4000);
    return () => clearInterval(timer);
  }, [busy, openId, load]);

  const units = useMemo(() => new Map((data?.units ?? []).map((unit) => [unit.id, unit])), [data]);
  const disabled = useMemo(() => new Set(data?.overrides.disabledUnitIds ?? []), [data]);

  async function patch(body: Record<string, unknown>) {
    if (!openId) return;
    setSaving(true);
    const response = await fetch(`/api/story/${openId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const next = await response.json();
    setSaving(false);
    if (!response.ok) setError(next.error ?? "Could not save.");
    else setData(next);
  }

  async function run(action: "rerender" | "repackage" | "upload") {
    if (!openId) return;
    const response = await fetch(`/api/story/${openId}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!response.ok) setError((await response.json()).error ?? "Could not start.");
    await load(openId);
  }

  function toggleUnit(unitId: string) {
    const next = new Set(disabled);
    if (next.has(unitId)) next.delete(unitId);
    else next.add(unitId);
    void patch({ disabledUnitIds: [...next] });
  }

  function seek(seconds: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      void videoRef.current.play().catch(() => undefined);
    }
  }

  const retakeGroups = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    for (const unit of data?.units ?? []) if (unit.retakeGroup) groups.set(unit.retakeGroup, [...(groups.get(unit.retakeGroup) ?? []), unit]);
    return [...groups.entries()].filter(([, members]) => members.length > 1);
  }, [data]);

  const segments: EdlSegment[] = data?.edl?.segments ?? [];
  const youtube = data?.youtube as { videoId?: string; studioLink?: string; privacyStatus?: string; title?: string; description?: string } | null;
  const bust = data?.rendered?.renderedAt;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Editor"
        title="Story edit"
        description="A long stream cut into an 8-12 minute story: hook, setup, development, payoff, close. Every cut, zoom and reason is below; override any of them and re-render."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/editor" className="text-sm text-[var(--muted-foreground)] hover:text-white">
              Clip editor
            </Link>
            <select
              className="rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-sm text-white"
              value={openId ?? ""}
              onChange={(event) => setOpenId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title.slice(0, 70)}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {error && <Card className="border-red-500/40 p-4 text-sm text-red-200">{error}</Card>}
      {!data && !error && <Card className="p-6 text-sm text-[var(--muted-foreground)]">{projects.length ? "Loading..." : "No story edits yet. Run npm run story:edit -- --url <stream link>."}</Card>}

      {data && (
        <>
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <span className="text-sm text-white">
              {busy ? `Working: ${data.status.stage}` : data.status.stage === "error" ? `Failed: ${data.status.error}` : "Ready"}
            </span>
            <span className="text-xs text-[var(--muted-foreground)]">{data.status.log.at(-1)?.message}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || saving} onClick={() => void run("repackage")}>
                Rewrite titles + description
              </Button>
              <Button variant="secondary" disabled={busy || saving} onClick={() => void run("rerender")}>
                Re-render
              </Button>
              <Button disabled={busy || saving || !data.rendered} onClick={() => void run("upload")}>
                {youtube?.videoId ? "Re-upload (private)" : "Upload to YouTube (private)"}
              </Button>
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card className="space-y-3 p-4">
              {data.rendered ? (
                <video ref={videoRef} controls className="aspect-video w-full rounded-lg bg-black" src={fileUrl(data.status.id, "package/final.mp4", bust)} />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-lg bg-black/40 text-sm text-[var(--muted-foreground)]">Not rendered yet</div>
              )}
              <div className="flex flex-wrap gap-2">
                {(data.chapters ?? []).map((chapter) => (
                  <button
                    key={chapter.seconds}
                    onClick={() => seek(chapter.seconds)}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-white hover:bg-white/10"
                  >
                    <span className="font-mono text-[var(--muted-foreground)]">{clock(chapter.seconds)}</span> {chapter.title}
                  </button>
                ))}
              </div>
              {data.edl && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Runtime {clock(data.edl.runtimeSec)} from {clock(data.status.durationSec)} of stream - {segments.filter((s) => s.enabled).length} segments
                  {data.plan?.shortfall ? ` - ${data.plan.shortfall}` : ""}
                </p>
              )}
            </Card>

            <Card className="space-y-4 p-4">
              <h2 className="text-sm font-semibold text-white">Hook</h2>
              <p className="text-sm text-white">&ldquo;{data.plan?.hookUnitIds.map((id) => units.get(id)?.text).join(" ")}&rdquo;</p>
              <p className="text-xs text-[var(--muted-foreground)]">{data.plan?.hookReason}</p>
              <label className="block text-xs text-[var(--muted-foreground)]">
                Swap the hook for another line
                <select
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-black/30 px-2 py-2 text-xs text-white"
                  value=""
                  disabled={busy || saving}
                  onChange={(event) => event.target.value && void patch({ hookUnitIds: [event.target.value] })}
                >
                  <option value="">Pick one of the strongest lines...</option>
                  {data.hookCandidates.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {clock(unit.start)} ({unit.scores.combined.toFixed(2)}) {unit.text.slice(0, 90)}
                    </option>
                  ))}
                </select>
              </label>
              {data.overrides.hookUnitIds?.length ? (
                <Button variant="ghost" onClick={() => void patch({ hookUnitIds: [] })}>
                  Back to the chosen hook
                </Button>
              ) : null}

              <h2 className="pt-2 text-sm font-semibold text-white">Story outline</h2>
              <ol className="space-y-2">
                {data.plan?.sections.map((section, index) => (
                  <li key={index} className="text-xs">
                    <span className={`mr-2 rounded px-1.5 py-0.5 ${SECTION_COLORS[section.role]}`}>{section.role}</span>
                    <span className="text-white">{section.title}</span>
                    <p className="mt-0.5 text-[var(--muted-foreground)]">{section.reason}</p>
                  </li>
                ))}
              </ol>
              {data.plan?.openLoops.length ? (
                <>
                  <h3 className="text-xs font-semibold text-white">Open loops</h3>
                  <ul className="space-y-1 text-xs text-[var(--muted-foreground)]">
                    {data.plan.openLoops.map((loop, index) => (
                      <li key={index}>{loop.question}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          </div>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-white">Every cut</h2>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[var(--card)] text-[var(--muted-foreground)]">
                  <tr>
                    <th className="p-2">Keep</th>
                    <th className="p-2">At</th>
                    <th className="p-2">Section</th>
                    <th className="p-2">Cut</th>
                    <th className="p-2">Zoom</th>
                    <th className="p-2">Source</th>
                    <th className="p-2">Scores</th>
                    <th className="p-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((segment) => {
                    const off = disabled.has(segment.unitId);
                    return (
                      <tr key={segment.id} className={`border-t border-[var(--border)] ${off ? "opacity-40" : ""}`}>
                        <td className="p-2">
                          <input type="checkbox" checked={!off} disabled={busy || saving} onChange={() => toggleUnit(segment.unitId)} />
                        </td>
                        <td className="p-2 font-mono">
                          <button className="hover:text-white" onClick={() => seek(segment.timelineIn)}>
                            {clock(segment.timelineIn)}
                          </button>
                        </td>
                        <td className="p-2">
                          <span className={`rounded px-1.5 py-0.5 ${SECTION_COLORS[segment.section]}`}>{segment.section}</span>
                        </td>
                        <td className="p-2">{segment.transition}</td>
                        <td className="p-2">
                          {segment.zoomTo !== segment.zoom ? (
                            <span>
                              push {Math.round(segment.zoom * 100)}-{Math.round(segment.zoomTo * 100)}%
                            </span>
                          ) : (
                            <input
                              type="number"
                              min={1}
                              max={1.2}
                              step={0.02}
                              defaultValue={segment.zoom}
                              disabled={busy || saving}
                              onBlur={(event) => {
                                const value = Number(event.target.value);
                                if (Number.isFinite(value) && Math.abs(value - segment.zoom) > 0.001) void patch({ zoom: { [segment.id]: value } });
                              }}
                              className="w-16 rounded border border-[var(--border)] bg-black/30 px-1 py-0.5 text-white"
                            />
                          )}
                        </td>
                        <td className="p-2 font-mono text-[var(--muted-foreground)]">
                          {clock(segment.in)}-{clock(segment.out)}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-col">
                            <Score label="audio" value={segment.audioScore} />
                            <Score label="visual" value={segment.visualScore} />
                            <Score label="story" value={segment.scores.story} />
                          </div>
                        </td>
                        <td className="p-2 text-[var(--muted-foreground)]">{segment.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {retakeGroups.length > 0 && (
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold text-white">Takes</h2>
              {retakeGroups.map(([group, members]) => (
                <div key={group} className="space-y-1">
                  {members.map((unit) => (
                    <label key={unit.id} className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
                      <input
                        type="radio"
                        name={group}
                        checked={!unit.retakeOf}
                        disabled={busy || saving}
                        onChange={() => void patch({ takeChoices: { [group]: unit.id } })}
                      />
                      <span>
                        <span className="font-mono">{clock(unit.start)}</span> ({unit.scores.combined.toFixed(2)}) {unit.text}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </Card>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold text-white">Titles</h2>
              <ol className="space-y-1 text-sm">
                {data.copy?.titles.map((option, index) => (
                  <li key={index} className={index === data.copy?.recommended ? "text-emerald-200" : "text-white"}>
                    {option.title} <span className="text-xs text-[var(--muted-foreground)]">({option.style}, {option.title.length})</span>
                    {index === data.copy?.recommended ? <span className="ml-2 text-xs">recommended - {data.copy.recommendedReason}</span> : null}
                  </li>
                ))}
              </ol>
              <h2 className="pt-2 text-sm font-semibold text-white">YouTube</h2>
              {youtube?.videoId ? (
                <p className="text-sm text-white">
                  Uploaded as <span className="font-semibold">{youtube.privacyStatus}</span>:{" "}
                  <a className="underline" href={youtube.studioLink} target="_blank" rel="noreferrer">
                    open in YouTube Studio
                  </a>
                </p>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">Not uploaded. Uploads are always private; you publish from Studio.</p>
              )}
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs text-[var(--muted-foreground)]">{youtube?.description}</pre>
            </Card>

            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold text-white">Thumbnails</h2>
              {data.copy?.thumbnails.map((concept, index) => (
                <div key={index} className="text-xs text-[var(--muted-foreground)]">
                  <span className="font-semibold text-white">&ldquo;{concept.overlay}&rdquo;</span> - {concept.emotion}; {concept.frame}; {concept.layout}; {concept.colors}
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(data.frames ?? []).map((frame) => (
                  <a key={frame.file} href={fileUrl(data.status.id, `package/thumbnail-frames/${frame.file}`, bust)} target="_blank" rel="noreferrer" title={frame.reason}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(data.status.id, `package/thumbnail-frames/${frame.file}`, bust)} alt={frame.reason} className="aspect-video w-full rounded object-cover" />
                  </a>
                ))}
              </div>
              {data.verification && (
                <>
                  <h2 className="pt-2 text-sm font-semibold text-white">Checks</h2>
                  <ul className="space-y-0.5 text-xs text-[var(--muted-foreground)]">
                    <li>Fillers removed: {data.verification.fillerRemovalPct}%</li>
                    <li>Caption drift: {data.verification.captionDriftMs} ms</li>
                    <li>
                      Loudness: {data.verification.loudness.integrated} LUFS, peak {data.verification.loudness.truePeak}
                    </li>
                    <li>
                      Chapters land: {data.verification.chapterChecks.filter((check) => check.lands).length}/{data.verification.chapterChecks.length}
                    </li>
                  </ul>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
