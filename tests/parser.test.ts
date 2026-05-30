import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRawScript } from "@/lib/parser";
import { ParseResultSchema } from "@/lib/schemas";
import { sampleScript } from "@/lib/sampleScript";

const originalEnv = { ...process.env };

describe("parseRawScript", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a strict parse result with characters, turns, warnings, and confidence", async () => {
    const result = await parseRawScript(sampleScript);

    const parsed = ParseResultSchema.parse(result);
    expect(parsed.title).toBe("The Rooftop Signal");
    expect(parsed.detectedFormat).toBe("screenplay");
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.7);
    expect(parsed.characters.map((character) => character.name)).toEqual(
      expect.arrayContaining(["Mara", "Jules", "Narrator"])
    );
    expect(parsed.turns.length).toBeGreaterThanOrEqual(5);
    expect(parsed.turns.some((turn) => turn.type === "stage_direction")).toBe(true);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("falls back to rule-based parsing when OpenAI parsing fails", async () => {
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "model unavailable" } }), {
          headers: { "Content-Type": "application/json" },
          status: 500
        })
      )
    );

    const parsed = await parseRawScript("# Fallback\nMARA: Keep going.");

    expect(parsed.title).toBe("Fallback");
    expect(parsed.characters.map((character) => character.name)).toContain("Mara");
    expect(parsed.warnings[0]).toContain("OpenAI parse failed");
  });
});
