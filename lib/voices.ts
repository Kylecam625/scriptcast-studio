import { z } from "zod";
import { elevenLabsApiKey, elevenLabsMockMode, elevenLabsTimeoutMs } from "@/lib/env";
import { Character, VoiceOption, VoiceOptionSchema } from "@/lib/schemas";

const mockVoices: VoiceOption[] = [
  {
    voiceId: "mock-voice-mara",
    name: "Mara - Focused Alto",
    description: "Controlled, resilient delivery with a tense dramatic edge.",
    category: "mock",
    previewUrl: null,
    labels: { accent: "American", age: "young adult" }
  },
  {
    voiceId: "mock-voice-jules",
    name: "Jules - Bright Tenor",
    description: "Quick, warm, energetic voice suited to banter and urgency.",
    category: "mock",
    previewUrl: null,
    labels: { accent: "American", style: "cinematic" }
  },
  {
    voiceId: "mock-voice-narrator",
    name: "Narrator - Clear Studio",
    description: "Grounded narration voice with clean projection.",
    category: "mock",
    previewUrl: null,
    labels: { role: "narration", style: "audiobook" }
  }
];

const ElevenLabsVoiceSchema = z.object({
  voice_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  preview_url: z.string().url().nullable().optional(),
  labels: z.record(z.string()).optional()
});

const ElevenLabsVoicesResponseSchema = z
  .object({
    voices: z.array(ElevenLabsVoiceSchema).optional().default([])
  })
  .passthrough();

export async function searchVoices(query: string): Promise<VoiceOption[]> {
  if (shouldUseMockVoices()) {
    return mockVoiceSearch(query);
  }

  const url = new URL("https://api.elevenlabs.io/v2/voices");
  if (query) {
    url.searchParams.set("search", query);
  }
  url.searchParams.set("page_size", "100");
  url.searchParams.set("include_total_count", "false");
  url.searchParams.set("sort", "name");
  url.searchParams.set("sort_direction", "asc");

  const controller = new AbortController();
  const timeoutMs = elevenLabsTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "xi-api-key": elevenLabsApiKey()
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs voice search failed with ${response.status}: ${await readErrorBody(response)}`);
    }

    const data = ElevenLabsVoicesResponseSchema.parse(await response.json());
    return data.voices.map(mapVoiceOption);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`ElevenLabs voice search timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapVoiceOption(voice: z.infer<typeof ElevenLabsVoiceSchema>) {
  return (
    VoiceOptionSchema.parse({
      voiceId: voice.voice_id,
      name: voice.name,
      description: voice.description || null,
      category: voice.category || null,
      previewUrl: voice.preview_url || null,
      labels: voice.labels || {}
    })
  );
}

export function designVoiceForCharacter(character: Character) {
  return {
    characterId: character.id,
    voiceSearchQuery: character.voiceSearchQuery,
    voiceDesignPrompt:
      character.voiceDesignPrompt ||
      `Design a natural expressive voice for ${character.name} with ${character.inferredTraits.join(", ")}.`
  };
}

function mockVoiceSearch(query: string) {
  const normalized = query.toLowerCase();
  const ranked = [...mockVoices].sort((left, right) => {
    const leftScore = scoreVoice(left, normalized);
    const rightScore = scoreVoice(right, normalized);
    return rightScore - leftScore;
  });

  return ranked;
}

function scoreVoice(voice: VoiceOption, query: string) {
  const haystack = `${voice.name} ${voice.description} ${Object.values(voice.labels || {}).join(" ")}`.toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function shouldUseMockVoices() {
  return elevenLabsMockMode();
}

async function readErrorBody(response: Response) {
  const body = await response.text().catch(() => "");
  return body.trim().slice(0, 500) || "empty error body";
}
