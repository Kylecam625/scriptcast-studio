import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as listProjects } from "@/app/api/projects/route";
import { GET as getProjectRoute } from "@/app/api/projects/[projectId]/route";
import { GET as archiveArtifacts } from "@/app/api/projects/[projectId]/artifacts/archive/route";
import { createProject, getProjectDirectory, saveProject, writeProjectArtifact } from "@/lib/storage";
import type { ParseResult } from "@/lib/schemas";

const parseResult: ParseResult = {
  title: "Project Routes",
  detectedFormat: "screenplay",
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

describe("project routes", () => {
  it("lists stored projects and loads a selected project", async () => {
    const project = await createProject("SPEAKER: Hello.", parseResult);

    const listResponse = await listProjects();
    const listData = await listResponse.json();
    expect(listData.projects.some((candidate: { id: string }) => candidate.id === project.id)).toBe(true);

    const projectResponse = await getProjectRoute(new Request(`http://localhost/api/projects/${project.id}`), {
      params: Promise.resolve({ projectId: project.id })
    });
    const projectData = await projectResponse.json();
    expect(projectData.project).toMatchObject({
      id: project.id,
      title: "Project Routes"
    });
  });

  it("downloads all project artifacts as a zip archive", async () => {
    const project = await createProject("SPEAKER: Hello.", parseResult);
    const finalAudioPath = path.join(getProjectDirectory(project.id), "final.wav");
    await writeFile(finalAudioPath, Buffer.from("RIFFdemo"));
    const extraArtifact = await writeProjectArtifact(project.id, "notes/review.txt", "review notes", {
      id: "artifact-review-notes",
      label: "Review notes",
      kind: "manifest",
      mimeType: "text/plain; charset=utf-8"
    });
    await saveProject({ ...project, artifacts: [...project.artifacts, extraArtifact], finalAudioPath });

    const response = await archiveArtifacts(
      new Request(`http://localhost/api/projects/${project.id}/artifacts/archive`),
      {
        params: Promise.resolve({ projectId: project.id })
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    const body = Buffer.from(await response.arrayBuffer()).toString("latin1");
    expect(body).toContain("review.txt");
    expect(body).toContain("PK\u0005\u0006");
  });
});
