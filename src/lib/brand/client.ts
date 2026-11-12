"use client";

import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_BRAND_KIT, type BrandKit, type BrandKitOverrides } from "@/lib/brand/defaults";
import { mergeOverrides } from "@/lib/brand/rules";
import type { VideoLook } from "@/lib/brand/video-look";

export type BrandKitState = {
  kit: BrandKit;
  overrides: BrandKitOverrides;
  issues: string[];
  loaded: boolean;
  refreshing: boolean;
  busy: boolean;
  error: string | null;
};

const INITIAL: BrandKitState = { kit: DEFAULT_BRAND_KIT, overrides: {}, issues: [], loaded: false, refreshing: false, busy: false, error: null };

let state: BrandKitState = INITIAL;
let loading: Promise<void> | null = null;
let readGeneration = 0;
let readable = false;
const listeners = new Set<() => void>();

function publish(next: Partial<BrandKitState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

type Reply = { kit?: BrandKit; overrides?: BrandKitOverrides; issues?: string[]; error?: string };

async function readReply(response: Response): Promise<Reply> {
  return ((await response.json().catch(() => null)) as Reply | null) ?? {};
}

export function loadBrandKit(force = false): Promise<void> {
  if (state.busy) return Promise.resolve();
  if (loading && !force) return loading;
  const generation = ++readGeneration;
  readable = false;
  publish({ refreshing: true });
  loading = fetch("/api/brand-kit", { cache: "no-store", signal: AbortSignal.timeout(15_000) })
    .then(async (response) => {
      const body = await readReply(response);
      if (generation !== readGeneration) return;
      if (!response.ok || !body.kit) throw new Error(body.error ?? `The brand kit could not be loaded (${response.status}).`);
      readable = true;
      publish({ kit: body.kit, overrides: body.overrides ?? {}, issues: body.issues ?? [], loaded: true, refreshing: false, error: null });
    })
    .catch((reason) => {
      if (generation !== readGeneration) return;
      publish({ loaded: true, refreshing: false, error: reason instanceof Error ? reason.message : String(reason) });
    });
  return loading;
}

export async function saveBrandKit(overrides: BrandKitOverrides, videoLooks?: VideoLook[]): Promise<boolean> {
  if (!state.loaded || !readable || state.busy || state.issues.length) return false;
  publish({ busy: true });
  try {
    const response = await fetch("/api/brand-kit", {
      method: videoLooks ? "PATCH" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(videoLooks ? { videoLooks, expectedOverrides: state.overrides } : { overrides, expectedOverrides: state.overrides }),
      signal: AbortSignal.timeout(15_000)
    });
    const body = await readReply(response);
    if (!response.ok || !body.kit) {
      publish({ busy: false, error: body.issues?.length ? body.issues.join(" ") : (body.error ?? `The brand kit was not saved (${response.status}).`) });
      return false;
    }
    publish({ kit: body.kit, overrides: body.overrides ?? {}, issues: body.issues ?? [], busy: false, error: null });
    return true;
  } catch (reason) {
    publish({ busy: false, error: reason instanceof Error ? reason.message : String(reason) });
    return false;
  }
}

export function saveVideoLooks(looks: VideoLook[]): Promise<boolean> {
  return saveBrandKit({}, looks);
}

export function patchBrandKit(patch: BrandKitOverrides): Promise<boolean> {
  return saveBrandKit(mergeOverrides(state.overrides, patch));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBrandKitState(): BrandKitState {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL
  );
  useEffect(() => {
    void loadBrandKit();
  }, []);
  return current;
}

export function useBrandKit(): BrandKit {
  return useBrandKitState().kit;
}
