export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

const unavailableAliases: Record<string, string> = {
  "gpt-5.5-mini": DEFAULT_OPENAI_MODEL,
  "gpt5.5-mini": DEFAULT_OPENAI_MODEL,
  "gpt-5-5-mini": DEFAULT_OPENAI_MODEL
};

export function normalizeOpenAIModel(model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL) {
  const slug = model.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return unavailableAliases[slug] || slug || DEFAULT_OPENAI_MODEL;
}

export function extractResponseText(response: unknown) {
  const data = response as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
        refusal?: string;
        type?: string;
      }>;
    }>;
  };

  if (data.output_text) {
    return data.output_text;
  }

  for (const output of data.output || []) {
    for (const item of output.content || []) {
      if (item.refusal) {
        throw new Error(`OpenAI refused to parse this script: ${item.refusal}`);
      }
      if (item.text) {
        return item.text;
      }
    }
  }

  throw new Error("OpenAI returned an empty parse response.");
}
