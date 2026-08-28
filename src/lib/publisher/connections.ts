/**
 * Every account this app can post to, and what connecting one actually needs.
 *
 * The list existed only as prose in `.env.example` and as scattered reads of
 * `process.env` - so the answer to "what do I have to set up before this works"
 * was to read a 340-line example file and a publisher module. This is that
 * answer as data, which is what lets Settings show a row per platform and say
 * connected or not without anyone maintaining a second copy of the list.
 *
 * `fields` are what the owner enters. `oauth` names the route that finishes the
 * job in the browser once those are in - the button is only worth showing when
 * the fields it depends on are set, because an OAuth round trip with no client
 * id fails at the provider with a message nobody can act on.
 */

export type ConnectionField = {
  /** The environment variable name, which is also the key in credentials.json. */
  name: string;
  label: string;
  /** Shown under the field. Where the value comes from, in one line. */
  hint?: string;
};

export type Connection = {
  id: string;
  label: string;
  /** What this account is used for, in the owner's terms. */
  purpose: string;
  fields: ConnectionField[];
  /** In-app route that completes the connection, once `fields` are set. */
  oauth?: { href: string; label: string };
  /** Set by hand or by a CLI today; named so the UI can say so plainly. */
  manualNote?: string;
  /** Where the provider's own console is, for the values above. */
  console?: string;
};

export const CONNECTIONS: Connection[] = [
  {
    id: "youtube",
    label: "YouTube",
    purpose: "Uploads long-form videos and Shorts, and reads the channel's own stats.",
    fields: [
      { name: "YOUTUBE_CLIENT_ID", label: "Client ID", hint: "Google Cloud console, OAuth 2.0 Client IDs." },
      { name: "YOUTUBE_CLIENT_SECRET", label: "Client secret" },
      { name: "YOUTUBE_API_KEY", label: "API key", hint: "Optional. Only needed for channel analytics." }
    ],
    oauth: { href: "/api/auth/google", label: "Connect YouTube" },
    console: "https://console.cloud.google.com/apis/credentials"
  },
  {
    id: "tiktok",
    label: "TikTok",
    purpose: "Posts clips to TikTok.",
    fields: [
      { name: "TIKTOK_CLIENT_KEY", label: "Client key", hint: "TikTok for Developers, your app's credentials." },
      { name: "TIKTOK_CLIENT_SECRET", label: "Client secret" }
    ],
    oauth: { href: "/api/auth/tiktok", label: "Connect TikTok" },
    console: "https://developers.tiktok.com/"
  },
  {
    id: "spotify",
    label: "Spotify",
    purpose: "Publishes podcast episodes.",
    fields: [
      { name: "SPOTIFY_CLIENT_ID", label: "Client ID", hint: "Spotify developer dashboard." },
      { name: "SPOTIFY_CLIENT_SECRET", label: "Client secret" }
    ],
    oauth: { href: "/api/auth/spotify", label: "Connect Spotify" },
    console: "https://developer.spotify.com/dashboard"
  },
  {
    id: "instagram",
    label: "Instagram",
    purpose: "Posts Reels and image posts to a business account.",
    fields: [
      { name: "IG_APP_ID", label: "App ID", hint: "Meta app, Instagram Graph API." },
      { name: "IG_APP_SECRET", label: "App secret" },
      { name: "IG_USER_ID", label: "Business account ID" },
      { name: "IG_ACCESS_TOKEN", label: "Access token", hint: "A long-lived token from the Meta console." }
    ],
    manualNote: "Instagram has no in-app sign-in yet: the token comes from Meta's console and is pasted here.",
    console: "https://developers.facebook.com/apps"
  },
  {
    id: "facebook",
    label: "Facebook",
    purpose: "Posts to a Facebook Page.",
    fields: [
      { name: "FB_PAGE_ID", label: "Page ID" },
      { name: "FB_PAGE_ACCESS_TOKEN", label: "Page access token", hint: "A long-lived Page token from the Meta console." }
    ],
    manualNote: "Facebook has no in-app sign-in yet: the Page token comes from Meta's console and is pasted here.",
    console: "https://developers.facebook.com/apps"
  },
  {
    id: "threads",
    label: "Threads",
    purpose: "Posts the daily Threads packs.",
    fields: [
      { name: "THREADS_USER_ID", label: "User ID" },
      { name: "THREADS_ACCESS_TOKEN", label: "Access token", hint: "A long-lived token from the Meta console." }
    ],
    manualNote: "Threads has no in-app sign-in yet: the token comes from Meta's console and is pasted here.",
    console: "https://developers.facebook.com/apps"
  }
];

/** Every credential name across every connection, for a presence check. */
export const CONNECTION_FIELD_NAMES: string[] = CONNECTIONS.flatMap((connection) =>
  connection.fields.map((field) => field.name)
);
