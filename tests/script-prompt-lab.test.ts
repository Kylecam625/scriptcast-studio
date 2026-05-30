import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDraftUserPrompt,
  defaultDraftSystemPrompt,
  formatPromptLabMarkdown,
  runPromptLab,
  scriptPromptVariants,
  writePromptLabArtifacts
} from "@/tools/script-prompt-lab";

const conversation = [
  {
    role: "user" as const,
    content: "A lighthouse keeper hears a rescue call from the future."
  },
  {
    role: "assistant" as const,
    content: "Who is with them and what does the storm sound like?"
  },
  {
    role: "user" as const,
    content: "Their skeptical sister is there, and the storm keeps knocking out the radio."
  }
];

describe("script prompt lab", () => {
  it("builds the same draft user prompt shape used by script generation", () => {
    const prompt = buildDraftUserPrompt({
      conversation,
      idea: "Make the ending unsettling.",
      preset: "Cinematic",
      duration: "Short"
    });

    expect(prompt).toContain("Use this story-development chat transcript as the source material:");
    expect(prompt).toContain("User: A lighthouse keeper hears a rescue call from the future.");
    expect(prompt).toContain("AI: Who is with them");
    expect(prompt).toContain("Additional idea notes: Make the ending unsettling.");
    expect(prompt).toContain("Delivery style: Cinematic");
    expect(prompt).toContain("Target audio duration: Short. Short target: about 1 to 2 minutes");
    expect(prompt).toContain("Create 8 to 12 turns");
  });

  it("defines ten candidate system prompts including the current baseline", () => {
    expect(scriptPromptVariants).toHaveLength(10);
    expect(scriptPromptVariants[0]).toMatchObject({
      id: "baseline",
      label: "Current baseline",
      systemPrompt: defaultDraftSystemPrompt
    });
    expect(new Set(scriptPromptVariants.map((variant) => variant.id)).size).toBe(10);
  });

  it("uses the selected general-purpose script generation system prompt", () => {
    expect(defaultDraftSystemPrompt).toContain("Write premium audio scripts");
    expect(defaultDraftSystemPrompt).toContain("specific, emotionally playable, and natural instead of generic");
    expect(defaultDraftSystemPrompt).toContain("concrete sound cues, character choices, clear emotional beats");
    expect(defaultDraftSystemPrompt).toContain("a satisfying ending");
    expect(defaultDraftSystemPrompt).not.toContain("Build tension through");
    expect(defaultDraftSystemPrompt).not.toContain("audio-drama");
  });

  it("runs each prompt variant against the same user prompt", async () => {
    const seen: Array<{ systemPrompt: string; userPrompt: string }> = [];

    const result = await runPromptLab(
      {
        idea: "A museum audio guide starts confessing crimes.",
        preset: "Podcast",
        duration: "Medium",
        variants: scriptPromptVariants.slice(0, 2),
        model: "gpt-test"
      },
      {
        createResponse: async ({ systemPrompt, userPrompt }) => {
          seen.push({ systemPrompt, userPrompt });
          return `Draft from ${systemPrompt.slice(0, 12)}`;
        },
        now: () => new Date("2026-05-30T12:00:00.000Z")
      }
    );

    expect(result.runId).toBe("2026-05-30T12-00-00-000Z");
    expect(result.model).toBe("gpt-test");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      variantId: "baseline",
      label: "Current baseline",
      error: null
    });
    expect(seen).toEqual([
      {
        systemPrompt: scriptPromptVariants[0].systemPrompt,
        userPrompt: expect.stringContaining("A museum audio guide starts confessing crimes.")
      },
      {
        systemPrompt: scriptPromptVariants[1].systemPrompt,
        userPrompt: expect.stringContaining("A museum audio guide starts confessing crimes.")
      }
    ]);
  });

  it("captures prompt variant errors without stopping the full comparison", async () => {
    const result = await runPromptLab(
      {
        idea: "A train conductor loses one impossible passenger.",
        variants: scriptPromptVariants.slice(0, 2)
      },
      {
        createResponse: async ({ variant }) => {
          if (variant.id === "baseline") {
            throw new Error("model overloaded");
          }
          return "A clean draft";
        },
        now: () => new Date("2026-05-30T12:00:00.000Z")
      }
    );

    expect(result.results.map((entry) => entry.error)).toEqual(["model overloaded", null]);
    expect(result.results.map((entry) => entry.output)).toEqual(["", "A clean draft"]);
  });

  it("formats a markdown report with comparison slots and full drafts", async () => {
    const result = await runPromptLab(
      {
        idea: "A night-shift nurse gets voicemails from patients who are still alive.",
        variants: scriptPromptVariants.slice(0, 1),
        model: "gpt-test"
      },
      {
        createResponse: async () => "# Ward Seven\n\n[fluorescent lights buzz]",
        now: () => new Date("2026-05-30T12:00:00.000Z")
      }
    );

    const markdown = formatPromptLabMarkdown(result);

    expect(markdown).toContain("# Script Prompt Lab Run 2026-05-30T12-00-00-000Z");
    expect(markdown).toContain("Model: `gpt-test`");
    expect(markdown).toContain("## Pick Notes");
    expect(markdown).toContain("- Best variant:");
    expect(markdown).toContain("### 1. Current baseline");
    expect(markdown).toContain("# Ward Seven");
    expect(markdown).toContain("System prompt");
  });

  it("writes markdown and json artifacts for later review", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "script-prompt-lab-"));

    try {
      const result = await runPromptLab(
        {
          idea: "A shuttle pilot hears mission control answering before she speaks.",
          variants: scriptPromptVariants.slice(0, 1)
        },
        {
          createResponse: async () => "# Echo Orbit\n\nPILOT: [quietly] That was my voice.",
          now: () => new Date("2026-05-30T12:00:00.000Z")
        }
      );

      const artifacts = await writePromptLabArtifacts(result, root);

      expect(artifacts.directory).toBe(path.join(root, "2026-05-30T12-00-00-000Z"));
      expect(await readFile(artifacts.reportPath, "utf8")).toContain("# Echo Orbit");
      expect(JSON.parse(await readFile(artifacts.jsonPath, "utf8"))).toMatchObject({
        runId: "2026-05-30T12-00-00-000Z",
        results: [{ variantId: "baseline" }]
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
