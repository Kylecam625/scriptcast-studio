import { afterEach, describe, expect, it, vi } from "vitest";
import { searchVoices } from "@/lib/voices";

const originalEnv = { ...process.env };

describe("searchVoices", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns selectable voice IDs from the available voice list in mock mode", async () => {
    const voices = await searchVoices("");

    expect(voices.length).toBeGreaterThanOrEqual(3);
    expect(voices.every((voice) => voice.voiceId && voice.name)).toBe(true);
    expect(voices.map((voice) => voice.name)).toEqual(
      expect.arrayContaining(["Mara - Focused Alto", "Jules - Bright Tenor"])
    );
  });

  it("maps live ElevenLabs voice payloads through a typed schema", async () => {
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    process.env.ELEVENLABS_API_KEY = "xi-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            voices: [
              {
                voice_id: "voice-live-1",
                name: "Live Voice",
                description: "A real selectable voice.",
                category: "professional",
                preview_url: "https://example.com/preview.mp3",
                labels: { accent: "American", use_case: "dialogue" }
              }
            ]
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200
          }
        )
      )
    );

    const voices = await searchVoices("live");

    expect(voices).toEqual([
      {
        voiceId: "voice-live-1",
        name: "Live Voice",
        description: "A real selectable voice.",
        category: "professional",
        previewUrl: "https://example.com/preview.mp3",
        labels: { accent: "American", use_case: "dialogue" }
      }
    ]);
  });
});
