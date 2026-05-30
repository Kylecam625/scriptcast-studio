import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Chunk, Turn } from "@/lib/schemas";
import { getStorageRoot } from "@/lib/storage";

type AudioOptions = {
  projectId: string;
  baseDir?: string;
};

export async function generateMockDialogueChunk(
  chunk: Chunk,
  turns: Turn[],
  options: AudioOptions
): Promise<Chunk> {
  const chunkDir = path.join(options.baseDir || getStorageRoot(), "projects", options.projectId, "chunks");
  await mkdir(chunkDir, { recursive: true });
  const audioPath = path.join(chunkDir, `${chunk.id}.wav`);
  const durationSeconds = Math.max(
    0.6,
    Math.min(
      4,
      turns.reduce((total, turn) => total + turn.ttsText.length, 0) / 80
    )
  );
  await writeFile(audioPath, createSilentWavBuffer(durationSeconds));

  return {
    ...chunk,
    status: "complete",
    audioPath
  };
}

export async function mergeAudioChunks(chunks: Chunk[], options: AudioOptions): Promise<string> {
  const projectDir = path.join(options.baseDir || getStorageRoot(), "projects", options.projectId);
  await mkdir(projectDir, { recursive: true });
  const finalAudioPath = path.join(projectDir, "final.wav");

  const durationSeconds = Math.max(1, chunks.length * 0.8);
  await writeFile(finalAudioPath, createSilentWavBuffer(durationSeconds));
  return finalAudioPath;
}

export function createSilentWavBuffer(durationSeconds: number) {
  const sampleRate = 22050;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = sampleCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}
