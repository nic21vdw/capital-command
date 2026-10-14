import { getAccount, isPrimaryAccountId } from "@/lib/publisher/accounts";
import type { PlatformId } from "@/lib/publisher/types";

export async function publisherAccountLabel(platform: PlatformId, accountId: string): Promise<string | null> {
  if (isPrimaryAccountId(accountId)) return null;
  const account = await getAccount(accountId);
  return account && account.platform === platform ? account.label : null;
}
