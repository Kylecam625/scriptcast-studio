import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { chunkTurnsForDialogue } from "@/lib/chunker";
import { buildCaptionCues, captionsToVtt, isCaptionableTurn } from "@/lib/captions";
import type { CaptionTimingHint } from "@/lib/captions";
import { generateMockDialogueChunk, mergeAudioChunks } from "@/lib/audio";
import {
  elevenLabsApiKey,
  elevenLabsDialogueModel,
  elevenLabsMaxConcurrency,
  elevenLabsMockMode,
  elevenLabsSoundEffectModel,
  elevenLabsTimeoutMs,
  ffmpegPath,
  ffprobePath,
  mediaToolTimeoutMs,
  soundEffectBackgroundVolume
} from "@/lib/env";
import {
  buildProjectArtifact,
  createJob,
  getProject,
  getStorageRoot,
  saveJob,
  saveProject,
  upsertArtifacts,
  writeProjectArtifact
} from "@/lib/storage";
import { Character, Chunk, DeliveryPreset, GenerateJob, ProjectArtifact, Turn } from "@/lib/schemas";

type GenerateOptions = {
  projectId: string;
  characters?: Character[];
  turns?: Turn[];
  preset?: DeliveryPreset;
  regenerateChunkId?: string;
  regenerateTurnId?: string;
};

type GenerationScheduler = (task: () => Promise<void>) => void;

type GeneratedChunkResult = {
  chunk: Chunk;
  artifacts: ProjectArtifact[];
  turnDurationsById: Record<string, number>;
  segmentTimings: SegmentTiming[];
};

type SegmentPlan = {
  type: "dialogue" | "sound_effect";
  turnId: string;
  text: string;
  voiceId?: string;
  behavior?: SoundEffectBehavior;
};

type SoundEffectBehavior = "background" | "one_shot";

type DialogueInputPlan = {
  turnId: string;
  text: string;
  voiceId: string;
};

type RenderPlan =
  | {
      type: "dialogue";
      turnIds: string[];
      inputs: DialogueInputPlan[];
    }
  | {
      type: "sound_effect";
      turnId: string;
      text: string;
      behavior: SoundEffectBehavior;
    };

type RenderAudioResult = {
  audio: Buffer;
  turnTimingsById: Record<string, TurnTiming>;
};

type RenderGenerationResult = {
  turnIds: string[];
  type: SegmentPlan["type"];
  behavior?: SoundEffectBehavior;
  audioPath: string;
  durationSeconds: number;
  turnTimingsById: Record<string, TurnTiming>;
};

type TimelineSegmentGroup =
  | {
      type: "standalone";
      primary: RenderGenerationResult;
      effects: [];
    }
  | {
      type: "mixed_with_dialogue";
      primary: RenderGenerationResult;
      effects: RenderGenerationResult[];
    };

type TimelineAudioSegment = {
  type: TimelineSegmentGroup["type"];
  audioPath: string;
  durationSeconds: number;
  sourceSegments: RenderGenerationResult[];
};

type TurnTiming = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

type SegmentTiming = {
  chunkId: string;
  chunkOrder: number;
  segmentIndex: number;
  turnId: string;
  type: SegmentPlan["type"];
  audioPath: string;
  durationSeconds: number;
  startSeconds: number;
  endSeconds: number;
};

const DIALOGUE_WITH_TIMESTAMPS_ENDPOINT =
  "https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps?output_format=mp3_44100_128";
const SOUND_EFFECT_ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation";
const AUDIO_FORMAT = "mp3_44100_128";
const SOUND_EFFECT_PROMPT_LIMIT = 450;
const BACKGROUND_PROMPT_INFLUENCE = 0.35;
const ONE_SHOT_PROMPT_INFLUENCE = 0.65;
const MIN_TURN_DURATION_SECONDS = 0.2;
const ELEVENLABS_MAX_ATTEMPTS = 3;
const ELEVENLABS_RETRY_BASE_MS = 250;
const activeProjectGenerations = new Set<string>();

const DialogueWithTimestampsResponseSchema = z.object({
  audio_base64: z.string().min(1),
  voice_segments: z
    .array(
      z.object({
        start_time_seconds: z.number(),
        end_time_seconds: z.number(),
        dialogue_input_index: z.number().int()
      })
    )
    .optional()
    .default([])
});

export async function generateProjectAudio(options: GenerateOptions): Promise<GenerateJob> {
  const job = await createJob(options.projectId);
  return runProjectAudioGeneration(options, job);
}

export async function startProjectAudioGeneration(
  options: GenerateOptions,
  schedule: GenerationScheduler = scheduleDetachedGeneration
): Promise<GenerateJob> {
  const job = await createJob(options.projectId);
  if (activeProjectGenerations.has(options.projectId)) {
    return saveJob({
      ...job,
      status: "error",
      progress: 100,
      message: "Generation is already running for this project.",
      error: "Wait for the current generation to finish before starting another one."
    });
  }

  activeProjectGenerations.add(options.projectId);
  try {
    schedule(async () => {
      await runProjectAudioGeneration(options, job, true);
    });
  } catch (error) {
    activeProjectGenerations.delete(options.projectId);
    return saveJob({
      ...job,
      status: "error",
      progress: 100,
      message: "Generation failed to start.",
      error: error instanceof Error ? error.message : "Unable to schedule audio generation."
    });
  }
  return job;
}

async function runProjectAudioGeneration(
  options: GenerateOptions,
  initialJob: GenerateJob,
  alreadyClaimed = false
): Promise<GenerateJob> {
  let job = initialJob;
  if (!alreadyClaimed && activeProjectGenerations.has(options.projectId)) {
    return saveJob({
      ...job,
      status: "error",
      progress: 100,
      message: "Generation is already running for this project.",
      error: "Wait for the current generation to finish before starting another one."
    });
  }

  if (!alreadyClaimed) {
    activeProjectGenerations.add(options.projectId);
  }

  try {
    job = await saveJob({
      ...job,
      status: "running",
      progress: 8,
      message: "Preparing dialogue chunks."
    });

    const project = await getProject(options.projectId);
    const characters = options.characters || project.characters;
    const turns = options.turns || project.turns;
    let artifacts = [...project.artifacts];
    const voiceMap = Object.fromEntries(
      characters.map((character) => [
        character.id,
        character.selectedVoiceId || character.id
      ])
    );

    const chunks = chunkTurnsForDialogue(turns, {
      maxChars: 1800,
      maxUniqueVoices: 10,
      voiceIdBySpeakerId: voiceMap
    });

    const targets = selectChunksForGeneration(chunks, options);
    if ((options.regenerateChunkId || options.regenerateTurnId) && targets.size === 0) {
      throw new Error("Regeneration target was not found. Refresh the project and choose an existing chunk or line.");
    }
    const existingById = new Map(project.chunks.map((chunk) => [chunk.id, chunk]));
    const generatedChunks: Chunk[] = [];
    const turnDurationsById: Record<string, number> = {};
    const segmentTimings: SegmentTiming[] = [];

    for (const [index, chunk] of chunks.entries()) {
      const shouldGenerate = targets.has(chunk.id) || !existingById.get(chunk.id)?.audioPath;
      if (!shouldGenerate && existingById.has(chunk.id)) {
        generatedChunks.push(existingById.get(chunk.id)!);
        continue;
      }

      const nextChunk = { ...chunk, status: "generating" as const };
      job = await saveJob({
        ...job,
        chunks: [...generatedChunks, nextChunk],
        progress: Math.min(88, 20 + Math.round((index / Math.max(chunks.length, 1)) * 60)),
        message: `Generating chunk ${chunk.order} of ${chunks.length}.`
      });

      const chunkTurns = turns.filter((turn) => chunk.turnIds.includes(turn.id));
      const generated = await generateDialogueChunk(nextChunk, chunkTurns, characters, options.projectId);
      generatedChunks.push(generated.chunk);
      for (const [turnId, duration] of Object.entries(generated.turnDurationsById)) {
        turnDurationsById[turnId] = (turnDurationsById[turnId] || 0) + duration;
      }
      segmentTimings.push(...generated.segmentTimings);
      artifacts = upsertArtifacts(artifacts, generated.artifacts);
    }

    job = await saveJob({
      ...job,
      chunks: generatedChunks,
      progress: 92,
      message: "Merging chunks with FFmpeg-compatible output."
	    });
    const finalAudioPath = await mergeDialogueChunks(generatedChunks, options.projectId);
    const turnDurationHints = await buildTurnDurationHints(turns, generatedChunks, turnDurationsById);
    const turnTimingHints = await buildAbsoluteTurnTimingHints(turns, generatedChunks, segmentTimings);
    const captions = buildCaptionCues(turns, characters, {
      ...turnDurationHints,
      ...turnTimingHints
    });
    const generationArtifacts = await writeGenerationArtifacts({
      projectId: options.projectId,
      preset: options.preset || "Natural",
      turns,
      chunks: generatedChunks,
      finalAudioPath,
      captions,
      segmentTimings
    });
    artifacts = upsertArtifacts(artifacts, generationArtifacts);

    const manifestArtifact = await writeProjectArtifact(
      options.projectId,
      "manifest.json",
      JSON.stringify(
        {
          projectId: project.id,
          title: project.title,
          sourceMode: project.sourceMode,
          preset: options.preset || "Natural",
          characters: characters.map((character) => ({
            id: character.id,
            name: character.name,
            voiceId: character.selectedVoiceId,
            voiceName: character.selectedVoiceName
          })),
          chunks: generatedChunks,
          captions,
          segmentTimings,
          artifacts: artifacts.map((artifact) => ({
            id: artifact.id,
            label: artifact.label,
            kind: artifact.kind,
            path: artifact.path,
            mimeType: artifact.mimeType,
            sizeBytes: artifact.sizeBytes
          }))
        },
        null,
        2
      ),
      {
        id: "artifact-manifest",
        label: "Project manifest",
        kind: "manifest",
        mimeType: "application/json; charset=utf-8"
      }
    );
    artifacts = upsertArtifacts(artifacts, [manifestArtifact]);

    await saveProject({
      ...project,
      characters,
      turns,
      chunks: generatedChunks,
      finalAudioPath,
      captions,
      artifacts
    });

    return saveJob({
      ...job,
      status: "complete",
      progress: 100,
      message: "Final audio is ready.",
      chunks: generatedChunks,
      finalAudioPath,
      error: null
    });
  } catch (error) {
    return saveJob({
      ...job,
      status: "error",
      progress: 100,
      message: "Generation failed.",
      error: error instanceof Error ? error.message : "Unknown generation error."
    });
  } finally {
    activeProjectGenerations.delete(options.projectId);
  }
}

function scheduleDetachedGeneration(task: () => Promise<void>) {
  void task();
}

function selectChunksForGeneration(chunks: Chunk[], options: GenerateOptions) {
  if (!options.regenerateChunkId && !options.regenerateTurnId) {
    return new Set(chunks.map((chunk) => chunk.id));
  }

  return new Set(
    chunks
      .filter((chunk) => {
        if (options.regenerateChunkId) {
          return chunk.id === options.regenerateChunkId;
        }
        return options.regenerateTurnId ? chunk.turnIds.includes(options.regenerateTurnId) : false;
      })
      .map((chunk) => chunk.id)
  );
}

async function generateDialogueChunk(
  chunk: Chunk,
  turns: Turn[],
  characters: Character[],
  projectId: string
): Promise<GeneratedChunkResult> {
  const segmentPlans = buildSegmentPlans(turns, characters);
  if (!segmentPlans.length) {
    throw new Error(`Chunk ${chunk.id} has no valid turns to render.`);
  }
  const renderPlans = buildRenderPlans(segmentPlans);

  const dialogueModel = elevenLabsDialogueModel();
  const soundEffectModel = elevenLabsSoundEffectModel();
  const payloadArtifact = await writeProjectArtifact(
    projectId,
    `chunks/${chunk.id}.dialogue.json`,
    JSON.stringify(
      {
        dialogueModel,
        soundEffectModel,
        outputFormat: AUDIO_FORMAT,
        segmentPlans,
        renderPlans
      },
      null,
      2
    ),
    {
      id: `artifact-dialogue-payload-${chunk.id}`,
      label: `Chunk ${chunk.order} dialogue payload`,
      kind: "dialogue_payload",
      mimeType: "application/json; charset=utf-8"
    }
  );

  if (shouldUseMockAudio()) {
    const generated = await generateMockDialogueChunk(chunk, turns, { projectId });
    return {
      chunk: generated,
      turnDurationsById: {},
      segmentTimings: [],
      artifacts: [
        payloadArtifact,
	        await buildProjectArtifact(projectId, generated.audioPath!, {
	          id: `artifact-chunk-audio-${chunk.id}`,
	          label: `Chunk ${chunk.order} audio`,
	          kind: "chunk_audio",
	          mimeType: audioMimeType(generated.audioPath!)
	        })
      ]
    };
  }

  const chunkDir = path.join(getStorageRoot(), "projects", projectId, "chunks");
  await mkdir(chunkDir, { recursive: true });

  const generatedSegments = await mapWithConcurrency(
    renderPlans,
    elevenLabsMaxConcurrency(),
    async (plan, index): Promise<RenderGenerationResult> => {
      const segmentPath = path.join(chunkDir, `${chunk.id}.${index}-${renderPlanFileToken(plan)}.mp3`);
      const generatedAudio = await requestElevenLabsRenderPlan(plan, { dialogueModel, soundEffectModel });
      await writeFile(segmentPath, generatedAudio.audio);

      const durationSeconds = Math.max(0.01, await getAudioDurationSeconds(segmentPath));
      const turnTimingsById = normalizeTurnTimings(plan, generatedAudio.turnTimingsById, durationSeconds);
	      return {
	        turnIds: renderPlanTurnIds(plan),
	        type: plan.type,
	        behavior: plan.type === "sound_effect" ? plan.behavior : undefined,
	        audioPath: segmentPath,
	        durationSeconds,
	        turnTimingsById
      };
    }
  );

  const timelineSegments = await renderTimelineAudioSegments(
    buildTimelineSegmentGroups(generatedSegments),
    chunkDir,
    chunk.id
  );
  const segmentPaths = timelineSegments.map((entry) => entry.audioPath);
  const turnDurationsById: Record<string, number> = {};
  const segmentTimings: SegmentTiming[] = [];
  let segmentOffset = 0;
	  for (const [segmentIndex, segment] of timelineSegments.entries()) {
	    for (const sourceSegment of segment.sourceSegments) {
	      for (const turnId of sourceSegment.turnIds) {
	        const timing = clampTurnTiming(
	          resolveTimelineTurnTiming(sourceSegment, turnId, segment),
	          segment.durationSeconds
	        );
        turnDurationsById[turnId] = (turnDurationsById[turnId] || 0) + timing.durationSeconds;
        segmentTimings.push({
          chunkId: chunk.id,
          chunkOrder: chunk.order,
          segmentIndex,
          turnId,
          type: sourceSegment.type,
          audioPath: segment.audioPath,
          durationSeconds: timing.durationSeconds,
          startSeconds: segmentOffset + timing.startSeconds,
          endSeconds: segmentOffset + timing.endSeconds
        });
      }
    }
    segmentOffset += segment.durationSeconds;
  }

  const audioPath = path.join(chunkDir, `${chunk.id}.mp3`);
  await concatenateAudioSegmentFiles(segmentPaths, audioPath);

  const generated = {
    ...chunk,
    status: "complete" as const,
    audioPath
  };

  return {
    chunk: generated,
    turnDurationsById,
    segmentTimings,
    artifacts: [
      payloadArtifact,
      await buildProjectArtifact(projectId, audioPath, {
        id: `artifact-chunk-audio-${chunk.id}`,
        label: `Chunk ${chunk.order} audio`,
        kind: "chunk_audio",
        mimeType: "audio/mpeg"
      })
    ]
  };
}

function buildSegmentPlans(turns: Turn[], characters: Character[]): SegmentPlan[] {
  const voiceMap = Object.fromEntries(
    characters.map((character) => [
      character.id,
      character.selectedVoiceId || character.id
    ])
  );

  return turns.flatMap((turn): SegmentPlan[] => {
    const tags = extractAudioTags(turn.ttsText);
    const spokenText = stripAudioTags(turn.ttsText).trim();
    const isTaggedStageDirection = turn.type === "stage_direction" && Boolean(tags.length);

    if (isTaggedStageDirection) {
      const prompt = makeSoundEffectPrompt([...tags, spokenText]);
      if (prompt) {
        return [
          {
            type: "sound_effect",
            behavior: classifySoundEffectPrompt(prompt),
            turnId: turn.id,
            text: prompt
          }
        ];
      }
      return [];
    }

    const voiceId = turn.speakerId ? voiceMap[turn.speakerId] : null;
    if (!voiceId || !turn.ttsText.trim()) {
      return [];
    }

    return [
      {
        type: "dialogue",
        turnId: turn.id,
        text: turn.ttsText,
        voiceId
      }
    ];
  });
}

function makeSoundEffectPrompt(tags: string[]) {
  const parts = uniqueSoundEffectParts(tags);
  if (!parts.length) {
    return null;
  }

  const description = parts.join("; ");
  const sentence = description.endsWith(".") ? description : `${description}.`;
  const behavior = classifySoundEffectPrompt(description);
  const prompt = behavior === "background"
    ? `Specific continuous environmental sound: ${sentence} Clearly identifiable source details and natural dynamics; avoid vague noise beds, music, and speech.`
    : isSequentialSoundEffect(description)
      ? `Specific timed foley sequence: ${sentence} Clear event order, crisp transients, and identifiable source sounds; avoid vague noise beds, music, and speech.`
      : `Specific recognizable foley events: ${sentence} Isolated, close-mic, clearly identifiable sound cues with crisp transients; avoid vague noise beds, music, and speech.`;

  return clampSoundEffectPrompt(prompt);
}

function uniqueSoundEffectParts(tags: string[]) {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const tag of tags) {
    const cleaned = concretizeSoundEffectPart(cleanSoundEffectPart(tag));
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    parts.push(cleaned);
  }

  return parts;
}

function cleanSoundEffectPart(part: string) {
  return part
    .replace(/\[[^\]]+]/g, " ")
    .replace(/^[A-Z][A-Z0-9 _-]{1,30}:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function concretizeSoundEffectPart(part: string) {
  const normalized = part.toLowerCase();

  if (!normalized || /\b(room tone|ambience|ambiance|background noise|low hum|nearby machinery hum)\b/.test(normalized)) {
    return null;
  }

  if (/\bkey|jingle/.test(normalized)) {
    return "metal keys jingling sharply";
  }

  if (/\b(car|truck|engine|motor|ignition)\b|starts? the car/.test(normalized)) {
    return "car ignition turns, engine sputters then starts";
  }

  if (/door|creak|hinge|handle/.test(normalized)) {
    return "wooden door creaking open";
  }

  if (/rain.*glass|glass.*rain/.test(normalized)) {
    return "distinct raindrops striking glass";
  }

  if (/rain.*(metal|antenna|roof)|antenna.*rain|roof.*rain/.test(normalized)) {
    return "distinct raindrops striking metal";
  }

  if (/rain|storm/.test(normalized)) {
    return "distinct raindrops striking glass";
  }

  if (/thunder|lightning|rumble/.test(normalized)) {
    return "sharp distant thunder crack";
  }

  if (/radio|static|signal|transmission|antenna/.test(normalized)) {
    return "crackling radio static bursts";
  }

  if (/glass|window|shatter/.test(normalized)) {
    return "sharp glass rattle";
  }

  if (/footstep|walk|run|stairs|hall/.test(normalized)) {
    return /metal|stair/.test(normalized) ? "distinct footsteps on metal stairs" : "distinct footsteps on hard floor";
  }

  if (/alarm|siren|warning/.test(normalized)) {
    return "warning alarm beeps";
  }

  if (/wind|gust/.test(normalized)) {
    return "sharp wind gust whipping past";
  }

  if (/crowd|market|street/.test(normalized)) {
    return "distinct crowd reaction";
  }

  return part;
}

function isSequentialSoundEffect(prompt: string) {
  return /\b(then|followed by|before|after|sequence|as .* then|into)\b/i.test(prompt);
}

function clampSoundEffectPrompt(prompt: string) {
  if (prompt.length <= SOUND_EFFECT_PROMPT_LIMIT) {
    return prompt;
  }

  return prompt.slice(0, SOUND_EFFECT_PROMPT_LIMIT);
}

function classifySoundEffectPrompt(prompt: string): SoundEffectBehavior {
  const normalized = prompt.toLowerCase();
  if (
    /\b(continuous|looping|loop|under dialogue|steady bed|background layer)\b/.test(
      normalized
    )
  ) {
    return "background";
  }

  return "one_shot";
}

function buildRenderPlans(segmentPlans: SegmentPlan[]): RenderPlan[] {
  const renderPlans: RenderPlan[] = [];
  let dialogueInputs: DialogueInputPlan[] = [];

  const flushDialogue = () => {
    if (!dialogueInputs.length) {
      return;
    }

    renderPlans.push({
      type: "dialogue",
      turnIds: dialogueInputs.map((input) => input.turnId),
      inputs: dialogueInputs
    });
    dialogueInputs = [];
  };

  for (const plan of segmentPlans) {
    if (plan.type === "dialogue") {
      if (!plan.voiceId) {
        throw new Error(`Dialogue turn ${plan.turnId} is missing a voice id.`);
      }

      dialogueInputs.push({
        turnId: plan.turnId,
        text: plan.text,
        voiceId: plan.voiceId
      });
      continue;
    }

    flushDialogue();
    renderPlans.push({
      type: "sound_effect",
      turnId: plan.turnId,
      text: plan.text,
      behavior: plan.behavior || classifySoundEffectPrompt(plan.text)
    });
  }

  flushDialogue();
  return renderPlans;
}

function renderPlanFileToken(plan: RenderPlan) {
  if (plan.type === "sound_effect") {
    return plan.turnId;
  }

  return `dialogue-${plan.turnIds[0]}-${plan.turnIds.length}`;
}

function renderPlanTurnIds(plan: RenderPlan) {
  return plan.type === "dialogue" ? plan.turnIds : [plan.turnId];
}

function buildTimelineSegmentGroups(generatedSegments: RenderGenerationResult[]): TimelineSegmentGroup[] {
  const groups: TimelineSegmentGroup[] = [];
  let pendingBackgroundEffects: RenderGenerationResult[] = [];

  for (const segment of generatedSegments) {
    if (segment.type === "sound_effect") {
      if (segment.behavior === "background") {
        pendingBackgroundEffects.push(segment);
        continue;
      }

      groups.push({
        type: "standalone",
        primary: segment,
        effects: []
      });
      continue;
    }

    if (pendingBackgroundEffects.length) {
      groups.push({
        type: "mixed_with_dialogue",
        primary: segment,
        effects: pendingBackgroundEffects
      });
      pendingBackgroundEffects = [];
      continue;
    }

    groups.push({
      type: "standalone",
      primary: segment,
      effects: []
    });
  }

  for (const effect of pendingBackgroundEffects) {
    groups.push({
      type: "standalone",
      primary: effect,
      effects: []
    });
  }

  return groups;
}

async function renderTimelineAudioSegments(
  groups: TimelineSegmentGroup[],
  chunkDir: string,
  chunkId: string
): Promise<TimelineAudioSegment[]> {
  const timelineSegments: TimelineAudioSegment[] = [];

  for (const [index, group] of groups.entries()) {
    if (group.type === "standalone") {
      timelineSegments.push({
        type: group.type,
        audioPath: group.primary.audioPath,
        durationSeconds: group.primary.durationSeconds,
        sourceSegments: [group.primary]
      });
      continue;
    }

    const outputPath = path.join(chunkDir, `${chunkId}.timeline-${index}-mixed.mp3`);
    await mixBackgroundEffects(group.primary, group.effects, outputPath);
    const measuredDuration = await getAudioDurationSeconds(outputPath);
    timelineSegments.push({
      type: group.type,
      audioPath: outputPath,
      durationSeconds: Math.max(0.01, measuredDuration || group.primary.durationSeconds),
      sourceSegments: [...group.effects, group.primary]
    });
  }

  return timelineSegments;
}

async function mixBackgroundEffects(
  dialogueSegment: RenderGenerationResult,
  effectSegments: RenderGenerationResult[],
  outputPath: string
) {
  if (!effectSegments.length) {
    await writeFile(outputPath, await readFile(dialogueSegment.audioPath));
    return;
  }

  await runFfmpeg(
    backgroundSfxMixArgs(
      dialogueSegment.audioPath,
      effectSegments.map((segment) => segment.audioPath),
      outputPath,
      dialogueSegment.durationSeconds
    )
  );
}

function backgroundSfxMixArgs(
  dialoguePath: string,
  effectPaths: string[],
  outputPath: string,
  targetDurationSeconds = 0.01
) {
  const volume = Math.min(1, Math.max(0.01, soundEffectBackgroundVolume()));
  const duration = Math.max(0.01, targetDurationSeconds);
  const fadeIn = Math.min(0.15, duration / 4);
  const fadeOut = Math.min(0.35, duration / 3);
  const fadeOutStart = Math.max(0, duration - fadeOut);
  const args = ["-y", "-i", dialoguePath];
  for (const effectPath of effectPaths) {
    args.push("-i", effectPath);
  }

  const effectFilters = effectPaths
    .map(
      (_, index) =>
        `[${index + 1}:a]volume=${volume.toFixed(3)},aloop=loop=-1:size=2147483647,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}[sfx${index}]`
    )
    .join(";");
  const mixInputs = ["[0:a]", ...effectPaths.map((_, index) => `[sfx${index}]`)].join("");
  const filter = [
    effectFilters,
    `${mixInputs}amix=inputs=${effectPaths.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`
  ]
    .filter(Boolean)
    .join(";");

  return [
    ...args,
    "-filter_complex",
    filter,
    "-map",
    "[aout]",
    "-vn",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath
  ];
}

async function requestElevenLabsSegment(
  plan: SegmentPlan,
  models: { dialogueModel: string; soundEffectModel: string }
) {
  const renderPlan = plan.type === "dialogue"
    ? buildRenderPlans([plan])[0]
    : ({
        type: "sound_effect",
        behavior: plan.behavior || classifySoundEffectPrompt(plan.text),
        turnId: plan.turnId,
        text: plan.text
      } satisfies RenderPlan);
  return (await requestElevenLabsRenderPlan(renderPlan, models)).audio;
}

async function requestElevenLabsRenderPlan(
  plan: RenderPlan,
  models: { dialogueModel: string; soundEffectModel: string }
): Promise<RenderAudioResult> {
  const label = plan.type === "dialogue" ? "dialogue" : "sound-effect";
  const timeoutMs = elevenLabsTimeoutMs();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= ELEVENLABS_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(buildElevenLabsUrl(plan), buildElevenLabsRequest(plan, models), timeoutMs);
      if (response.ok) {
        return parseElevenLabsAudioResponse(plan, response);
      }

      const detail = await readResponseBody(response);
      const message = `ElevenLabs ${label} generation failed with ${response.status}: ${detail}`;
      if (!isRetryableStatus(response.status) || attempt === ELEVENLABS_MAX_ATTEMPTS) {
        throw markNonRetryable(new Error(message));
      }
      lastError = new Error(message);
    } catch (error) {
      const message = isAbortError(error)
        ? `ElevenLabs ${label} generation timed out after ${timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : `ElevenLabs ${label} generation failed.`;
      lastError = new Error(message);
      if (!isRetryableError(error) || attempt === ELEVENLABS_MAX_ATTEMPTS) {
        throw lastError;
      }
    }

    await sleep(ELEVENLABS_RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  throw lastError || new Error(`ElevenLabs ${label} generation failed.`);
}

async function parseElevenLabsAudioResponse(plan: RenderPlan, response: Response): Promise<RenderAudioResult> {
  if (plan.type === "dialogue") {
    const data = DialogueWithTimestampsResponseSchema.parse(await response.json());
    return {
      audio: Buffer.from(data.audio_base64, "base64"),
      turnTimingsById: turnTimingsFromVoiceSegments(plan.inputs, data.voice_segments)
    };
  }

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    turnTimingsById: {}
  };
}

function buildElevenLabsUrl(plan: RenderPlan) {
  if (plan.type === "dialogue") {
    return DIALOGUE_WITH_TIMESTAMPS_ENDPOINT;
  }

  return `${SOUND_EFFECT_ENDPOINT}?output_format=${AUDIO_FORMAT}`;
}

function buildElevenLabsRequest(
  plan: RenderPlan,
  models: { dialogueModel: string; soundEffectModel: string }
): RequestInit {
  const headers = {
    "xi-api-key": elevenLabsApiKey(),
    "Content-Type": "application/json"
  };

  if (plan.type === "dialogue") {
    return {
      method: "POST",
      headers,
      body: JSON.stringify({
        model_id: models.dialogueModel,
        inputs: plan.inputs.map((input) => ({
          text: input.text,
          voice_id: input.voiceId
        }))
      })
    };
  }

  return {
    method: "POST",
    headers,
    body: JSON.stringify(buildSoundEffectRequestBody(plan, models.soundEffectModel))
  };
}

function buildSoundEffectRequestBody(
  plan: Extract<RenderPlan, { type: "sound_effect" }>,
  soundEffectModel: string
) {
  const body: Record<string, boolean | number | string> = {
    text: plan.text,
    model_id: soundEffectModel,
    prompt_influence:
      plan.behavior === "background" ? BACKGROUND_PROMPT_INFLUENCE : ONE_SHOT_PROMPT_INFLUENCE
  };

  if (supportsSoundEffectLoop(soundEffectModel)) {
    body.loop = plan.behavior === "background";
  }

  return body;
}

function supportsSoundEffectLoop(soundEffectModel: string) {
  return soundEffectModel === "eleven_text_to_sound_v2";
}

function turnTimingsFromVoiceSegments(
  inputs: DialogueInputPlan[],
  voiceSegments: Array<{
    start_time_seconds: number;
    end_time_seconds: number;
    dialogue_input_index: number;
  }>
) {
  const timings: Record<string, TurnTiming> = {};

  for (const segment of voiceSegments) {
    const input = inputs[segment.dialogue_input_index];
    if (!input) {
      continue;
    }

    const start = Math.max(0, segment.start_time_seconds);
    const end = Math.max(start, segment.end_time_seconds);
    const existing = timings[input.turnId];
    timings[input.turnId] = {
      startSeconds: existing ? Math.min(existing.startSeconds, start) : start,
      endSeconds: existing ? Math.max(existing.endSeconds, end) : end,
      durationSeconds: 0
    };
  }

  for (const timing of Object.values(timings)) {
    timing.durationSeconds = Math.max(0.01, timing.endSeconds - timing.startSeconds);
  }

  return timings;
}

function normalizeTurnTimings(
  plan: RenderPlan,
  turnTimingsById: Record<string, TurnTiming>,
  durationSeconds: number
) {
  if (plan.type === "sound_effect") {
    return {
      [plan.turnId]: {
        startSeconds: 0,
        endSeconds: durationSeconds,
        durationSeconds
      }
    };
  }

  if (plan.turnIds.every((turnId) => turnTimingsById[turnId])) {
    return turnTimingsById;
  }

  const fallback = distributeDialogueDurations(plan, durationSeconds);
  return {
    ...fallback,
    ...turnTimingsById
  };
}

function resolveSourceTurnTiming(segment: RenderGenerationResult, turnId: string) {
  return segment.turnTimingsById[turnId] || {
    startSeconds: 0,
    endSeconds: segment.durationSeconds,
    durationSeconds: segment.durationSeconds
  };
}

function resolveTimelineTurnTiming(
  sourceSegment: RenderGenerationResult,
  turnId: string,
  timelineSegment: TimelineAudioSegment
) {
  if (
    timelineSegment.type === "mixed_with_dialogue" &&
    sourceSegment.type === "sound_effect" &&
    sourceSegment.behavior === "background"
  ) {
    return {
      startSeconds: 0,
      endSeconds: timelineSegment.durationSeconds,
      durationSeconds: timelineSegment.durationSeconds
    };
  }

  return resolveSourceTurnTiming(sourceSegment, turnId);
}

function clampTurnTiming(timing: TurnTiming, segmentDurationSeconds: number): TurnTiming {
  const maxDuration = Math.max(0.01, segmentDurationSeconds);
  let startSeconds = Math.min(Math.max(0, timing.startSeconds), maxDuration);
  let endSeconds = Math.min(Math.max(startSeconds, timing.endSeconds), maxDuration);

  if (endSeconds - startSeconds < 0.01) {
    startSeconds = Math.min(startSeconds, Math.max(0, maxDuration - 0.01));
    endSeconds = Math.min(maxDuration, startSeconds + 0.01);
  }

  const durationSeconds = Math.max(0.01, endSeconds - startSeconds);

  return {
    startSeconds,
    endSeconds,
    durationSeconds
  };
}

function distributeDialogueDurations(plan: Extract<RenderPlan, { type: "dialogue" }>, durationSeconds: number) {
  const weights = plan.inputs.map((input) => Math.max(0.2, estimateTextWeight(input.text)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const timings: Record<string, TurnTiming> = {};
  let cursor = 0;

  for (const [index, input] of plan.inputs.entries()) {
    const isLast = index === plan.inputs.length - 1;
    const duration = isLast
      ? Math.max(0.01, durationSeconds - cursor)
      : Math.max(0.01, (durationSeconds * weights[index]) / Math.max(totalWeight, 0.01));
    timings[input.turnId] = {
      startSeconds: cursor,
      endSeconds: cursor + duration,
      durationSeconds: duration
    };
    cursor += duration;
  }

  return timings;
}

function estimateTextWeight(text: string) {
  const spokenText = stripAudioTags(text).replace(/\s+/g, " ").trim();
  const words = spokenText.split(/\s+/).filter(Boolean).length;
  const tagCount = extractAudioTags(text).length;
  const pauses = (spokenText.match(/[,.!?;:]/g) || []).length * 0.08;
  return words / 2.55 + tagCount * 0.34 + pauses;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function markNonRetryable(error: Error) {
  return Object.assign(error, { retryable: false });
}

function isRetryableError(error: unknown) {
  return !(
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    (error as { retryable?: unknown }).retryable === false
  );
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    String((error as { name?: unknown }).name) === "AbortError"
  );
}

async function readResponseBody(response: Response) {
  const body = await response.text().catch(() => "");
  return body.trim().slice(0, 500) || "empty error body";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    })
  );

  return results;
}

async function buildTurnDurationHints(
  turns: Turn[],
  chunks: Chunk[],
  explicitTurnDurations: Record<string, number> = {}
): Promise<Record<string, number>> {
  const hints: Record<string, number> = {};
  const turnById = new Map(turns.map((turn) => [turn.id, turn]));

  for (const chunk of chunks) {
    if (!chunk.audioPath) {
      continue;
    }

    const chunkDuration = await getAudioDurationSeconds(chunk.audioPath);
    if (!chunkDuration || chunkDuration <= 0) {
      continue;
    }

    const resolvedTurns = chunk.turnIds
      .map((turnId) => turnById.get(turnId))
      .filter((turn): turn is Turn => Boolean(turn));
    const captionableTurns = resolvedTurns.filter(isCaptionableTurn);
    if (!captionableTurns.length) {
      continue;
    }

    const explicitDurations = captionableTurns.map((turn) => {
      const explicit = explicitTurnDurations[turn.id];
      if (Number.isFinite(explicit) && explicit > 0) {
        return Math.max(MIN_TURN_DURATION_SECONDS, explicit);
      }
      return null;
    });
    const explicitTotal = explicitDurations
      .filter((duration): duration is number => duration !== null)
      .reduce((sum, duration) => sum + duration, 0);
    const estimatedMissingWeights = captionableTurns
      .map((turn, index) => ({ index, weight: Math.max(MIN_TURN_DURATION_SECONDS, estimateTurnWeight(turn)) }))
      .filter((candidate) => explicitDurations[candidate.index] === null)
      .map((candidate) => candidate.weight);

    if (estimatedMissingWeights.length > 0) {
      const missingWeightTotal = estimatedMissingWeights.reduce((sum, value) => sum + value, 0);
      const remainingDurationBudget = Math.max(0, chunkDuration - explicitTotal);
      if (missingWeightTotal > 0) {
        for (let index = 0; index < captionableTurns.length; index += 1) {
          if (explicitDurations[index] !== null) {
            continue;
          }

          const weight = Math.max(MIN_TURN_DURATION_SECONDS, estimateTurnWeight(captionableTurns[index]));
          explicitDurations[index] = (remainingDurationBudget * weight) / missingWeightTotal;
        }
      } else {
        const fallback = remainingDurationBudget / estimatedMissingWeights.length;
        for (let index = 0; index < captionableTurns.length; index += 1) {
          if (explicitDurations[index] === null) {
            explicitDurations[index] = Math.max(MIN_TURN_DURATION_SECONDS, fallback);
          }
        }
      }
    }

    if (explicitDurations.every((duration) => duration !== null)) {
      const resolvedDurations = explicitDurations.map((duration) => duration || MIN_TURN_DURATION_SECONDS);
      const resolvedTotal = resolvedDurations.reduce((sum, duration) => sum + duration, 0);
      if (resolvedTotal > 0) {
        const scaledDurations = resolvedDurations.map((duration) => (chunkDuration * duration) / resolvedTotal);
        const drift = chunkDuration - scaledDurations.reduce((sum, duration) => sum + duration, 0);
        scaledDurations[0] += drift;

        for (let index = 0; index < captionableTurns.length; index += 1) {
          hints[captionableTurns[index].id] = Math.max(0.01, scaledDurations[index]);
        }
        continue;
      }
    }

    const weights = captionableTurns.map((turn) => Math.max(MIN_TURN_DURATION_SECONDS, estimateTurnWeight(turn)));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    if (weightTotal <= 0) {
      const equalDuration = chunkDuration / captionableTurns.length;
      for (const turn of captionableTurns) {
        hints[turn.id] = equalDuration;
      }
      continue;
    }

    const weightedDurations = weights.map((weight) => (chunkDuration * weight) / weightTotal);
    const totalWeighted = weightedDurations.reduce((sum, value) => sum + value, 0);
    const roundingDrift = chunkDuration - totalWeighted;
    if (weightedDurations.length) {
      weightedDurations[0] += roundingDrift;
      for (let index = 0; index < weightedDurations.length; index += 1) {
        hints[captionableTurns[index].id] = Math.max(0.01, weightedDurations[index]);
      }
    }
  }

  return hints;
}

async function buildAbsoluteTurnTimingHints(
  turns: Turn[],
  chunks: Chunk[],
  segmentTimings: SegmentTiming[]
): Promise<Record<string, CaptionTimingHint>> {
  const hints: Record<string, CaptionTimingHint> = {};
  const captionableTurnIds = new Set(turns.filter(isCaptionableTurn).map((turn) => turn.id));
  const timingsByChunk = new Map<string, SegmentTiming[]>();

  for (const timing of segmentTimings) {
    if (!captionableTurnIds.has(timing.turnId)) {
      continue;
    }

    const chunkTimings = timingsByChunk.get(timing.chunkId) || [];
    chunkTimings.push(timing);
    timingsByChunk.set(timing.chunkId, chunkTimings);
  }

  let chunkOffset = 0;
  for (const chunk of chunks) {
    const chunkTimings = (timingsByChunk.get(chunk.id) || []).sort((a, b) => a.startSeconds - b.startSeconds);
    for (const timing of chunkTimings) {
      const start = Math.max(0, chunkOffset + timing.startSeconds);
      const end = Math.max(start + 0.01, chunkOffset + timing.endSeconds);
      const existing = resolveCaptionTimingRange(hints[timing.turnId]);
      hints[timing.turnId] = existing
        ? {
            start: Math.min(existing.start, start),
            end: Math.max(existing.end, end)
          }
        : { start, end };
    }

    const measuredDuration = chunk.audioPath ? await getAudioDurationSeconds(chunk.audioPath) : 0;
    const timingDuration = chunkTimings.reduce((max, timing) => Math.max(max, timing.endSeconds), 0);
    chunkOffset += Math.max(measuredDuration, timingDuration);
  }

  return hints;
}

function resolveCaptionTimingRange(hint: CaptionTimingHint | undefined) {
  if (!hint || typeof hint === "number") {
    return null;
  }

  return hint;
}

function estimateTurnWeight(turn: Turn) {
  const spokenText = stripAudioTags(turn.ttsText).replace(/\s+/g, " ").trim();
  const words = spokenText.split(/\s+/).filter(Boolean).length;
  const tagCount = extractAudioTags(turn.ttsText).length;
  const pauses = (spokenText.match(/[,.!?;:]/g) || []).length * 0.08;
  return words / 2.55 + tagCount * 0.34 + pauses;
}

async function concatenateAudioSegmentFiles(segmentPaths: string[], outputPath: string) {
  if (!segmentPaths.length) {
    throw new Error("No audio segments to merge.");
  }

  if (segmentPaths.length === 1) {
    await writeFile(outputPath, await readFile(segmentPaths[0]));
    return;
  }

  const listPath = `${outputPath}-inputs.txt`;
  const listBody = segmentPaths.map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listBody);

  try {
    await runFfmpeg(mp3ConcatArgs(listPath, outputPath));
  } finally {
    await unlink(listPath).catch(() => undefined);
  }
}

async function mergeDialogueChunks(chunks: Chunk[], projectId: string) {
  if (shouldUseMockAudio()) {
    return mergeAudioChunks(chunks, { projectId });
  }

  const projectDir = path.join(getStorageRoot(), "projects", projectId);
  await mkdir(projectDir, { recursive: true });
  const listPath = path.join(projectDir, "ffmpeg-inputs.txt");
  const finalAudioPath = path.join(projectDir, "final.mp3");
  const listBody = chunks
    .map((chunk) => {
      if (!chunk.audioPath) {
        throw new Error(`Chunk ${chunk.id} is missing audio.`);
      }
      return `file '${chunk.audioPath.replace(/'/g, "'\\''")}'`;
    })
    .join("\n");

  await writeFile(listPath, listBody);
  try {
    await runFfmpeg(mp3ConcatArgs(listPath, finalAudioPath));
  } finally {
    await unlink(listPath).catch(() => undefined);
  }
  return finalAudioPath;
}

function mp3ConcatArgs(listPath: string, outputPath: string) {
  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vn",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath
  ];
}

async function writeGenerationArtifacts({
  projectId,
  preset,
  turns,
  chunks,
  finalAudioPath,
  captions,
  segmentTimings
}: {
  projectId: string;
  preset: DeliveryPreset;
  turns: Turn[];
  chunks: Chunk[];
  finalAudioPath: string;
  captions: ReturnType<typeof buildCaptionCues>;
  segmentTimings: SegmentTiming[];
}) {
  return [
    await writeProjectArtifact(
      projectId,
      "generation/enhanced-turns.json",
      JSON.stringify({ preset, turns }, null, 2),
      {
        id: "artifact-enhanced-turns",
        label: "Enhanced ElevenLabs turns",
        kind: "enhanced_turns",
        mimeType: "application/json; charset=utf-8"
      }
    ),
    await writeProjectArtifact(
      projectId,
      "captions/captions.json",
      JSON.stringify({ captions }, null, 2),
      {
        id: "artifact-captions-json",
        label: "Captions JSON",
        kind: "captions_json",
        mimeType: "application/json; charset=utf-8"
      }
    ),
    await writeProjectArtifact(projectId, "captions/captions.vtt", captionsToVtt(captions), {
      id: "artifact-captions-vtt",
      label: "Captions VTT",
      kind: "captions_vtt",
      mimeType: "text/vtt; charset=utf-8"
    }),
	    await buildProjectArtifact(projectId, finalAudioPath, {
	      id: "artifact-final-audio",
	      label: "Final merged audio",
	      kind: "final_audio",
	      mimeType: audioMimeType(finalAudioPath)
	    }),
    await writeProjectArtifact(projectId, "generation/chunks.json", JSON.stringify({ chunks }, null, 2), {
      id: "artifact-chunks-json",
      label: "Generated chunks JSON",
      kind: "dialogue_payload",
      mimeType: "application/json; charset=utf-8"
    }),
    await writeProjectArtifact(projectId, "generation/segment-timings.json", JSON.stringify({ segmentTimings }, null, 2), {
      id: "artifact-segment-timings",
      label: "Segment timing JSON",
      kind: "segment_timings",
      mimeType: "application/json; charset=utf-8"
    })
  ];
}

async function runFfmpeg(args: string[]) {
  await runMediaTool({
    args,
    captureStdout: false,
    command: ffmpegPath(),
    label: "FFmpeg merge"
  });
}

async function getAudioDurationSeconds(filePath: string) {
  try {
    const command = await runMediaTool({
      args: ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath],
      captureStdout: true,
      command: ffprobePath(),
      label: "FFprobe"
    });
    const parsed = JSON.parse(command);
    const duration = Number(parsed?.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return 0;
    }
    return duration;
  } catch (error) {
    return 0;
  }
}

async function runMediaTool({
  args,
  captureStdout,
  command,
  label
}: {
  args: string[];
  captureStdout: boolean;
  command: string;
  label: string;
}) {
  const timeoutMs = mediaToolTimeoutMs();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${label} failed with exit code ${code}: ${stderr}`));
      }
    });
  });
}

function stripAudioTags(text: string) {
  return text.replace(/\[[^\]]+]/g, " ");
}

function extractAudioTags(text: string) {
  return Array.from(text.matchAll(/\[([^\]]+)]/g), (match) => match[1].trim()).filter(Boolean);
}

function shouldUseMockAudio() {
  return elevenLabsMockMode();
}

function audioMimeType(filePath: string) {
  return filePath.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
}

export const generatorTestUtils = {
  buildSegmentPlans,
  buildRenderPlans,
  buildTimelineSegmentGroups,
  backgroundSfxMixArgs,
  mp3ConcatArgs,
  mapWithConcurrency,
  requestElevenLabsRenderPlan,
  requestElevenLabsSegment
};
