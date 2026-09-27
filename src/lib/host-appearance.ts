import { DEFAULT_THEME, LEGACY_THEME_IDS, themePresetIds } from "@/lib/themes";

export const THEME_STORAGE_KEY = "capital-command-theme";
export const HOST_THEME_KEY = "capital-command-host-theme";
export const HOST_APPEARANCE_KEY = "capital-command-host-appearance";
export const HOST_THEME_MESSAGE = "colateral:theme";
export const HOST_THEME_PARAM = "theme";
export const HOST_SURFACE_PARAM = "surface";
export const HOST_GLASS_LEVEL_PARAM = "glassLevel";
export const HOST_BACKDROP_PARAM = "backdrop";
export const DEFAULT_GLASS_LEVEL = 60;
export const MAX_BACKDROP = 90;

export type HostSurface = "glass" | "classic";

export interface HostAppearance {
  surface: HostSurface;
  glassLevel: number;
  backdrop: number;
}

export interface HostAppearanceInput {
  surface?: unknown;
  glassLevel?: unknown;
  backdrop?: unknown;
}

export const DEFAULT_APPEARANCE: HostAppearance = { surface: "glass", glassLevel: DEFAULT_GLASS_LEVEL, backdrop: 0 };

const APPEARANCE_PARAMS = [HOST_SURFACE_PARAM, HOST_GLASS_LEVEL_PARAM, HOST_BACKDROP_PARAM] as const;

function parseSurface(value: unknown): HostSurface | null {
  return value === "glass" || value === "classic" ? value : null;
}

function parseLevel(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(0, Math.round(n)));
}

export function mergeHostAppearance(base: HostAppearance, input: HostAppearanceInput): HostAppearance {
  return {
    surface: parseSurface(input.surface) ?? base.surface,
    glassLevel: parseLevel(input.glassLevel, 100) ?? base.glassLevel,
    backdrop: parseLevel(input.backdrop, MAX_BACKDROP) ?? base.backdrop,
  };
}

export function carriesAppearance(input: object): boolean {
  return APPEARANCE_PARAMS.some((key) => key in input);
}

export interface AppearanceRoot {
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
}

export function applyHostAppearance(root: AppearanceRoot, appearance: HostAppearance) {
  root.dataset.surface = appearance.surface;
  root.dataset.glass = appearance.glassLevel === 0 ? "flat" : "on";
  root.style.setProperty("--glass-level", String(appearance.glassLevel));
  if (appearance.backdrop > 0) {
    root.dataset.hostBackdrop = "clear";
    root.style.setProperty("--host-backdrop", String(appearance.backdrop));
  } else {
    delete root.dataset.hostBackdrop;
    root.style.removeProperty("--host-backdrop");
  }
}

type SessionStore = Pick<Storage, "getItem" | "setItem">;

export function readStoredAppearance(storage: SessionStore): HostAppearance {
  try {
    const stored = JSON.parse(storage.getItem(HOST_APPEARANCE_KEY) ?? "null") as unknown;
    if (stored && typeof stored === "object") return mergeHostAppearance(DEFAULT_APPEARANCE, stored);
  } catch {
    return DEFAULT_APPEARANCE;
  }
  return DEFAULT_APPEARANCE;
}

export function storeAppearance(storage: SessionStore, appearance: HostAppearance) {
  try {
    storage.setItem(HOST_APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    return;
  }
}

export function readHostAppearance(search: string, storage: SessionStore): HostAppearance {
  const stored = readStoredAppearance(storage);
  const params = new URLSearchParams(search);
  if (!APPEARANCE_PARAMS.some((key) => params.has(key))) return stored;
  const next = mergeHostAppearance(stored, {
    surface: params.get(HOST_SURFACE_PARAM),
    glassLevel: params.get(HOST_GLASS_LEVEL_PARAM),
    backdrop: params.get(HOST_BACKDROP_PARAM),
  });
  storeAppearance(storage, next);
  return next;
}

export function hostBootScript(): string {
  const valid = JSON.stringify(themePresetIds);
  const legacy = JSON.stringify(LEGACY_THEME_IDS);
  const params = JSON.stringify(APPEARANCE_PARAMS);
  return (
    `(function(){var valid=${valid};var legacy=${legacy};` +
    `function ok(t){return valid.indexOf(t)>-1}` +
    `var t=null;try{var p=new URLSearchParams(location.search).get('${HOST_THEME_PARAM}');` +
    `if(ok(p)){t=p;sessionStorage.setItem('${HOST_THEME_KEY}',p)}` +
    `if(!t){var h=sessionStorage.getItem('${HOST_THEME_KEY}');if(ok(h))t=h}` +
    `if(!t){var s=localStorage.getItem('${THEME_STORAGE_KEY}');if(s&&legacy[s])s=legacy[s];if(ok(s))t=s}}catch(e){}` +
    `var d=document.documentElement;d.dataset.theme=t||'${DEFAULT_THEME}';` +
    `var a={surface:'glass',glassLevel:${DEFAULT_GLASS_LEVEL},backdrop:0};` +
    `function lv(v,m){if(v===null||v===undefined||v==='')return null;var n=Number(v);return isFinite(n)?Math.min(m,Math.max(0,Math.round(n))):null}` +
    `function mg(o){if(!o)return;if(o.surface==='glass'||o.surface==='classic')a.surface=o.surface;` +
    `var n=lv(o.glassLevel,100);if(n!==null)a.glassLevel=n;var b=lv(o.backdrop,${MAX_BACKDROP});if(b!==null)a.backdrop=b}` +
    `try{mg(JSON.parse(sessionStorage.getItem('${HOST_APPEARANCE_KEY}')));var q=new URLSearchParams(location.search);` +
    `if(${params}.some(function(k){return q.has(k)})){mg({surface:q.get('${HOST_SURFACE_PARAM}'),glassLevel:q.get('${HOST_GLASS_LEVEL_PARAM}'),backdrop:q.get('${HOST_BACKDROP_PARAM}')});` +
    `sessionStorage.setItem('${HOST_APPEARANCE_KEY}',JSON.stringify(a))}}catch(e){}` +
    `d.dataset.surface=a.surface;d.dataset.glass=a.glassLevel===0?'flat':'on';d.style.setProperty('--glass-level',String(a.glassLevel));` +
    `if(a.backdrop>0){d.dataset.hostBackdrop='clear';d.style.setProperty('--host-backdrop',String(a.backdrop))}` +
    `else{delete d.dataset.hostBackdrop;d.style.removeProperty('--host-backdrop')}})();`
  );
}
