import { describe, expect, it } from "vitest";
import {
  findProjectBlockingIssues,
  maxReachableStep,
  rankVoicesForCharacter
} from "@/lib/workflow";
import type { Character, Project, Turn, VoiceOption } from "@/lib/schemas";

function character(patch: Partial<Character> = {}): Character {
  return {
    id: patch.id || "mara",
    name: patch.name ?? "Mara",
    aliases: patch.aliases || ["MARA"],
    inferredTraits: patch.inferredTraits || ["urgent", "focused", "survival drama"],
    voiceSearchQuery: patch.voiceSearchQuery || "urgent focused dramatic adult woman",
    voiceDesignPrompt: patch.voiceDesignPrompt || "A focused dramatic adult voice.",
    selectedVoiceId: patch.selectedVoiceId ?? null,
    selectedVoiceName: patch.selectedVoiceName ?? null
  };
}

function turn(patch: Partial<Turn> = {}): Turn {
  return {
    id: patch.id || "turn-1",
    order: patch.order ?? 1,
    type: patch.type || "dialogue",
    speakerId: patch.speakerId === undefined ? "mara" : patch.speakerId,
    originalText: patch.originalText ?? "We only get one chance.",
    ttsText: patch.ttsText ?? "We only get one chance.",
    emotionHint: patch.emotionHint ?? null,
    needsReview: patch.needsReview ?? false
  };
}

function project(patch: Partial<Project> = {}): Project {
  const characters = patch.characters || [character()];
  const turns = patch.turns || [turn()];
  return {
    id: patch.id || "project_1",
    title: patch.title || "Signal",
    sourceMode: patch.sourceMode || "raw_script",
    sourceIdea: patch.sourceIdea ?? null,
    rawText: patch.rawText ?? "MARA: We only get one chance.",
    parseResult:
      patch.parseResult ||
      {
        title: "Signal",
        detectedFormat: "screenplay",
        confidence: 0.9,
        characters,
        turns,
        warnings: []
      },
    characters,
    turns,
    chunks: patch.chunks || [],
    finalAudioPath: patch.finalAudioPath ?? null,
    captions: patch.captions || [],
    artifacts: patch.artifacts || [],
    createdAt: patch.createdAt || "2026-01-01T00:00:00.000Z",
    updatedAt: patch.updatedAt || "2026-01-01T00:00:00.000Z"
  };
}

describe("workflow helpers", () => {
  it("gates workflow steps by completed production prerequisites", () => {
    expect(maxReachableStep(null)).toBe(0);
    expect(maxReachableStep(project())).toBe(2);
    expect(
      maxReachableStep(
        project({
          characters: [character({ selectedVoiceId: "voice-1", selectedVoiceName: "Voice 1" })]
        })
      )
    ).toBe(3);
    expect(
      maxReachableStep(
        project({
          characters: [character({ selectedVoiceId: "voice-1", selectedVoiceName: "Voice 1" })],
          finalAudioPath: "/project/final.mp3"
        })
      )
    ).toBe(4);
  });

  it("blocks generation when editable project data is invalid", () => {
    const issues = findProjectBlockingIssues({
      characters: [
        character({ id: "empty-name", name: "   ", selectedVoiceId: "voice-1" }),
        character({ id: "mara", selectedVoiceId: null })
      ],
      turns: [
        turn({ id: "blank-turn", order: 1, originalText: " ", ttsText: " " }),
        turn({ id: "missing-speaker", order: 2, speakerId: null, type: "dialogue" })
      ]
    });

    expect(issues).toEqual([
      "Character 1 needs a name.",
      "Mara needs a selected voice.",
      "Line 1 needs text.",
      "Line 2 needs a speaker."
    ]);
  });

  it("does not require a voice for characters that are not used by generated turns", () => {
    const issues = findProjectBlockingIssues({
      characters: [
        character({ id: "mara", selectedVoiceId: "voice-mara" }),
        character({ id: "unused", name: "Unused", selectedVoiceId: null })
      ],
      turns: [turn({ speakerId: "mara" })]
    });

    expect(issues).toEqual([]);
  });

  it("ranks available live voices against character intent", () => {
    const voices: VoiceOption[] = [
      {
        voiceId: "voice-calm",
        name: "Calm Educator",
        description: "Neutral instructional delivery.",
        category: "professional",
        previewUrl: null,
        labels: { style: "calm", age: "adult" }
      },
      {
        voiceId: "voice-urgent",
        name: "Focused Dramatic Lead",
        description: "Urgent cinematic adult woman with tense delivery.",
        category: "professional",
        previewUrl: "https://example.com/voice.mp3",
        labels: { style: "dramatic", gender: "female" }
      }
    ];

    expect(rankVoicesForCharacter(character(), voices).map((voice) => voice.voiceId)).toEqual([
      "voice-urgent",
      "voice-calm"
    ]);
  });
});
