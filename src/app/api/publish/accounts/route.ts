import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { accountIdConfigured, addAccount, listAccounts, isPrimaryAccountId, type SocialAccount } from "@/lib/publisher/accounts";
import { youtubeChannelInfo, type YoutubeChannelInfo } from "@/lib/publisher/googleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SocialAccountView = SocialAccount & {
  primary: boolean;
  /** True when posts for this account publish automatically. */
  connected: boolean;
  /** Connected YouTube channel's name/avatar, when known. */
  youtube: YoutubeChannelInfo | null;
};

async function accountView(account: SocialAccount): Promise<SocialAccountView> {
  const connected = await accountIdConfigured(account.platform, account.id);
  return {
    ...account,
    primary: isPrimaryAccountId(account.id),
    connected,
    youtube: account.platform === "youtube" && connected ? await youtubeChannelInfo(account.id) : null
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
