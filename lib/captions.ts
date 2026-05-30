import { CaptionCue, Character, Turn } from "@/lib/schemas";

export type CaptionTimingHint = number | { start: number; end: number };

const captionColors = [
  "#4338ca",
  "#0f766e",
  "#b45309",
  "#be123c",
  "#0369a1",
  "#7c3aed",
  "#15803d",
  "#c2410c",
  "#4f46e5",
  "#0f766e"
];

export function buildCaptionCues(
  turns: Turn[],
  characters: Character[],
  turnTimingHintsById: Record<string, CaptionTimingHint> = {}
): CaptionCue[] {
  const characterById = new Map(characters.map((character, index) => [character.id, { character, index }]));
  const usableTurns = turns.filter(isCaptionableTurn);
  const hasTimingHints = Object.keys(turnTimingHintsById).length > 0;
  let cursor = hasTimingHints ? 0 : 0.18;
  const gapBetweenTurns = hasTimingHints ? 0 : 0.12;

  return usableTurns.map((turn, index) => {
    const speaker = turn.speakerId ? characterById.get(turn.speakerId) : null;
    const text = captionText(turn);
    const explicitRange = resolveTimingRange(turnTimingHintsById[turn.id]);
    const start = explicitRange?.start ?? cursor;
    const end = explicitRange?.end ?? start + resolveDuration(turn.id, text, turn.ttsText, turnTimingHintsById);
    cursor = Math.max(cursor, end + gapBetweenTurns);

    return {
      id: `caption-${index + 1}`,
      turnId: turn.id,
      order: index + 1,
      speakerId: turn.speakerId,
      speakerName: speaker?.character.name || "Sound",
      text,
      start: roundTime(start),
      end: roundTime(end),
      color: captionColors[(speaker?.index || 0) % captionColors.length]
    };
  });
}

function resolveDuration(
  turnId: string,
  captionTextValue: string,
  ttsText: string,
  turnTimingHintsById: Record<string, CaptionTimingHint>
) {
  const explicit = turnTimingHintsById[turnId];
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.max(0.2, explicit);
  }

  return estimateDuration(captionTextValue, ttsText);
}

function resolveTimingRange(hint: CaptionTimingHint | undefined) {
  if (!hint || typeof hint === "number") {
    return null;
  }

  const start = Math.max(0, hint.start);
  const end = Math.max(start + 0.2, hint.end);
  return { start, end };
}

export function captionsToVtt(captions: CaptionCue[]) {
  return [
    "WEBVTT",
    "",
    ...captions.flatMap((cue, index) => [
      String(index + 1),
      `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}`,
      `${cue.speakerName}: ${cue.text}`,
      ""
    ])
  ].join("\n");
}

export function isCaptionableTurn(turn: Turn) {
  if (turn.type === "stage_direction") {
    return /^\s*\[[^\]]+]/.test(turn.ttsText);
  }
  return Boolean(turn.speakerId && turn.ttsText.trim());
}

function captionText(turn: Turn) {
  const spoken = stripAudioTags(turn.ttsText).replace(/\s+/g, " ").trim();
  if (spoken) {
    return spoken;
  }

  const tags = extractAudioTags(turn.ttsText);
  if (tags.length) {
    return tags.map((tag) => `SFX: ${tag}`).join(" / ");
  }

  return turn.originalText.trim();
}

function stripAudioTags(text: string) {
  return text.replace(/\[[^\]]+]/g, " ");
}

function extractAudioTags(text: string) {
  return Array.from(text.matchAll(/\[([^\]]+)]/g), (match) => match[1].trim()).filter(Boolean);
}

function estimateDuration(text: string, ttsText: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const tagCount = extractAudioTags(ttsText).length;
  const punctuationPauses = (text.match(/[,.!?;:]/g) || []).length * 0.08;
  return Math.max(1.1, Math.min(7, words / 2.55 + tagCount * 0.34 + punctuationPauses));
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatVttTime(value: number) {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  const millis = Math.floor((value % 1) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${String(millis).padStart(3, "0")}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
