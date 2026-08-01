import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyEnvUpdates,
  connectInstagram,
  envUpdatesFor,
  inspectInstagram
} from "@/lib/publisher/instagramConnect";
import { jsonResponse, mockFetchRoutes, testConfig } from "@/lib/publisher/test-helpers";

/**
 * The connect flow turns one short-lived token from the Meta dashboard into the
 * two values the adapter needs. These tests pin the outgoing Graph calls and the
 * failure messages, so a wrong-shaped account is explained rather than guessed at.
 */

const APP = { appId: "app-1", appSecret: "secret-1", userToken: "short-lived" };
const NOW = new Date("2026-07-27T12:00:00.000Z");

// A fully granted token: both halves of the Meta connection, Instagram
// publishing and the Page permission Facebook Reels needs.
const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts"
];

function routes(
  overrides: {
    pages?: unknown;
    scopes?: string[];
    exchange?: unknown;
  } = {}
) {
  return mockFetchRoutes([
    {
      match: "/oauth/access_token",
      respond: () => jsonResponse(overrides.exchange ?? { access_token: "long-lived", expires_in: 5_184_000 })
    },
    { match: "/debug_token", respond: () => jsonResponse({ data: { scopes: overrides.scopes ?? SCOPES } }) },
    {
      match: "/me/accounts",
      respond: () =>
        jsonResponse(
          overrides.pages ?? {
            data: [
              {
                id: "page-1",
                name: "Nic Vandewetering",
                access_token: "page-token",
                instagram_business_account: { id: "17840000000000001", username: "nic" }
              }
            ]
          }
        )
    },
    { match: "content_publishing_limit", respond: () => jsonResponse({ data: [{ quota_usage: 3 }] }) }
  ]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connectInstagram", () => {
  it("exchanges the token and resolves the linked Instagram account", async () => {
    const requests = routes();
    const connection = await connectInstagram({ ...APP, graphApiVersion: "v23.0" }, NOW);

    expect(connection.igUserId).toBe("17840000000000001");
    expect(connection.igUsername).toBe("nic");
    expect(connection.page?.pageAccessToken).toBe("page-token");
    expect(connection.longLivedUserToken).toBe("long-lived");
    expect(connection.userTokenExpiresAt).toBe("2026-09-25T12:00:00.000Z");
    expect(connection.missingScopes).toEqual([]);
    expect(connection.quotaUsage).toBe(3);

    const exchange = requests.find((r) => r.url.includes("/oauth/access_token"));
    expect(exchange?.url).toContain("grant_type=fb_exchange_token");
    expect(exchange?.url).toContain("fb_exchange_token=short-lived");

    const quota = requests.find((r) => r.url.includes("content_publishing_limit"));
    expect(quota?.url).toContain("access_token=page-token");
  });

  it("reports the permissions the token is missing instead of failing later at publish time", async () => {
    routes({ scopes: ["instagram_basic", "pages_show_list"] });
    const connection = await connectInstagram({ ...APP, graphApiVersion: "v23.0" }, NOW);
    expect(connection.missingScopes).toEqual([
      "instagram_content_publish",
      "pages_read_engagement",
      "pages_manage_posts"
    ]);
  });

  // The exact shape of the real connection before this was caught: everything
  // Instagram needs, and nothing Facebook Reels needs.
  it("flags pages_manage_posts on a token that can publish to Instagram but not the Page", async () => {
    routes({
      scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"]
    });
    const connection = await connectInstagram({ ...APP, graphApiVersion: "v23.0" }, NOW);
    expect(connection.missingScopes).toEqual(["pages_manage_posts"]);
  });

  it("points at --ig-user-id when no Page reports a linked Instagram account", async () => {
    routes({ pages: { data: [{ id: "page-1", name: "Side Project", access_token: "page-token" }] } });
    await expect(connectInstagram({ ...APP, graphApiVersion: "v23.0" }, NOW)).rejects.toThrow(/--ig-user-id/);
  });

  it("connects through a business portfolio, where the Page does not expose the account", async () => {
    const requests = mockFetchRoutes([
      { match: "/oauth/access_token", respond: () => jsonResponse({ access_token: "long-lived", expires_in: 5_184_000 }) },
      { match: "/debug_token", respond: () => jsonResponse({ data: { scopes: SCOPES } }) },
      {
        match: "/me/accounts",
        respond: () => jsonResponse({ data: [{ id: "page-1", name: "CoLateral", access_token: "page-token" }] })
      },
      { match: "content_publishing_limit", respond: () => jsonResponse({ data: [{ quota_usage: 0 }] }) },
      { match: "graph.facebook.com", respond: () => jsonResponse({ username: "nic_vandewetering" }) }
    ]);

    const connection = await connectInstagram(
      { ...APP, graphApiVersion: "v23.0", igUserId: "17841414226901547" },
      NOW
    );

    expect(connection.igUserId).toBe("17841414226901547");
    expect(connection.igUsername).toBe("nic_vandewetering");
    expect(connection.tokenSource).toBe("page");
    expect(connection.accessToken).toBe("page-token");
    expect(requests.some((r) => r.url.includes("content_publishing_limit"))).toBe(true);
  });

  it("falls back to the user token when no Page token can reach the account", async () => {
    mockFetchRoutes([
      { match: "/oauth/access_token", respond: () => jsonResponse({ access_token: "long-lived", expires_in: 5_184_000 }) },
      { match: "/debug_token", respond: () => jsonResponse({ data: { scopes: SCOPES } }) },
      {
        match: "/me/accounts",
        respond: () => jsonResponse({ data: [{ id: "page-1", name: "Unrelated", access_token: "page-token" }] })
      },
      {
        match: "content_publishing_limit",
        respond: (request) =>
          request.url.includes("access_token=page-token")
            ? jsonResponse({ error: { message: "no access" } }, { status: 400 })
            : jsonResponse({ data: [{ quota_usage: 2 }] })
      },
      { match: "graph.facebook.com", respond: () => jsonResponse({ username: "nic_vandewetering" }) }
    ]);

    const connection = await connectInstagram(
      { ...APP, graphApiVersion: "v23.0", igUserId: "17841414226901547" },
      NOW
    );

    expect(connection.tokenSource).toBe("user");
    expect(connection.accessToken).toBe("long-lived");
    expect(connection.page).toBeNull();
    expect(connection.quotaUsage).toBe(2);
  });

  it("asks which Page to use when more than one has an Instagram account", async () => {
    routes({
      pages: {
        data: [
          {
            id: "page-1",
            name: "One",
            access_token: "t1",
            instagram_business_account: { id: "ig-1", username: "one" }
          },
          {
            id: "page-2",
            name: "Two",
            access_token: "t2",
            instagram_business_account: { id: "ig-2", username: "two" }
          }
        ]
      }
    });
    await expect(connectInstagram({ ...APP, graphApiVersion: "v23.0" }, NOW)).rejects.toThrow(/--page/);

    const chosen = await connectInstagram({ ...APP, graphApiVersion: "v23.0", pageId: "page-2" }, NOW);
    expect(chosen.igUserId).toBe("ig-2");
  });

  it("says the token is stale rather than surfacing a raw Graph error", async () => {
    routes({ exchange: { error: { message: "Error validating access token: Session has expired" } } });
    await expect(connectInstagram({ ...APP, graphApiVersion: "v23.0" }, NOW)).rejects.toThrow(
      /Session has expired/
    );
  });
});

describe("envUpdatesFor", () => {
  it("saves the Page token as the Instagram token, since that is what the adapter sends", async () => {
    routes();
    const connection = await connectInstagram({ ...APP, graphApiVersion: "v23.0" }, NOW);
    expect(envUpdatesFor(connection, { appId: "app-1", appSecret: "secret-1" })).toEqual({
      IG_USER_ID: "17840000000000001",
      IG_ACCESS_TOKEN: "page-token",
      IG_APP_ID: "app-1",
      IG_APP_SECRET: "secret-1",
      FB_PAGE_ID: "page-1",
      FB_PAGE_ACCESS_TOKEN: "page-token"
    });
  });
});

describe("applyEnvUpdates", () => {
  it("replaces existing keys in place and leaves everything else untouched", () => {
    const raw = ["PUBLISH_ENABLED=true", "# a comment", "IG_USER_ID=old", "IG_ACCESS_TOKEN=", "OTHER=keep"].join("\n");
    const out = applyEnvUpdates(raw, { IG_USER_ID: "new", IG_ACCESS_TOKEN: "tok" });
    expect(out.split("\n")).toEqual([
      "PUBLISH_ENABLED=true",
      "# a comment",
      "IG_USER_ID=new",
      "IG_ACCESS_TOKEN=tok",
      "OTHER=keep",
      ""
    ]);
  });

  it("appends keys the file does not have yet", () => {
    const out = applyEnvUpdates("PUBLISH_ENABLED=true\n", { IG_USER_ID: "new" });
    expect(out).toContain("PUBLISH_ENABLED=true");
    expect(out).toContain("IG_USER_ID=new");
  });

  it("keeps the file's line endings so a Windows .env does not become mixed", () => {
    const out = applyEnvUpdates("PUBLISH_ENABLED=true\r\nIG_USER_ID=old\r\n", { IG_USER_ID: "new" });
    expect(out).toBe("PUBLISH_ENABLED=true\r\nIG_USER_ID=new\r\n");
  });

  it("does not touch a key that merely starts with the same name", () => {
    const out = applyEnvUpdates("IG_USER_ID_BACKUP=keep\nIG_USER_ID=old\n", { IG_USER_ID: "new" });
    expect(out).toContain("IG_USER_ID_BACKUP=keep");
    expect(out).toContain("IG_USER_ID=new");
  });
});

describe("inspectInstagram", () => {
  it("reads the account back and flags a token that never expires", async () => {
    mockFetchRoutes([
      { match: "/debug_token", respond: () => jsonResponse({ data: { expires_at: 0, scopes: SCOPES } }) },
      { match: "content_publishing_limit", respond: () => jsonResponse({ data: [{ quota_usage: 7 }] }) },
      { match: "graph.facebook.com", respond: () => jsonResponse({ username: "nic", followers_count: 1234 }) }
    ]);

    const status = await inspectInstagram(testConfig());
    expect(status.username).toBe("nic");
    expect(status.followers).toBe(1234);
    expect(status.quotaUsage).toBe(7);
    expect(status.neverExpires).toBe(true);
    expect(status.tokenExpiresAt).toBeNull();
    expect(status.missingScopes).toEqual([]);
  });

  it("refuses to guess when nothing is configured", async () => {
    const config = testConfig();
    config.instagram.userId = null;
    await expect(inspectInstagram(config)).rejects.toThrow(/not connected yet/);
  });
});
