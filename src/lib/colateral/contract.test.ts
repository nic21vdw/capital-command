import { describe, expect, it } from "vitest";
import {
  APP_MESSAGE,
  BRIDGE_PROTOCOL_VERSION,
  HOST_MESSAGE,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  THEME_TOKEN_NAMES,
  appResult,
  buildNotifyMessage,
  buildReadyMessage,
  buildRouteMessage,
  buildSurfaceMessage,
  emptySurface,
  parseHostMessage,
  type PageSurface
} from "./protocol";
import {
  APP_MESSAGE_SCHEMAS,
  CHROME_MODE_VALUES,
  CONTRACT_VERSION,
  FIELD_KIND_VALUES,
  HOST_MESSAGE_SCHEMAS,
  NOTIFICATION_LEVEL_VALUES,
  SURFACE_SCHEMA,
  type JsonSchema
} from "./contract";
import { allRoutes } from "./routes";

function check(schema: JsonSchema, value: unknown, at = "$"): string[] {
  const problems: string[] = [];
  const kinds = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.oneOf) {
    const results = schema.oneOf.map((option) => check(option, value, at));
    return results.some((found) => found.length === 0) ? [] : [`${at}: matches none of ${results.length} alternatives`];
  }
  if (schema.const !== undefined && value !== schema.const) problems.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  if (kinds.length) {
    const actual =
      value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    const allowed = kinds.some((kind) => kind === actual || (kind === "number" && actual === "integer"));
    if (!allowed) return [...problems, `${at}: expected ${kinds.join("|")}, got ${actual}`];
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${at}: longer than ${schema.maxLength}`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: below ${schema.minimum}`);
  if (Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => problems.push(...check(schema.items as JsonSchema, entry, `${at}[${index}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const name of schema.required ?? []) if (!(name in record)) problems.push(`${at}: missing "${name}"`);
    const known = schema.properties ?? {};
    for (const [name, entry] of Object.entries(record)) {
      if (entry === undefined) continue;
      if (known[name]) problems.push(...check(known[name], entry, `${at}.${name}`));
      else if (schema.additionalProperties === false) problems.push(`${at}: unexpected "${name}"`);
      else if (typeof schema.additionalProperties === "object") problems.push(...check(schema.additionalProperties, entry, `${at}.${name}`));
    }
  }
  return problems;
}

const SURFACE: PageSurface = {
  route: "/uploading-center",
  title: "Uploading Center",
  summary: "Book clips.",
  fields: [
    { id: "bookClip", label: "Clip to book", value: "", kind: "select", options: ["A", "B"] },
    { id: "bookCaption", label: "Caption", value: "hi", kind: "longtext", hint: "optional", readOnly: false, unit: "chars" }
  ],
  controls: [{ id: "book", label: "Book", group: "Book clip", destructive: true, disabled: false, active: false, hint: "Books it" }],
  readings: [{ label: "Queue: YouTube", value: "1 pending" }]
};

const ROUTES = [{ path: "/uploading-center", label: "Uploading Center", group: "Schedule" }];

const HOST_FIXTURES: Record<string, unknown[]> = {
  "colateral:hello": [
    { type: "colateral:hello", protocol: 1, chrome: "compact" },
    { type: "colateral:hello", protocol: 1, protocolVersion: 1, chrome: "full" },
    { type: "colateral:hello" }
  ],
  "colateral:theme": [
    { type: "colateral:theme", theme: "midnight", tokens: { "--accent": "#4da6ff" } },
    { type: "colateral:theme", theme: "midnight", tokens: { "--accent": "#4da6ff" }, surface: "glass", glassLevel: 60, reducedTransparency: false }
  ],
  "colateral:chrome": [{ type: "colateral:chrome", chrome: "bare" }],
  "colateral:navigate": [{ type: "colateral:navigate", id: "cc1", route: "/performance" }],
  "colateral:read": [{ type: "colateral:read", id: "cc2" }],
  "colateral:set-fields": [
    { type: "colateral:set-fields", id: "cc3", fields: { bookPlatform: "youtube", bookCaption: "Hello" } },
    { type: "colateral:set-fields", id: "cc4", fields: [{ field: "Post at", value: "2026-10-15T18:00" }] }
  ],
  "colateral:click": [{ type: "colateral:click", id: "cc5", control: "Book clip > Book" }],
  "colateral:list-routes": [{ type: "colateral:list-routes", id: "cc6" }]
};

const READY = buildReadyMessage({ id: "cc1", route: "/uploading-center", title: "Uploading Center", routes: ROUTES, surface: SURFACE });

const APP_FIXTURES: Record<string, unknown[]> = {
  "capital-command:ready": [READY, buildReadyMessage({ id: "", route: "/", title: "Stream Pipeline", routes: [], surface: emptySurface("/", "Stream Pipeline") })],
  "capital-command:route": [buildRouteMessage({ route: "/uploading-center", title: "Uploading Center", surface: SURFACE })],
  "capital-command:surface": [buildSurfaceMessage(SURFACE)],
  "capital-command:result": [
    appResult("cc2", true, { surface: SURFACE }),
    appResult("cc3", false, { error: "No field called \"x\" on this page.", applied: ["Caption"], surface: SURFACE }),
    appResult("cc5", true, { applied: ["Book"], surface: SURFACE }),
    appResult("cc6", true, { routes: ROUTES }),
    appResult("cc1", true, { applied: ["/performance"] }),
    appResult("cc7", true)
  ],
  "capital-command:notify": [
    buildNotifyMessage({ id: "publish-failed:a:youtube:1", level: "error", title: "YouTube post failed", body: "Reconnect.", route: "/uploading-center?item=abc" })
  ]
};

describe("the message names are pinned", () => {
  it("sends colateral:* from the host and capital-command:* from the app", () => {
    expect(HOST_MESSAGE).toEqual({
      hello: "colateral:hello",
      theme: "colateral:theme",
      navigate: "colateral:navigate",
      read: "colateral:read",
      setFields: "colateral:set-fields",
      click: "colateral:click",
      listRoutes: "colateral:list-routes",
      chrome: "colateral:chrome"
    });
    expect(APP_MESSAGE).toEqual({
      ready: "capital-command:ready",
      route: "capital-command:route",
      surface: "capital-command:surface",
      result: "capital-command:result",
      notify: "capital-command:notify"
    });
  });

  it("has a schema for every message type and no schema for one that does not exist", () => {
    expect(Object.keys(HOST_MESSAGE_SCHEMAS).sort()).toEqual(Object.values(HOST_MESSAGE).sort());
    expect(Object.keys(APP_MESSAGE_SCHEMAS).sort()).toEqual(Object.values(APP_MESSAGE).sort());
    expect(Object.keys(HOST_FIXTURES).sort()).toEqual(Object.values(HOST_MESSAGE).sort());
    expect(Object.keys(APP_FIXTURES).sort()).toEqual(Object.values(APP_MESSAGE).sort());
  });

  it("pins the closed vocabularies both ends switch on", () => {
    expect([...CHROME_MODE_VALUES]).toEqual(["full", "compact", "bare"]);
    expect([...FIELD_KIND_VALUES]).toEqual(["text", "number", "boolean", "select", "date", "time", "longtext"]);
    expect([...NOTIFICATION_LEVEL_VALUES]).toEqual(["error", "warning", "info"]);
    expect([...THEME_TOKEN_NAMES]).toEqual([
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
    ]);
    expect(NOTIFICATION_TITLE_MAX).toBe(200);
    expect(NOTIFICATION_BODY_MAX).toBe(1000);
  });
});

describe("the protocol version", () => {
  it("is one number shared by the contract and the protocol", () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(1);
    expect(CONTRACT_VERSION).toBe(BRIDGE_PROTOCOL_VERSION);
  });

  it("rides on the ready handshake as protocolVersion, and still as protocol for hosts that read the old name", () => {
    expect(READY.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(READY.protocol).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(READY.app).toBe("capital-command");
  });

  it("reads the host's version from either name, and calls a host that sends none version 0", () => {
    expect(parseHostMessage({ type: "colateral:hello", protocol: 1 })?.protocolVersion).toBe(1);
    expect(parseHostMessage({ type: "colateral:hello", protocolVersion: 3 })?.protocolVersion).toBe(3);
    expect(parseHostMessage({ type: "colateral:hello", protocol: 1, protocolVersion: 2 })?.protocolVersion).toBe(2);
    expect(parseHostMessage({ type: "colateral:hello" })?.protocolVersion).toBe(0);
    expect(parseHostMessage({ type: "colateral:hello", protocolVersion: "x" })?.protocolVersion).toBe(0);
    expect(parseHostMessage({ type: "colateral:hello", protocolVersion: -4 })?.protocolVersion).toBe(0);
  });

  it("does not refuse a host that is newer than the app", () => {
    const parsed = parseHostMessage({ type: "colateral:hello", protocolVersion: 99, chrome: "compact", futureField: true });
    expect(parsed?.type).toBe("colateral:hello");
    expect(parsed?.chrome).toBe("compact");
  });
});

describe("every message the host sends is accepted by the app", () => {
  for (const [type, fixtures] of Object.entries(HOST_FIXTURES)) {
    it.each(fixtures.map((fixture, index) => [index, fixture] as const))(`${type} fixture %i matches its schema and parses`, (_, fixture) => {
      expect(check(HOST_MESSAGE_SCHEMAS[type], fixture)).toEqual([]);
      expect(parseHostMessage(fixture)?.type).toBe(type);
    });
  }

  it("normalises a navigate, a set-fields in both forms and a click exactly like this", () => {
    expect(parseHostMessage({ type: "colateral:navigate", id: "cc1", route: "performance/?x=1" })).toMatchObject({
      type: "colateral:navigate",
      id: "cc1",
      route: "/performance"
    });
    expect(parseHostMessage({ type: "colateral:set-fields", id: "a", fields: { x: 1, y: "z", ok: true, none: null } })?.fields).toEqual({
      x: 1,
      y: "z",
      ok: true,
      none: null
    });
    expect(parseHostMessage({ type: "colateral:set-fields", id: "a", fields: [{ field: "x", value: 1 }, { id: "y", value: "z" }, { label: "Caption", value: "c" }] })?.fields).toEqual({
      x: 1,
      y: "z",
      Caption: "c"
    });
    expect(parseHostMessage({ type: "colateral:click", id: "a", control: "Book clip > Book" })?.control).toBe("Book clip > Book");
  });

  it("ignores what it does not own", () => {
    expect(parseHostMessage({ type: "capital-command:ready" })).toBeNull();
    expect(parseHostMessage({ type: "colateral:unknown" })).toBeNull();
    expect(parseHostMessage({ route: "/x" })).toBeNull();
    expect(parseHostMessage(null)).toBeNull();
    expect(parseHostMessage("colateral:read")).toBeNull();
    expect(parseHostMessage([])).toBeNull();
  });

  it("rejects a host message that breaks its schema", () => {
    expect(check(HOST_MESSAGE_SCHEMAS["colateral:navigate"], { type: "colateral:navigate", route: "/x" })).not.toEqual([]);
    expect(check(HOST_MESSAGE_SCHEMAS["colateral:chrome"], { type: "colateral:chrome", chrome: "huge" })).not.toEqual([]);
    expect(check(HOST_MESSAGE_SCHEMAS["colateral:click"], { type: "colateral:click", id: "a" })).not.toEqual([]);
    expect(check(HOST_MESSAGE_SCHEMAS["colateral:set-fields"], { type: "colateral:set-fields", id: "a", fields: "x" })).not.toEqual([]);
  });
});

describe("every message the app sends matches its schema", () => {
  for (const [type, fixtures] of Object.entries(APP_FIXTURES)) {
    it.each(fixtures.map((fixture, index) => [index, fixture] as const))(`${type} fixture %i`, (_, fixture) => {
      expect(fixture).not.toBeNull();
      expect(check(APP_MESSAGE_SCHEMAS[type], fixture)).toEqual([]);
      expect((fixture as { type: string }).type).toBe(type);
    });
  }

  it("pins the ready handshake byte for byte", () => {
    expect(READY).toEqual({
      type: "capital-command:ready",
      id: "cc1",
      protocol: 1,
      protocolVersion: 1,
      app: "capital-command",
      route: "/uploading-center",
      title: "Uploading Center",
      routes: ROUTES,
      surface: SURFACE
    });
  });

  it("pins the route, surface, result and notify messages byte for byte", () => {
    expect(buildRouteMessage({ route: "/clips", title: "Short Clips", surface: emptySurface("/clips", "Short Clips") })).toEqual({
      type: "capital-command:route",
      route: "/clips",
      title: "Short Clips",
      surface: { route: "/clips", title: "Short Clips", fields: [], controls: [], readings: [] }
    });
    expect(buildSurfaceMessage(SURFACE)).toEqual({ type: "capital-command:surface", route: "/uploading-center", surface: SURFACE });
    expect(appResult("cc3", false, { error: "nope", applied: ["a"], surface: SURFACE })).toEqual({
      type: "capital-command:result",
      id: "cc3",
      ok: false,
      error: "nope",
      applied: ["a"],
      surface: SURFACE
    });
    expect(buildNotifyMessage({ id: "n1", level: "warning", title: "T", body: "B", route: "/inbox" })).toEqual({
      type: "capital-command:notify",
      notification: { id: "n1", level: "warning", title: "T", body: "B", route: "/inbox" }
    });
  });

  it("lists every page the app has in the routes it announces", () => {
    const message = buildReadyMessage({ id: "", route: "/", title: "Stream Pipeline", routes: allRoutes(), surface: emptySurface("/", "Stream Pipeline") });
    expect(check(APP_MESSAGE_SCHEMAS["capital-command:ready"], message)).toEqual([]);
    expect(message.routes.length).toBeGreaterThan(20);
  });

  it("rejects an app message that breaks its schema", () => {
    const without = (key: string) => Object.fromEntries(Object.entries(READY).filter(([name]) => name !== key));
    expect(check(APP_MESSAGE_SCHEMAS["capital-command:ready"], without("protocol"))).not.toEqual([]);
    expect(check(APP_MESSAGE_SCHEMAS["capital-command:ready"], without("protocolVersion"))).not.toEqual([]);
    expect(check(APP_MESSAGE_SCHEMAS["capital-command:result"], { type: "capital-command:result", id: "a" })).not.toEqual([]);
    expect(check(APP_MESSAGE_SCHEMAS["capital-command:notify"], { type: "capital-command:notify", notification: { id: "a", level: "fatal", title: "t", body: "" } })).not.toEqual([]);
    expect(check(APP_MESSAGE_SCHEMAS["capital-command:surface"], { type: "capital-command:surface", route: "/x", surface: { route: "/x", title: "x", fields: [{ id: "a", label: "A", value: {}, kind: "text" }], controls: [], readings: [] } })).not.toEqual([]);
    expect(check(APP_MESSAGE_SCHEMAS["capital-command:surface"], { type: "capital-command:surface", route: "/x", surface: { route: "/x", title: "x", fields: [{ id: "a", label: "A", value: "v", kind: "datetime" }], controls: [], readings: [] } })).not.toEqual([]);
  });
});

describe("the page surface shape is pinned", () => {
  it("names every property a field, a control, a reading and a page may carry", () => {
    const fields = (SURFACE_SCHEMA.properties?.fields.items as JsonSchema).properties ?? {};
    const controls = (SURFACE_SCHEMA.properties?.controls.items as JsonSchema).properties ?? {};
    const readings = (SURFACE_SCHEMA.properties?.readings.items as JsonSchema).properties ?? {};
    expect(Object.keys(fields).sort()).toEqual(["hint", "id", "kind", "label", "options", "readOnly", "unit", "value"]);
    expect(Object.keys(controls).sort()).toEqual(["active", "destructive", "disabled", "group", "hint", "id", "label"]);
    expect(Object.keys(readings).sort()).toEqual(["label", "value"]);
    expect(Object.keys(SURFACE_SCHEMA.properties ?? {}).sort()).toEqual(["controls", "fields", "readings", "route", "summary", "title"]);
    expect(SURFACE_SCHEMA.required).toEqual(["route", "title", "fields", "controls", "readings"]);
  });

  it("marks destructive on the control and nowhere else", () => {
    expect(check(SURFACE_SCHEMA, SURFACE)).toEqual([]);
    expect(SURFACE.controls[0].destructive).toBe(true);
  });
});
