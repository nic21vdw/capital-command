"use client";

import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_BRAND_KIT, type BrandKit, type BrandKitOverrides } from "@/lib/brand/defaults";
import { mergeOverrides } from "@/lib/brand/rules";

export type BrandKitState = {
  kit: BrandKit;
  overrides: BrandKitOverrides;
  issues: string[];
  loaded: boolean;
  busy: boolean;
  error: string | null;
};

const INITIAL: BrandKitState = { kit: DEFAULT_BRAND_KIT, overrides: {}, issues: [], loaded: false, busy: false, error: null };

let state: BrandKitState = INITIAL;
let loading: Promise<void> | null = null;
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
  if (loading && !force) return loading;
  loading = fetch("/api/brand-kit", { cache: "no-store" })
    .then(async (response) => {
      const body = await readReply(response);
      if (!response.ok || !body.kit) throw new Error(body.error ?? `The brand kit could not be loaded (${response.status}).`);
      publish({ kit: body.kit, overrides: body.overrides ?? {}, issues: body.issues ?? [], loaded: true, error: null });
    })
    .catch((reason) => {
      publish({ loaded: true, error: reason instanceof Error ? reason.message : String(reason) });
    });
  return loading;
}

export async function saveBrandKit(overrides: BrandKitOverrides): Promise<boolean> {
  publish({ busy: true });
  try {
    const response = await fetch("/api/brand-kit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides })
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
