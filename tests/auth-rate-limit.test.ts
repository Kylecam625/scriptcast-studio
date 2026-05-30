import { describe, expect, it } from "vitest";
import { authRateLimitTestUtils, checkAuthAttempt, recordFailedAuthAttempt } from "@/lib/authRateLimit";

describe("auth throttling", () => {
  it("blocks repeated bad access-code attempts for the same client", () => {
    authRateLimitTestUtils.reset();

    const clientKey = "127.0.0.1";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(checkAuthAttempt(clientKey, 1000).allowed).toBe(true);
      recordFailedAuthAttempt(clientKey, 1000 + attempt);
    }

    const blocked = checkAuthAttempt(clientKey, 2000);
    expect(blocked).toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number)
    });
  });
});
