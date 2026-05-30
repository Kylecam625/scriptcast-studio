import { sampleScript } from "@/lib/sampleScript";
import { shouldUseOpenAI } from "@/lib/env";
import { createOpenAIResponse } from "@/lib/openaiResponses";
import {
  buildDraftSourcePrompt,
  buildDraftUserPrompt,
  defaultDraftSystemPrompt,
  ideaConversationToText
} from "@/lib/scriptPrompting";
import { DeliveryPreset, IdeaChatMessage, IdeaChatReply, IdeaChatReplySchema, ScriptDuration } from "@/lib/schemas";

type DraftOptions = {
  idea?: string;
  conversation?: IdeaChatMessage[];
  preset: DeliveryPreset;
  duration?: ScriptDuration;
};

export { ideaConversationToText };

export async function continueIdeaChat(
  messages: IdeaChatMessage[],
  preset: DeliveryPreset
): Promise<IdeaChatReply> {
  if (!messages.some((message) => message.role === "user" && message.content.trim())) {
    throw new Error("Send an idea before asking the AI to respond.");
  }

  if (!shouldUseOpenAI()) {
    return createMockChatReply(messages, preset);
  }

  const text = await createOpenAIResponse({
    task: "chat",
    input: [
      {
        role: "system",
        content:
          "You are a concise story development partner for a script-to-audio app. Help the user shape an audio-first story through short back-and-forth chat. Ask one focused multiple-choice question per reply with exactly three specific choices. Suggest characters, conflict, sound moments, structure, or ending direction. Do not write the full script until the user clicks Generate story."
      },
      ...messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ],
    metadata: {
      route: "api-idea-chat",
      preset,
      schema: "scriptcast_idea_chat_reply"
    },
    promptCacheKey: "scriptcast-idea-chat-v1",
    reasoning: {
      effort: "low"
    },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "scriptcast_idea_chat_reply",
        strict: true,
        schema: ideaChatReplyJsonSchema
      }
    }
  });

  return cleanIdeaChatReply(IdeaChatReplySchema.parse(JSON.parse(text)));
}

export async function draftScriptFromIdea(options: DraftOptions): Promise<string> {
  const prompt = buildDraftSourcePrompt(options);
  if (!prompt) {
    throw new Error("Chat with the AI or describe the idea first.");
  }

  const duration = options.duration || "Medium";
  const userPrompt = buildDraftUserPrompt({ ...options, duration });

  if (!shouldUseOpenAI()) {
    return createMockDraft(userPrompt);
  }

  const text = await createOpenAIResponse({
    task: "draft",
    input: [
      {
        role: "system",
        content: defaultDraftSystemPrompt
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    metadata: {
      route: "api-script",
      preset: options.preset,
      duration
    },
    promptCacheKey: "scriptcast-script-draft-v2",
    reasoning: {
      effort: "low"
    },
    text: {
      verbosity: "medium"
    }
  });

  return cleanDraft(text);
}

function cleanDraft(value: string) {
  return value
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function cleanChatReply(value: string) {
  return value
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function cleanIdeaChatReply(reply: IdeaChatReply): IdeaChatReply {
  return IdeaChatReplySchema.parse({
    content: cleanChatReply(reply.content),
    question: cleanChatReply(reply.question),
    choices: reply.choices.map((choice) => ({
      id: choice.id.trim(),
      label: choice.label.trim(),
      description: choice.description.trim()
    }))
  });
}

function createMockChatReply(messages: IdeaChatMessage[], preset: DeliveryPreset) {
  const userMessages = messages.filter((message) => message.role === "user");
  const latest = userMessages[userMessages.length - 1]?.content || "the idea";
  const replyNumber = messages.filter((message) => message.role === "assistant").length + 1;

  if (replyNumber === 1) {
    return {
      content: `Good start. For a ${preset.toLowerCase()} audio story, I would shape this around a clear pressure point: ${latest}`,
      question:
        "Who is the main character, what do they want in this scene, and what sound should instantly tell us where we are?",
      choices: [
        {
          id: "lead",
          label: "Driven lead",
          description: "Center the scene on one protagonist chasing a specific goal."
        },
        {
          id: "duo",
          label: "Tense duo",
          description: "Pair the lead with someone who challenges every choice."
        },
        {
          id: "soundscape",
          label: "Sound first",
          description: "Start by defining the signature sound that reveals the setting."
        }
      ]
    };
  }

  if (replyNumber === 2) {
    return {
      content:
        "That gives us a stronger spine. I would add one opposing voice, one recurring sound motif, and one choice the lead has to make before the signal or opportunity disappears.",
      question: "What ending tone should the story build toward?",
      choices: [
        {
          id: "hopeful",
          label: "Hopeful",
          description: "Resolve the danger while leaving a warm emotional afterglow."
        },
        {
          id: "eerie",
          label: "Eerie",
          description: "Answer one mystery while implying something stranger remains."
        },
        {
          id: "unresolved",
          label: "Unresolved",
          description: "End on a hard choice, a cut signal, or an unanswered call."
        }
      ]
    };
  }

  return {
    content:
      "I have enough to generate a draft now. If you want to refine further, add one more note about the ending, a character secret, or a sound effect you definitely want included.",
    question: "What would you like to lock in before generating?",
    choices: [
      {
        id: "ending",
        label: "Ending beat",
        description: "Choose the final emotional turn or last image."
      },
      {
        id: "secret",
        label: "Character secret",
        description: "Add a hidden motive or reveal that changes the scene."
      },
      {
        id: "sound",
        label: "Signature sound",
        description: "Name the recurring audio cue the script should feature."
      }
    ]
  };
}

const ideaChatReplyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["content", "question", "choices"],
  properties: {
    content: { type: "string" },
    question: { type: "string" },
    choices: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "description"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          description: { type: "string" }
        }
      }
    }
  }
};

function createMockDraft(idea: string) {
  return [
    "# Generated Scene",
    "",
    `[A quick generated draft based on: ${idea}]`,
    "",
    sampleScript
      .replace(/^# .+$/m, "# The Rooftop Signal")
      .split(/\r?\n/)
      .filter((line) => !line.includes("Mock parser"))
      .join("\n")
      .trim()
  ].join("\n");
}
