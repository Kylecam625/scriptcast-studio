import { describe, expect, it } from "vitest";
import { prepareTurnsForDelivery } from "@/lib/generationFlow";
import type { Turn } from "@/lib/schemas";

const enhancedTurns: Turn[] = [
  {
    id: "turn-1",
    order: 1,
    type: "dialogue",
    speakerId: "mara",
    originalText: "Run before the signal dies!",
    ttsText: "[urgent] [radio static] Run before the signal dies!",
    emotionHint: "tense",
    needsReview: false
  },
  {
    id: "turn-2",
    order: 2,
    type: "stage_direction",
    speakerId: null,
    originalText: "Rain hits the antenna.",
    ttsText: "[distant thunder] [rain hits antenna]",
    emotionHint: "sound effect",
    needsReview: false
  }
];

describe("prepareTurnsForDelivery", () => {
  it("resets enhanced text when delivery and sound effects are disabled", () => {
    const prepared = prepareTurnsForDelivery(enhancedTurns, false);

    expect(prepared.map((turn) => turn.ttsText)).toEqual([
      "Run before the signal dies!",
      "Rain hits the antenna."
    ]);
  });

  it("keeps enhanced text when delivery and sound effects are enabled", () => {
    expect(prepareTurnsForDelivery(enhancedTurns, true)).toEqual(enhancedTurns);
  });
});
