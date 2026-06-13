"use client";

import { useMemo, useState } from "react";
import { Eye, Plus, Radio, Settings2, Timer, Users, Youtube } from "lucide-react";
import { makeContentItem, makeCreatorProfile, useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import type { ContentItem, ContentPlatform, ContentStatus, ContentType } from "@/types/domain";

const CONTENT_TYPES: ContentType[] = ["Video", "Short", "Stream", "Podcast"];
const CONTENT_PLATFORMS: ContentPlatform[] = ["YouTube", "Twitch", "TikTok", "Instagram", "Other"];
const CONTENT_STATUSES: ContentStatus[] = ["Idea", "Scripting", "Recording", "Editing", "Scheduled", "Published"];

// YouTube Partner Program monetization thresholds.
const MONETIZATION_SUBSCRIBERS = 1000;
const MONETIZATION_WATCH_HOURS = 4000;

function formatCount(value: number) {
  return new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function isThisMonth(dateString?: string) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function CreatorPage() {
  const { data, mutate } = useAppData();
  const currency = data.settings.currency;
  const profile = data.creatorProfile;
  const items = data.contentItems;

  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [showContentModal, setShowContentModal] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);

  const metrics = useMemo(() => {
    const published = items.filter((item) => item.status === "Published");
    const publishedThisMonth = published.filter((item) => isThisMonth(item.publishDate));
    const revenueThisMonth = publishedThisMonth.reduce((sum, item) => sum + (item.revenue ?? 0), 0);
    const inPipeline = items.filter((item) => item.status !== "Published").length;
    const subProgress = profile.subscriberGoal > 0 ? (profile.subscribers / profile.subscriberGoal) * 100 : 0;
    const subThreshold = (profile.subscribers / MONETIZATION_SUBSCRIBERS) * 100;
    const watchThreshold = (profile.watchHours / MONETIZATION_WATCH_HOURS) * 100;
    return { published, publishedThisMonth, revenueThisMonth, inPipeline, subProgress, subThreshold, watchThreshold };
  }, [items, profile]);

  const saveContent = async (formData: FormData) => {
    const item = makeContentItem(editing ?? undefined);
    item.title = String(formData.get("title") ?? "");
    item.type = String(formData.get("type") ?? "Video") as ContentType;
    item.platform = String(formData.get("platform") ?? "YouTube") as ContentPlatform;
    item.status = String(formData.get("status") ?? "Idea") as ContentStatus;
    item.publishDate = String(formData.get("publishDate") ?? "") || undefined;
    item.url = String(formData.get("url") ?? "");
    item.views = Number(formData.get("views") ?? 0) || undefined;
    item.likes = Number(formData.get("likes") ?? 0) || undefined;
    item.comments = Number(formData.get("comments") ?? 0) || undefined;
    item.watchHours = Number(formData.get("watchHours") ?? 0) || undefined;
    item.revenue = Number(formData.get("revenue") ?? 0) || undefined;
    item.notes = String(formData.get("notes") ?? "");
    await mutate("upsertContentItem", item, { successMessage: editing ? "Content updated." : "Content added." });
    setShowContentModal(false);
    setEditing(null);
  };

  const saveChannel = async (formData: FormData) => {
    const next = makeCreatorProfile(profile);
    next.channelName = String(formData.get("channelName") ?? "");
    next.platform = String(formData.get("platform") ?? "YouTube") as ContentPlatform;
    next.subscribers = Number(formData.get("subscribers") ?? 0);
    next.totalViews = Number(formData.get("totalViews") ?? 0);
    next.watchHours = Number(formData.get("watchHours") ?? 0);
    next.monetized = formData.get("monetized") === "on";
    next.subscriberGoal = Number(formData.get("subscriberGoal") ?? 1000) || 1000;
    next.monthlyRevenueGoal = Number(formData.get("monthlyRevenueGoal") ?? 0);
    await mutate("updateCreatorProfile", next, { successMessage: "Channel updated." });
    setShowChannelModal(false);
  };

  const openNew = () => {
    setEditing(null);
    setShowContentModal(true);
  };

  const openEdit = (item: ContentItem) => {
    setEditing(item);
    setShowContentModal(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Studio"
        title={profile.channelName ? profile.channelName : "Your channel"}
        description="Track subscriber growth, monetization, and every upload and stream."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowChannelModal(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Edit channel
            </Button>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" />
              Add content
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Subscribers"
          value={formatCount(profile.subscribers)}
          detail={`${metrics.subProgress.toFixed(0)}% to ${formatCount(profile.subscriberGoal)} goal`}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="Total views"
          value={formatCount(profile.totalViews)}
          detail={`${items.length} pieces of content tracked`}
          icon={<Eye className="h-5 w-5" />}
        />
        <StatCard
          label="Watch hours"
          value={formatCount(profile.watchHours)}
          detail={`${formatCount(MONETIZATION_WATCH_HOURS)} needed to monetize`}
          icon={<Timer className="h-5 w-5" />}
        />
        <StatCard
          label="Revenue this month"
          value={formatCurrency(metrics.revenueThisMonth, currency)}
          detail={
            profile.monthlyRevenueGoal > 0
              ? `Goal ${formatCurrency(profile.monthlyRevenueGoal, currency)}`
              : `${metrics.publishedThisMonth.length} published this month`
          }
          icon={<Youtube className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">Monetization progress</h2>
            <Badge className={profile.monetized ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : ""}>
              {profile.monetized ? "Monetized" : "On the path"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            YouTube Partner Program requires {formatCount(MONETIZATION_SUBSCRIBERS)} subscribers and{" "}
            {formatCount(MONETIZATION_WATCH_HOURS)} public watch hours in the last 12 months.
          </p>
          <div className="mt-5 space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Subscribers</span>
                <span className="text-white">
                  {formatCount(profile.subscribers)} / {formatCount(MONETIZATION_SUBSCRIBERS)}
                </span>
              </div>
              <Progress value={metrics.subThreshold} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Watch hours</span>
                <span className="text-white">
                  {formatCount(profile.watchHours)} / {formatCount(MONETIZATION_WATCH_HOURS)}
                </span>
              </div>
              <Progress value={metrics.watchThreshold} />
            </div>
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-white">Pipeline</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Work in progress right now.</p>
          <p className="mt-5 text-4xl font-semibold text-white">{metrics.inPipeline}</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            unpublished {metrics.inPipeline === 1 ? "item" : "items"} across {CONTENT_STATUSES.length - 1} stages
          </p>
          <p className="mt-4 text-4xl font-semibold text-white">{metrics.published.length}</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">published all-time</p>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-xl font-semibold text-white">Content pipeline</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CONTENT_STATUSES.map((status) => {
            const columnItems = items.filter((item) => item.status === status);
            return (
              <div key={status} className="rounded-3xl border border-white/8 bg-black/20 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-white">{status}</h3>
                  <Badge>{columnItems.length}</Badge>
                </div>
                <div className="space-y-3">
                  {columnItems.length === 0 ? (
                    <p className="text-sm text-[var(--muted-foreground)]">Nothing here yet.</p>
                  ) : (
                    columnItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openEdit(item)}
                        className="block w-full rounded-2xl border border-white/10 bg-[var(--panel)] p-4 text-left transition hover:border-[var(--accent)]"
                      >
                        <p className="font-medium text-white">{item.title}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.type === "Stream" ? (
                            <Badge className="border-rose-400/30 bg-rose-400/10 text-rose-300">
                              <Radio className="mr-1 h-3 w-3" />
                              {item.type}
                            </Badge>
                          ) : (
                            <Badge>{item.type}</Badge>
                          )}
                          <Badge>{item.platform}</Badge>
                        </div>
                        {item.status === "Published" ? (
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
                            {item.views ? <span>{formatCount(item.views)} views</span> : null}
                            {item.watchHours ? <span>{formatCount(item.watchHours)} hrs</span> : null}
                            {item.revenue ? <span>{formatCurrency(item.revenue, currency)}</span> : null}
                          </div>
                        ) : item.publishDate ? (
                          <p className="mt-3 text-xs text-[var(--muted-foreground)]">Target: {item.publishDate}</p>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        open={showContentModal}
        title={editing ? "Edit content" : "Add content"}
        description="Track an upload or stream."
        onClose={() => {
          setShowContentModal(false);
          setEditing(null);
        }}
      >
        <form action={saveContent} className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input name="title" placeholder="Title" defaultValue={editing?.title} required />
          </div>
          <Select name="type" defaultValue={editing?.type ?? "Video"}>
            {CONTENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
          <Select name="platform" defaultValue={editing?.platform ?? "YouTube"}>
            {CONTENT_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={editing?.status ?? "Idea"}>
            {CONTENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
          <Input name="publishDate" type="date" defaultValue={editing?.publishDate} />
          <div className="md:col-span-2">
            <Input name="url" type="url" placeholder="Link (optional)" defaultValue={editing?.url} />
          </div>
          <Input name="views" type="number" placeholder="Views" defaultValue={editing?.views} />
          <Input name="watchHours" type="number" step="any" placeholder="Watch hours" defaultValue={editing?.watchHours} />
          <Input name="likes" type="number" placeholder="Likes" defaultValue={editing?.likes} />
          <Input name="comments" type="number" placeholder="Comments" defaultValue={editing?.comments} />
          <div className="md:col-span-2">
            <Input name="revenue" type="number" step="any" placeholder="Revenue" defaultValue={editing?.revenue} />
          </div>
          <div className="md:col-span-2">
            <Textarea name="notes" placeholder="Notes" defaultValue={editing?.notes} />
          </div>
          <div className="md:col-span-2 flex justify-between gap-2">
            {editing ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  void mutate("deleteContentItem", editing.id, { successMessage: "Content deleted." });
                  setShowContentModal(false);
                  setEditing(null);
                }}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setShowContentModal(false);
                  setEditing(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={showChannelModal}
        title="Edit channel"
        description="Your channel-level metrics and goals."
        onClose={() => setShowChannelModal(false)}
      >
        <form action={saveChannel} className="grid gap-3 md:grid-cols-2">
          <Input name="channelName" placeholder="Channel name" defaultValue={profile.channelName} required />
          <Select name="platform" defaultValue={profile.platform}>
            {CONTENT_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
          </Select>
          <Input name="subscribers" type="number" placeholder="Subscribers" defaultValue={profile.subscribers} />
          <Input name="totalViews" type="number" placeholder="Total views" defaultValue={profile.totalViews} />
          <Input name="watchHours" type="number" step="any" placeholder="Watch hours" defaultValue={profile.watchHours} />
          <Input name="subscriberGoal" type="number" placeholder="Subscriber goal" defaultValue={profile.subscriberGoal} />
          <Input
            name="monthlyRevenueGoal"
            type="number"
            step="any"
            placeholder="Monthly revenue goal"
            defaultValue={profile.monthlyRevenueGoal}
          />
          <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <input
              name="monetized"
              type="checkbox"
              defaultChecked={profile.monetized}
              className="h-4 w-4 rounded border-white/20 bg-black/20"
            />
            Channel is monetized
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setShowChannelModal(false)}>
              Cancel
            </Button>
            <Button type="submit">Save channel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
