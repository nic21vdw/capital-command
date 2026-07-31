"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  Eye,
  Facebook,
  Film,
  Image as ImageIcon,
  Instagram,
  LayoutDashboard,
  Library,
  MessageSquare,
  Pencil,
  PenSquare,
  Plus,
  Save,
  ThumbsUp,
  Trash2,
  Type,
  UploadCloud,
  X,
  type LucideIcon
} from "lucide-react";
import { toast } from "sonner";
import { makeFbPost, useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { localDateKey } from "@/lib/x-strategy/analytics";
import { cn } from "@/lib/utils";
import type { FbPost, FbPostFormat, FbPlatform, FbThreadComment } from "@/types/domain";

// Benchmark from the playbook: 78.2% of the 1.4B organic views came from
// text-only posts.
const TEXT_VIEW_BENCHMARK = 78.2;

const FORMAT_META: Record<FbPostFormat, { label: string; icon: LucideIcon; chip: string }> = {
  text: { label: "Text-only", icon: Type, chip: "border-sky-400/30 bg-sky-400/10 text-sky-200" },
  imageText: { label: "Image + text", icon: ImageIcon, chip: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  reel: { label: "Reel", icon: Film, chip: "border-violet-400/30 bg-violet-400/10 text-violet-200" }
};

const PLATFORM_META: Record<FbPlatform, { label: string; icon: LucideIcon; chip: string }> = {
  facebook: { label: "Facebook", icon: Facebook, chip: "border-blue-400/30 bg-blue-400/10 text-blue-200" },
  instagram: { label: "Instagram", icon: Instagram, chip: "border-pink-400/30 bg-pink-400/10 text-pink-200" }
};

const FORMATS: FbPostFormat[] = ["text", "imageText", "reel"];
const PLATFORMS: FbPlatform[] = ["facebook", "instagram"];

// Media is persisted inline as a base64 data URL, so keep the caps modest to
// avoid bloating the JSON store: 15MB for an image, 50MB for a reel video.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** The numbered comment thread including the CTA as the final comment. */
function compiledThread(post: Pick<FbPost, "threadComments" | "cta">): string[] {
  const comments = post.threadComments.filter((comment) => comment.text.trim()).map((comment) => comment.text.trim());
  if (post.cta.trim()) comments.push(post.cta.trim());
  return comments.map((text, index) => `${index + 1}/ ${text}`);
}

function fullPostText(post: FbPost): string {
  const thread = compiledThread(post);
  const sections = [`MAIN POST:\n${post.hook}`];
  if (post.body.trim()) {
    const label = post.format === "reel" ? "SCRIPT / CAPTION" : post.format === "imageText" ? "IMAGE TEXT" : "EXTRA";
    sections.push(`${label}:\n${post.body.trim()}`);
  }
  if (thread.length) sections.push(`COMMENT THREAD:\n${thread.join("\n\n")}`);
  return sections.join("\n\n");
}

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
}

function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      toast.error("Clipboard unavailable — select and copy the text manually.");
    }
  }, []);
  return { copiedId, copy };
}

export function FacebookPage() {
  const { data, mutate } = useAppData();
  const posts = useMemo(() => data.fbStrategy?.posts ?? [], [data.fbStrategy]);
  const brief = data.fbStrategy?.brief ?? "";
  const [editing, setEditing] = useState<FbPost | null>(null);

  const savePost = useCallback(
    async (post: FbPost, message: string) => {
      await mutate("upsertFbPost", post, { successMessage: message });
    },
    [mutate]
  );

  return (
    <div>
      <PageHeader
        eyebrow="Step 2 · Formats"
        title="Thread Content Engine"
        description="The Professional-Mode playbook behind 1.4B organic views: text-only hooks (78.2% of views), image posts, and reels — with the real content continued as a numbered thread in the comments and the CTA as the final comment."
      />

      <Tabs
        tabs={[
          {
            id: "dashboard",
            label: "Dashboard",
            icon: LayoutDashboard,
            content: <DashboardTab posts={posts} />
          },
          {
            id: "composer",
            label: "Thread Composer",
            icon: PenSquare,
            content: <ComposerTab onSave={savePost} />
          },
          {
            id: "library",
            label: "Library",
            icon: Library,
            content: <LibraryTab posts={posts} onEdit={setEditing} savePost={savePost} deletePost={(id) => mutate("deleteFbPost", id, { successMessage: "Post deleted." })} />
          },
          {
            id: "playbook",
            label: "Playbook",
            icon: BookOpen,
            content: <PlaybookTab brief={brief} onSaveBrief={(next) => mutate("updateFbBrief", { brief: next }, { successMessage: "Brief saved." })} />
          }
        ]}
      />

      <Modal
        open={editing !== null}
        title="Edit post"
        description="Changes are saved back to the library."
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <PostForm
              key={editing.id}
              initial={editing}
              submitLabel="Save changes"
              onSubmit={async (post) => {
                await savePost(post, "Post updated.");
                setEditing(null);
              }}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

// ----- Dashboard -----

function DashboardTab({ posts }: { posts: FbPost[] }) {
  const posted = posts.filter((post) => post.status === "posted");
  const totalViews = posts.reduce((sum, post) => sum + (post.views ?? 0), 0);
  const viewsByFormat = FORMATS.map((format) => ({
    format,
    posts: posts.filter((post) => post.format === format).length,
    views: posts.filter((post) => post.format === format).reduce((sum, post) => sum + (post.views ?? 0), 0)
  }));
  const textShare = totalViews > 0 ? ((viewsByFormat[0]?.views ?? 0) / totalViews) * 100 : null;
  const recent = [...posts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Posts in library" value={String(posts.length)} detail={`${posted.length} posted · ${posts.length - posted.length} drafts`} icon={<Library className="h-5 w-5" />} />
        <StatCard label="Total logged views" value={formatViews(totalViews)} detail="Across all posted content" icon={<Eye className="h-5 w-5" />} />
        <StatCard
          label="Text-only view share"
          value={textShare === null ? "—" : `${textShare.toFixed(1)}%`}
          detail={`Benchmark: ${TEXT_VIEW_BENCHMARK}% of the 1.4B-view account`}
          icon={<Type className="h-5 w-5" />}
        />
        <StatCard
          label="Facebook / Instagram"
          value={`${posts.filter((post) => post.platform === "facebook").length} / ${posts.filter((post) => post.platform === "instagram").length}`}
          detail="Posts per platform"
          icon={<Facebook className="h-5 w-5" />}
        />
      </div>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-white">Format mix</h3>
          <Badge>Views logged per format vs. the 78.2% text-only benchmark</Badge>
        </div>
        <div className="space-y-3">
          {viewsByFormat.map(({ format, posts: count, views }) => {
            const meta = FORMAT_META[format];
            const share = totalViews > 0 ? (views / totalViews) * 100 : 0;
            return (
              <div key={format} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", meta.chip)}>{meta.label}</span>
                  <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                    {count} posts · {formatViews(views)} views{totalViews > 0 ? ` · ${share.toFixed(1)}%` : ""}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, share)}%` }} />
                </div>
                {format === "text" ? (
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Target: text-only should carry ~{TEXT_VIEW_BENCHMARK}% of views. If it&apos;s far below, ship more black-background hook posts.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold text-white">Recent posts</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            Nothing yet — build your first hook + comment thread in the Thread Composer tab.
          </p>
        ) : (
          <div className="space-y-2">
            {recent.map((post) => {
              const format = FORMAT_META[post.format];
              const platform = PLATFORM_META[post.platform];
              return (
                <div key={post.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                  <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{post.date}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", platform.chip)}>{platform.label}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", format.chip)}>{format.label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white/90">{post.hook}</span>
                  {post.views !== undefined ? (
                    <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{formatViews(post.views)} views</span>
                  ) : (
                    <Badge className="text-[10px]">{post.status}</Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ----- Composer -----

const EXAMPLE_POST: Partial<FbPost> = {
  hook: "This one single YouTube hack just grew my client's channel by 100,000 subscribers in just 30 days. 👇\n\n(See the breakdown in the comments!)",
  threadComments: [
    { id: "example-1", text: "Step one: Stop ignoring YouTube Search. While everyone else is chasing trends, search is currently wide open. Use tools like VidIQ or TubeBuddy to find high-volume, low-competition keywords in your niche." },
    { id: "example-2", text: "Step two: Use AI to create a data-backed outline. Feed your keyword into an LLM and have it structure a script designed specifically for high retention and viewer satisfaction." },
    { id: "example-3", text: "Step three: The Thumbnail/Title A/B test. Never settle for one version. Use AI to generate 3 unique thumbnail variations and rotate them to see which one actually drives the CTR." },
    { id: "example-4", text: "Step four: Consistent, recurring series. Stop making random one-off videos. Create a branded series (e.g., 'Secrets You Should Know') that builds a pattern your audience expects and returns to." }
  ],
  cta: "Profit. If you want to see the exact systems we use to scale, check out my full playbook here: [Your Link/Call to Action]"
};

function ComposerTab({ onSave }: { onSave: (post: FbPost, message: string) => Promise<void> }) {
  const [formKey, setFormKey] = useState(0);
  const [seed, setSeed] = useState<Partial<FbPost> | undefined>(undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted-foreground)]">
          Hook in the main post, content in the comments. Facebook sorts comments by relevance — an engaged thread keeps the whole post resurfacing.
        </p>
        <Button
          variant="ghost"
          className="px-3 py-1.5 text-xs"
          onClick={() => {
            setSeed(EXAMPLE_POST);
            setFormKey((key) => key + 1);
          }}
        >
          Load example thread
        </Button>
      </div>
      <PostForm
        key={formKey}
        initial={seed ? makeFbPost(seed) : undefined}
        submitLabel="Save to library"
        onSubmit={async (post) => {
          await onSave(post, "Saved to library as a draft.");
          setSeed(undefined);
          setFormKey((key) => key + 1);
        }}
      />
    </div>
  );
}

function PostForm({
  initial,
  submitLabel,
  onSubmit
}: {
  initial?: FbPost;
  submitLabel: string;
  onSubmit: (post: FbPost) => Promise<void>;
}) {
  const [platform, setPlatform] = useState<FbPlatform>(initial?.platform ?? "facebook");
  const [format, setFormat] = useState<FbPostFormat>(initial?.format ?? "text");
  const [date, setDate] = useState(initial?.date ?? localDateKey());
  const [hook, setHook] = useState(initial?.hook ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [media, setMedia] = useState<{ url: string; name: string; kind: "image" | "video" } | null>(
    initial?.mediaUrl ? { url: initial.mediaUrl, name: initial.mediaName ?? "media", kind: initial.format === "reel" ? "video" : "image" } : null
  );
  const [comments, setComments] = useState<FbThreadComment[]>(
    initial?.threadComments.length ? initial.threadComments : [{ id: `fbc-${crypto.randomUUID()}`, text: "" }]
  );
  const [cta, setCta] = useState(initial?.cta ?? "");
  const [saving, setSaving] = useState(false);

  const bodyLabel = format === "reel" ? "Reel script / caption" : format === "imageText" ? "Image text / caption" : "Extra context (optional)";
  const canSave = hook.trim().length > 0 && !saving;
  const mediaKind: "image" | "video" | null = format === "imageText" ? "image" : format === "reel" ? "video" : null;
  // Keep uploads keyed to their format — an image loaded for "Image + text"
  // shouldn't leak into a Reel post if the format is switched.
  const activeMedia = media && media.kind === mediaKind ? media : null;

  const buildPost = (): FbPost =>
    makeFbPost({
      ...initial,
      platform,
      format,
      date,
      hook: hook.trim(),
      body,
      // Media only belongs to image/reel posts — drop it for text-only.
      mediaUrl: activeMedia?.url,
      mediaName: activeMedia?.name,
      threadComments: comments.filter((comment) => comment.text.trim()),
      cta
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SegmentedControl label="Platform" options={PLATFORMS} value={platform} onChange={setPlatform} meta={PLATFORM_META} />
          <SegmentedControl label="Format" options={FORMATS} value={format} onChange={setFormat} meta={FORMAT_META} />
        </div>

        <Field label="Target date">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="sm:w-48" />
        </Field>

        <Field
          label="Hook (main post)"
          hint="Clickbait headline promising a concrete outcome. End with 👇 so the eye drops into the comments."
        >
          <Textarea value={hook} onChange={(event) => setHook(event.target.value)} placeholder="This one single hack just… 👇" />
          {!hook.includes("👇") && hook.trim() ? (
            <button
              type="button"
              onClick={() => setHook((current) => `${current.trimEnd()} 👇`)}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              + append 👇
            </button>
          ) : null}
        </Field>

        {mediaKind ? (
          <Field
            label={mediaKind === "image" ? "Image" : "Reel video"}
            hint={
              mediaKind === "image"
                ? "Drag & drop an image or click to browse — PNG, JPEG, GIF, or WebP · up to 15MB."
                : "Drag & drop a video or click to browse — MP4, MOV, or WebM · up to 50MB."
            }
          >
            <MediaDropzone kind={mediaKind} media={activeMedia} onChange={setMedia} />
          </Field>
        ) : null}

        {format !== "text" || body ? (
          <Field label={bodyLabel}>
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={format === "reel" ? "Hook line, beats, on-screen text…" : "The text that goes on the image…"} />
          </Field>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Comment thread {platform === "instagram" ? "(caption + pinned comments on IG)" : ""}
            </p>
            <Button
              variant="secondary"
              className="px-2.5 py-1 text-xs"
              onClick={() => setComments((current) => [...current, { id: `fbc-${crypto.randomUUID()}`, text: "" }])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add step
            </Button>
          </div>
          {comments.map((comment, index) => (
            <div key={comment.id} className="flex gap-2">
              <span className="mt-3 w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--accent)]">{index + 1}/</span>
              <Textarea
                value={comment.text}
                onChange={(event) =>
                  setComments((current) => current.map((item) => (item.id === comment.id ? { ...item, text: event.target.value } : item)))
                }
                placeholder={`Step ${index + 1} — one self-contained insight`}
                className="min-h-20"
              />
              <button
                type="button"
                aria-label={`Remove step ${index + 1}`}
                onClick={() => setComments((current) => current.filter((item) => item.id !== comment.id))}
                className="mt-3 shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/15 hover:text-red-200"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <Field
          label={`Call to action (final comment · ${comments.filter((comment) => comment.text.trim()).length + 1}/)`}
          hint="The back-end system: every post drives subscribers, affiliate sales, or product traffic. Links live here, never in the hook."
        >
          <Textarea value={cta} onChange={(event) => setCta(event.target.value)} placeholder="If you want the exact system, grab it here: [link]" className="min-h-20" />
        </Field>

        <div className="flex justify-end">
          <Button
            disabled={!canSave}
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit(buildPost());
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : submitLabel}
          </Button>
        </div>
      </Card>

      <PostPreview
        platform={platform}
        format={format}
        hook={hook}
        body={body}
        media={activeMedia}
        thread={compiledThread({ threadComments: comments, cta })}
      />
    </div>
  );
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  meta
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (next: T) => void;
  meta: Record<T, { label: string; icon: LucideIcon }>;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5">
        {options.map((option) => {
          const Icon = meta[option].icon;
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition",
                active ? "bg-white/10 font-medium text-white" : "text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {meta[option].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MediaDropzone({
  kind,
  media,
  onChange
}: {
  kind: "image" | "video";
  media: { url: string; name: string; kind: "image" | "video" } | null;
  onChange: (next: { url: string; name: string; kind: "image" | "video" } | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      const expectedPrefix = kind === "image" ? "image/" : "video/";
      if (!file.type.startsWith(expectedPrefix)) {
        toast.error(`That file isn't ${kind === "image" ? "an image" : "a video"}. Pick a ${kind} file.`);
        return;
      }
      const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
      if (file.size > maxBytes) {
        toast.error(`${kind === "image" ? "Image" : "Video"} is too large — keep it under ${Math.round(maxBytes / (1024 * 1024))}MB.`);
        return;
      }
      try {
        const url = await readFileAsDataUrl(file);
        onChange({ url, name: file.name, kind });
      } catch {
        toast.error("Could not read that file — try another one.");
      }
    },
    [kind, onChange]
  );

  const accept = kind === "image" ? "image/*" : "video/*";

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />

      {media ? (
        <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.url} alt={media.name} className="max-h-56 w-full rounded-xl object-contain" />
          ) : (
            <video src={media.url} controls className="max-h-56 w-full rounded-xl bg-black" />
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">{media.name}</p>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => inputRef.current?.click()}>
                Replace
              </Button>
              <button
                type="button"
                aria-label="Remove media"
                onClick={() => onChange(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-red-500/20 hover:text-red-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-8 text-center transition",
            dragging ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-white/12 bg-white/3 hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/4"
          )}
        >
          {kind === "image" ? <ImageIcon className="h-6 w-6 text-[var(--accent)]" /> : <Film className="h-6 w-6 text-[var(--accent)]" />}
          <p className="text-sm font-medium text-white">
            Drop {kind === "image" ? "an image" : "a video"} here
          </p>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              inputRef.current?.click();
            }}
          >
            <UploadCloud className="mr-1.5 h-3.5 w-3.5" /> Upload {kind === "image" ? "image" : "video"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      {children}
      {hint ? <p className="text-[11px] text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

function PostPreview({
  platform,
  format,
  hook,
  body,
  media,
  thread
}: {
  platform: FbPlatform;
  format: FbPostFormat;
  hook: string;
  body: string;
  media: { url: string; name: string } | null;
  thread: string[];
}) {
  const { copiedId, copy } = useCopy();
  const platformMeta = PLATFORM_META[platform];
  const PlatformIcon = platformMeta.icon;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Live preview</p>
        <span className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", platformMeta.chip)}>
          <PlatformIcon className="h-3 w-3" /> {platformMeta.label}
        </span>
      </div>

      <Card className="space-y-4 p-4">
        {format === "text" ? (
          // The signature look: black background, bold centered white text.
          <div className="flex min-h-44 items-center justify-center rounded-xl bg-black p-6">
            <p className="whitespace-pre-wrap text-center text-lg font-bold leading-snug text-[#fff]">
              {hook || "Your clickbait headline lands here 👇"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{hook || "Your hook lands here 👇"}</p>
            {media ? (
              format === "imageText" ? (
                <div className="relative overflow-hidden rounded-xl bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={media.url} alt={media.name} className="max-h-72 w-full object-contain" />
                  {body ? (
                    <p className="absolute inset-x-0 bottom-0 bg-black/50 p-3 text-center text-base font-semibold text-[#fff]">{body}</p>
                  ) : null}
                </div>
              ) : (
                <video src={media.url} controls className="max-h-72 w-full rounded-xl bg-black" />
              )
            ) : (
              <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-white/15 bg-[var(--surface-2)] p-6 text-center">
                {format === "imageText" ? (
                  <p className="whitespace-pre-wrap text-base font-semibold text-white/80">{body || "Image with the headline text"}</p>
                ) : (
                  <div className="space-y-1 text-[var(--muted-foreground)]">
                    <Film className="mx-auto h-6 w-6" />
                    <p className="whitespace-pre-wrap text-xs">{body || "Reel — script/caption preview"}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-[var(--border)] pt-3">
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <MessageSquare className="h-3.5 w-3.5" />
            {platform === "instagram" ? "Caption thread + pinned comment" : "Comment thread (sorted by relevance, not time)"}
          </div>
          {thread.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">Add thread steps and a CTA to see the comment section.</p>
          ) : (
            thread.map((text, index) => {
              const isCta = index === thread.length - 1;
              return (
                <div key={index} className="flex items-start gap-2">
                  <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/8 text-[10px] font-semibold text-white">
                    You
                  </span>
                  <div
                    className={cn(
                      "min-w-0 flex-1 rounded-2xl px-3 py-2 text-sm leading-relaxed",
                      isCta ? "border border-[var(--accent)]/40 bg-[var(--accent)]/10 text-white" : "bg-white/6 text-white/90"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{text}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Copy comment ${index + 1}`}
                    onClick={() => copy(`preview-${index}`, text)}
                    className="mt-2 shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-white/8 hover:text-white"
                  >
                    {copiedId === `preview-${index}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => copy("preview-hook", hook)} disabled={!hook.trim()}>
            {copiedId === "preview-hook" ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            Copy hook
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() =>
              copy(
                "preview-all",
                [
                  `MAIN POST:\n${hook.trim()}`,
                  body.trim() ? `${format === "reel" ? "SCRIPT / CAPTION" : format === "imageText" ? "IMAGE TEXT" : "EXTRA"}:\n${body.trim()}` : null,
                  thread.length ? `COMMENT THREAD:\n${thread.join("\n\n")}` : null
                ]
                  .filter(Boolean)
                  .join("\n\n")
              )
            }
            disabled={!hook.trim()}
          >
            {copiedId === "preview-all" ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            Copy everything
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ----- Library -----

function LibraryTab({
  posts,
  onEdit,
  savePost,
  deletePost
}: {
  posts: FbPost[];
  onEdit: (post: FbPost) => void;
  savePost: (post: FbPost, message: string) => Promise<void>;
  deletePost: (id: string) => void;
}) {
  const [platformFilter, setPlatformFilter] = useState<"all" | FbPlatform>("all");
  const [formatFilter, setFormatFilter] = useState<"all" | FbPostFormat>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | FbPost["status"]>("all");

  const filtered = posts.filter(
    (post) =>
      (platformFilter === "all" || post.platform === platformFilter) &&
      (formatFilter === "all" || post.format === formatFilter) &&
      (statusFilter === "all" || post.status === statusFilter)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as typeof platformFilter)} className="w-40">
          <option value="all">All platforms</option>
          {PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {PLATFORM_META[platform].label}
            </option>
          ))}
        </Select>
        <Select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as typeof formatFilter)} className="w-40">
          <option value="all">All formats</option>
          {FORMATS.map((format) => (
            <option key={format} value={format}>
              {FORMAT_META[format].label}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="w-36">
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
            {posts.length === 0 ? "No posts yet — build one in the Thread Composer." : "Nothing matches these filters."}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((post) => (
            <LibraryCard key={post.id} post={post} onEdit={onEdit} savePost={savePost} deletePost={deletePost} />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryCard({
  post,
  onEdit,
  savePost,
  deletePost
}: {
  post: FbPost;
  onEdit: (post: FbPost) => void;
  savePost: (post: FbPost, message: string) => Promise<void>;
  deletePost: (id: string) => void;
}) {
  const { copiedId, copy } = useCopy();
  const [expanded, setExpanded] = useState(false);
  const [logging, setLogging] = useState(false);
  const [metrics, setMetrics] = useState({
    views: post.views?.toString() ?? "",
    reactions: post.reactions?.toString() ?? "",
    comments: post.comments?.toString() ?? "",
    shares: post.shares?.toString() ?? ""
  });
  const format = FORMAT_META[post.format];
  const platform = PLATFORM_META[post.platform];
  const thread = compiledThread(post);

  const parseMetric = (value: string) => {
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? undefined : Math.max(0, Math.round(parsed));
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", platform.chip)}>{platform.label}</span>
        <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", format.chip)}>{format.label}</span>
        <Badge className={post.status === "posted" ? "text-emerald-200" : undefined}>{post.status}</Badge>
        <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{post.date}</span>
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">
          {thread.length} comment{thread.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-white">{post.hook}</p>

      {expanded ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          {post.mediaUrl ? (
            post.format === "reel" ? (
              <video src={post.mediaUrl} controls className="max-h-64 w-full rounded-lg bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.mediaUrl} alt={post.mediaName ?? "post media"} className="max-h-64 w-full rounded-lg object-contain" />
            )
          ) : null}
          {post.body.trim() ? <p className="whitespace-pre-wrap text-sm text-white/80">{post.body}</p> : null}
          {thread.map((text, index) => (
            <p key={index} className={cn("whitespace-pre-wrap text-sm leading-relaxed", index === thread.length - 1 && post.cta.trim() ? "text-[var(--accent)]" : "text-white/80")}>
              {text}
            </p>
          ))}
          {thread.length === 0 && !post.body.trim() ? <p className="text-xs text-[var(--muted-foreground)]">No thread yet.</p> : null}
        </div>
      ) : null}

      {(["views", "reactions", "comments", "shares"] as const).some((key) => post[key] !== undefined) ? (
        <div className="flex flex-wrap gap-3 text-xs text-[var(--muted-foreground)]">
          {post.views !== undefined ? (
            <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {formatViews(post.views)}</span>
          ) : null}
          {post.reactions !== undefined ? (
            <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" /> {formatViews(post.reactions)}</span>
          ) : null}
          {post.comments !== undefined ? (
            <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {formatViews(post.comments)}</span>
          ) : null}
          {post.shares !== undefined ? <span>↗ {formatViews(post.shares)} shares</span> : null}
        </div>
      ) : null}

      {logging ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          {(["views", "reactions", "comments", "shares"] as const).map((key) => (
            <label key={key} className="space-y-1 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
              {key}
              <Input
                type="number"
                min={0}
                value={metrics[key]}
                onChange={(event) => setMetrics((current) => ({ ...current, [key]: event.target.value }))}
                className="h-9 w-24"
              />
            </label>
          ))}
          <Button
            className="px-3 py-1.5 text-xs"
            onClick={async () => {
              await savePost(
                {
                  ...post,
                  status: "posted",
                  views: parseMetric(metrics.views),
                  reactions: parseMetric(metrics.reactions),
                  comments: parseMetric(metrics.comments),
                  shares: parseMetric(metrics.shares),
                  updatedAt: new Date().toISOString()
                },
                "Results logged."
              );
              setLogging(false);
            }}
          >
            Save results
          </Button>
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setLogging(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Hide thread" : "Show thread"}
        </Button>
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => copy(post.id, fullPostText(post))}>
          {copiedId === post.id ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
          Copy all
        </Button>
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onEdit(post)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
        {post.status === "draft" ? (
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => savePost({ ...post, status: "posted", updatedAt: new Date().toISOString() }, "Marked as posted.")}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" /> Mark posted
          </Button>
        ) : null}
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setLogging((current) => !current)}>
          <Eye className="mr-1.5 h-3.5 w-3.5" /> Log results
        </Button>
        <Button variant="danger" className="ml-auto px-3 py-1.5 text-xs" onClick={() => deletePost(post.id)}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
        </Button>
      </div>
    </Card>
  );
}

// ----- Playbook -----

const PLAYBOOK: Array<{ title: string; body: string }> = [
  {
    title: "Professional Mode, not a page",
    body: "The whole system runs on a personal profile switched to Professional Mode — it unlocks analytics and reach while keeping the trust and distribution of a personal account."
  },
  {
    title: "Three formats, one hierarchy",
    body: "Text-only posts drove 78.2% of 1.4B organic views; image-with-text and reels carry the rest. Default to the black-background text hook and use the other formats as variety, not the base."
  },
  {
    title: "The text-post recipe",
    body: "Black background, white text, a clickbait headline that promises a concrete outcome, and a down-pointing emoji (👇). The main post is only the hook — never the content."
  },
  {
    title: "Thread in the comments",
    body: "The actual content continues in the comment section as a numbered thread (1/, 2/, 3/…). Facebook sorts comments by relevance, not chronology, so engagement on any step keeps pulling the whole post back up."
  },
  {
    title: "Every post has a back end",
    body: "No post exists just for reach. Each one drives a business system — email subscribers, affiliate sales, or product traffic — and the call to action goes in the comments as the final numbered step, never in the hook."
  },
  {
    title: "Instagram runs the same play",
    body: "Cross-post reels as-is. For text hooks, put the headline on a simple graphic, run the thread in the caption or as a pinned comment, and keep the CTA comment pattern identical."
  }
];

function PlaybookTab({ brief, onSaveBrief }: { brief: string; onSaveBrief: (next: string) => Promise<void> }) {
  const [draft, setDraft] = useState(brief);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {PLAYBOOK.map((item) => (
          <Card key={item.title} className="space-y-1.5">
            <h4 className="text-sm font-semibold text-white">{item.title}</h4>
            <p className="text-sm text-[var(--muted-foreground)]">{item.body}</p>
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-white">Content brief</h3>
          <Button
            className="px-3 py-1.5 text-xs"
            disabled={saving || draft === brief}
            onClick={async () => {
              setSaving(true);
              try {
                await onSaveBrief(draft);
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" /> {saving ? "Saving…" : "Save brief"}
          </Button>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          Your positioning, voice, and hook rules for Facebook/Instagram — edit it here and use it as the source of truth when drafting threads.
        </p>
        <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-72 font-mono text-xs" />
      </Card>
    </div>
  );
}
