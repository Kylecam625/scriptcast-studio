import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateJob, Project } from "@/lib/schemas";

const startProjectAudioGeneration = vi.fn();
const getProject = vi.fn();

vi.mock("@/lib/generator", () => ({
  startProjectAudioGeneration
}));

vi.mock("@/lib/storage", () => ({
  getProject
}));

const job: GenerateJob = {
  id: "job-queued",
  projectId: "project-1",
  status: "queued",
  progress: 0,
  message: "Generation queued.",
  chunks: [],
  finalAudioPath: null,
  error: null,
  createdAt: "2026-05-30T00:00:00.000Z",
  updatedAt: "2026-05-30T00:00:00.000Z"
};

const project = {
  id: "project-1",
  title: "Queued Project"
} as Project;

describe("generate route", () => {
  beforeEach(() => {
    startProjectAudioGeneration.mockResolvedValue(job);
    getProject.mockResolvedValue(project);
  });

  it("queues generation and returns immediately with a job id", async () => {
    const { POST } = await import("@/app/api/generate/route");
    const response = await POST(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-1" })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(202);
    expect(startProjectAudioGeneration).toHaveBeenCalledWith(
      { projectId: "project-1", preset: "Natural" },
      expect.any(Function)
    );
    expect(data).toMatchObject({
      job: { id: "job-queued", status: "queued" },
      project: { id: "project-1" }
    });
  });
});
