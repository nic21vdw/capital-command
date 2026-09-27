"use client";

/*
 * The one call a page makes to be drivable from the canvas.
 * ---------------------------------------------------------------------------
 *   useColateralSurface({
 *     route: "/clips",
 *     title: "Short Clips",
 *     fields: [{ id: "minLength", label: "Minimum length", value: min, kind: "number", unit: "s" }],
 *     controls: [{ id: "generate", label: "Generate clips" }],
 *     readings: [{ label: "Clips ready", value: String(clips.length) }],
 *     setField: (id, value) => { ... },
 *     click: (id) => { ... }
 *   });
 *
 * The registration is re-read on every render, so what the host sees is what
 * the page is showing now rather than what it was showing when it mounted. The
 * handlers are held in a ref so a page that rebuilds its callbacks each render
 * — most of them do — does not churn the registry.
 */

import { useEffect, useRef } from "react";
import { registerSurface, surfaceChanged, type SurfaceRegistration } from "./surface";

export function useColateralSurface(registration: SurfaceRegistration) {
  const latest = useRef(registration);
  latest.current = registration;

  useEffect(() => {
    const release = registerSurface({
      get route() {
        return latest.current.route;
      },
      get title() {
        return latest.current.title;
      },
      get summary() {
        return latest.current.summary;
      },
      get fields() {
        return latest.current.fields;
      },
      get controls() {
        return latest.current.controls;
      },
      get readings() {
        return latest.current.readings;
      },
      setField: (id, value) => latest.current.setField?.(id, value),
      click: (id) => latest.current.click?.(id)
    } as SurfaceRegistration);
    return release;
    // The route is the identity of the registration; everything else is read
    // through the ref, so re-registering on a value change would be churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registration.route]);

  // Tell the host the page moved under its own steam, so a card showing a
  // stale reading catches up without being asked.
  useEffect(() => {
    surfaceChanged(latest.current.route);
  });
}
