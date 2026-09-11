/*
 * The CoLateral canvas bridge — the wire format.
 * ---------------------------------------------------------------------------
 * Capital Command runs inside a Capital Command Card on the CoLateral project
 * canvas, in a cross-origin iframe. The card and the app therefore share no
 * storage, no globals and no router: everything one says to the other goes
 * through `postMessage`, and this file is the only description of what those
 * messages may be.
 *
 * It is deliberately pure — no React, no DOM, no window — so both ends can
 * test the same parser. The host half lives in CoLateral's
 * `src/canvas/capitalCommandCard.js` and speaks exactly these names.
 *
 * Two directions, two prefixes, so a message is never mistaken for its own
 * echo: the host sends `colateral:*` and the app answers `capital-command:*`.
 *
 * The verbs are CoLateral's own tool-card vocabulary (read, set fields, list
 * controls, click a control), and that is the point. An agent on the canvas
 * already knows how to drive a Tool Card; giving Capital Command the same four
 * verbs means the agent drives this app with the skills it already has instead
 * of a second, app-specific dialect.
 */

/** Bumped when a message shape changes in a way an old peer cannot read. */
export const BRIDGE_PROTOCOL_VERSION = 1;

export const HOST_MESSAGE = {
  /** Host announces itself and asks the app to introduce itself back. */
  hello: "colateral:hello",
  /** Theme id, and optionally the host's whole resolved token palette. */
  theme: "colateral:theme",
  /** Route the app without reloading the frame. */
  navigate: "colateral:navigate",
  /** Read the current page as fields, controls and readings. */
  read: "colateral:read",
  /** Write values into the current page's fields. */
  setFields: "colateral:set-fields",
  /** Press one of the current page's controls. */
  click: "colateral:click",
  /** Ask what routes this app has. */
  listRoutes: "colateral:list-routes",
  /** How much room the card has, so the app can shed its own chrome. */
  chrome: "colateral:chrome"
} as const;

export const APP_MESSAGE = {
  /** Sent on mount and in answer to `hello`. */
  ready: "capital-command:ready",
  /** Sent whenever the app's own navigation moves, so the card title follows. */
  route: "capital-command:route",
  /** Pushed when the visible page's surface changes under its own steam. */
  surface: "capital-command:surface",
  /** The answer to one addressed request, carrying its `id` back. */
  result: "capital-command:result"
} as const;

export type HostMessageType = (typeof HOST_MESSAGE)[keyof typeof HOST_MESSAGE];
export type AppMessageType = (typeof APP_MESSAGE)[keyof typeof APP_MESSAGE];

/** One editable value on the visible page. */
export interface SurfaceField {
  /** Stable handle an agent addresses the field by, e.g. "title". */
  id: string;
  /** What the engineer sees beside it, e.g. "Clip title". */
  label: string;
  value: string | number | boolean | null;
  kind: "text" | "number" | "boolean" | "select" | "date" | "time" | "longtext";
  /** For `select`, the values that are actually accepted. */
  options?: string[];
  /** "s", "px", "%" — shown after the value, never part of it. */
  unit?: string;
  /** Why a write would be refused right now. Absent means writable. */
  readOnly?: boolean;
  hint?: string;
}

/** One thing on the visible page that can be pressed. */
export interface SurfaceControl {
  id: string;
  label: string;
  /** The toolbar or section it belongs to, so two "Add" buttons stay apart. */
  group?: string;
  /** Already in this mode: pressing it again is a no-op, not a toggle. */
  active?: boolean;
  disabled?: boolean;
  /** Deletes or publishes something. The host warns before pressing it. */
  destructive?: boolean;
  hint?: string;
}

/** One thing the page is reporting. Read-only by definition. */
export interface SurfaceReading {
  label: string;
  value: string;
}

/**
 * What one page of Capital Command looks like to an agent. A page that
 * registers none of this is still framed and still navigable — it simply
 * cannot be typed into, which is the honest answer rather than a guess.
 */
export interface PageSurface {
  route: string;
  title: string;
  /** One line: what this page is for. */
  summary?: string;
  fields: SurfaceField[];
  controls: SurfaceControl[];
  readings: SurfaceReading[];
}

export interface RouteEntry {
  path: string;
  label: string;
  /** The pipeline stage this route belongs to, e.g. "Formats". */
  group: string;
}

export function emptySurface(route: string, title: string): PageSurface {
  return { route, title, fields: [], controls: [], readings: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A route as the app will actually use it: leading slash, no trailing one, no
 * query, no scheme, no `..`. A host that asks for "clips", "/clips/" or
 * "//evil.example" all land on the same safe answer, and anything that cannot
 * be read as a path at all becomes the home route rather than throwing.
 */
export function normalizeRoute(value: unknown): string {
  const raw = str(value).trim();
  if (!raw) return "/";
  // Strip a query or hash: the bridge addresses pages, not page state.
  const path = raw.split(/[?#]/)[0];
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  // A protocol-relative "//host/x" would navigate off the app entirely.
  if (withSlash.startsWith("//")) return "/";
  if (!/^\/[a-zA-Z0-9\-_/]*$/.test(withSlash)) return "/";
  if (withSlash.includes("..")) return "/";
  const trimmed = withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
  return trimmed || "/";
}

/**
 * How much of its own chrome the app should draw. The card is a window onto
 * the app, and at card size the app's 240px sidebar is most of the window, so
 * the host says which it wants and the app obeys:
 *
 *  - `full`    — the app looks exactly as it does in a browser tab (default,
 *                and what an unhosted app always uses).
 *  - `compact` — the sidebar starts collapsed to its icon rail. Everything is
 *                still reachable; it just stops costing half the card.
 *  - `bare`    — no sidebar and no footer. For a card the host has given its
 *                own route rail, or one small enough that only the page itself
 *                fits.
 */
export type ChromeMode = "full" | "compact" | "bare";

const CHROME_MODES: ReadonlySet<string> = new Set<ChromeMode>(["full", "compact", "bare"]);

export function normalizeChrome(value: unknown, fallback: ChromeMode = "full"): ChromeMode {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CHROME_MODES.has(raw) ? (raw as ChromeMode) : fallback;
}

export interface HostRequest {
  type: HostMessageType;
  /** Present on everything that expects a `result` back. */
  id: string;
  route: string;
  control: string;
  fields: Record<string, string | number | boolean | null>;
  theme: string;
  tokens: Record<string, string>;
  chrome: ChromeMode | "";
}

const HOST_TYPES: ReadonlySet<string> = new Set(Object.values(HOST_MESSAGE));

/**
 * Token names the host is allowed to push into this document. The palette is
 * written straight onto the root element, so it is an allowlist and not a
 * filter: an unknown name would let a host set any custom property the app
 * happens to read, and a `--`-prefixed value is not sanitised by anything else.
 */
export const THEME_TOKEN_NAMES = [
  "--background",
  "--foreground",
  "--color-white",
  "--panel",
  "--surface",
  "--surface-2",
  "--border",
  "--border-strong",
  "--muted-foreground",
  "--muted-foreground-2",
  "--accent",
  "--accent-strong",
  "--accent-contrast",
  "--success",
  "--warning",
  "--danger",
  "--info"
] as const;

const TOKEN_ALLOWLIST: ReadonlySet<string> = new Set(THEME_TOKEN_NAMES);

/**
 * A CSS colour the app is willing to paint with. Deliberately narrow: hex,
 * rgb/rgba, hsl/hsla and colour keywords. Anything carrying a `;`, a `}`, a
 * `url(` or a comment marker is dropped rather than escaped, because a token
 * lands in a style declaration and an escape that is nearly right is worse
 * than a value that is simply absent.
 */
export function isSafeTokenValue(value: unknown): boolean {
  const raw = str(value).trim();
  if (!raw || raw.length > 64) return false;
  if (/[;{}<>\\]/.test(raw)) return false;
  if (/url\s*\(/i.test(raw)) return false;
  if (raw.includes("/*") || raw.includes("*/")) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return true;
  if (/^(rgb|rgba|hsl|hsla|color-mix)\([^()]*\)$/i.test(raw)) return true;
  return /^[a-z-]+$/i.test(raw);
}

export function sanitizeThemeTokens(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!TOKEN_ALLOWLIST.has(name)) continue;
    if (!isSafeTokenValue(raw)) continue;
    out[name] = String(raw).trim();
  }
  return out;
}

function sanitizeFieldValue(value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length > 20000 ? value.slice(0, 20000) : value;
  return null;
}

function sanitizeFields(value: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (Array.isArray(value)) {
    // The host's agent tools accept a list of {field, value} pairs as well as
    // an object, because a model that sent the list form was otherwise getting
    // a schema rejection for input the app would have handled.
    for (const entry of value) {
      if (!isRecord(entry)) continue;
      const name = str(entry.field) || str(entry.id) || str(entry.label);
      if (!name) continue;
      out[name] = sanitizeFieldValue(entry.value);
    }
    return out;
  }
  if (!isRecord(value)) return out;
  for (const [name, raw] of Object.entries(value)) {
    if (!name) continue;
    out[name] = sanitizeFieldValue(raw);
  }
  return out;
}

/**
 * Read one inbound host message, or return null when it is not one of ours.
 * Every field is normalised here so nothing downstream has to re-check it.
 */
export function parseHostMessage(data: unknown): HostRequest | null {
  if (!isRecord(data)) return null;
  const type = str(data.type);
  if (!HOST_TYPES.has(type)) return null;
  return {
    type: type as HostMessageType,
    id: str(data.id).slice(0, 64),
    route: normalizeRoute(data.route),
    control: str(data.control).slice(0, 200),
    fields: sanitizeFields(data.fields ?? data.inputs),
    theme: str(data.theme).slice(0, 40),
    tokens: sanitizeThemeTokens(data.tokens),
    // "" and not a default, so a message that never mentioned chrome is told
    // apart from one that asked for `full`.
    chrome: data.chrome === undefined ? "" : normalizeChrome(data.chrome)
  };
}

export interface AppResult {
  type: typeof APP_MESSAGE.result;
  id: string;
  ok: boolean;
  error?: string;
  /** The page as it stands AFTER the request, so one round trip is enough. */
  surface?: PageSurface;
  routes?: RouteEntry[];
  /** Which field names or controls the request actually touched. */
  applied?: string[];
}

export function appResult(
  id: string,
  ok: boolean,
  extra: Omit<AppResult, "type" | "id" | "ok"> = {}
): AppResult {
  return { type: APP_MESSAGE.result, id, ok, ...extra };
}
