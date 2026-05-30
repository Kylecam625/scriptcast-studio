import { describe, expect, it } from "vitest";
import { enhanceTurnsWithDelivery } from "@/lib/parser";
import type { Turn } from "@/lib/schemas";

const turns: Turn[] = [
  {
    id: "turn-1",
    order: 1,
    type: "stage_direction",
    speakerId: "narrator",
    originalText: "The antenna spits radio static in the storm.",
    ttsText: "The antenna spits radio static in the storm.",
    emotionHint: "scene direction",
    needsReview: false
  },
  {
    id: "turn-2",
    order: 2,
    type: "dialogue",
    speakerId: "mara",
    originalText: "Run before the signal dies!",
    ttsText: "Run before the signal dies!",
    emotionHint: "tense",
    needsReview: false
  }
];

describe("enhanceTurnsWithDelivery", () => {
  it("adds richer ElevenLabs tags and converts stage directions into sound events", async () => {
    const enhanced = await enhanceTurnsWithDelivery(turns, "Cinematic", true);

    expect(enhanced[0].ttsText).toMatch(/^\[[^\]]+]/);
    expect(enhanced[0].ttsText).toContain("radio static");
    expect(enhanced[1].ttsText).toContain("Run before the signal dies!");
    expect(enhanced[1].ttsText.match(/\[[^\]]+]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("uses concrete recognizable SFX tags instead of generic hums", async () => {
    const enhanced = await enhanceTurnsWithDelivery(
      [
        {
          id: "turn-keys",
          order: 1,
          type: "stage_direction",
          speakerId: null,
          originalText: "Keys jingle as the car starts.",
          ttsText: "Keys jingle as the car starts.",
          emotionHint: "sound effect",
          needsReview: false
        }
      ],
      "Cinematic",
      true
    );

    expect(enhanced[0].ttsText).toContain("[keys jingling]");
    expect(enhanced[0].ttsText).toContain("[car engine starts]");
    expect(enhanced[0].ttsText).not.toMatch(/hum|room tone|ambience/i);
  });
});
