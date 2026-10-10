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
  optional?: boolean;
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
  /** Further plain-language notes under the fields, one paragraph each. */
  notes?: string[];
  /**
   * The OAuth client type to create in the provider's console. Registering the
   * redirect URI under the wrong type is the usual first failure, and it is
   * reported on the provider's own page where this app cannot explain it.
   */
  clientType?: string;
  /** A provider quirk about the redirect URI worth saying next to it. */
  redirectNote?: string;
  /** Where this platform's other controls live, since Settings holds only the credentials. */
  more?: { href: string; label: string };
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
      { name: "YOUTUBE_CLIENT_SECRET", label: "Client secret" }
    ],
    oauth: { href: "/api/auth/google", label: "Connect YouTube" },
    console: "https://console.cloud.google.com/apis/credentials",
    clientType: "Web application",
    more: { href: "/uploading-center", label: "Add another YouTube account in the Uploading Center" }
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
    console: "https://developers.tiktok.com/",
    clientType: "Login Kit for Desktop",
    more: { href: "/uploading-center", label: "Add another TikTok account in the Uploading Center" }
  },
  {
    id: "spotify",
    label: "Spotify",
    purpose: "Checks your Spotify account and podcast episodes.",
    fields: [
      { name: "SPOTIFY_CLIENT_ID", label: "Client ID", hint: "Spotify developer dashboard." },
      { name: "SPOTIFY_CLIENT_SECRET", label: "Client secret" }
    ],
    oauth: { href: "/api/auth/spotify", label: "Connect Spotify" },
    console: "https://developer.spotify.com/dashboard",
    clientType: "Web API",
    redirectNote:
      "Spotify no longer accepts localhost in a redirect URI, so register the 127.0.0.1 address exactly as shown. " +
      "The app switches localhost to 127.0.0.1 for the sign-in on its own.",
    more: { href: "/podcast", label: "Disconnect Spotify on the Podcast page" }
  },
  {
    id: "instagram",
    label: "Instagram",
    purpose: "Posts Reels and image posts to a business account.",
    fields: [
      { name: "IG_APP_ID", label: "App ID", hint: "Used for token checks and Meta webhooks.", optional: true },
      { name: "IG_APP_SECRET", label: "App secret", optional: true },
      { name: "IG_USER_ID", label: "Business account ID" },
      {
        name: "IG_ACCESS_TOKEN",
        label: "Access token",
        hint: "Run npm run publish:instagram:connect to get a long-lived one. A Graph Explorer token expires in an hour."
      }
    ],
    manualNote:
      "Instagram has no in-app sign-in yet. The path that works is the command npm run publish:instagram:connect " +
      "(steps in docs/INSTAGRAM_SETUP.md), which trades a short-lived token for a long-lived one and saves it to .env. " +
      "A token copied straight from Meta's Graph Explorer expires in about an hour: it will look saved here, " +
      "then posts stop.",
    notes: [
      "Instagram also needs Media hosting (the last row below). Meta downloads each video from a public web link, " +
        "so scheduling an Instagram post fails until the S3 fields are filled in."
    ],
    console: "https://developers.facebook.com/apps"
  },
  {
    id: "facebook",
    label: "Facebook",
    purpose: "Posts to a Facebook Page.",
    fields: [
      { name: "FB_PAGE_ID", label: "Page ID" },
      {
        name: "FB_PAGE_ACCESS_TOKEN",
        label: "Page access token",
        hint: "npm run publish:instagram:connect saves this too. A Graph Explorer token expires in an hour."
      }
    ],
    manualNote:
      "Facebook has no in-app sign-in yet. npm run publish:instagram:connect (steps in docs/INSTAGRAM_SETUP.md) " +
      "saves a Page token that does not expire. A token copied from Meta's Graph Explorer expires in about an hour.",
    notes: [
      "Facebook video posts also need Media hosting (the last row below): the S3 fields have to be filled in " +
        "before a post can be scheduled."
    ],
    console: "https://developers.facebook.com/apps"
  },
  {
    id: "threads",
    label: "Threads",
    purpose: "Posts daily and stream-generated Threads posts with contextual CoLateral follow-up replies.",
    fields: [
      { name: "THREADS_USER_ID", label: "User ID", hint: "The access token normally identifies the account.", optional: true },
      { name: "THREADS_ACCESS_TOKEN", label: "Access token", hint: "A long-lived token with publishing and reply permissions from the Meta console." }
    ],
    manualNote: "Threads has no in-app sign-in yet: the token comes from Meta's console and is pasted here.",
    console: "https://developers.facebook.com/apps",
    more: { href: "/x-posts", label: "Check the Threads connection on the Threads Autopilot page" }
  },
  {
    id: "media-hosting",
    label: "Media hosting",
    purpose: "A public web link for each video, which Instagram and Facebook download from.",
    fields: [
      { name: "S3_ENDPOINT", label: "Endpoint", hint: "Cloudflare R2 or any S3-compatible storage. R2's free tier is enough." },
      { name: "S3_BUCKET", label: "Bucket" },
      { name: "S3_ACCESS_KEY_ID", label: "Access key ID" },
      { name: "S3_SECRET_ACCESS_KEY", label: "Secret access key" },
      { name: "S3_REGION", label: "Region", hint: "Leave blank for auto.", optional: true },
      { name: "S3_PUBLIC_BASE_URL", label: "Public base URL", hint: "The bucket's public address, when it has one.", optional: true }
    ],
    manualNote: "Media hosting has no sign-in: create a bucket, then paste its details here. YouTube and TikTok do not need it.",
    console: "https://dash.cloudflare.com/?to=/:account/r2/overview"
  }
];

/** Every credential name across every connection, for a presence check. */
export const CONNECTION_FIELD_NAMES: string[] = CONNECTIONS.flatMap((connection) =>
  connection.fields.map((field) => field.name)
);

/**
 * The sidebar's amber wording for an account that has credentials but whose
 * latest post failed on the connection. Here, not beside the check, because
 * the sidebar is a client component and this module has no server imports.
 */
export function reconnectBlocker(label: string): string {
  return `Reconnect ${label}: its last post failed because the connection expired or was revoked.`;
}
