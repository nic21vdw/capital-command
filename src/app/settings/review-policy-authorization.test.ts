import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REVIEW_POLICY, type ReviewPolicy } from "@/lib/publisher/approval";
import type { SurfaceRegistration } from "@/lib/colateral/surface";
import Page from "@/app/settings/page";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/defaults";

const state = vi.hoisted(() => ({
  policy: {} as ReviewPolicy, loaded: false, surface: null as SurfaceRegistration | null,
  change: vi.fn(async () => true)
}));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/layout/settings-page", () => ({ SettingsPage: () => null }));
vi.mock("@/components/providers/app-provider", () => ({ useAppData: () => ({ data: { settings: {} }, apiStatus: {}, mutate: vi.fn() }) }));
vi.mock("@/components/providers/theme-preset-provider", () => ({ useThemePreset: () => ({ theme: "default", setTheme: vi.fn(), hosted: false }) }));
vi.mock("@/components/layout/review-policy", () => ({ useReviewPolicy: () => ({ policy: state.policy, loaded: state.loaded }), changeReviewPolicy: state.change }));
vi.mock("@/lib/brand/client", () => ({
  useBrandKitState: () => ({ kit: DEFAULT_BRAND_KIT, overrides: {} }), patchBrandKit: vi.fn(), saveBrandKit: vi.fn()
}));
vi.mock("@/lib/colateral/useSurface", () => ({ useColateralSurface: (surface: SurfaceRegistration) => { state.surface = surface; } }));

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.policy = { ...DEFAULT_REVIEW_POLICY };
  state.loaded = false;
  state.surface = null;
  state.change.mockClear();
});

describe("Settings canvas cannot authorize a policy release", () => {
  it.each([false, true])("refuses Auto from an all-auto client snapshot, loaded=%s", async (loaded) => {
    state.loaded = loaded;
    renderToStaticMarkup(React.createElement(Page));
    expect(await state.surface?.setField?.("review-instagram", "auto")).toBe(false);
    expect(state.change).not.toHaveBeenCalled();
  });

  it("still lets the canvas place a channel on Hold before its first read completes", async () => {
    renderToStaticMarkup(React.createElement(Page));
    expect(await state.surface?.setField?.("review-instagram", "hold")).toBe(true);
    expect(state.change).toHaveBeenCalledWith({ instagram: "hold" });
  });
});
