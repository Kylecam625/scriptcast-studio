import { slugId } from "@/lib/ids";
import { shouldUseOpenAI } from "@/lib/env";
import { createOpenAIResponse } from "@/lib/openaiResponses";
import {
  DeliveryPreset,
  ParseResult,
  ParseResultSchema,
  Turn,
  TurnSchema
} from "@/lib/schemas";
import { z } from "zod";

const SPEAKER_LINE = /^([A-Z][A-Z0-9 _.'-]{1,40}):\s*(.+)$/;

const deliveryTagsByPreset: Record<DeliveryPreset, string[]> = {
  Natural: ["[naturally]", "[thoughtful]", "[softly]", "[gentle breath]"],
  "Anime/Dramatic": ["[determined]", "[gasps]", "[nervous]", "[shouting]", "[breathless]"],
  Podcast: ["[warmly]", "[thoughtful]", "[light laugh]", "[leans in]"],
  Audiobook: ["[softly]", "[with tension]", "[measured]", "[hushed]"],
  "Game Dialogue": ["[urgent]", "[whispering]", "[laughs]", "[interrupting]", "[radio static]"],
  Cinematic: ["[sighs]", "[low voice]", "[with dread]", "[distant rumble]", "[footsteps]"]
};

const contextualAudioTags: Array<[RegExp, string]> = [
  [/\bkey|jingle/i, "[keys jingling]"],
  [/\b(car|truck|motor|engine|ignition)\b|starts? the car/i, "[car engine starts]"],
  [/rain|storm/i, "[rain hitting metal]"],
  [/thunder|lightning|rumble/i, "[distant thunder crack]"],
  [/door|knock|hinge|handle/i, "[wooden door creaks]"],
  [/footstep|walk|run|stairs|hall/i, "[footsteps on hard floor]"],
  [/radio|signal|static|antenna|transmission/i, "[crackling radio static]"],
  [/glass|window|shatter/i, "[sharp glass rattle]"],
  [/crowd|market|street/i, "[distinct crowd reaction]"],
  [/wind|rooftop|outside/i, "[wind gusts]"],
  [/alarm|siren|warning/i, "[alarm beeps]"],
  [/laugh|joke|smile/i, "[laughs]"]
];

const enhancedTurnsPayloadSchema = z.object({
  turns: z.array(
    z.object({
      id: z.string().min(1),
      ttsText: z.string().min(1),
      emotionHint: z.string().nullable(),
      needsReview: z.boolean()
    })
  )
});

export async function parseRawScript(rawText: string): Promise<ParseResult> {
  const text = rawText.trim();
  if (!text) {
    throw new Error("Paste or upload script text first.");
  }

  if (shouldUseOpenAI()) {
    try {
      return await parseWithOpenAI(text);
    } catch (error) {
      return mockParse(text, `OpenAI parse failed; used rule-based parsing instead: ${readError(error)}`);
    }
  }

  return mockParse(text);
}

export async function enhanceTurnsWithDelivery(
  turns: Turn[],
  preset: DeliveryPreset,
  enabled = true
): Promise<Turn[]> {
  if (!enabled) {
    return turns.map((turn) => ({ ...turn, ttsText: turn.originalText }));
  }

  if (shouldUseOpenAI()) {
    try {
      return await enhanceWithOpenAI(turns, preset);
    } catch {
      return enhanceWithRules(turns, preset);
    }
  }

  return enhanceWithRules(turns, preset);
}

function enhanceWithRules(turns: Turn[], preset: DeliveryPreset): Turn[] {
  const tags = deliveryTagsByPreset[preset];
  return turns.map((turn, index) => {
    if (turn.type === "stage_direction") {
      return {
        ...turn,
        ttsText: stageDirectionToAudioTags(turn.originalText),
        emotionHint: "sound effect",
        needsReview: false
      };
    }

    if (!turn.speakerId) {
      return { ...turn, ttsText: turn.originalText };
    }

    const turnTags = selectTurnTags(turn, index, tags, preset);
    const text = turnTags.length ? `${turnTags.join(" ")} ${turn.originalText}` : turn.originalText;

    return {
      ...turn,
      ttsText: text,
      needsReview: turn.needsReview || text.length > 1800
    };
  });
}

function mockParse(rawText: string, fallbackWarning?: string): ParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const titleLine = lines.find((line) => line.startsWith("#"));
  const title = titleLine?.replace(/^#+\s*/, "").trim() || "Untitled Script";
  const characters = new Map<string, ReturnType<typeof createCharacter>>();
  const turns: Turn[] = [];

  const narrator = createCharacter("Narrator", [
    "grounded narrator",
    "clear exposition",
    "steady pacing"
  ]);
  characters.set(narrator.id, narrator);

  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }

    const stageDirection = line.match(/^\[(.+)]$/);
    if (stageDirection) {
      turns.push({
        id: `turn-${turns.length + 1}`,
        order: turns.length + 1,
        type: "stage_direction",
        speakerId: narrator.id,
        originalText: stageDirection[1],
        ttsText: stageDirection[1],
        emotionHint: "scene direction",
        needsReview: true
      });
      continue;
    }

    const speakerMatch = line.match(SPEAKER_LINE);
    if (speakerMatch) {
      const name = toTitleCase(speakerMatch[1]);
      const speakerId = slugId(name);
      if (!characters.has(speakerId)) {
        characters.set(speakerId, createCharacter(name, inferTraits(name, speakerMatch[2])));
      }

      turns.push({
        id: `turn-${turns.length + 1}`,
        order: turns.length + 1,
        type: speakerId === narrator.id ? "narration" : "dialogue",
        speakerId,
        originalText: speakerMatch[2],
        ttsText: speakerMatch[2],
        emotionHint: inferEmotion(speakerMatch[2]),
        needsReview: false
      });
      continue;
    }

    turns.push({
      id: `turn-${turns.length + 1}`,
      order: turns.length + 1,
      type: "narration",
      speakerId: narrator.id,
      originalText: line,
      ttsText: line,
      emotionHint: null,
      needsReview: false
    });
  }

  if (turns.length === 0) {
    turns.push({
      id: "turn-1",
      order: 1,
      type: "narration",
      speakerId: narrator.id,
      originalText: rawText,
      ttsText: rawText,
      emotionHint: null,
      needsReview: true
    });
  }

  const warnings = [
    fallbackWarning || "Rule-based parser is active because API keys are missing or mock mode is enabled.",
    ...turns
      .filter((turn) => turn.type === "stage_direction")
      .slice(0, 1)
      .map(() => "Stage directions were detected and marked for review.")
  ];

  return ParseResultSchema.parse({
    title,
    detectedFormat: inferFormat(lines),
    confidence: turns.some((turn) => turn.type === "dialogue") ? 0.88 : 0.66,
    characters: Array.from(characters.values()),
    turns,
    warnings
  });
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown parse error.";
}

function createCharacter(name: string, traits: string[]) {
  const id = slugId(name);
  const traitLine = traits.join(", ");
  return {
    id,
    name,
    aliases: [name.toUpperCase()],
    inferredTraits: traits,
    voiceSearchQuery: `${name} ${traitLine} expressive dialogue`,
    voiceDesignPrompt: `Create a voice for ${name}: ${traitLine}. Keep it natural, distinct, and suitable for multi-character dialogue.`,
    selectedVoiceId: null,
    selectedVoiceName: null
  };
}

function inferTraits(name: string, line: string) {
  const traits = ["expressive", "natural timing"];
  if (/[!?]/.test(line)) {
    traits.push("high emotional range");
  }
  if (/whisper|quiet|listen/i.test(line)) {
    traits.push("controlled tension");
  }
  if (/run|loud|chance|signal/i.test(line)) {
    traits.push("urgent delivery");
  }
  return [`${name} character voice`, ...traits].slice(0, 4);
}

function inferEmotion(text: string) {
  if (/\?/.test(text)) {
    return "uncertain";
  }
  if (/!/.test(text)) {
    return "excited";
  }
  if (/run|chance|wrong|faster|signal/i.test(text)) {
    return "tense";
  }
  return null;
}

function inferFormat(lines: string[]): ParseResult["detectedFormat"] {
  const speakerLines = lines.filter((line) => SPEAKER_LINE.test(line)).length;
  if (speakerLines >= 2) {
    return "screenplay";
  }
  if (lines.some((line) => /^[-*]\s+\w+:/i.test(line))) {
    return "transcript";
  }
  return "unknown";
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function parseWithOpenAI(rawText: string): Promise<ParseResult> {
  const content = await createOpenAIResponse({
    task: "parse",
    input: [
      {
        role: "system",
        content:
          "Parse messy scripts into strict JSON for a text-to-dialogue app. Preserve all dialogue exactly. Do not invent voice IDs. If a line is unclear, mark it needsReview instead of rewriting it."
      },
      {
        role: "user",
        content: `Parse this raw script:\n\n${rawText}`
      }
    ],
    metadata: {
      route: "api-parse",
      schema: "scriptcast_parse_result"
    },
    promptCacheKey: "scriptcast-parse-v1",
    reasoning: {
      effort: "low"
    },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "scriptcast_parse_result",
        strict: true,
        schema: parseResultJsonSchema
      }
    }
  });
  const parsed = ParseResultSchema.parse(JSON.parse(content));
  const characterById = new Map(parsed.characters.map((character) => [character.id, character]));
  return {
    ...parsed,
    turns: parsed.turns.map((turn, index) =>
      TurnSchema.parse({
        ...turn,
        order: turn.order || index + 1,
        originalText: stripRedundantSpeakerLabel(
          turn.originalText,
          turn.speakerId ? characterById.get(turn.speakerId) : null
        ),
        ttsText: stripRedundantSpeakerLabel(
          turn.ttsText,
          turn.speakerId ? characterById.get(turn.speakerId) : null
        )
      })
    )
  };
}

async function enhanceWithOpenAI(turns: Turn[], preset: DeliveryPreset): Promise<Turn[]> {
  const content = await createOpenAIResponse({
    task: "enhance",
    input: [
      {
        role: "system",
        content:
          "You are preparing text for ElevenLabs Text to Dialogue (v3). Add expressive square-bracket audio tags inside each spoken turn. Tags are natural-language performance directives (not SSML). Keep original wording intact; do not alter semantics or invent words."
      },
      {
        role: "user",
        content: [
          `Delivery preset: ${preset}`,
          "For each turn, add context-appropriate tags from v3-style audio instructions. Use 0-4 tags per turn (more if the beat benefits from it), placed before/after the segment they modify.",
          "Use valid voice delivery tags and exact non-verbal cues such as [whispers], [laughs], [sighs], [exhales], [annoyed], [curious], [excited], [angry], [appalled], [clears throat], [keys jingling], [car engine starts], [footsteps on metal stairs], [distant thunder crack], [wooden door creaks], [crackling radio static], [alarm beeps], [sharp glass rattle], [applause], [explosion], [gunshot], [dramatic pause], [short pause], [long pause].",
          "For sound effects, prefer concrete recognizable source sounds over broad beds. Do not use vague tags like [room tone], [low hum], [engine hum], [nearby machinery hum], [ambience], or [background noise].",
          "Do NOT rewrite original text. Do NOT invent dialogue. Keep each line speakable and under 1800 chars after tagging.",
          "Avoid unsupported/invalid direction tags (for example [music], [pacing], [standing], [grinning], [scene direction]). Use punctuation, ellipses, capitalization, and tag placement for pacing and emphasis.",
          "Return one enhanced item for every input turn.",
          JSON.stringify(
            turns.map((turn) => ({
              id: turn.id,
              type: turn.type,
              originalText: turn.originalText,
              emotionHint: turn.emotionHint
            }))
          )
        ].join("\n")
      }
    ],
    metadata: {
      route: "api-enhance",
      preset,
      schema: "scriptcast_enhanced_turns"
    },
    promptCacheKey: "scriptcast-enhance-v1",
    reasoning: {
      effort: "low"
    },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "scriptcast_enhanced_turns",
        strict: true,
        schema: enhancedTurnsJsonSchema
      }
    }
  });
  const data = enhancedTurnsPayloadSchema.parse(JSON.parse(content));
  const byId = new Map(data.turns.map((turn) => [turn.id, turn]));

  return turns.map((turn) => {
    const enhanced = byId.get(turn.id);
    if (!enhanced) {
      return turn;
    }
    return {
      ...turn,
      ttsText: enhanced.ttsText,
      emotionHint: enhanced.emotionHint,
      needsReview: enhanced.needsReview || enhanced.ttsText.length > 1800
    };
  });
}

function selectTurnTags(
  turn: Turn,
  index: number,
  presetTags: string[],
  preset: DeliveryPreset
) {
  const selected = new Set<string>();
  const baseTag = presetTags[index % Math.max(presetTags.length, 1)];
  if (baseTag) {
    selected.add(baseTag);
  }

  if (turn.emotionHint) {
    selected.add(emotionTag(turn.emotionHint));
  }

  for (const [pattern, tag] of contextualAudioTags) {
    if (pattern.test(turn.originalText)) {
      selected.add(tag);
      break;
    }
  }

  return Array.from(selected).slice(0, preset === "Podcast" ? 2 : 3);
}

function stageDirectionToAudioTags(text: string) {
  const clean = text
    .replace(/^\[|\]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。]+$/g, "");

  if (!clean) {
    return "[brief pause]";
  }

  const contextual = contextualAudioTags
    .filter(([pattern]) => pattern.test(clean))
    .map(([, tag]) => tag)
    .slice(0, 2);

  if (contextual.length) {
    return contextual.join(" ");
  }

  return `[${clean.slice(0, 80)}]`;
}

function emotionTag(emotion: string) {
  if (/uncertain|question|confused/i.test(emotion)) {
    return "[uncertain]";
  }
  if (/excited|happy|joy/i.test(emotion)) {
    return "[excited]";
  }
  if (/tense|afraid|fear|dread/i.test(emotion)) {
    return "[tense]";
  }
  if (/sad|grief/i.test(emotion)) {
    return "[sad]";
  }
  return `[${emotion.replace(/[^\w\s-]/g, "").trim().slice(0, 40) || "thoughtful"}]`;
}

function stripRedundantSpeakerLabel(
  text: string,
  character: ParseResult["characters"][number] | null | undefined
) {
  if (!character) {
    return text;
  }

  const aliases = [character.name, ...character.aliases]
    .map((alias) => alias.trim())
    .filter(Boolean);
  let cleaned = text.trim();

  for (const alias of aliases) {
    const prefix = new RegExp(`^${escapeRegExp(alias)}\\s*:\\s*`, "i");
    cleaned = cleaned.replace(prefix, "");

    const bracketedPrefix = new RegExp(`^\\[\\s*${escapeRegExp(alias)}\\s*:\\s*(.+)]$`, "i");
    cleaned = cleaned.replace(bracketedPrefix, "[$1]");
  }

  return cleaned;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const parseResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "detectedFormat", "confidence", "characters", "turns", "warnings"],
  properties: {
    title: { type: "string" },
    detectedFormat: {
      type: "string",
      enum: ["screenplay", "transcript", "prose", "chat", "unknown"]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "aliases",
          "inferredTraits",
          "voiceSearchQuery",
          "voiceDesignPrompt",
          "selectedVoiceId",
          "selectedVoiceName"
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          inferredTraits: { type: "array", items: { type: "string" } },
          voiceSearchQuery: { type: "string" },
          voiceDesignPrompt: { type: "string" },
          selectedVoiceId: { type: ["string", "null"] },
          selectedVoiceName: { type: ["string", "null"] }
        }
      }
    },
    turns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "order",
          "type",
          "speakerId",
          "originalText",
          "ttsText",
          "emotionHint",
          "needsReview"
        ],
        properties: {
          id: { type: "string" },
          order: { type: "number" },
          type: { type: "string", enum: ["dialogue", "narration", "stage_direction"] },
          speakerId: { type: ["string", "null"] },
          originalText: { type: "string" },
          ttsText: { type: "string" },
          emotionHint: { type: ["string", "null"] },
          needsReview: { type: "boolean" }
        }
      }
    },
    warnings: { type: "array", items: { type: "string" } }
  }
};

const enhancedTurnsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["turns"],
  properties: {
    turns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "ttsText", "emotionHint", "needsReview"],
        properties: {
          id: { type: "string" },
          ttsText: { type: "string" },
          emotionHint: { type: ["string", "null"] },
          needsReview: { type: "boolean" }
        }
      }
    }
  }
};
