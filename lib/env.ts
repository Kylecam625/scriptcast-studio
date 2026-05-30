import os from "node:os";
import path from "node:path";

export function isMockMode() {
  return process.env.SCRIPTCAST_MOCK_MODE === "true";
}

export function shouldUseOpenAI() {
  return Boolean(process.env.OPENAI_API_KEY) && !isMockMode();
}

export function shouldUseElevenLabs() {
  return Boolean(process.env.ELEVENLABS_API_KEY) && !isMockMode();
}

export function openAIMockMode() {
  return !shouldUseOpenAI();
}

export function elevenLabsMockMode() {
  return !shouldUseElevenLabs();
}

export function elevenLabsApiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY is not configured.");
  }
  return key;
}

export function elevenLabsDialogueModel() {
  return process.env.ELEVENLABS_DIALOGUE_MODEL || "eleven_v3";
}

export function elevenLabsSoundEffectModel() {
  return process.env.ELEVENLABS_SOUND_EFFECT_MODEL || "eleven_text_to_sound_v2";
}

export function ffmpegPath() {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

export function ffprobePath() {
  return process.env.FFPROBE_PATH || "ffprobe";
}

export function elevenLabsTimeoutMs() {
  return positiveIntegerFromEnv("ELEVENLABS_TIMEOUT_MS", 90_000);
}

export function mediaToolTimeoutMs() {
  return positiveIntegerFromEnv("MEDIA_TOOL_TIMEOUT_MS", 120_000);
}

export function elevenLabsMaxConcurrency() {
  return positiveIntegerFromEnv("ELEVENLABS_MAX_CONCURRENCY", 3);
}

export function soundEffectBackgroundVolume() {
  return positiveNumberFromEnv("SFX_BACKGROUND_VOLUME", 0.35);
}

export function scriptcastStorageDir() {
  const configured = process.env.SCRIPTCAST_STORAGE_DIR?.trim();
  if (configured) {
    return path.resolve(expandHome(configured));
  }

  if (process.platform === "darwin" && isCloudManagedPath(process.cwd())) {
    return path.join(os.homedir(), "Library", "Application Support", "ScriptCast Studio");
  }

  return path.join(process.cwd(), ".scriptcast");
}

function positiveIntegerFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function expandHome(value: string) {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function isCloudManagedPath(value: string) {
  const normalized = path.resolve(value);
  const home = os.homedir();
  return (
    normalized.startsWith(path.join(home, "Documents")) ||
    normalized.includes(`${path.sep}Library${path.sep}Mobile Documents${path.sep}`)
  );
}
