"use client";

import { useEffect, useState } from "react";

/** What a screen needs to know about one network: is posting there live? */
export type PlatformLink = {
  /** At least one account is signed in and its connection still works. */
  connected: boolean;
  /** Why a signed-in account still cannot publish unattended, if it cannot. */
  blocker: string | null;
};

export type PlatformLinks = Partial<Record<"youtube" | "instagram" | "tiktok" | "facebook" | "linkedin", PlatformLink>>;

type AccountRow = { platform: string; connected: boolean; needsReconnect?: boolean; blocker?: string | null };

/** Pure so it can be tested: fold the accounts route's rows into one answer per network. */
export function linksFromAccounts(accounts: AccountRow[]): PlatformLinks {
  const links: PlatformLinks = {};
  for (const account of accounts) {
    const platform = account.platform as keyof PlatformLinks;
    if (!["youtube", "instagram", "tiktok", "facebook", "linkedin"].includes(platform)) continue;
    const live = account.connected && !account.needsReconnect;
    const current = links[platform];
    if (live || !current) {
      links[platform] = { connected: live || Boolean(current?.connected), blocker: account.blocker ?? null };
    }
  }
  return links;
}

/**
 * Which networks are really signed in, from the same `/api/publish/accounts`
 * the sidebar reads. `null` while loading or if the check fails: callers keep
 * their neutral wording then, because saying "not connected" on a guess is as
 * wrong as saying "Automatic" on one.
 */
export function usePlatformConnections(): PlatformLinks | null {
  const [links, setLinks] = useState<PlatformLinks | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/publish/accounts", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { accounts?: AccountRow[] }) => {
        if (live) setLinks(linksFromAccounts(json.accounts ?? []));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return links;
}
