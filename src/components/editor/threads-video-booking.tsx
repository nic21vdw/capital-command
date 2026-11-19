"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ThreadsVideoTarget } from "@/lib/threads/video";

type Account = { id: string; label: string; identityPinned: boolean };
type Settings = { enabled: boolean; paused: boolean; accounts: Account[] };
type Review = { target: ThreadsVideoTarget; digest: string; commandId: string };
type Receipt = { id: string; status: string; providerState: string; permalink?: string };

async function videoRequest(body: object) {
  const response = await fetch("/api/threads/video", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Threads could not confirm this request.");
  return result;
}

function exactTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "shortOffset", timeZone
  }).format(new Date(instant));
}

export function ThreadsVideoBooking({ jobId, fileName }: { jobId?: string; fileName?: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [show, setShow] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState("");
  const [localSource, setLocalSource] = useState<{ jobId: string; fileName: string } | null>(null);
  const [accountId, setAccount] = useState("");
  const [text, setText] = useState("");
  const [at, setAt] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [approved, setApproved] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/threads/video", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (response.ok) {
          const result = await response.json() as Settings;
          setSettings(result);
          setAccount(result.accounts.find((account) => account.identityPinned)?.id ?? "");
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setFilePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!settings?.enabled) return null;
  if (!show) return <Button variant="secondary" className="w-full" onClick={() => setShow(true)}>{jobId ? "Review for Threads" : "Review a final MP4 for Threads"}</Button>;

  const setChanged = () => {
    setReview(null);
    setApproved(false);
    setError("");
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (review && approved) {
        const result = await videoRequest({
          action: "schedule", target: review.target, approvalDigest: review.digest, commandId: review.commandId, confirmed: true
        });
        setReceipt(result.receipt);
      } else {
        const date = new Date(at);
        if (!Number.isFinite(date.getTime())) throw new Error("Choose the posting time first.");
        let source = jobId && fileName ? { jobId, fileName } : localSource;
        if (!source && file) {
          const response = await fetch("/api/threads/video?stage=1", {
            method: "POST", headers: { "Content-Type": "video/mp4" }, body: file
          });
          const staged = await response.json();
          if (!response.ok) throw new Error(staged.error ?? "Could not save the MP4 locally.");
          source = staged.source as { jobId: string; fileName: string };
          setLocalSource(source);
        }
        if (!source) throw new Error("Choose the final MP4 first.");
        const result = await videoRequest({ action: "preview", input: { ...source, text, accountId, publishAt: date.toISOString() } });
        setReview({ target: result.target, digest: result.digest, commandId: crypto.randomUUID() });
        setApproved(false);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Threads could not confirm this request.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-md border border-[var(--border)] p-3 text-sm">
      <p className="font-semibold">Schedule this export on Threads</p>
      {receipt ? (
        <p role="status">Saved on this worker for {review && exactTime(review.target.publishAt, review.target.timezone)}. Booking {receipt.id}. Meta’s delivery receipt appears in Scheduled & sent.</p>
      ) : (
        <>
          {!jobId && (
            <>
              <label className="block space-y-1">
                <span>Final MP4</span>
                <Input type="file" accept="video/mp4,.mp4" disabled={busy} onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFilePreview("");
                  setFile(next);
                  setLocalSource(null);
                  setChanged();
                }} />
              </label>
              {filePreview && <video className="w-full max-h-[40vh] rounded-md bg-black" controls src={filePreview} />}
            </>
          )}
          {settings.paused && <p>Delivery is paused. The worker will hold this booking until Threads video-only delivery resumes.</p>}
          <label className="block space-y-1">
            <span>Threads account</span>
            <select className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2"
              value={accountId} disabled={busy} onChange={(event) => { setAccount(event.target.value); setChanged(); }}>
              <option value="">Choose a verified account</option>
              {settings.accounts.map((account) => <option key={account.id} value={account.id} disabled={!account.identityPinned}>{account.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span>Caption</span>
            <textarea rows={3} maxLength={500} className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2"
              value={text} disabled={busy} onChange={(event) => { setText(event.target.value); setChanged(); }} />
          </label>
          <label className="block space-y-1">
            <span>Posting time in {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
            <Input type="datetime-local" value={at} disabled={busy} onChange={(event) => { setAt(event.target.value); setChanged(); }} />
          </label>
          {review && (
            <div className="space-y-2">
              <p><strong>@{review.target.username}</strong> · {exactTime(review.target.publishAt, review.target.timezone)} · {review.target.timezone}</p>
              <p className="whitespace-pre-wrap">{review.target.text}</p>
              <p>Delivery window ends at {exactTime(review.target.latestAt, review.target.timezone)}. Meta will fetch this final export through a short-lived signed link.</p>
              <label className="flex gap-2">
                <input type="checkbox" checked={approved} disabled={busy} onChange={(event) => setApproved(event.target.checked)} />
                <span>I watched this exact MP4 and approve its caption, account and posting window.</span>
              </label>
            </div>
          )}
          <Button type="button" disabled={busy || (!jobId && !file) || !accountId || !at || !text.trim() || Boolean(review && !approved)} onClick={() => void submit()}>
            {busy ? "Checking…" : review ? "Approve and book this slot" : "Review exact post"}
          </Button>
        </>
      )}
      {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
    </div>
  );
}

export function ThreadsVideoReceipt({ id, postId, verifiedAt, permalink }: { id: string; postId?: string; verifiedAt?: string; permalink?: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const link = permalink ?? receipt?.permalink;
  if ((verifiedAt || receipt?.providerState === "verified") && link) return (
    <a href={link} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)] underline">Verified Threads post</a>
  );
  const check = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await videoRequest({ action: "reconcile", id });
      setReceipt(result.receipt);
      setMessage(result.note ?? (result.receipt.providerState === "not_sent" ? "Saved on this worker. Awaiting delivery." : ""));
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Threads could not verify this receipt.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void check()}>
        {busy ? "Checking…" : "Check Threads receipt"}
      </Button>
      {(message || postId) && <span role="status" className="text-xs">{message || "Meta returned a post ID. Readback pending."}</span>}
    </div>
  );
}
