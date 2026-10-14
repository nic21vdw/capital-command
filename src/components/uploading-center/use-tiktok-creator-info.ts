"use client";

import { useEffect, useState } from "react";
import type { TiktokCreatorPostingInfo } from "@/lib/publisher/tiktokPost";

export type CreatorInfoState =
  | { status: "loading" }
  | { status: "ready"; info: TiktokCreatorPostingInfo; audited: boolean }
  | { status: "error"; message: string; cannotPostNow: boolean };

const FRESH_FOR_MS = 30_000;

const requests = new Map<string, { at: number; pending: Promise<CreatorInfoState> }>();

async function request(accountId: string): Promise<CreatorInfoState> {
  try {
    const response = await fetch(`/api/publish/tiktok/creator-info?account=${encodeURIComponent(accountId)}`);
    const payload = await response.json();
    if (!response.ok) {
      return {
        status: "error",
        message: payload?.error ?? "TikTok would not answer.",
        cannotPostNow: payload?.cannotPostNow === true
      };
    }
    const { audited, ...info } = payload as TiktokCreatorPostingInfo & { audited: boolean };
    return { status: "ready", info, audited };
  } catch {
    return { status: "error", message: "Could not reach TikTok.", cannotPostNow: false };
  }
}

export async function loadCreatorInfo(accountId: string): Promise<CreatorInfoState> {
  const held = requests.get(accountId);
  if (held && Date.now() - held.at < FRESH_FOR_MS) return held.pending;
  const pending = request(accountId);
  requests.set(accountId, { at: Date.now(), pending });
  const settled = await pending;
  if (settled.status === "error") requests.delete(accountId);
  return settled;
}

export function useTiktokCreatorInfo(accountId: string, enabled: boolean): CreatorInfoState {
  const [state, setState] = useState<CreatorInfoState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadCreatorInfo(accountId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
      setState({ status: "loading" });
    };
  }, [enabled, accountId]);

  return state;
}
