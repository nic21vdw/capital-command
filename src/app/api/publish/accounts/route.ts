import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { accountIdConfigured, addAccount, listAccounts, isPrimaryAccountId, type SocialAccount } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import { youtubeChannelInfo, type YoutubeChannelInfo } from "@/lib/publisher/googleAuth";
import {
  FACEBOOK_SCOPE_BLOCKER,
  facebookCanPublish,
  facebookProfile,
  instagramProfile,
  type MetaProfile
} from "@/lib/publisher/metaProfile";
import { TIKTOK_AUDIT_BLOCKER, tiktokCreatorInfo, type TiktokCreatorInfo } from "@/lib/publisher/tiktokAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who an account posts as: display name, @handle and avatar. */
export type ConnectedProfile = MetaProfile;

export type SocialAccountView = SocialAccount & {
  primary: boolean;
  /** True when posts for this account publish automatically. */
  connected: boolean;
  /** The profile behind this account, whichever platform minted it. */
  profile: ConnectedProfile | null;
  /** Connected, but something still stops it publishing unattended. */
  blocker: string | null;
  /** Connected YouTube channel's name/avatar, when known. */
  youtube: YoutubeChannelInfo | null;
  /** Connected TikTok profile's display name/avatar, when known. */
  tiktok: TiktokCreatorInfo | null;
};

async function profileFor(
  account: SocialAccount
): Promise<{ profile: ConnectedProfile | null; blocker: string | null }> {
  if (account.platform === "youtube") return { profile: await youtubeChannelInfo(account.id), blocker: null };
  if (account.platform === "tiktok") {
    const config = publisherConfig();
    return {
      profile: await tiktokCreatorInfo(),
      blocker: config.tiktok.audited ? null : TIKTOK_AUDIT_BLOCKER
    };
  }
  if (account.platform === "instagram") return { profile: await instagramProfile(), blocker: null };
  return {
    profile: await facebookProfile(),
    blocker: (await facebookCanPublish()) ? null : FACEBOOK_SCOPE_BLOCKER
  };
}

async function accountView(account: SocialAccount): Promise<SocialAccountView> {
  const connected = await accountIdConfigured(account.platform, account.id);
  const { profile, blocker } = connected
    ? await profileFor(account)
    : { profile: null, blocker: null };
  return {
    ...account,
    primary: isPrimaryAccountId(account.id),
    connected,
    profile,
    blocker,
    youtube: account.platform === "youtube" ? (profile as YoutubeChannelInfo | null) : null,
    tiktok: account.platform === "tiktok" ? (profile as TiktokCreatorInfo | null) : null
  };
}

/** GET /api/publish/accounts — every social account across all platforms. */
export async function GET() {
  const accounts = await listAccounts();
  return NextResponse.json({ accounts: await Promise.all(accounts.map(accountView)) });
}

const createSchema = z.object({
  platform: z.enum(["youtube", "instagram", "tiktok", "facebook"]),
  label: z.string().min(1).max(60)
});

/** POST /api/publish/accounts — add another account for a platform. */
export async function POST(request: NextRequest) {
  let body;
  try {
    body = createSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Provide a platform and an account name." }, { status: 400 });
  }
  try {
    const account = await addAccount(body.platform, body.label);
    return NextResponse.json({ account: await accountView(account) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
