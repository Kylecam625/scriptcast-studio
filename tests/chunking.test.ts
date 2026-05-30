import { describe, expect, it } from "vitest";
import { chunkTurnsForDialogue } from "@/lib/chunker";
import type { Turn } from "@/lib/schemas";

const makeTurn = (order: number, speakerId: string, length = 120): Turn => ({
  id: `turn-${order}`,
  order,
  type: "dialogue",
  speakerId,
  originalText: `${speakerId} `.repeat(Math.ceil(length / (speakerId.length + 1))).slice(0, length),
  ttsText: `${speakerId} `.repeat(Math.ceil(length / (speakerId.length + 1))).slice(0, length),
  emotionHint: null,
  needsReview: false
});

const makeTaggedStageDirection = (order: number, ttsText: string): Turn => ({
  id: `sd-${order}`,
  order,
  type: "stage_direction",
  speakerId: null,
  originalText: ttsText,
  ttsText,
  emotionHint: null,
  needsReview: false
});

describe("chunkTurnsForDialogue", () => {
  it("keeps chunks at or below 1800 characters and 10 unique voices", () => {
    const turns = Array.from({ length: 36 }, (_, index) =>
      makeTurn(index + 1, `voice-${(index % 12) + 1}`, 115)
    );

    const chunks = chunkTurnsForDialogue(turns, {
      maxChars: 1800,
      maxUniqueVoices: 10
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.charCount).toBeLessThanOrEqual(1800);
      expect(chunk.uniqueVoiceIds.length).toBeLessThanOrEqual(10);
      expect(chunk.turnIds.length).toBeGreaterThan(0);
    }
  });

  it("keeps tagged stage directions with no speaker", () => {
    const turns: Turn[] = [
      makeTurn(1, "narrator"),
      makeTaggedStageDirection(2, "[distant thunder]"),
      makeTaggedStageDirection(3, "[radio static]"),
      makeTurn(4, "narrator")
    ];

    const chunks = chunkTurnsForDialogue(turns, {
      maxChars: 1800,
      maxUniqueVoices: 10
    });

    const turnIds = chunks.flatMap((chunk) => chunk.turnIds);
    expect(turnIds).toContain("sd-2");
    expect(turnIds).toContain("sd-3");
  });

  it("keeps tagged stage directions that include extra descriptive text", () => {
    const turns: Turn[] = [
      makeTurn(1, "narrator"),
      makeTaggedStageDirection(2, "[door creaks] The door opens slowly."),
      makeTurn(3, "narrator")
    ];

    const chunks = chunkTurnsForDialogue(turns, {
      maxChars: 1800,
      maxUniqueVoices: 10
    });

    expect(chunks.flatMap((chunk) => chunk.turnIds)).toContain("sd-2");
    expect(chunks[0].uniqueVoiceIds).toContain("__sfx__");
  });
});
