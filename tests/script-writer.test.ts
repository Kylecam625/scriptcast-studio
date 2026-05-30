import { afterEach, describe, expect, it, vi } from "vitest";
import { continueIdeaChat, draftScriptFromIdea, ideaConversationToText } from "@/lib/scriptWriter";
import type { IdeaChatMessage } from "@/lib/schemas";

const originalEnv = { ...process.env };

const messages: IdeaChatMessage[] = [
  {
    role: "user",
    content: "A lighthouse keeper hears a rescue call from the future."
  },
  {
    role: "assistant",
    content: "Great audio setup. Who is with them and what does the storm sound like?"
  },
  {
    role: "user",
    content: "Their skeptical sister is there, and the storm keeps knocking out the radio."
  }
];

describe("idea chat script writer", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("continues the idea chat with a multiple-choice question", async () => {
    const reply = await continueIdeaChat(messages.slice(0, 1), "Cinematic");

    expect(reply.content).toContain("Good start");
    expect(reply.question).toContain("Who is the main character");
    expect(reply.choices).toHaveLength(3);
    expect(reply.choices[0]).toMatchObject({
      id: "lead",
      label: expect.any(String),
      description: expect.any(String)
    });
  });

  it("requests a strict structured output schema for OpenAI idea chat replies", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            content: "The future rescue call is a strong hook.",
            question: "What should the keeper choose next?",
            choices: [
              {
                id: "answer",
                label: "Answer the call",
                description: "They break protocol and speak to the future survivor."
              },
              {
                id: "ignore",
                label: "Ignore it",
                description: "They treat it as storm interference until evidence piles up."
              },
              {
                id: "sister",
                label: "Ask the sister",
                description: "The sibling recognizes something impossible in the signal."
              }
            ]
          })
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await continueIdeaChat(messages.slice(0, 1), "Cinematic");

    expect(reply.question).toBe("What should the keeper choose next?");
    expect(reply.choices.map((choice) => choice.id)).toEqual(["answer", "ignore", "sister"]);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.text).toMatchObject({
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "scriptcast_idea_chat_reply",
        strict: true,
        schema: {
          additionalProperties: false,
          required: ["content", "question", "choices"]
        }
      }
    });
    expect(body.text.format.schema.properties.choices).toMatchObject({
      type: "array",
      minItems: 3,
      maxItems: 3
    });
  });

  it("turns the full chat transcript into a draft script source", async () => {
    const transcript = ideaConversationToText(messages);
    const script = await draftScriptFromIdea({
      conversation: messages,
      preset: "Cinematic"
    });

    expect(transcript).toContain("User: A lighthouse keeper");
    expect(transcript).toContain("AI: Great audio setup");
    expect(script).toContain("# Generated Scene");
    expect(script).toContain("A lighthouse keeper hears a rescue call from the future.");
  });

  it("includes the requested duration target when drafting a mock script", async () => {
    const script = await draftScriptFromIdea({
      conversation: messages,
      preset: "Cinematic",
      duration: "Short"
    });

    expect(script).toContain("Target audio duration: Short");
    expect(script).toContain("Short target: about 1 to 2 minutes");
    expect(script).toContain("Create 8 to 12 turns");
  });

  it("sends duration guidance to OpenAI draft requests", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.SCRIPTCAST_MOCK_MODE = "false";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: "# Generated Scene\n\n[storm pounds the windows]\n\nNARRATOR: [low] The light flickered."
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await draftScriptFromIdea({
      conversation: messages,
      preset: "Cinematic",
      duration: "Long"
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    const userMessage = body.input.find((message: { role: string }) => message.role === "user");

    expect(body.metadata).toMatchObject({
      route: "api-script",
      preset: "Cinematic",
      duration: "Long"
    });
    expect(userMessage.content).toContain("Target audio duration: Long");
    expect(userMessage.content).toContain("Long target: about 6 to 9 minutes");
    expect(userMessage.content).toContain("Create 26 to 40 turns");
  });
});
