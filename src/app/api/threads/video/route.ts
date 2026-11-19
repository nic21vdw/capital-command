import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteUpload, saveUploadFromStream } from "@/lib/publisher/uploads";
import { isAutomationPaused } from "@/lib/automations/store";
import { mutationGuardRefuses } from "@/lib/security/mutation-guard";
import { readThreadsVideoPost, threadsVideoContainerStatus } from "@/lib/threads/api";
import { findAccount, threadsConfig } from "@/lib/threads/config";
import { mutateQueue, readQueue } from "@/lib/threads/queue";
import { ThreadsConnectionError, verifyThreadsPublishingConnection } from "@/lib/threads/reconnect";
import {
  MAX_VIDEO_BYTES, planVideoBooking, readThreadsExport, ThreadsVideoError, videoBookingMatches, videoBookingReceipt,
  videoDeliveryProfile, videoDigest, videoReplay, videoTarget
} from "@/lib/threads/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const input = z.object({
  jobId: z.string().max(128), fileName: z.string().max(128), text: z.string().min(1).max(500),
  accountId: z.string().min(1).max(30), publishAt: z.string().max(30)
}).strict();
const target = input.extend({
  sha256: z.string().regex(/^[a-f\d]{64}$/), userId: z.string().regex(/^\d{1,64}$/),
  username: z.string().regex(/^[\w.]{1,64}$/), timezone: z.string().min(1).max(128), latestAt: z.string().max(30)
}).strict();
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), input }).strict(),
  z.object({
    action: z.literal("schedule"), target, commandId: z.string().uuid(),
    approvalDigest: z.string().regex(/^[a-f\d]{64}$/), confirmed: z.literal(true)
  }).strict(),
  z.object({ action: z.literal("reconcile"), id: z.string().regex(/^thread-video-[a-f\d-]{36}$/) }).strict()
]);

export async function GET() {
  const config = threadsConfig();
  return NextResponse.json({
    enabled: config.enabled && config.videoOnly === true && Boolean(videoDeliveryProfile()),
    accounts: config.accounts.map(({ id, label, userId }) => ({ id, label, identityPinned: Boolean(userId) })),
    paused: await isAutomationPaused("threads")
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (mutationGuardRefuses(request)) return NextResponse.json({ error: "Cross-origin mutation refused." }, { status: 403 });
  if (new URL(request.url).searchParams.get("stage") === "1") {
    const config = threadsConfig();
    if (!config.enabled || !config.videoOnly || !videoDeliveryProfile()) {
      return NextResponse.json({ error: "Threads video-only delivery is not configured." }, { status: 409 });
    }
    const limit = Number(request.headers.get("content-length"));
    if (!request.body || request.headers.get("content-type") !== "video/mp4" || limit > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: "Choose a final MP4 no larger than 100 MB." }, { status: 400 });
    }
    let stagedId: string | undefined;
    try {
      let size = 0;
      const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength;
          if (size > MAX_VIDEO_BYTES) throw new ThreadsVideoError("Choose a final MP4 no larger than 100 MB.", 400);
          controller.enqueue(chunk);
        }
      }));
      const saved = await saveUploadFromStream(bounded, "export-threads.mp4", "video/mp4");
      stagedId = saved.id;
      const source = { jobId: `upload-${saved.id}`, fileName: "export-threads.mp4" };
      await readThreadsExport(source.jobId, source.fileName);
      return NextResponse.json({ source }, { status: 201 });
    } catch (error) {
      if (stagedId) await deleteUpload(stagedId);
      return NextResponse.json({ error: error instanceof ThreadsVideoError ? error.message : "The local video could not be prepared." },
        { status: error instanceof ThreadsVideoError ? error.status : 503 });
    }
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Threads video request." }, { status: 400 });
  const body = parsed.data;
  const config = threadsConfig();
  try {
    if (body.action === "reconcile") {
      const item = (await readQueue()).find((row) => row.id === body.id);
      if (!item?.video || !videoBookingMatches(item)) throw new ThreadsVideoError("No exact Threads video booking was found.", 404);
      if (item.video.verifiedAt) return NextResponse.json({ receipt: videoBookingReceipt(item) });
      const account = findAccount(config, item.accountId);
      if (!account || account.userId !== item.video.target.userId) {
        throw new ThreadsVideoError("Reconnect the exact Threads profile before checking this receipt.");
      }
      if (!item.postId) {
        if (!item.containerId || !item.publishAttemptedAt) return NextResponse.json({ receipt: videoBookingReceipt(item) });
        // A container status alone does not prove which public post is ours.
        const status = await threadsVideoContainerStatus(account, item.containerId, config);
        return NextResponse.json({
          receipt: videoBookingReceipt(item),
          containerStatus: ["IN_PROGRESS", "FINISHED", "PUBLISHED", "ERROR", "EXPIRED"].includes(status) ? status : "unknown",
          note: "No accepted post ID to verify. Keep this receipt held and check Threads before any new booking."
        });
      }
      const readback = await readThreadsVideoPost(account, item.video.target, item.postId, config);
      const receipt = await mutateQueue((items) => {
        const saved = items.find((row) => row.id === item.id);
        if (!saved?.video || saved.postId !== item.postId || saved.video.digest !== item.video?.digest || !videoBookingMatches(saved)) {
          throw new ThreadsVideoError("The booking changed while checking its receipt.");
        }
        if (saved.video.verifiedAt) return { items, result: videoBookingReceipt(saved), unchanged: true };
        Object.assign(saved.video, { ...readback, verifiedAt: new Date().toISOString() });
        saved.status = "published";
        saved.publishedAt = readback.providerTimestamp;
        delete saved.error;
        delete saved.nextAttemptAt;
        delete saved.publishAttemptedAt;
        return { items, result: videoBookingReceipt(saved) };
      });
      return NextResponse.json({ receipt });
    }

    if (body.action === "schedule") {
      if (body.approvalDigest !== videoDigest(body.target)) throw new ThreadsVideoError("Review the exact video, caption, profile and time again.");
      const old = videoReplay(await readQueue(), body.commandId, body.target);
      if (old) return NextResponse.json({ receipt: videoBookingReceipt(old), replayed: true });
    }
    if (!config.enabled || !config.videoOnly || !videoDeliveryProfile()) {
      throw new ThreadsVideoError("Threads video-only delivery needs the existing private R2 bucket confirmed by the owner.");
    }

    const supplied = body.action === "preview" ? body.input : body.target;
    const exact = { jobId: supplied.jobId, fileName: supplied.fileName, text: supplied.text,
      accountId: supplied.accountId, publishAt: supplied.publishAt };
    const account = findAccount(config, exact.accountId);
    if (!account?.userId) throw new ThreadsVideoError("Verify and save the exact Threads profile in Settings > Accounts first.");
    const artifact = await readThreadsExport(exact.jobId, exact.fileName);
    const { userId, username } = await verifyThreadsPublishingConnection(account, config, {
      userId: account.userId, username: body.action === "schedule" ? body.target.username : undefined
    });
    const current = videoTarget(exact, { userId, username }, artifact, config, new Date());
    const digest = videoDigest(current);
    if (body.action === "preview") return NextResponse.json({ target: current, digest });
    if (digest !== body.approvalDigest) throw new ThreadsVideoError("The MP4, profile or posting window changed. Review again.");
    const live = threadsConfig();
    if (!live.enabled || !live.videoOnly || !videoDeliveryProfile() || findAccount(live, exact.accountId)?.accessToken !== account.accessToken
      || live.timezone !== config.timezone || live.lateGraceMinutes !== config.lateGraceMinutes) {
      throw new ThreadsVideoError("Threads settings changed. Reload and review this booking again.");
    }
    const outcome = await mutateQueue((items) => {
      const old = videoReplay(items, body.commandId, current);
      if (old) return { items, result: { receipt: videoBookingReceipt(old), replayed: true }, unchanged: true };
      const booked = planVideoBooking(items, current, account, body.commandId, new Date());
      return { items: [...items, booked], result: { receipt: videoBookingReceipt(booked), replayed: false } };
    });
    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof ThreadsConnectionError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof ThreadsVideoError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Threads video outcome could not be confirmed. Keep the same approval ID if checking again." }, { status: 503 });
  }
}
