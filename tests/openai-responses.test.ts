import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenAIResponse, createSafetyIdentifier } from "@/lib/openaiResponses";

const originalEnv = { ...process.env };

describe("createOpenAIResponse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL = "gpt 5.5 mini";
    process.env.SCRIPTCAST_MOCK_MODE = "false";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("sends a Responses API body with metadata, cache key, safety identifier, and text format", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: "structured text" }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await createOpenAIResponse({
      task: "parse",
      input: [
        { role: "system", content: "Return JSON." },
        { role: "user", content: "MARA: Hello" }
      ],
      metadata: {
        route: "api-parse"
      },
      promptCacheKey: "scriptcast-parse",
      safetySeed: "user@example.com",
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "scriptcast_test",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["value"],
            properties: {
              value: { type: "string" }
            }
          }
        }
      }
    });

    expect(text).toBe("structured text");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json"
    });

    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.input).toHaveLength(2);
    expect(body.store).toBe(false);
    expect(body.truncation).toBe("auto");
    expect(body.metadata).toMatchObject({
      task: "parse",
      route: "api-parse"
    });
    expect(body.prompt_cache_key).toBe("scriptcast-parse");
    expect(body.safety_identifier).toMatch(/^scriptcast_[a-f0-9]{32}$/);
    expect(body.safety_identifier).not.toContain("user@example.com");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.text).toMatchObject({
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "scriptcast_test",
        strict: true
      }
    });
  });

  it("throws a clear error when the Responses API reports an incomplete response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: []
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200
          }
        )
      )
    );

    await expect(
      createOpenAIResponse({
        task: "draft",
        input: [{ role: "user", content: "Write a script." }]
      })
    ).rejects.toThrow("OpenAI draft response incomplete: max_output_tokens");
  });
});

describe("createSafetyIdentifier", () => {
  it("hashes the seed without leaking the original value", () => {
    const identifier = createSafetyIdentifier("private-user-code");

    expect(identifier).toMatch(/^scriptcast_[a-f0-9]{32}$/);
    expect(identifier).not.toContain("private-user-code");
    expect(createSafetyIdentifier("private-user-code")).toBe(identifier);
  });
});
