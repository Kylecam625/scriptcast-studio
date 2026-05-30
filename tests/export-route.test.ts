import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as exportAudio } from "@/app/api/export/[projectId]/route";
import { createProject, getProjectDirectory, saveProject } from "@/lib/storage";
import type { ParseResult } from "@/lib/schemas";

const parseResult: ParseResult = {
  title: "Range Test",
  detectedFormat: "transcript",
  confidence: 1,
  characters: [
    {
      id: "speaker",
      name: "Speaker",
      aliases: ["SPEAKER"],
      inferredTraits: ["clear"],
      voiceSearchQuery: "clear speaker",
      voiceDesignPrompt: "clear speaker",
      selectedVoiceId: "voice-speaker",
      selectedVoiceName: "Speaker Voice"
    }
  ],
  turns: [
    {
      id: "turn-1",
      order: 1,
      type: "dialogue",
      speakerId: "speaker",
      originalText: "Hello.",
      ttsText: "Hello.",
      emotionHint: null,
      needsReview: false
    }
  ],
  warnings: []
};

describe("export audio route", () => {
  it("serves byte ranges so browser audio players can resume without restarting the file", async () => {
    const project = await createProject("SPEAKER: Hello.", parseResult);
    const finalAudioPath = path.join(getProjectDirectory(project.id), "final.mp3");
    await writeFile(finalAudioPath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    await saveProject({ ...project, finalAudioPath });

    const response = await exportAudio(
      new Request(`http://localhost/api/export/${project.id}`, {
        headers: { range: "bytes=2-5" }
      }),
      { params: Promise.resolve({ projectId: project.id }) }
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([2, 3, 4, 5]));
  });
});
