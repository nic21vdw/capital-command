import { setCachedToken } from "@/lib/publisher/tokens";

export function rotationNotSaved(label: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(
    `[publisher] ${label}: the rotated refresh token could not be saved (${reason}). The new access token is still used for this request; if ${label} stops accepting the old refresh token, reconnect it in Settings > Accounts.`
  );
}

export async function saveRotatedToken(label: string, key: string, value: string): Promise<boolean> {
  try {
    await setCachedToken(key, value);
    return true;
  } catch (error) {
    rotationNotSaved(label, error);
    return false;
  }
}
