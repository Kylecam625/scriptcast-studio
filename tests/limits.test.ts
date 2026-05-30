import { describe, expect, it } from "vitest";
import { MAX_SCRIPT_CHARACTERS, MAX_SCRIPT_FILE_BYTES } from "@/lib/limits";
import { ParseRequestSchema } from "@/lib/schemas";

describe("script input limits", () => {
  it("rejects API parse requests larger than the client editor limit", () => {
    const result = ParseRequestSchema.safeParse({
      rawText: "x".repeat(MAX_SCRIPT_CHARACTERS + 1)
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(MAX_SCRIPT_CHARACTERS.toLocaleString());
  });

  it("keeps the accepted upload file size large enough for max-length text", () => {
    expect(MAX_SCRIPT_FILE_BYTES).toBeGreaterThan(MAX_SCRIPT_CHARACTERS);
  });
});
