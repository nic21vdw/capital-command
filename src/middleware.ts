import { NextResponse, type NextRequest } from "next/server";
import { mutationGuardRefuses } from "@/lib/security/mutation-guard";

export function middleware(request: NextRequest) {
  if (mutationGuardRefuses(request)) {
    return NextResponse.json({ error: "Cross-origin mutation refused." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
