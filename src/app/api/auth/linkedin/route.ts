import { NextRequest, NextResponse } from "next/server";
import { connectErrorUrl, missingCredentialsMessage, oauthCredentialsMissing, redirectWithinApp } from "@/lib/publisher/connectStart";
import { linkedinAuthUrl, linkedinRedirectUri } from "@/lib/publisher/linkedinAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (oauthCredentialsMissing("linkedin")) {
    return redirectWithinApp(connectErrorUrl(origin, "linkedin", missingCredentialsMessage("linkedin")));
  }
  try {
    const pages = request.nextUrl.searchParams.get("pages") === "1";
    return NextResponse.redirect(await linkedinAuthUrl(linkedinRedirectUri(origin), { pages }));
  } catch (error) {
    return redirectWithinApp(connectErrorUrl(origin, "linkedin", error instanceof Error ? error.message : String(error)));
  }
}
