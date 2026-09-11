"use client";

/*
 * The app's end of the CoLateral canvas bridge.
 * ---------------------------------------------------------------------------
 * When Capital Command is framed by a Capital Command Card on the CoLateral
 * project canvas, this is what answers. It does four things and nothing else:
 *
 *   1. Introduces the app to the card (`ready`), and keeps the card's header
 *      honest by announcing every route change the user makes in here.
 *   2. Routes the app when the card (or an agent driving it) asks, using the
 *      Next router — so the frame never reloads and nothing in flight is lost.
 *   3. Answers reads and applies writes against whatever the visible page
 *      registered with `useColateralSurface`.
 *   4. Takes the host's theme, and now its whole token palette, so a canvas on
 *      a theme this app has never heard of still paints the frame to match.
 *
 * Security posture: only `window.parent` is listened to, only the message types
 * in ./protocol are acted on, and every value is normalised by `parseHostMessage`
 * before it reaches anything here. Replies go to the origin the host actually
 * wrote from — never "*" once that origin is known — so a page that framed this
 * app without being CoLateral learns nothing by listening.
 */

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  APP_MESSAGE,
  BRIDGE_PROTOCOL_VERSION,
  HOST_MESSAGE,
  appResult,
  normalizeChrome,
  parseHostMessage,
  type ChromeMode,
  type HostRequest,
  type PageSurface
} from "@/lib/colateral/protocol";
import { allRoutes, routeLabel } from "@/lib/colateral/routes";
import { getRegistration, matchControl, matchField, onSurfaceChange, readSurface } from "@/lib/colateral/surface";
import { useHostTheme } from "@/components/providers/theme-preset-provider";

/** Written on <html> so CSS can shed chrome without a prop drilled everywhere. */
const CHROME_ATTRIBUTE = "data-colateral-chrome";
const HOSTED_ATTRIBUTE = "data-colateral-hosted";

interface ColateralBridgeValue {
  /** True when the app is inside a Capital Command Card. */
  hosted: boolean;
  chrome: ChromeMode;
}

const ColateralBridgeContext = createContext<ColateralBridgeValue>({ hosted: false, chrome: "full" });

export function useColateralBridge(): ColateralBridgeValue {
  return useContext(ColateralBridgeContext);
}

function framed(): boolean {
  try {
    return typeof window !== "undefined" && window.parent && window.parent !== window;
  } catch {
    // A cross-origin parent still compares fine; this catch is for the
    // hardened-iframe case where even reading `parent` throws.
    return false;
  }
}

export function ColateralBridgeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { applyHostTheme } = useHostTheme();
  const [hosted, setHosted] = useState(false);
  const [chrome, setChrome] = useState<ChromeMode>("full");

  // The origin the host wrote from. Until a host message has arrived the app
  // has no idea who framed it, so the only thing it will broadcast is `ready`,
  // which carries a route and a title and nothing else.
  const hostOrigin = useRef<string>("");
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const post = useCallback((message: object, allowBroadcast = false) => {
    if (typeof window === "undefined" || !framed()) return;
    const target = hostOrigin.current || (allowBroadcast ? "*" : "");
    if (!target) return;
    try {
      window.parent.postMessage(message, target);
    } catch {
      /* a host that has gone away is not an error worth surfacing */
    }
  }, []);

  const currentSurface = useCallback((): PageSurface => {
    const route = pathnameRef.current || "/";
    return readSurface(route, routeLabel(route));
  }, []);

  /* ---- answering the host ------------------------------------------- */

  const answerRead = useCallback(
    (request: HostRequest) => {
      post(appResult(request.id, true, { surface: currentSurface() }));
    },
    [currentSurface, post]
  );

  const answerNavigate = useCallback(
    (request: HostRequest) => {
      const known = allRoutes().some((route) => route.path === request.route);
      if (!known) {
        post(appResult(request.id, false, { error: `Capital Command has no page at ${request.route}.` }));
        return;
      }
      if (request.route === pathnameRef.current) {
        post(appResult(request.id, true, { surface: currentSurface() }));
        return;
      }
      router.push(request.route);
      // The surface of the page being navigated TO does not exist yet — it is
      // registered when that page mounts. Answering with the page that is
      // still on screen would be a lie, so the result says only that the
      // navigation was accepted; the `route` and `surface` pushes that follow
      // the mount carry the real thing.
      post(appResult(request.id, true, { applied: [request.route] }));
    },
    [currentSurface, post, router]
  );

  const answerSetFields = useCallback(
    async (request: HostRequest) => {
      const registration = getRegistration(pathnameRef.current || "/");
      if (!registration || typeof registration.setField !== "function") {
        post(
          appResult(request.id, false, {
            error: `${routeLabel(pathnameRef.current || "/")} has no fields the canvas can write.`,
            surface: currentSurface()
          })
        );
        return;
      }
      const names = Object.keys(request.fields);
      if (!names.length) {
        post(appResult(request.id, false, { error: "No fields given." }));
        return;
      }
      const applied: string[] = [];
      const refused: string[] = [];
      for (const name of names) {
        const fields = readSurface(pathnameRef.current || "/").fields;
        const { field, error } = matchField(fields, name);
        if (!field) {
          refused.push(error || `No field called "${name}".`);
          continue;
        }
        if (field.readOnly) {
          refused.push(`"${field.label}" is read-only on this page.`);
          continue;
        }
        try {
          const outcome = await registration.setField(field.id, request.fields[name]);
          if (outcome === false) refused.push(`"${field.label}" refused that value.`);
          else applied.push(field.label);
        } catch (error) {
          refused.push(`"${field.label}" threw: ${(error as Error)?.message || String(error)}`);
        }
      }
      // Read AFTER the writes: the reply carries what the page says now, so
      // one round trip both writes and reports.
      post(
        appResult(request.id, refused.length === 0, {
          error: refused.length ? refused.join(" ") : undefined,
          applied,
          surface: currentSurface()
        })
      );
    },
    [currentSurface, post]
  );

  const answerClick = useCallback(
    async (request: HostRequest) => {
      const route = pathnameRef.current || "/";
      const registration = getRegistration(route);
      if (!registration || typeof registration.click !== "function") {
        post(
          appResult(request.id, false, {
            error: `${routeLabel(route)} has no controls the canvas can press.`,
            surface: currentSurface()
          })
        );
        return;
      }
      const { control, error } = matchControl(readSurface(route).controls, request.control);
      if (!control) {
        post(appResult(request.id, false, { error, surface: currentSurface() }));
        return;
      }
      if (control.disabled) {
        post(
          appResult(request.id, false, {
            error: `"${control.label}" is disabled right now.`,
            surface: currentSurface()
          })
        );
        return;
      }
      try {
        const outcome = await registration.click(control.id);
        if (outcome === false) {
          post(appResult(request.id, false, { error: `"${control.label}" did nothing.`, surface: currentSurface() }));
          return;
        }
      } catch (error) {
        post(
          appResult(request.id, false, {
            error: `"${control.label}" threw: ${(error as Error)?.message || String(error)}`,
            surface: currentSurface()
          })
        );
        return;
      }
      post(appResult(request.id, true, { applied: [control.label], surface: currentSurface() }));
    },
    [currentSurface, post]
  );

  const sendReady = useCallback(
    (id = "") => {
      post(
        {
          type: APP_MESSAGE.ready,
          id,
          protocol: BRIDGE_PROTOCOL_VERSION,
          app: "capital-command",
          route: pathnameRef.current || "/",
          title: routeLabel(pathnameRef.current || "/"),
          routes: allRoutes(),
          surface: currentSurface()
        },
        true
      );
    },
    [currentSurface, post]
  );

  /* ---- the listener --------------------------------------------------- */

  useEffect(() => {
    if (!framed()) return;
    setHosted(true);

    const onMessage = (event: MessageEvent) => {
      let fromParent = false;
      try {
        fromParent = event.source === window.parent;
      } catch {
        fromParent = false;
      }
      if (!fromParent) return;
      const request = parseHostMessage(event.data);
      if (!request) return;
      // First valid host message pins the reply address for the rest of the
      // session. `event.origin` is "null" for a host on a file:// page, which
      // postMessage will not accept as a target; such a host gets broadcast
      // replies, which is what it already had.
      if (!hostOrigin.current && event.origin && event.origin !== "null") {
        hostOrigin.current = event.origin;
      }

      if (request.chrome) {
        setChrome(request.chrome);
      }
      if (request.type === HOST_MESSAGE.theme || request.theme || Object.keys(request.tokens).length) {
        applyHostTheme(request.theme, request.tokens);
      }

      switch (request.type) {
        case HOST_MESSAGE.hello:
          sendReady(request.id);
          return;
        case HOST_MESSAGE.navigate:
          answerNavigate(request);
          return;
        case HOST_MESSAGE.read:
          answerRead(request);
          return;
        case HOST_MESSAGE.setFields:
          void answerSetFields(request);
          return;
        case HOST_MESSAGE.click:
          void answerClick(request);
          return;
        case HOST_MESSAGE.listRoutes:
          post(appResult(request.id, true, { routes: allRoutes() }));
          return;
        default:
          // `theme` and `chrome` are handled above and want no reply; an
          // addressed one still gets an acknowledgement so a host that waits
          // on an id is never left hanging.
          if (request.id) post(appResult(request.id, true));
      }
    };

    window.addEventListener("message", onMessage);
    sendReady();
    return () => window.removeEventListener("message", onMessage);
  }, [answerClick, answerNavigate, answerRead, answerSetFields, applyHostTheme, post, sendReady]);

  /* ---- pushes the host did not ask for -------------------------------- */

  // The user clicked something in here; the card's header says the old page.
  useEffect(() => {
    if (!hosted) return;
    post({
      type: APP_MESSAGE.route,
      route: pathname || "/",
      title: routeLabel(pathname || "/"),
      surface: readSurface(pathname || "/", routeLabel(pathname || "/"))
    });
  }, [hosted, pathname, post]);

  // The visible page changed what it is reporting. Coalesced to one push per
  // frame and skipped when nothing actually differs: a page re-rendering on
  // every keystroke would otherwise put a message on the wire per keystroke.
  useEffect(() => {
    if (!hosted) return;
    let scheduled = 0;
    let last = "";
    const flush = () => {
      scheduled = 0;
      const surface = readSurface(pathnameRef.current || "/", routeLabel(pathnameRef.current || "/"));
      const serialized = JSON.stringify(surface);
      if (serialized === last) return;
      last = serialized;
      post({ type: APP_MESSAGE.surface, route: surface.route, surface });
    };
    const release = onSurfaceChange(() => {
      if (scheduled) return;
      scheduled = window.requestAnimationFrame(flush);
    });
    return () => {
      release();
      if (scheduled) window.cancelAnimationFrame(scheduled);
    };
  }, [hosted, post]);

  // Stamped on <html> rather than passed down: the shell, the footer and the
  // command bar are in three different trees, and all three want the answer.
  useEffect(() => {
    const root = document.documentElement;
    if (hosted) root.setAttribute(HOSTED_ATTRIBUTE, "true");
    else root.removeAttribute(HOSTED_ATTRIBUTE);
    root.setAttribute(CHROME_ATTRIBUTE, normalizeChrome(chrome));
  }, [chrome, hosted]);

  const value = useMemo(() => ({ hosted, chrome }), [chrome, hosted]);
  return <ColateralBridgeContext.Provider value={value}>{children}</ColateralBridgeContext.Provider>;
}

