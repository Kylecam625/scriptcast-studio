import type { Character, Project, Turn, VoiceOption } from "@/lib/schemas";

type ProjectDraft = {
  characters: Character[];
  turns: Turn[];
};

export function maxReachableStep(project: Project | null) {
  if (!project) {
    return 0;
  }

  if (project.finalAudioPath) {
    return 4;
  }

  const requiredVoiceIds = requiredCharacterIdsForGeneration(project.turns);
  if (
    requiredVoiceIds.size === 0 ||
    project.characters.every((character) => !requiredVoiceIds.has(character.id) || character.selectedVoiceId)
  ) {
    return 3;
  }

  return 2;
}

export function requiredCharacterIdsForGeneration(turns: Turn[]) {
  const ids = new Set<string>();
  for (const turn of turns) {
    if (turn.type !== "stage_direction" && turn.speakerId) {
      ids.add(turn.speakerId);
    }
  }
  return ids;
}

export function findProjectBlockingIssues(project: ProjectDraft) {
  const issues: string[] = [];
  const requiredVoiceIds = requiredCharacterIdsForGeneration(project.turns);
  const characterIds = new Set(project.characters.map((character) => character.id));

  project.characters.forEach((character, index) => {
    const displayName = character.name.trim() || `Character ${index + 1}`;
    if (!character.name.trim()) {
      issues.push(`Character ${index + 1} needs a name.`);
      return;
    }
    if (requiredVoiceIds.has(character.id) && !character.selectedVoiceId) {
      issues.push(`${displayName} needs a selected voice.`);
    }
  });

  project.turns.forEach((turn) => {
    if (!turn.originalText.trim() || !turn.ttsText.trim()) {
      issues.push(`Line ${turn.order} needs text.`);
    }
    if (turn.type !== "stage_direction" && !turn.speakerId) {
      issues.push(`Line ${turn.order} needs a speaker.`);
    }
    if (turn.speakerId && !characterIds.has(turn.speakerId)) {
      issues.push(`Line ${turn.order} uses a speaker that no longer exists.`);
    }
  });

  return issues;
}

export function rankVoicesForCharacter(character: Character, voices: VoiceOption[]) {
  const terms = weightedTerms(
    [
      character.name,
      character.voiceSearchQuery,
      character.voiceDesignPrompt,
      ...character.inferredTraits
    ].join(" ")
  );

  return [...voices].sort((left, right) => {
    const scoreDelta = scoreVoiceForTerms(right, terms) - scoreVoiceForTerms(left, terms);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.name.localeCompare(right.name);
  });
}

export function bestVoiceForCharacter(character: Character, voices: VoiceOption[]) {
  return rankVoicesForCharacter(character, voices)[0] || null;
}

function scoreVoiceForTerms(voice: VoiceOption, terms: Map<string, number>) {
  const haystack = normalize(
    [
      voice.name,
      voice.description || "",
      voice.category || "",
      ...Object.values(voice.labels || {})
    ].join(" ")
  );
  let score = voice.previewUrl ? 0.15 : 0;

  for (const [term, weight] of terms) {
    if (haystack.includes(term)) {
      score += weight;
    }
  }

  return score;
}

function weightedTerms(text: string) {
  const terms = new Map<string, number>();
  const tokens = normalize(text)
    .split(" ")
    .filter((term) => term.length > 2 && !ignoredTerms.has(term));

  for (const token of tokens) {
    terms.set(token, (terms.get(token) || 0) + 1);
  }

  return terms;
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ignoredTerms = new Set([
  "and",
  "the",
  "for",
  "with",
  "voice",
  "adult",
  "delivery",
  "create",
  "natural",
  "dialogue"
]);
