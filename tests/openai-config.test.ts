import { describe, expect, it } from "vitest";
import { normalizeOpenAIModel } from "@/lib/openai";

describe("normalizeOpenAIModel", () => {
  it("uses the available mini model when the requested GPT-5.5 mini slug does not exist", () => {
    expect(normalizeOpenAIModel("gpt 5.5 mini")).toBe("gpt-5.4-mini");
    expect(normalizeOpenAIModel("gpt-5.5-mini")).toBe("gpt-5.4-mini");
  });

  it("keeps exact valid configured model slugs", () => {
    expect(normalizeOpenAIModel("gpt-5.5")).toBe("gpt-5.5");
    expect(normalizeOpenAIModel("gpt-5.4-mini")).toBe("gpt-5.4-mini");
  });
});
