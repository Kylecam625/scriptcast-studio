import { Chunk, Turn } from "@/lib/schemas";

type ChunkOptions = {
  maxChars?: number;
  maxUniqueVoices?: number;
  voiceIdBySpeakerId?: Record<string, string>;
};

const SOUND_EFFECT_CHUNK_VOICE_ID = "__sfx__";

export function chunkTurnsForDialogue(turns: Turn[], options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? 1800;
  const maxUniqueVoices = options.maxUniqueVoices ?? 10;
  const chunks: Chunk[] = [];
  let activeTurns: Turn[] = [];
  let activeChars = 0;
  let activeVoices = new Set<string>();

  const flush = () => {
    if (activeTurns.length === 0) {
      return;
    }

    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      order: chunks.length + 1,
      turnIds: activeTurns.map((turn) => turn.id),
      charCount: activeChars,
      uniqueVoiceIds: Array.from(activeVoices),
      status: "queued",
      audioPath: null
    });
    activeTurns = [];
    activeChars = 0;
    activeVoices = new Set<string>();
  };

  for (const turn of turns) {
    const isTaggedStageDirection = turn.type === "stage_direction" && /^\s*\[[^\]]+]/.test(turn.ttsText);

    if (turn.type === "stage_direction" && !isTaggedStageDirection) {
      continue;
    }

    const voiceId = isTaggedStageDirection
      ? SOUND_EFFECT_CHUNK_VOICE_ID
      : resolveVoiceId(turn, options.voiceIdBySpeakerId);
    if (!voiceId) {
      continue;
    }

    const turnChars = turn.ttsText.length;
    const nextVoices = new Set(activeVoices);
    nextVoices.add(voiceId);

    if (
      activeTurns.length > 0 &&
      (activeChars + turnChars > maxChars || nextVoices.size > maxUniqueVoices)
    ) {
      flush();
    }

    if (turnChars > maxChars) {
      throw new Error(`Turn ${turn.id} is ${turnChars} characters and exceeds ${maxChars}.`);
    }

    activeTurns.push(turn);
    activeChars += turnChars;
    activeVoices.add(voiceId);
  }

  flush();
  return chunks;
}

function resolveVoiceId(turn: Turn, voiceIdBySpeakerId?: Record<string, string>) {
  if (!turn.speakerId) {
    return null;
  }

  return voiceIdBySpeakerId?.[turn.speakerId] || turn.speakerId;
}
