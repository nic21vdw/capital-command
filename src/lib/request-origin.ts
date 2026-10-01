import type { NextRequest } from "next/server";

export function allowsRequestOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("host") ?? request.nextUrl.host;
    const expected = new URL(`${request.nextUrl.protocol}//${host}`).origin;
    return origin === expected;
  } catch {
    return false;
  }
}
