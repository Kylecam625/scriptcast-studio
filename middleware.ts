import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, accessCode, accessTokenForCode, isAccessControlEnabled } from "@/lib/auth";

const PUBLIC_PATHS = ["/unlock", "/api/auth"];

export async function middleware(request: NextRequest) {
  if (!isAccessControlEnabled() || isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const expectedToken = await accessTokenForCode(accessCode());
  const actualToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value || "";
  if (actualToken === expectedToken) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Access code required." }, { status: 401 });
  }

  const unlockUrl = request.nextUrl.clone();
  unlockUrl.pathname = "/unlock";
  unlockUrl.search = "";
  unlockUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"]
};

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
