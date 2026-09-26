import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  HOST_APPEARANCE_KEY,
  applyHostAppearance,
  carriesAppearance,
  hostBootScript,
  mergeHostAppearance,
  readHostAppearance,
  readStoredAppearance,
  storeAppearance,
} from "@/lib/host-appearance";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

function fakeRoot() {
  const props = new Map<string, string>();
  return {
    props,
    dataset: {} as DOMStringMap,
    style: {
      setProperty: (name: string, value: string | null) => void props.set(name, String(value)),
      removeProperty: (name: string) => {
        const previous = props.get(name) ?? "";
        props.delete(name);
        return previous;
      },
    },
  };
}

describe("mergeHostAppearance backdrop", () => {
  it("defaults to 0 so the standalone app stays opaque", () => {
    expect(DEFAULT_APPEARANCE.backdrop).toBe(0);
    expect(mergeHostAppearance(DEFAULT_APPEARANCE, {}).backdrop).toBe(0);
  });

  it("parses numbers and numeric strings, rounding and clamping to 0-90", () => {
    expect(mergeHostAppearance(DEFAULT_APPEARANCE, { backdrop: "35" }).backdrop).toBe(35);
    expect(mergeHostAppearance(DEFAULT_APPEARANCE, { backdrop: 42.6 }).backdrop).toBe(43);
    expect(mergeHostAppearance(DEFAULT_APPEARANCE, { backdrop: 140 }).backdrop).toBe(90);
    expect(mergeHostAppearance(DEFAULT_APPEARANCE, { backdrop: -5 }).backdrop).toBe(0);
  });

  it("keeps the previous value when the field is missing or junk", () => {
    const base = { ...DEFAULT_APPEARANCE, backdrop: 30 };
    expect(mergeHostAppearance(base, { glassLevel: 20 }).backdrop).toBe(30);
    expect(mergeHostAppearance(base, { backdrop: "abc" }).backdrop).toBe(30);
    expect(mergeHostAppearance(base, { backdrop: null }).backdrop).toBe(30);
    expect(mergeHostAppearance(base, { backdrop: 0 }).backdrop).toBe(0);
  });

  it("treats a message carrying only backdrop as an appearance update", () => {
    expect(carriesAppearance({ type: "colateral:theme", backdrop: 20 })).toBe(true);
    expect(carriesAppearance({ type: "colateral:theme", theme: "dark" })).toBe(false);
  });
});

describe("applyHostAppearance", () => {
  it("marks the root clear and sets --host-backdrop above 0", () => {
    const root = fakeRoot();
    applyHostAppearance(root, { surface: "glass", glassLevel: 40, backdrop: 35 });
    expect(root.dataset.hostBackdrop).toBe("clear");
    expect(root.props.get("--host-backdrop")).toBe("35");
    expect(root.props.get("--glass-level")).toBe("40");
  });

  it("removes both at 0", () => {
    const root = fakeRoot();
    applyHostAppearance(root, { surface: "glass", glassLevel: 40, backdrop: 35 });
    applyHostAppearance(root, { surface: "glass", glassLevel: 40, backdrop: 0 });
    expect(root.dataset.hostBackdrop).toBeUndefined();
    expect(root.props.has("--host-backdrop")).toBe(false);
  });
});

describe("host appearance persistence", () => {
  it("stores the backdrop from the URL and reads it back after a reload", () => {
    const storage = memoryStorage();
    const first = readHostAppearance("?theme=dark&surface=glass&glassLevel=40&backdrop=35", storage);
    expect(first).toEqual({ surface: "glass", glassLevel: 40, backdrop: 35 });
    expect(readHostAppearance("", storage)).toEqual(first);
  });

  it("a backdrop-only URL still persists and keeps the stored glass level", () => {
    const storage = memoryStorage();
    storeAppearance(storage, { surface: "glass", glassLevel: 25, backdrop: 10 });
    expect(readHostAppearance("?backdrop=50", storage)).toEqual({ surface: "glass", glassLevel: 25, backdrop: 50 });
    expect(readStoredAppearance(storage).backdrop).toBe(50);
  });

  it("reads entries stored before backdrop existed as opaque", () => {
    const storage = memoryStorage({ [HOST_APPEARANCE_KEY]: JSON.stringify({ surface: "glass", glassLevel: 70 }) });
    expect(readStoredAppearance(storage)).toEqual({ surface: "glass", glassLevel: 70, backdrop: 0 });
  });
});

describe("pre-paint boot script", () => {
  function boot(search: string, session: ReturnType<typeof memoryStorage>) {
    const root = fakeRoot();
    runInNewContext(hostBootScript(), {
      URLSearchParams,
      JSON,
      Math,
      Number,
      String,
      isFinite,
      location: { search },
      sessionStorage: session,
      localStorage: memoryStorage(),
      document: { documentElement: root },
    });
    return root;
  }

  it("applies and stores the backdrop from the URL", () => {
    const session = memoryStorage();
    const root = boot("?theme=dark&surface=glass&glassLevel=40&backdrop=35", session);
    expect(root.dataset.hostBackdrop).toBe("clear");
    expect(root.props.get("--host-backdrop")).toBe("35");
    expect(JSON.parse(session.getItem(HOST_APPEARANCE_KEY) ?? "{}")).toEqual({ surface: "glass", glassLevel: 40, backdrop: 35 });
  });

  it("keeps the stored backdrop on a reload without params", () => {
    const session = memoryStorage();
    boot("?backdrop=60", session);
    const root = boot("", session);
    expect(root.dataset.hostBackdrop).toBe("clear");
    expect(root.props.get("--host-backdrop")).toBe("60");
  });

  it("clamps and leaves the root opaque at 0", () => {
    expect(boot("?backdrop=500", memoryStorage()).props.get("--host-backdrop")).toBe("90");
    const root = boot("?backdrop=0", memoryStorage());
    expect(root.dataset.hostBackdrop).toBeUndefined();
    expect(root.props.has("--host-backdrop")).toBe(false);
  });
});

describe("backdrop CSS", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");

  it("clears the root and veils body only for a glass, non-flat host", () => {
    const selector = 'html[data-host-backdrop="clear"]:not([data-surface="classic"]):not([data-glass="flat"])';
    expect(css).toContain(`${selector} {\n  background: transparent;`);
    expect(css).toMatch(/color-mix\(in srgb, var\(--background\) var\(--host-veil\), transparent\)/);
  });

  it("caps the see-through and restores the theme's muted colour inside panels", () => {
    expect(css).toContain("--host-see-through: min(var(--host-backdrop, 0), var(--host-backdrop-cap));");
    expect(css).toContain("--host-veil: calc(100% - var(--host-see-through) * 1%);");
    expect(css).toContain("--muted-foreground: var(--host-page-muted);");
    expect(css).toMatch(/:is\(\.glass, \.glass-popover, \.glass-inset\) \{\n {2}--muted-foreground: var\(--host-panel-muted\);/);
  });

  describe("page-level text passes WCAG AA at the capped see-through", () => {
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const channel = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    const contrast = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * t + b[i] * (1 - t));
    const wallpaper = [[255, 255, 255], [230, 57, 70], [244, 162, 97], [42, 157, 143], [69, 123, 157], [155, 93, 229]];
    const defaultCap = Number(/html \{\n {2}--host-backdrop-cap: (\d+);/.exec(css)?.[1]);
    const mutedShare = Number(/--host-page-muted: color-mix\(in srgb, var\(--foreground\) (\d+)%, var\(--muted-foreground\)\)/.exec(css)?.[1]);
    const themes = [...css.matchAll(/\n\[data-theme="([^"]+)"\] \{([^}]*)\}/g)]
      .filter(([, , body]) => body.includes("--background:"))
      .map(([, id, body]) => {
        const token = (name: string) => hex(new RegExp(`--${name}: (#[0-9a-fA-F]{6});`).exec(body)?.[1] ?? "#000000");
        const cap = new RegExp(`html\\[data-theme="${id}"\\] \\{ --host-backdrop-cap: (\\d+); \\}`).exec(css)?.[1];
        return { id, cap: cap ? Number(cap) : defaultCap, bg: token("background"), fg: token("foreground"), muted: token("muted-foreground") };
      });

    it("finds every theme and the shared values", () => {
      expect(themes.length).toBeGreaterThanOrEqual(17);
      expect(defaultCap).toBeGreaterThan(0);
      expect(mutedShare).toBeGreaterThan(0);
    });

    it.each(themes.map((t) => [t.id, t] as const))("%s", (_id, theme) => {
      const text = mix(theme.fg, theme.muted, mutedShare / 100);
      for (const colour of wallpaper) {
        const page = mix(theme.bg, colour, 1 - theme.cap / 100);
        expect(contrast(text, page)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.fg, page)).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("goes opaque again under reduced transparency", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-transparency: reduce)"));
    expect(reduced).toContain('html[data-host-backdrop="clear"]:not([data-surface="classic"]):not([data-glass="flat"]) body');
  });
});
