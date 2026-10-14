import {
  APP_MESSAGE,
  BRIDGE_PROTOCOL_VERSION,
  CHROME_MODE_VALUES,
  FIELD_KIND_VALUES,
  HOST_MESSAGE,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_LEVEL_VALUES,
  NOTIFICATION_TITLE_MAX,
  type AppNotifyMessage,
  type AppReadyMessage,
  type AppResult,
  type AppRouteMessage,
  type AppSurfaceMessage,
  type ChromeMode
} from "./protocol";

export {
  APP_MESSAGE,
  BRIDGE_PROTOCOL_VERSION,
  CHROME_MODE_VALUES,
  FIELD_KIND_VALUES,
  HOST_MESSAGE,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_LEVEL_VALUES,
  NOTIFICATION_TITLE_MAX
};
export type {
  AppNotification,
  AppNotifyMessage,
  AppReadyMessage,
  AppResult,
  AppRouteMessage,
  AppSurfaceMessage,
  ChromeMode,
  PageSurface,
  RouteEntry,
  SurfaceControl,
  SurfaceField,
  SurfaceReading
} from "./protocol";

export const CONTRACT_VERSION = BRIDGE_PROTOCOL_VERSION;

type FieldValue = string | number | boolean | null;

export interface HostHelloMessage {
  type: typeof HOST_MESSAGE.hello;
  id?: string;
  protocol?: number;
  protocolVersion?: number;
  chrome?: ChromeMode;
}

export interface HostThemeMessage {
  type: typeof HOST_MESSAGE.theme;
  id?: string;
  theme?: string;
  tokens?: Record<string, string>;
  chrome?: ChromeMode;
}

export interface HostChromeMessage {
  type: typeof HOST_MESSAGE.chrome;
  id?: string;
  chrome: ChromeMode;
}

export interface HostNavigateMessage {
  type: typeof HOST_MESSAGE.navigate;
  id: string;
  route: string;
}

export interface HostReadMessage {
  type: typeof HOST_MESSAGE.read;
  id: string;
}

export interface HostSetFieldsMessage {
  type: typeof HOST_MESSAGE.setFields;
  id: string;
  fields: Record<string, FieldValue> | Array<{ field?: string; id?: string; label?: string; value: FieldValue }>;
}

export interface HostClickMessage {
  type: typeof HOST_MESSAGE.click;
  id: string;
  control: string;
}

export interface HostListRoutesMessage {
  type: typeof HOST_MESSAGE.listRoutes;
  id: string;
}

export type HostMessage =
  | HostHelloMessage
  | HostThemeMessage
  | HostChromeMessage
  | HostNavigateMessage
  | HostReadMessage
  | HostSetFieldsMessage
  | HostClickMessage
  | HostListRoutesMessage;

export type AppMessage = AppReadyMessage | AppRouteMessage | AppSurfaceMessage | AppResult | AppNotifyMessage;

export type JsonType = "string" | "number" | "integer" | "boolean" | "null" | "object" | "array";

export interface JsonSchema {
  type?: JsonType | JsonType[];
  enum?: readonly unknown[];
  const?: unknown;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
}

const TEXT: JsonSchema = { type: "string" };
const FLAG: JsonSchema = { type: "boolean" };
const VERSION: JsonSchema = { type: "integer", minimum: 0 };
const FIELD_VALUE: JsonSchema = { type: ["string", "number", "boolean", "null"] };
const CHROME: JsonSchema = { enum: CHROME_MODE_VALUES };

export const SURFACE_FIELD_SCHEMA: JsonSchema = {
  type: "object",
  required: ["id", "label", "value", "kind"],
  additionalProperties: false,
  properties: {
    id: TEXT,
    label: TEXT,
    value: FIELD_VALUE,
    kind: { enum: FIELD_KIND_VALUES },
    options: { type: "array", items: TEXT },
    unit: TEXT,
    readOnly: FLAG,
    hint: TEXT
  }
};

export const SURFACE_CONTROL_SCHEMA: JsonSchema = {
  type: "object",
  required: ["id", "label"],
  additionalProperties: false,
  properties: {
    id: TEXT,
    label: TEXT,
    group: TEXT,
    active: FLAG,
    disabled: FLAG,
    destructive: FLAG,
    hint: TEXT
  }
};

export const SURFACE_READING_SCHEMA: JsonSchema = {
  type: "object",
  required: ["label", "value"],
  additionalProperties: false,
  properties: { label: TEXT, value: TEXT }
};

export const SURFACE_SCHEMA: JsonSchema = {
  type: "object",
  required: ["route", "title", "fields", "controls", "readings"],
  additionalProperties: false,
  properties: {
    route: TEXT,
    title: TEXT,
    summary: TEXT,
    fields: { type: "array", items: SURFACE_FIELD_SCHEMA },
    controls: { type: "array", items: SURFACE_CONTROL_SCHEMA },
    readings: { type: "array", items: SURFACE_READING_SCHEMA }
  }
};

export const ROUTE_ENTRY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["path", "label", "group"],
  additionalProperties: false,
  properties: { path: TEXT, label: TEXT, group: TEXT }
};

export const NOTIFICATION_SCHEMA: JsonSchema = {
  type: "object",
  required: ["id", "level", "title", "body"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    level: { enum: NOTIFICATION_LEVEL_VALUES },
    title: { type: "string", minLength: 1, maxLength: NOTIFICATION_TITLE_MAX },
    body: { type: "string", maxLength: NOTIFICATION_BODY_MAX },
    route: TEXT
  }
};

function hostMessage(type: string, required: string[], properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    required: ["type", ...required],
    additionalProperties: true,
    properties: { type: { const: type }, id: TEXT, ...properties }
  };
}

export const HOST_MESSAGE_SCHEMAS: Record<string, JsonSchema> = {
  [HOST_MESSAGE.hello]: hostMessage(HOST_MESSAGE.hello, [], { protocol: VERSION, protocolVersion: VERSION, chrome: CHROME }),
  [HOST_MESSAGE.theme]: hostMessage(HOST_MESSAGE.theme, [], {
    theme: TEXT,
    tokens: { type: "object", additionalProperties: TEXT },
    chrome: CHROME
  }),
  [HOST_MESSAGE.chrome]: hostMessage(HOST_MESSAGE.chrome, ["chrome"], { chrome: CHROME }),
  [HOST_MESSAGE.navigate]: hostMessage(HOST_MESSAGE.navigate, ["id", "route"], { route: TEXT }),
  [HOST_MESSAGE.read]: hostMessage(HOST_MESSAGE.read, ["id"], {}),
  [HOST_MESSAGE.setFields]: hostMessage(HOST_MESSAGE.setFields, ["id", "fields"], {
    fields: {
      oneOf: [
        { type: "object", additionalProperties: FIELD_VALUE },
        {
          type: "array",
          items: {
            type: "object",
            required: ["value"],
            properties: { field: TEXT, id: TEXT, label: TEXT, value: FIELD_VALUE }
          }
        }
      ]
    }
  }),
  [HOST_MESSAGE.click]: hostMessage(HOST_MESSAGE.click, ["id", "control"], { control: TEXT }),
  [HOST_MESSAGE.listRoutes]: hostMessage(HOST_MESSAGE.listRoutes, ["id"], {})
};

export const APP_MESSAGE_SCHEMAS: Record<string, JsonSchema> = {
  [APP_MESSAGE.ready]: {
    type: "object",
    required: ["type", "id", "protocol", "protocolVersion", "app", "route", "title", "routes", "surface"],
    additionalProperties: false,
    properties: {
      type: { const: APP_MESSAGE.ready },
      id: TEXT,
      protocol: VERSION,
      protocolVersion: VERSION,
      app: { const: "capital-command" },
      route: TEXT,
      title: TEXT,
      routes: { type: "array", items: ROUTE_ENTRY_SCHEMA },
      surface: SURFACE_SCHEMA
    }
  },
  [APP_MESSAGE.route]: {
    type: "object",
    required: ["type", "route", "title", "surface"],
    additionalProperties: false,
    properties: { type: { const: APP_MESSAGE.route }, route: TEXT, title: TEXT, surface: SURFACE_SCHEMA }
  },
  [APP_MESSAGE.surface]: {
    type: "object",
    required: ["type", "route", "surface"],
    additionalProperties: false,
    properties: { type: { const: APP_MESSAGE.surface }, route: TEXT, surface: SURFACE_SCHEMA }
  },
  [APP_MESSAGE.result]: {
    type: "object",
    required: ["type", "id", "ok"],
    additionalProperties: false,
    properties: {
      type: { const: APP_MESSAGE.result },
      id: TEXT,
      ok: FLAG,
      error: TEXT,
      surface: SURFACE_SCHEMA,
      routes: { type: "array", items: ROUTE_ENTRY_SCHEMA },
      applied: { type: "array", items: TEXT }
    }
  },
  [APP_MESSAGE.notify]: {
    type: "object",
    required: ["type", "notification"],
    additionalProperties: false,
    properties: { type: { const: APP_MESSAGE.notify }, notification: NOTIFICATION_SCHEMA }
  }
};
