import { NextRequest } from "next/server";
import { connectErrorUrl, redirectWithinApp } from "@/lib/publisher/connectStart";
import { exchangeLinkedinCode, linkedinRedirectUri } from "@/lib/publisher/linkedinAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error_description") ?? params.get("error");
  if (denied || !code || !state) {
    return redirectWithinApp(
      connectErrorUrl(origin, "linkedin", denied || "LinkedIn returned no authorization code. Click Connect LinkedIn again.")
    );
  }
  try {
    await exchangeLinkedinCode({ code, state, redirectUri: linkedinRedirectUri(origin) });
  } catch (error) {
    return redirectWithinApp(connectErrorUrl(origin, "linkedin", error instanceof Error ? error.message : String(error)));
  }
  const target = new URL("/settings", origin);
  target.searchParams.set("connected", "linkedin");
  target.hash = "accounts";
  return redirectWithinApp(target);
}
