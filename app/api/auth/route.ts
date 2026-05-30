import { NextResponse } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE_NAME, accessCode, accessTokenForCode, isAccessControlEnabled } from "@/lib/auth";
import { checkAuthAttempt, recordFailedAuthAttempt, recordSuccessfulAuthAttempt } from "@/lib/authRateLimit";

export const runtime = "nodejs";

const AuthRequestSchema = z.object({
  accessCode: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    if (!isAccessControlEnabled()) {
      return NextResponse.json({ ok: true });
    }

    const clientKey = authClientKey(request);
    const rateLimit = checkAuthAttempt(clientKey);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many incorrect access code attempts. Try again soon." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds)
          }
        }
      );
    }

    const payload = AuthRequestSchema.parse(await request.json());
    if (payload.accessCode.trim() !== accessCode()) {
      recordFailedAuthAttempt(clientKey);
      return NextResponse.json({ error: "Access code is incorrect." }, { status: 401 });
    }

    recordSuccessfulAuthAttempt(clientKey);
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: ACCESS_COOKIE_NAME,
      value: await accessTokenForCode(accessCode()),
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to verify access code."
      },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 0
  });
  return response;
}

function isSecureRequest(request: Request) {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

function authClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "local"
  );
}
