/*
 * What a page offers the canvas.
 * ---------------------------------------------------------------------------
 * A page says what it holds by registering a surface: its fields, its controls,
 * and what it is currently reporting. The bridge provider reads whatever is
 * registered for the route being shown and answers the host from that.
 *
 * A module-level store rather than React context, for one reason: the provider
 * sits at the root of the tree and the pages are its descendants, so a page
 * cannot hand anything UP through context. The store is the seam. It holds one
 * registration per route — two mounted at once would mean two pages visible,
 * which the router does not do — and it is defensive about the last one
 * winning, because a route change unmounts the old page after mounting the new.
 *
 * Pure: no React, no DOM. `useColateralSurface` in ./useSurface.ts is the thin
 * React wrapper pages actually call.
 */

import { emptySurface, normalizeRoute, type PageSurface, type SurfaceControl, type SurfaceField, type SurfaceReading } from "./protocol";

export interface SurfaceRegistration {
  route: string;
  title: string;
  summary?: string;
  fields?: SurfaceField[];
  controls?: SurfaceControl[];
  readings?: SurfaceReading[];
  /**
   * Write one field. Return false (or throw) when the value is refused; the
   * host reports the refusal rather than claiming a write that did not happen.
   */
  setField?: (id: string, value: string | number | boolean | null) => boolean | void | Promise<boolean | void>;
  /** Press one control. Same contract as setField. */
  click?: (id: string) => boolean | void | Promise<boolean | void>;
}

type Listener = (route: string) => void;

const registrations = new Map<string, SurfaceRegistration>();
const listeners = new Set<Listener>();

function announce(route: string) {
  for (const listener of listeners) {
    try {
      listener(route);
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

/**
 * Register (or replace) the surface for one route. Returns the release
 * function; calling it only clears the entry if it is still THIS one, so a
 * page unmounting after its successor mounted cannot blank the live page.
 */
export function registerSurface(registration: SurfaceRegistration): () => void {
  const route = normalizeRoute(registration.route);
  // Stored by reference and never copied: `useColateralSurface` hands over an
  // object whose properties are getters onto the live render, and a spread
  // here would freeze the page's values at the moment it mounted.
  registrations.set(route, registration);
  announce(route);
  return () => {
    if (registrations.get(route) === registration) {
      registrations.delete(route);
      announce(route);
    }
  };
}

export function surfaceChanged(route: string) {
  announce(normalizeRoute(route));
}

export function onSurfaceChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRegistration(route: string): SurfaceRegistration | null {
  return registrations.get(normalizeRoute(route)) ?? null;
}

/** Test seam. Nothing in the app calls this. */
export function clearSurfaces() {
  registrations.clear();
  listeners.clear();
}

/**
 * The surface for a route as the host should see it. A route nothing has
 * registered still answers — with its own path and an empty body — because
 * "this page holds nothing an agent can drive" is a real answer and a missing
 * reply is not.
 */
export function readSurface(route: string, fallbackTitle = ""): PageSurface {
  const path = normalizeRoute(route);
  const entry = registrations.get(path);
  if (!entry) return emptySurface(path, fallbackTitle || path);
  return {
    route: path,
    title: entry.title || fallbackTitle || path,
    summary: entry.summary,
    fields: cloneFields(entry.fields),
    controls: cloneControls(entry.controls),
    readings: cloneReadings(entry.readings)
  };
}

function cloneFields(fields?: SurfaceField[]): SurfaceField[] {
  return Array.isArray(fields) ? fields.map((field) => ({ ...field })) : [];
}

function cloneControls(controls?: SurfaceControl[]): SurfaceControl[] {
  return Array.isArray(controls) ? controls.map((control) => ({ ...control })) : [];
}

function cloneReadings(readings?: SurfaceReading[]): SurfaceReading[] {
  return Array.isArray(readings) ? readings.map((reading) => ({ ...reading })) : [];
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Address a field the way the engineer would: by id ("#title" or "title"), by
 * the label they can see ("Clip title"), or close enough that there is only
 * one candidate. Ambiguity is an error rather than a guess — writing the wrong
 * field is worse than saying which two it could have been.
 */
export function matchField(fields: SurfaceField[], name: string): { field?: SurfaceField; error?: string } {
  const wanted = String(name || "").trim();
  if (!wanted) return { error: "No field named." };
  const bare = wanted.startsWith("#") ? wanted.slice(1) : wanted;
  const exactId = fields.find((field) => field.id === bare);
  if (exactId) return { field: exactId };
  const folded = fold(bare);
  const exactLabel = fields.filter((field) => fold(field.label) === folded);
  if (exactLabel.length === 1) return { field: exactLabel[0] };
  if (exactLabel.length > 1) return { error: `"${wanted}" matches ${exactLabel.length} fields; use its id.` };
  const partial = fields.filter(
    (field) => fold(field.label).includes(folded) || fold(field.id).includes(folded)
  );
  if (partial.length === 1) return { field: partial[0] };
  if (partial.length > 1) {
    return { error: `"${wanted}" matches ${partial.map((field) => field.label).join(", ")}. Be exact.` };
  }
  return { error: `No field called "${wanted}" on this page.` };
}

/**
 * The same resolution for controls, with one extra form: a control can be
 * addressed group-qualified ("View controls > Plan") when two toolbars use the
 * same label.
 */
export function matchControl(
  controls: SurfaceControl[],
  name: string
): { control?: SurfaceControl; error?: string } {
  const wanted = String(name || "").trim();
  if (!wanted) return { error: "No control named." };
  const bare = wanted.startsWith("#") ? wanted.slice(1) : wanted;
  const exactId = controls.find((control) => control.id === bare);
  if (exactId) return { control: exactId };

  const qualified = bare.split(">").map((part) => part.trim()).filter(Boolean);
  if (qualified.length === 2) {
    const [group, label] = qualified;
    const hit = controls.filter(
      (control) => fold(control.group || "") === fold(group) && fold(control.label) === fold(label)
    );
    if (hit.length === 1) return { control: hit[0] };
  }

  const folded = fold(bare);
  const exactLabel = controls.filter((control) => fold(control.label) === folded);
  if (exactLabel.length === 1) return { control: exactLabel[0] };
  if (exactLabel.length > 1) {
    const groups = exactLabel.map((control) => control.group || "(no group)").join(", ");
    return { error: `"${wanted}" is in ${groups}. Qualify it as "Group > ${wanted}".` };
  }
  const partial = controls.filter(
    (control) => fold(control.label).includes(folded) || fold(control.id).includes(folded)
  );
  if (partial.length === 1) return { control: partial[0] };
  if (partial.length > 1) {
    return { error: `"${wanted}" matches ${partial.map((control) => control.label).join(", ")}. Be exact.` };
  }
  return { error: `No control called "${wanted}" on this page.` };
}
