import { createHash, randomUUID } from "node:crypto";

export const STORAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,96}$/;

export function createId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

export function assertStorageId(value: string, label = "Storage id") {
  if (!STORAGE_ID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function slugId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);

  if (slug) {
    return slug;
  }

  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}
