export const ACCESS_COOKIE_NAME = "scriptcast_access";

export function accessCode() {
  return process.env.SCRIPTCAST_ACCESS_CODE?.trim() || "";
}

export function isAccessControlEnabled() {
  return accessCode().length > 0;
}

export async function accessTokenForCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
