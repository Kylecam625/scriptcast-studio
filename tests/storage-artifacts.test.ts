import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRawScript } from "@/lib/parser";
import {
  assertLocalFileAvailable,
  createProject,
  getProject,
  getStorageRoot
} from "@/lib/storage";
import { sampleScript } from "@/lib/sampleScript";

describe("project artifact storage", () => {
  it("records idea, generated script, and parse artifacts when a project starts from an idea", async () => {
    const parseResult = await parseRawScript(sampleScript);
    const project = await createProject(sampleScript, parseResult, {
      sourceMode: "idea",
      sourceIdea: "A rooftop radio thriller."
    });

    expect(project.sourceMode).toBe("idea");
    expect(project.sourceIdea).toBe("A rooftop radio thriller.");
    expect(project.artifacts.map((artifact) => artifact.kind)).toEqual(
      expect.arrayContaining(["idea_prompt", "generated_script", "parse_result"])
    );
    expect(project.artifacts.every((artifact) => artifact.sizeBytes > 0)).toBe(true);
  });

  it("rejects unsafe storage IDs before filesystem access", async () => {
    await expect(getProject("../project")).rejects.toThrow("Project id is invalid.");
  });

  it("uses SCRIPTCAST_STORAGE_DIR when present", () => {
    const previous = process.env.SCRIPTCAST_STORAGE_DIR;
    process.env.SCRIPTCAST_STORAGE_DIR = "./tmp-scriptcast-storage";

    try {
      expect(getStorageRoot()).toBe(path.resolve("./tmp-scriptcast-storage"));
    } finally {
      if (previous === undefined) {
        delete process.env.SCRIPTCAST_STORAGE_DIR;
      } else {
        process.env.SCRIPTCAST_STORAGE_DIR = previous;
      }
    }
  });

  it("rejects macOS dataless placeholder files before reading them", async () => {
    await expect(
      assertLocalFileAvailable("/offline/project.json", {
        platform: "darwin",
        readFlags: async () => "hidden,compressed,dataless"
      })
    ).rejects.toThrow("offline");
  });
});
