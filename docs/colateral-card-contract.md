# The CoLateral card contract

CoLateral Marketing runs inside a CoLateral Marketing Card on the CoLateral canvas,
in a cross-origin iframe. The two halves share nothing but `postMessage`, so the
messages are the whole relationship. This file is the app half of that contract;
the host half is `docs/capital-command-card.md` in the CoLateral repository.

| What | Where |
|---|---|
| Message names, builders and parsers | `src/lib/colateral/protocol.ts` |
| Types and JSON schemas for every message | `src/lib/colateral/contract.ts` |
| The test that pins them | `src/lib/colateral/contract.test.ts` |
| What a page offers an agent | `src/lib/colateral/surface.ts`, `useSurface.ts` |
| The pages the card lists | `src/lib/colateral/routes.ts` |
| The listener | `src/components/providers/colateral-bridge-provider.tsx` |

## Version

`BRIDGE_PROTOCOL_VERSION` in `protocol.ts` (re-exported as `CONTRACT_VERSION`) is 1.
Raise it only when a message changes in a way an old peer cannot read. Adding an
optional property is not that.

The handshake carries it both ways:

- The host sends `colateral:hello` with `protocol: 1` today. The app also reads
  `protocolVersion`, and prefers it when both are present. A host that sends
  neither is version 0. The app never refuses a host for being newer or older.
- The app answers `capital-command:ready` with `protocolVersion: 1` **and**
  `protocol: 1`. The host reads `protocol` today; `protocolVersion` is the name to
  move to. Drop `protocol` only after the host has stopped reading it.

## Host to app

Every host message has a `type`. Unknown properties are ignored, so a newer host can
add some without breaking an older app. `id` is required on everything that expects a
`capital-command:result` back.

| Type | Required | Optional | Answer |
|---|---|---|---|
| `colateral:hello` | `type` | `id`, `protocol`, `protocolVersion`, `chrome` | `capital-command:ready` |
| `colateral:theme` | `type` | `theme`, `tokens`, `chrome` | none |
| `colateral:chrome` | `type`, `chrome` | | none |
| `colateral:navigate` | `type`, `id`, `route` | | `result` with `applied: [route]` |
| `colateral:read` | `type`, `id` | | `result` with `surface` |
| `colateral:set-fields` | `type`, `id`, `fields` | | `result` with `applied`, `error`, `surface` |
| `colateral:click` | `type`, `id`, `control` | | `result` with `applied`, `error`, `surface` |
| `colateral:list-routes` | `type`, `id` | | `result` with `routes` |

`fields` is either an object of `name: value` or a list of `{ field | id | label, value }`.
A value is a string, a number, a boolean or null. `chrome` is `full`, `compact` or `bare`.
`tokens` are checked against an allowlist (`THEME_TOKEN_NAMES`) and a narrow colour grammar.
The host also sends glass properties with `colateral:theme` (`surface`, `glassLevel`,
`reducedTransparency`, `backdrop`); the app ignores them today.

## App to host

| Type | Properties |
|---|---|
| `capital-command:ready` | `id`, `protocol`, `protocolVersion`, `app: "capital-command"`, `route`, `title`, `routes`, `surface` |
| `capital-command:route` | `route`, `title`, `surface` |
| `capital-command:surface` | `route`, `surface` |
| `capital-command:result` | `id`, `ok`, and any of `error`, `surface`, `routes`, `applied` |
| `capital-command:notify` | `notification: { id, level, title, body, route? }` |

The app sends no property outside this table, so the schemas close them.

`capital-command:notify` is sent only after a host has spoken, once per `id`, and only
to the origin that host wrote from. The CoLateral host does not read it yet: its
`CC_APP_MESSAGE` lists four types. Until it does, a notification is dropped on arrival.

## A page surface

```
{ route, title, summary?, fields: [], controls: [], readings: [] }
field    { id, label, value, kind, options?, unit?, readOnly?, hint? }
control  { id, label, group?, active?, disabled?, destructive?, hint? }
reading  { label, value }
```

`kind` is one of `text`, `number`, `boolean`, `select`, `date`, `time`, `longtext`.
`destructive` means the control publishes, sends or deletes something real; the agent
tools tell the agent to name it and get the user's word before pressing it.

A handler a page registers may return `false` to refuse, or `refuse("why")` from
`surface.ts` to refuse with a reason. The reason becomes the `error` of the `result`, so
an agent hears why instead of only that nothing happened.

## What the canvas agent can do on the Uploading Center

Through `read_capital_command`, `set_capital_command_input` and
`click_capital_command_control`, with no change to the host:

- **Book one clip.** Set `Clip to book`, `Platform to book on`, `Post at` (local time in the
  publish timezone, or ISO-8601 with an offset) and optionally `Caption for this booking`,
  then press `Book clip > Book`. Book is `destructive`. It calls the same `schedule` the
  calendar's drag-and-drop calls, so the duplicate guard, the daily caps and the earliest-day
  rule apply now, and the brand rules and the approval hold will too once they land, because
  they sit on the same server path. Book returns as
  soon as the booking starts; read `Last booking` for how it ended, in the server's words.
- **Read the queue.** `Queue: YouTube`, `Queue: Instagram`, `Queue: TikTok` and
  `Queue: Facebook` give pending, scheduled, failed and manual counts and the next slot.
- **Read what is broken.** `Broken accounts` comes from `/api/health/platforms`.
- **Read today's limits.** `Today's quota` and `Days at the shorts cap`.
- **Read the backup.** `Last backup`.

Inbox (`Unread`, `Unread by platform`), Listening (`New leads`) and Performance (`Top posts`,
the 7 and 28 day totals) already declare their numbers as readings.

## Personal pages are not part of the surface

`/finance` and the `/holdings`, `/watchlist` and `/goals` tabs that redirect into it are
Nic's portfolio, not marketing. They are in neither route list, `registerSurface` ignores
them, and the sidebar and command bar show them only in a collapsed **Personal** group
when the personal dashboard setting is on. The pages and their data are unchanged and
still open by URL. The list is `PERSONAL_ROUTE_PATHS` in `src/lib/personal-routes.ts`.

## Changing the contract

1. Change `protocol.ts` and `contract.ts` together.
2. `contract.test.ts` fails until the fixtures, the pinned lists and the schemas agree.
3. Change the host (`src/canvas/capitalCommandBridge.js` in CoLateral) in the same step. If
   the change is not backward compatible, raise `BRIDGE_PROTOCOL_VERSION` in both.

## Porting the test to the CoLateral side

`contract.test.ts` has three parts, and the host needs the last two:

1. The schemas (`HOST_MESSAGE_SCHEMAS`, `APP_MESSAGE_SCHEMAS`, `SURFACE_SCHEMA`) are plain
   JSON-compatible objects. Copy them into the host's test as JSON.
2. `check()`, a 40 line validator for the subset of JSON Schema they use: `type`, `enum`,
   `const`, `required`, `properties`, `additionalProperties`, `items`, `oneOf`, `minLength`,
   `maxLength`, `minimum`.
3. The assertions the host can make:
   - what `bridge.hello(...)`, `theme`, `chrome`, `navigate`, `read`, `setFields`, `click`
     and `listRoutes` post validates against `HOST_MESSAGE_SCHEMAS`;
   - each app fixture passes `parseCapitalCommandMessage`, `ready` fills `state.protocol` from
     `protocol` and gains the same from `protocolVersion`, and a `result` with `ok: false`
     rejects the pending request with its `error`;
   - `CC_HOST_MESSAGE` and `CC_APP_MESSAGE` equal the tables in `protocol.ts`. The host lacks
     `capital-command:notify` today, so add it there or list it as a known gap in the test.
