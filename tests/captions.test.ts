import { describe, expect, it } from "vitest";
import { buildCaptionCues, captionsToVtt } from "@/lib/captions";
import type { Character, Turn } from "@/lib/schemas";

const characters: Character[] = [
  {
    id: "narrator",
    name: "Narrator",
    aliases: ["NARRATOR"],
    inferredTraits: ["steady"],
    voiceSearchQuery: "narrator",
    voiceDesignPrompt: "steady narrator",
    selectedVoiceId: "voice-narrator",
    selectedVoiceName: "Narrator Voice"
  },
  {
    id: "mara",
    name: "Mara",
    aliases: ["MARA"],
    inferredTraits: ["tense"],
    voiceSearchQuery: "mara",
    voiceDesignPrompt: "tense lead",
    selectedVoiceId: "voice-mara",
    selectedVoiceName: "Mara Voice"
  }
];

const turns: Turn[] = [
  {
    id: "turn-1",
    order: 1,
    type: "stage_direction",
    speakerId: "narrator",
    originalText: "Radio static crackles.",
    ttsText: "[radio static]",
    emotionHint: "sound effect",
    needsReview: false
  },
  {
    id: "turn-2",
    order: 2,
    type: "dialogue",
    speakerId: "mara",
    originalText: "We have one shot.",
    ttsText: "[whispering] We have one shot.",
    emotionHint: "tense",
    needsReview: false
  }
];

describe("captions", () => {
  it("builds timed, speaker-colored captions and VTT without exposing delivery tags as dialogue", () => {
    const captions = buildCaptionCues(turns, characters);

    expect(captions).toHaveLength(2);
    expect(captions[0].text).toBe("SFX: radio static");
    expect(captions[1].text).toBe("We have one shot.");
    expect(captions[1].speakerName).toBe("Mara");
    expect(captions[1].color).not.toBe(captions[0].color);
    expect(captions[1].start).toBeGreaterThan(captions[0].start);

    const vtt = captionsToVtt(captions);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("Mara: We have one shot.");
  });

  it("uses absolute timing hints so sound effects can overlap dialogue captions", () => {
    const captions = buildCaptionCues(turns, characters, {
      "turn-1": { start: 0, end: 2.4 },
      "turn-2": { start: 0, end: 1.1 }
    } as never);

    expect(captions[0]).toMatchObject({ turnId: "turn-1", start: 0, end: 2.4 });
    expect(captions[1]).toMatchObject({ turnId: "turn-2", start: 0, end: 1.1 });
  });
});
