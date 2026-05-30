import { afterEach, describe, expect, it, vi } from "vitest";
import { generatorTestUtils } from "@/lib/generator";
import { generateProjectAudio } from "@/lib/generator";
import { createProject } from "@/lib/storage";
import type { ParseResult } from "@/lib/schemas";

const originalEnv = { ...process.env };

describe("generator resilience helpers", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("limits concurrent segment work", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await generatorTestUtils.mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return item * 2;
    });

    expect(results).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("retries retryable ElevenLabs audio failures", async () => {
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    process.env.ELEVENLABS_API_KEY = "xi-test";
    process.env.ELEVENLABS_TIMEOUT_MS = "5000";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 500 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const audio = await generatorTestUtils.requestElevenLabsSegment(
      { type: "sound_effect", turnId: "turn-1", text: "rain on glass" },
      { dialogueModel: "eleven_v3", soundEffectModel: "eleven_text_to_sound_v2" }
    );

    expect(Buffer.from(audio)).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends loop and prompt influence settings for background sound effects", async () => {
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    process.env.ELEVENLABS_API_KEY = "xi-test";
    process.env.ELEVENLABS_TIMEOUT_MS = "5000";

    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await generatorTestUtils.requestElevenLabsSegment(
      {
        type: "sound_effect",
        behavior: "background",
        turnId: "sfx-rain",
        text: "Seamless loop ambience: rain on glass with distant thunder."
      },
      { dialogueModel: "eleven_v3", soundEffectModel: "eleven_text_to_sound_v2" }
    );

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(String(url)).toContain("/v1/sound-generation");
    expect(body).toMatchObject({
      model_id: "eleven_text_to_sound_v2",
      loop: true,
      prompt_influence: 0.35
    });
    expect(body).not.toHaveProperty("duration_seconds");
  });

  it("sends tighter prompt influence and no loop for one-shot sound effects", async () => {
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    process.env.ELEVENLABS_API_KEY = "xi-test";
    process.env.ELEVENLABS_TIMEOUT_MS = "5000";

    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([7, 8, 9]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await generatorTestUtils.requestElevenLabsSegment(
      {
        type: "sound_effect",
        behavior: "one_shot",
        turnId: "sfx-door",
        text: "High-quality professionally recorded foley, one-shot: heavy door slam."
      },
      { dialogueModel: "eleven_v3", soundEffectModel: "eleven_text_to_sound_v2" }
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      loop: false,
      prompt_influence: 0.65
    });
  });

  it("sends contiguous dialogue turns as one Text to Dialogue request with multiple inputs", async () => {
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    process.env.ELEVENLABS_API_KEY = "xi-test";
    process.env.ELEVENLABS_TIMEOUT_MS = "5000";

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          audio_base64: Buffer.from([7, 8, 9]).toString("base64"),
          voice_segments: [
            {
              start_time_seconds: 0,
              end_time_seconds: 0.7,
              dialogue_input_index: 0
            },
            {
              start_time_seconds: 0.7,
              end_time_seconds: 1.4,
              dialogue_input_index: 1
            }
          ]
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const renderPlans = generatorTestUtils.buildRenderPlans([
      { type: "dialogue", turnId: "turn-1", text: "Hello.", voiceId: "voice-a" },
      { type: "dialogue", turnId: "turn-2", text: "Answer me.", voiceId: "voice-b" }
    ]);
    const generated = await generatorTestUtils.requestElevenLabsRenderPlan(renderPlans[0], {
      dialogueModel: "eleven_v3",
      soundEffectModel: "eleven_text_to_sound_v2"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/text-to-dialogue/with-timestamps");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model_id: "eleven_v3",
      inputs: [
        { text: "Hello.", voice_id: "voice-a" },
        { text: "Answer me.", voice_id: "voice-b" }
      ]
    });
    expect(generated.audio).toEqual(Buffer.from([7, 8, 9]));
    expect(generated.turnTimingsById["turn-2"]).toMatchObject({
      startSeconds: 0.7,
      endSeconds: 1.4
    });
  });

  it("does not retry non-retryable ElevenLabs request errors", async () => {
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    process.env.ELEVENLABS_API_KEY = "xi-test";
    process.env.ELEVENLABS_TIMEOUT_MS = "5000";

    const fetchMock = vi.fn().mockResolvedValue(new Response("bad input", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generatorTestUtils.requestElevenLabsSegment(
        { type: "dialogue", turnId: "turn-1", text: "Hello", voiceId: "voice-1" },
        { dialogueModel: "eleven_v3", soundEffectModel: "eleven_text_to_sound_v2" }
      )
    ).rejects.toThrow("ElevenLabs dialogue generation failed with 400: bad input");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-encodes stitched MP3 segments instead of copying compressed frames", () => {
    expect(generatorTestUtils.mp3ConcatArgs("inputs.txt", "out.mp3")).toEqual(
      expect.arrayContaining(["-c:a", "libmp3lame", "-b:a", "128k"])
    );
    expect(generatorTestUtils.mp3ConcatArgs("inputs.txt", "out.mp3")).not.toContain("copy");
  });

  it("queues standalone sound effects as background layers under the next dialogue segment", () => {
    const groups = generatorTestUtils.buildTimelineSegmentGroups([
      {
        turnIds: ["sfx-1"],
        type: "sound_effect",
        behavior: "background",
        audioPath: "sfx-1.mp3",
        durationSeconds: 2.5,
        turnTimingsById: {
          "sfx-1": { startSeconds: 0, endSeconds: 2.5, durationSeconds: 2.5 }
        }
      },
      {
        turnIds: ["line-1"],
        type: "dialogue",
        audioPath: "line-1.mp3",
        durationSeconds: 1.2,
        turnTimingsById: {
          "line-1": { startSeconds: 0, endSeconds: 1.2, durationSeconds: 1.2 }
        }
      }
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("mixed_with_dialogue");
    expect(groups[0].primary.turnIds).toEqual(["line-1"]);
    expect(groups[0].effects.map((effect: { turnIds: string[] }) => effect.turnIds[0])).toEqual(["sfx-1"]);
  });

  it("keeps one-shot effects between dialogue segments as their own timeline beat", () => {
    const groups = generatorTestUtils.buildTimelineSegmentGroups([
      {
        turnIds: ["line-1"],
        type: "dialogue",
        audioPath: "line-1.mp3",
        durationSeconds: 3,
        turnTimingsById: {
          "line-1": { startSeconds: 0, endSeconds: 3, durationSeconds: 3 }
        }
      },
      {
        turnIds: ["sfx-1"],
        type: "sound_effect",
        behavior: "one_shot",
        audioPath: "door-slam.mp3",
        durationSeconds: 0.8,
        turnTimingsById: {
          "sfx-1": { startSeconds: 0, endSeconds: 0.8, durationSeconds: 0.8 }
        }
      },
      {
        turnIds: ["line-2"],
        type: "dialogue",
        audioPath: "line-2.mp3",
        durationSeconds: 2,
        turnTimingsById: {
          "line-2": { startSeconds: 0, endSeconds: 2, durationSeconds: 2 }
        }
      }
    ]);

    expect(groups.map((group) => group.type)).toEqual(["standalone", "standalone", "standalone"]);
    expect(groups[1].primary.turnIds).toEqual(["sfx-1"]);
  });

  it("loops and trims background sound effects to the dialogue duration", () => {
    const args = generatorTestUtils.backgroundSfxMixArgs(
      "dialogue.mp3",
      ["rain.mp3"],
      "out.mp3",
      12.5
    );
    const filter = args[args.indexOf("-filter_complex") + 1];

    expect(filter).toContain("aloop=");
    expect(filter).toContain("atrim=duration=12.500");
    expect(filter).toContain("afade=t=in");
    expect(filter).toContain("afade=t=out");
  });

  it("renders tagged stage directions with extra text as sound effects", () => {
    const plans = generatorTestUtils.buildSegmentPlans(
      [
        {
          id: "turn-1",
          order: 1,
          type: "stage_direction",
          speakerId: null,
          originalText: "Door opens.",
          ttsText: "[door creaks] Door opens slowly.",
          emotionHint: "sound effect",
          needsReview: false
        }
      ],
      []
    );

    expect(plans[0]).toMatchObject({
      type: "sound_effect",
      behavior: "one_shot",
      turnId: "turn-1"
    });
    expect(plans[0].text).toContain("wooden door creaking open");
    expect(plans[0].text).toContain("clearly identifiable sound cues");
    expect(plans[0].text).not.toMatch(/ambience|room tone|hum/i);
  });

  it("builds exact recognizable event prompts from stage directions", () => {
    const plans = generatorTestUtils.buildSegmentPlans(
      [
        {
          id: "turn-1",
          order: 1,
          type: "stage_direction",
          speakerId: null,
          originalText: "The storm fills the room.",
          ttsText: "[rain on glass] [distant thunder] The storm fills the room.",
          emotionHint: "sound effect",
          needsReview: false
        }
      ],
      []
    );

    expect(plans[0]).toMatchObject({
      type: "sound_effect",
      behavior: "one_shot",
      turnId: "turn-1"
    });
    expect(plans[0].text).toContain("distinct raindrops striking glass");
    expect(plans[0].text).toContain("sharp distant thunder crack");
    expect(plans[0].text).toContain("clearly identifiable sound cues");
    expect(plans[0].text).not.toMatch(/seamless|ambience|room tone|hum/i);
  });

  it("turns keys and car starts into concrete recognizable foley", () => {
    const plans = generatorTestUtils.buildSegmentPlans(
      [
        {
          id: "turn-1",
          order: 1,
          type: "stage_direction",
          speakerId: null,
          originalText: "He grabs the keys and starts the car.",
          ttsText: "[keys jingling] [car engine starts] He grabs the keys and starts the car.",
          emotionHint: "sound effect",
          needsReview: false
        }
      ],
      []
    );

    expect(plans[0]).toMatchObject({
      type: "sound_effect",
      behavior: "one_shot",
      turnId: "turn-1"
    });
    expect(plans[0].text).toContain("metal keys jingling sharply");
    expect(plans[0].text).toContain("car ignition turns, engine sputters then starts");
    expect(plans[0].text).not.toMatch(/engine hum|ambience|room tone/i);
  });

  it("keeps ElevenLabs sound-effect prompts under the provider prompt limit", () => {
    const longScene = Array.from({ length: 30 }, () => "metal debris rattles across wet concrete").join(", ");
    const plans = generatorTestUtils.buildSegmentPlans(
      [
        {
          id: "turn-1",
          order: 1,
          type: "stage_direction",
          speakerId: null,
          originalText: longScene,
          ttsText: `[metal debris rattles] ${longScene}`,
          emotionHint: "sound effect",
          needsReview: false
        }
      ],
      []
    );

    expect(plans[0].type).toBe("sound_effect");
    expect(plans[0].text).toHaveLength(450);
  });

  it("marks regeneration jobs as failed when the requested turn id does not exist", async () => {
    const parseResult: ParseResult = {
      title: "Missing Regeneration Target",
      detectedFormat: "screenplay",
      confidence: 1,
      characters: [
        {
          id: "mara",
          name: "Mara",
          aliases: ["MARA"],
          inferredTraits: ["focused"],
          voiceSearchQuery: "focused voice",
          voiceDesignPrompt: "focused voice",
          selectedVoiceId: "voice-mara",
          selectedVoiceName: "Mara Voice"
        }
      ],
      turns: [
        {
          id: "turn-1",
          order: 1,
          type: "dialogue",
          speakerId: "mara",
          originalText: "Hello.",
          ttsText: "Hello.",
          emotionHint: null,
          needsReview: false
        }
      ],
      warnings: []
    };
    const project = await createProject("MARA: Hello.", parseResult);

    const job = await generateProjectAudio({
      projectId: project.id,
      regenerateTurnId: "missing-turn"
    });

    expect(job.status).toBe("error");
    expect(job.error).toContain("Regeneration target was not found");
  });
});
