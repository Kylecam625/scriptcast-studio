import { createHash } from "node:crypto";
import { extractResponseText, normalizeOpenAIModel } from "@/lib/openai";

type ResponseRole = "system" | "user" | "assistant";
type ResponseInput = string | Array<{ role: ResponseRole; content: string }>;
type ReasoningEffort = "minimal" | "low" | "medium" | "high";
type TextVerbosity = "low" | "medium" | "high";
type OpenAITask = "chat" | "draft" | "parse" | "enhance";
type MetadataValue = string | number | boolean | null | undefined;

export type CreateOpenAIResponseOptions = {
  task: OpenAITask;
  input: ResponseInput;
  model?: string;
  metadata?: Record<string, MetadataValue>;
  promptCacheKey?: string;
  safetySeed?: string;
  timeoutMs?: number;
  reasoning?: {
    effort: ReasoningEffort;
  };
  text?: {
    verbosity?: TextVerbosity;
    format?: unknown;
  };
};

export async function createOpenAIResponse(options: CreateOpenAIResponseOptions) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = normalizeOpenAIModel(options.model);
  const body = buildOpenAIResponseBody(options, model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const message = data?.error?.message || `OpenAI ${options.task} failed with ${response.status}`;
      throw new Error(`OpenAI ${options.task} failed using ${model}: ${message}`);
    }

    const data = await response.json();
    ensureCompleteResponse(data, options.task);
    return extractResponseText(data);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`OpenAI ${options.task} timed out after ${options.timeoutMs ?? 60_000}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildOpenAIResponseBody(options: CreateOpenAIResponseOptions, model = normalizeOpenAIModel(options.model)) {
  const body: Record<string, unknown> = {
    model,
    input: options.input,
    store: false,
    truncation: "auto",
    metadata: sanitizeMetadata({
      task: options.task,
      ...options.metadata
    }),
    safety_identifier: createSafetyIdentifier(
      options.safetySeed ||
        process.env.SCRIPTCAST_INSTANCE_ID ||
        process.env.SCRIPTCAST_ACCESS_CODE ||
        "local-scriptcast"
    )
  };

  if (options.promptCacheKey) {
    body.prompt_cache_key = options.promptCacheKey.slice(0, 64);
  }

  if (options.reasoning) {
    body.reasoning = options.reasoning;
  }

  if (options.text) {
    body.text = options.text;
  }

  return body;
}

export function createSafetyIdentifier(seed: string) {
  const digest = createHash("sha256").update(`scriptcast:${seed}`).digest("hex").slice(0, 32);
  return `scriptcast_${digest}`;
}

function sanitizeMetadata(metadata: Record<string, MetadataValue>) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 16)
      .map(([key, value]) => [key.slice(0, 64), String(value).slice(0, 512)])
  );
}

function ensureCompleteResponse(data: unknown, task: OpenAITask) {
  const response = data as {
    status?: string;
    error?: { message?: string } | null;
    incomplete_details?: { reason?: string } | null;
  };

  if (response.error?.message) {
    throw new Error(`OpenAI ${task} response error: ${response.error.message}`);
  }

  if (response.status === "incomplete") {
    throw new Error(
      `OpenAI ${task} response incomplete: ${response.incomplete_details?.reason || "unknown reason"}`
    );
  }
}
