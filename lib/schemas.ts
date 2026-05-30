import { z } from "zod";
import { MAX_SCRIPT_CHARACTERS, formatCharacterLimit } from "@/lib/limits";

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  inferredTraits: z.array(z.string()),
  voiceSearchQuery: z.string().min(1),
  voiceDesignPrompt: z.string().min(1),
  selectedVoiceId: z.string().nullable(),
  selectedVoiceName: z.string().nullable()
});

export const TurnSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  type: z.enum(["dialogue", "narration", "stage_direction"]),
  speakerId: z.string().nullable(),
  originalText: z.string().min(1),
  ttsText: z.string().min(1),
  emotionHint: z.string().nullable(),
  needsReview: z.boolean()
});

export const ChunkSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  turnIds: z.array(z.string().min(1)).min(1),
  charCount: z.number().int().nonnegative(),
  uniqueVoiceIds: z.array(z.string().min(1)),
  status: z.enum(["queued", "generating", "complete", "error"]),
  audioPath: z.string().nullable()
});

export const SourceModeSchema = z.enum(["raw_script", "idea"]);

export const CaptionCueSchema = z.object({
  id: z.string().min(1),
  turnId: z.string().min(1),
  order: z.number().int().nonnegative(),
  speakerId: z.string().nullable(),
  speakerName: z.string().min(1),
  text: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  color: z.string().min(1)
});

export const ProjectArtifactSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum([
    "idea_prompt",
    "raw_script",
    "generated_script",
    "parse_result",
    "enhanced_turns",
    "dialogue_payload",
    "segment_timings",
    "chunk_audio",
    "final_audio",
    "captions_json",
    "captions_vtt",
    "manifest"
  ]),
  path: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().min(1)
});

export const ParseResultSchema = z.object({
  title: z.string().min(1),
  detectedFormat: z.enum(["screenplay", "transcript", "prose", "chat", "unknown"]),
  confidence: z.number().min(0).max(1),
  characters: z.array(CharacterSchema).min(1),
  turns: z.array(TurnSchema).min(1),
  warnings: z.array(z.string())
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceMode: SourceModeSchema.default("raw_script"),
  sourceIdea: z.string().nullable().default(null),
  rawText: z.string(),
  parseResult: ParseResultSchema,
  characters: z.array(CharacterSchema),
  turns: z.array(TurnSchema),
  chunks: z.array(ChunkSchema),
  finalAudioPath: z.string().nullable(),
  captions: z.array(CaptionCueSchema).default([]),
  artifacts: z.array(ProjectArtifactSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const VoiceOptionSchema = z.object({
  voiceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  category: z.string().nullable(),
  previewUrl: z.string().url().nullable(),
  labels: z.record(z.string()).optional()
});

export const DeliveryPresetSchema = z.enum([
  "Natural",
  "Anime/Dramatic",
  "Podcast",
  "Audiobook",
  "Game Dialogue",
  "Cinematic"
]);

export const ScriptDurationSchema = z.enum(["Short", "Medium", "Long"]);

export const IdeaChatChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1)
});

export const IdeaChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  choices: z.array(IdeaChatChoiceSchema).optional()
});

export const IdeaChatReplySchema = z.object({
  content: z.string().min(1),
  question: z.string().min(1),
  choices: z.array(IdeaChatChoiceSchema).length(3)
});

export const GenerateJobSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  status: z.enum(["queued", "running", "complete", "error"]),
  progress: z.number().min(0).max(100),
  message: z.string(),
  chunks: z.array(ChunkSchema),
  finalAudioPath: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const ParseRequestSchema = z.object({
  rawText: z
    .string()
    .min(1, "Paste or upload script text first.")
    .max(MAX_SCRIPT_CHARACTERS, `Script text must be ${formatCharacterLimit()} characters or fewer.`),
  sourceMode: SourceModeSchema.default("raw_script"),
  sourceIdea: z.string().nullable().optional()
});

export const DraftScriptRequestSchema = z
  .object({
    idea: z.string().default(""),
    conversation: z.array(IdeaChatMessageSchema).default([]),
    preset: DeliveryPresetSchema.default("Cinematic"),
    duration: ScriptDurationSchema.default("Medium")
  })
  .refine(
    (payload) =>
      payload.idea.trim().length >= 5 ||
      payload.conversation.some((message) => message.role === "user" && message.content.trim().length >= 5),
    "Chat with the AI or describe the idea first."
  );

export const IdeaChatRequestSchema = z.object({
  messages: z.array(IdeaChatMessageSchema).min(1),
  preset: DeliveryPresetSchema.default("Cinematic")
});

export const EnhanceRequestSchema = z.object({
  turns: z.array(TurnSchema).min(1),
  preset: DeliveryPresetSchema,
  enabled: z.boolean().default(true)
});

export const GenerateRequestSchema = z.object({
  projectId: z.string().min(1),
  characters: z.array(CharacterSchema).optional(),
  turns: z.array(TurnSchema).optional(),
  preset: DeliveryPresetSchema.default("Natural"),
  regenerateChunkId: z.string().optional(),
  regenerateTurnId: z.string().optional()
});

export type Character = z.infer<typeof CharacterSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type ParseResult = z.infer<typeof ParseResultSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type SourceMode = z.infer<typeof SourceModeSchema>;
export type CaptionCue = z.infer<typeof CaptionCueSchema>;
export type ProjectArtifact = z.infer<typeof ProjectArtifactSchema>;
export type VoiceOption = z.infer<typeof VoiceOptionSchema>;
export type DeliveryPreset = z.infer<typeof DeliveryPresetSchema>;
export type ScriptDuration = z.infer<typeof ScriptDurationSchema>;
export type IdeaChatChoice = z.infer<typeof IdeaChatChoiceSchema>;
export type IdeaChatMessage = z.infer<typeof IdeaChatMessageSchema>;
export type IdeaChatReply = z.infer<typeof IdeaChatReplySchema>;
export type GenerateJob = z.infer<typeof GenerateJobSchema>;
