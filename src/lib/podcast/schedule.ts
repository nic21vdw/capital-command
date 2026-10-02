import { randomUUID } from "node:crypto";
import { recordAutomationEventSafely } from "@/lib/automations/history";
import { isAutomationPaused } from "@/lib/automations/store";
import { feedBlockers } from "@/lib/podcast/feed";
import {
  podcastConfigured,
  publishEpisode,
  type NewEpisode,
} from "@/lib/podcast/publish";
import { mutatePodcastState, readPodcastState } from "@/lib/podcast/store";
import type { PodcastAutomation, PodcastDelivery } from "@/lib/podcast/types";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 30 * 60_000;
let draining = false;

export function validatePodcastAutomation(
  input: PodcastAutomation,
): PodcastAutomation {
  if (
    !input ||
    typeof input.enabled !== "boolean" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
  ) {
    throw new Error("Choose a valid daily release time (00:00 to 23:59).");
  }
  try {
    if (typeof input.timeZone !== "string" || !input.timeZone.trim())
      throw new Error("Missing time zone");
    new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone }).format();
  } catch {
    throw new Error("Choose a valid time zone, such as America/Toronto.");
  }
  return { enabled: input.enabled, time: input.time, timeZone: input.timeZone };
}

export function nextPodcastSlot(
  automation: PodcastAutomation,
  deliveries: PodcastDelivery[],
  now = new Date(),
): string {
  validatePodcastAutomation(automation);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: automation.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (date: Date) =>
    Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
  const local = parts(now);
  const [hour, minute] = automation.time.split(":").map(Number);
  const occupied = new Set(
    deliveries
      .filter((item) => item.status !== "cancelled")
      .map((item) => {
        const p = parts(new Date(item.publishAt));
        return `${p.year}-${p.month}-${p.day}`;
      }),
  );
  const startDay = Date.UTC(
    Number(local.year),
    Number(local.month) - 1,
    Number(local.day),
  );
  for (let day = 0; day < 3660; day++) {
    const nominal = startDay + day * 86_400_000 + (hour * 60 + minute) * 60_000;
    const targetDay = new Date(startDay + day * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const offsets = new Set(
      [-12, 0, 12].map((hours) => {
        const sampled = nominal + hours * 3_600_000;
        const p = parts(new Date(sampled));
        return (
          Date.UTC(
            Number(p.year),
            Number(p.month) - 1,
            Number(p.day),
            Number(p.hour),
            Number(p.minute),
          ) - sampled
        );
      }),
    );
    const candidates = [...offsets]
      .map((offset) => new Date(nominal - offset))
      .sort((a, b) => a.getTime() - b.getTime());
    for (const candidate of candidates) {
      const p = parts(candidate);
      if (
        `${p.year}-${p.month}-${p.day}` !== targetDay ||
        `${p.hour}:${p.minute}` !== automation.time
      )
        continue;
      const iso = candidate.toISOString();
      if (candidate > now && !occupied.has(targetDay)) return iso;
    }
  }
  throw new Error("No free daily podcast slot could be found.");
}

export async function savePodcastAutomation(input: PodcastAutomation) {
  const automation = validatePodcastAutomation(input);
  return (
    await mutatePodcastState((state) => {
      state.automation = automation;
    })
  ).state;
}

export async function scheduleEpisode(
  input: NewEpisode & { exportId: string },
  publishAt?: string,
  now = new Date(),
) {
  const requested = publishAt === undefined ? undefined : new Date(publishAt);
  if (
    requested &&
    (!Number.isFinite(requested.getTime()) || requested <= now)
  ) {
    throw new Error("Choose a podcast release time in the future.");
  }
  if (!input.exportId || !input.title.trim())
    throw new Error("The episode needs a finished export and a title.");
  return (
    await mutatePodcastState((state) => {
      const existing = state.deliveries.find(
        (item) => item.exportId === input.exportId,
      );
      if (existing?.status === "cancelled")
        throw new Error(
          "That release was cancelled. Set a new time under Scheduled podcast delivery.",
        );
      if (existing) return existing;
      const episode = state.episodes.find(
        (item) => item.exportId === input.exportId,
      );
      const delivery: PodcastDelivery = {
        ...input,
        exportId: input.exportId,
        id: randomUUID(),
        createdAt: now.toISOString(),
        publishAt:
          episode?.publishedAt ??
          requested?.toISOString() ??
          nextPodcastSlot(state.automation, state.deliveries, now),
        status: episode ? "published" : "scheduled",
        attempts: 0,
        episodeId: episode?.id,
        completedAt: episode?.publishedAt,
      };
      state.deliveries.unshift(delivery);
      return delivery;
    })
  ).result;
}

export async function managePodcastDelivery(
  id: string,
  action: "retry" | "cancel" | "reschedule",
  publishAt?: string,
) {
  const now = new Date();
  const requested = publishAt ? new Date(publishAt) : undefined;
  if (
    action === "reschedule" &&
    (!requested || !Number.isFinite(requested.getTime()) || requested <= now)
  ) {
    throw new Error("Choose a podcast release time in the future.");
  }
  return (
    await mutatePodcastState((state) => {
      const delivery = state.deliveries.find((item) => item.id === id);
      if (!delivery)
        throw new Error("That podcast delivery could not be found.");
      if (delivery.status === "publishing" || delivery.status === "published") {
        throw new Error(
          "A publishing or published episode cannot be changed here.",
        );
      }
      if (action === "cancel") delivery.status = "cancelled";
      else {
        delivery.status = "scheduled";
        delivery.publishAt =
          action === "reschedule"
            ? requested!.toISOString()
            : now.toISOString();
        delivery.attempts = 0;
        delete delivery.lastError;
        delete delivery.blocked;
      }
      delete delivery.nextAttemptAt;
      return delivery;
    })
  ).result;
}

export async function processDuePodcastDeliveries(
  now = new Date(),
): Promise<number> {
  if (draining || (await isAutomationPaused("podcast"))) return 0;
  draining = true;
  let attempted = 0;
  try {
    const initial = await readPodcastState();
    if (!initial.automation.enabled) return 0;
    const candidates = initial.deliveries
      .filter(
        (item) =>
          (item.status === "scheduled" ||
            (item.status === "failed" && item.attempts < MAX_ATTEMPTS) ||
            (item.status === "publishing" &&
              (!item.lastAttemptAt ||
                now.getTime() - Date.parse(item.lastAttemptAt) >= LEASE_MS))) &&
          Date.parse(item.nextAttemptAt ?? item.publishAt) <= now.getTime(),
      )
      .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
    for (const candidate of candidates.slice(0, 1)) {
      if (await isAutomationPaused("podcast")) break;
      const delivery = (
        await mutatePodcastState((state) => {
          if (!state.automation.enabled) return null;
          const current = state.deliveries.find(
            (item) => item.id === candidate.id,
          );
          if (
            !current ||
            current.status === "cancelled" ||
            current.status === "published"
          )
            return null;
          if (
            current.status === "publishing" &&
            current.lastAttemptAt &&
            now.getTime() - Date.parse(current.lastAttemptAt) < LEASE_MS
          )
            return null;
          if (current.attempts >= MAX_ATTEMPTS) {
            if (current.status === "publishing") {
              current.status = "failed";
              current.lastError =
                "The last publishing attempt was interrupted. Retry to confirm delivery.";
              delete current.nextAttemptAt;
            }
            return null;
          }
          if (
            Date.parse(current.nextAttemptAt ?? current.publishAt) >
            now.getTime()
          )
            return null;
          const blockers = feedBlockers(state.show, state.episodes, {
            hosted: podcastConfigured(),
          }).filter((item) => item.code !== "episodes");
          if (blockers.length) {
            current.status = "failed";
            current.blocked = true;
            current.lastError = blockers.map((item) => item.problem).join(" ");
            current.lastAttemptAt = now.toISOString();
            current.nextAttemptAt = new Date(
              now.getTime() + 90_000,
            ).toISOString();
            return null;
          }
          delete current.blocked;
          current.status = "publishing";
          current.lastAttemptAt = now.toISOString();
          current.attempts++;
          return { ...current };
        })
      ).result;
      if (!delivery) {
        const waiting = (await readPodcastState()).deliveries.find((item) => item.id === candidate.id);
        if (waiting?.blocked) await recordAutomationEventSafely({ automationId: "podcast", scope: "delivery", kind: "blocked", at: new Date().toISOString(), itemId: waiting.id, destination: "RSS feed", detail: `${waiting.title}: ${waiting.lastError ?? "Feed setup is incomplete."}`, nextAttemptAt: waiting.nextAttemptAt, key: `${waiting.id}:${waiting.lastError}` });
        else if (waiting?.status === "failed" && waiting.attempts >= MAX_ATTEMPTS) await recordAutomationEventSafely({ automationId: "podcast", scope: "delivery", kind: "failed", at: new Date().toISOString(), itemId: waiting.id, destination: "RSS feed", detail: `${waiting.title}: ${waiting.lastError ?? "Delivery attempts exhausted."}`, key: `${waiting.id}:interrupted:${waiting.lastAttemptAt}` });
        continue;
      }
      attempted++;
      try {
        const { episode } = await publishEpisode({
          ...delivery,
          publishedAt: delivery.publishAt,
        });
        await mutatePodcastState((state) => {
          const current = state.deliveries.find(
            (item) => item.id === delivery.id,
          )!;
          current.status = "published";
          current.episodeId = episode.id;
          current.completedAt = new Date().toISOString();
          delete current.lastError;
          delete current.nextAttemptAt;
        });
        await recordAutomationEventSafely({ automationId: "podcast", scope: "delivery", kind: "delivered", at: new Date().toISOString(), itemId: delivery.id, destination: "RSS feed", detail: `${delivery.title}: published to the RSS feed. Spotify ingestion is not confirmed.`, key: `${delivery.id}:${episode.id}` });
      } catch (error) {
        const failed = await mutatePodcastState((state) => {
          const current = state.deliveries.find(
            (item) => item.id === delivery.id,
          )!;
          current.status = "failed";
          current.lastError =
            error instanceof Error ? error.message : String(error);
          if (current.attempts < MAX_ATTEMPTS) {
            current.nextAttemptAt = new Date(
              now.getTime() +
                Math.min(
                  6 * 3_600_000,
                  5 * 60_000 * 2 ** (current.attempts - 1),
                ),
            ).toISOString();
          } else delete current.nextAttemptAt;
          return { ...current };
        });
        await recordAutomationEventSafely({ automationId: "podcast", scope: "delivery", kind: failed.result.nextAttemptAt ? "retrying" : "failed", at: new Date().toISOString(), itemId: delivery.id, destination: "RSS feed", detail: `${delivery.title}: ${failed.result.lastError}`, nextAttemptAt: failed.result.nextAttemptAt, key: `${delivery.id}:${failed.result.attempts}:${delivery.lastAttemptAt}` });
      }
    }
    return attempted;
  } catch (error) {
    await recordAutomationEventSafely({ automationId: "podcast", scope: "worker", kind: "failed", at: new Date().toISOString(), detail: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    draining = false;
  }
}

export async function podcastAutomationStatus() {
  const state = await readPodcastState();
  const deliveries = state.deliveries.map((item) => {
    const { filePath, ...delivery } = item;
    void filePath;
    return delivery;
  });
  const pending = deliveries.filter(
    (item) =>
      item.status === "scheduled" ||
      item.status === "publishing" ||
      (item.status === "failed" && item.attempts < MAX_ATTEMPTS),
  );
  const counts = {
    scheduled: deliveries.filter((item) => item.status === "scheduled").length,
    publishing: deliveries.filter((item) => item.status === "publishing")
      .length,
    failed: deliveries.filter((item) => item.status === "failed").length,
    published: deliveries.filter((item) => item.status === "published").length,
    cancelled: deliveries.filter((item) => item.status === "cancelled").length,
  };
  return {
    automation: state.automation,
    deliveries,
    counts,
    paused: await isAutomationPaused("podcast"),
    nextDueAt:
      pending.map((item) => item.nextAttemptAt ?? item.publishAt).sort()[0] ??
      null,
  };
}
