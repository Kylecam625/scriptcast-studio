export type DraftDeliveryPreset =
  | "Natural"
  | "Anime/Dramatic"
  | "Podcast"
  | "Audiobook"
  | "Game Dialogue"
  | "Cinematic";

export type DraftScriptDuration = "Short" | "Medium" | "Long";

export type DraftIdeaChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DraftPromptOptions = {
  idea?: string;
  conversation?: DraftIdeaChatMessage[];
  preset: DraftDeliveryPreset;
  duration?: DraftScriptDuration;
};

export const defaultScriptDuration: DraftScriptDuration = "Medium";

export const defaultDraftSystemPrompt =
  "Write premium audio scripts for a multi-character ElevenLabs Eleven v3 workflow. Make the dialogue specific, emotionally playable, and natural instead of generic. Use parser-friendly screenplay text only: a Markdown title, bracketed audible stage directions, and UPPERCASE speaker labels followed by dialogue. Shape each scene through concrete sound cues, character choices, clear emotional beats, and a satisfying ending. Do not use code fences.";

export function ideaConversationToText(messages: DraftIdeaChatMessage[]) {
  return messages
    .map((message) => `${message.role === "user" ? "User" : "AI"}: ${message.content.trim()}`)
    .filter(Boolean)
    .join("\n\n");
}

export function buildDraftSourcePrompt(options: Pick<DraftPromptOptions, "conversation" | "idea">) {
  const transcript = ideaConversationToText(options.conversation || []);
  const idea = options.idea?.trim();
  const parts = [];

  if (transcript) {
    parts.push("Use this story-development chat transcript as the source material:");
    parts.push(transcript);
  }

  if (idea) {
    parts.push(`Additional idea notes: ${idea}`);
  }

  return parts.join("\n\n").trim();
}

export function buildDraftUserPrompt(options: DraftPromptOptions) {
  const sourcePrompt = buildDraftSourcePrompt(options);
  if (!sourcePrompt) {
    return "";
  }

  return [sourcePrompt, ...buildDraftInstructions(options.preset, options.duration || defaultScriptDuration)].join("\n");
}

export function buildDraftInstructions(preset: DraftDeliveryPreset, duration: DraftScriptDuration) {
  const guidance = getDurationGuidance(duration);

  return [
    `Delivery style: ${preset}`,
    `Target audio duration: ${duration}. ${guidance.target}`,
    guidance.turns,
    guidance.pacing,
    "Write in longer, cinematic lines: richer clauses, imagery, emotional transitions, and scene texture. Avoid clipped fragments unless the beat truly demands it.",
    "Use ElevenLabs v3 audio tags as your control language. Add square-bracket tags (no SSML), and only add tags that describe audible behavior.",
    "For each spoken turn, place 1-4 relevant tags near the phrase they modify (before or after that segment, or at natural pauses).",
    "Use this tag style for speech and exact sound cues: emotional/delivery cues like [whispers], [whispering], [excited], [sarcastic], [curious], [appalled], [annoyed], [sighs], [exhales], [laughs], [clears throat], [snorts], [breathless], [nervous laugh], [angry], [happy], and non-verbal/sfx cues like [keys jingling], [car engine starts], [footsteps on metal stairs], [distant thunder crack], [wooden door creaks], [crackling radio static], [applause], [gunshot], [sharp glass rattle], [explosion], and [dramatic pause].",
    "Use punctuation and ellipses intentionally for timing/pauses. Don't change meaning; keep delivery shifts plausible for the speaker and voice.",
    "When describing scene moments, add bracketed SFX lines that name concrete recognizable sounds (for example [wind gusts], [distinct crowd reaction], [alarm beeps]) instead of vague beds like low hum, room tone, ambience, or background noise.",
    "Do not put speaker labels inside bracketed stage directions.",
    "Keep each line speakable and emotionally playable, while leaning into atmospheric detail where it improves performance."
  ];
}

function getDurationGuidance(duration: DraftScriptDuration) {
  const guidance: Record<DraftScriptDuration, { target: string; turns: string; pacing: string }> = {
    Short: {
      target: "Short target: about 1 to 2 minutes of final audio.",
      turns: "Create 8 to 12 turns with 2 to 4 distinct speakers plus a narrator only when useful.",
      pacing: "Keep the premise focused on one scene, one sharp conflict, and a clean ending beat."
    },
    Medium: {
      target: "Medium target: about 3 to 5 minutes of final audio.",
      turns: "Create 14 to 22 turns with 2 to 6 distinct speakers plus a narrator when useful.",
      pacing: "Give the story room for setup, escalation, reversal, and resolution without drifting into extra scenes."
    },
    Long: {
      target: "Long target: about 6 to 9 minutes of final audio.",
      turns: "Create 26 to 40 turns with 3 to 7 distinct speakers plus a narrator when useful.",
      pacing: "Use multiple connected beats, recurring sound motifs, and a fuller escalation while keeping every line performable."
    }
  };

  return guidance[duration];
}
