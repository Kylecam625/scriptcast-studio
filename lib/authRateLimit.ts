const AUTH_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_AUTH_ATTEMPTS = 5;

type AttemptDecision =
  | { allowed: true; retryAfterSeconds: null }
  | { allowed: false; retryAfterSeconds: number };

const failedAttemptsByClient = new Map<string, number[]>();

export function checkAuthAttempt(clientKey: string, now = Date.now()): AttemptDecision {
  const attempts = recentFailures(clientKey, now);
  if (attempts.length < MAX_FAILED_AUTH_ATTEMPTS) {
    return { allowed: true, retryAfterSeconds: null };
  }

  const oldest = attempts[0];
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + AUTH_ATTEMPT_WINDOW_MS - now) / 1000))
  };
}

export function recordFailedAuthAttempt(clientKey: string, now = Date.now()) {
  const attempts = recentFailures(clientKey, now);
  attempts.push(now);
  failedAttemptsByClient.set(clientKey, attempts);
}

export function recordSuccessfulAuthAttempt(clientKey: string) {
  failedAttemptsByClient.delete(clientKey);
}

function recentFailures(clientKey: string, now: number) {
  const cutoff = now - AUTH_ATTEMPT_WINDOW_MS;
  const attempts = (failedAttemptsByClient.get(clientKey) || []).filter((timestamp) => timestamp > cutoff);
  failedAttemptsByClient.set(clientKey, attempts);
  return attempts;
}

export const authRateLimitTestUtils = {
  reset() {
    failedAttemptsByClient.clear();
  }
};
