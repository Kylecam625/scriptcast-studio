import { describe, expect, it } from "vitest";
import { generateMockDialogueChunk, mergeAudioChunks } from "@/lib/audio";
import type { Chunk, Turn } from "@/lib/schemas";

const turns: Turn[] = [
  {
    id: "turn-1",
    order: 1,
    type: "dialogue",
    speakerId: "mara",
    originalText: "We only get one chance to send the signal.",
    ttsText: "[whispers] We only get one chance to send the signal.",
    emotionHint: "tense",
    needsReview: false
  },
  {
    id: "turn-2",
    order: 2,
    type: "dialogue",
    speakerId: "jules",
    originalText: "Then make it loud.",
    ttsText: "Then make it loud.",
    emotionHint: null,
    needsReview: false
  }
];

const chunk: Chunk = {
  id: "chunk-1",
  order: 1,
  turnIds: ["turn-1", "turn-2"],
  charCount: 68,
  uniqueVoiceIds: ["mara", "jules"],
  status: "queued",
  audioPath: null
};

describe("mock audio generation", () => {
  it("generates chunk artifacts and merges them into a final mock MP3 artifact without real APIs", async () => {
    const generated = await generateMockDialogueChunk(chunk, turns, {
      projectId: "project-test"
    });

    expect(generated.status).toBe("complete");
    expect(generated.audioPath).toContain("chunk-1.wav");

    const finalAudioPath = await mergeAudioChunks([generated], {
      projectId: "project-test"
    });

    expect(finalAudioPath).toContain("final.wav");
  });
});
