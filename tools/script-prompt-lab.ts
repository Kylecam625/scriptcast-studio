import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OPENAI_MODEL, extractResponseText, normalizeOpenAIModel } from "../lib/openai.ts";
import {
  buildDraftUserPrompt,
  defaultDraftSystemPrompt,
  type DraftDeliveryPreset,
  type DraftIdeaChatMessage,
  type DraftScriptDuration
} from "../lib/scriptPrompting.ts";

export { buildDraftUserPrompt, defaultDraftSystemPrompt } from "../lib/scriptPrompting.ts";

export type PromptVariant = {
  id: string;
  label: string;
  systemPrompt: string;
  notes: string;
};

export type PromptLabOptions = {
  idea?: string;
  conversation?: DraftIdeaChatMessage[];
  preset?: DraftDeliveryPreset;
  duration?: DraftScriptDuration;
  model?: string;
  variants?: PromptVariant[];
  timeoutMs?: number;
  mock?: boolean;
};

export type PromptLabCreateResponseRequest = {
  variant: PromptVariant;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  preset: DraftDeliveryPreset;
  duration: DraftScriptDuration;
  timeoutMs?: number;
};

export type PromptLabDependencies = {
  createResponse?: (request: PromptLabCreateResponseRequest) => Promise<string>;
  now?: () => Date;
};

export type PromptLabResultEntry = {
  variantId: string;
  label: string;
  notes: string;
  systemPrompt: string;
  output: string;
  error: string | null;
  elapsedMs: number;
};

export type PromptLabResult = {
  runId: string;
  createdAt: string;
  model: string;
  preset: DraftDeliveryPreset;
  duration: DraftScriptDuration;
  idea: string;
  conversation: DraftIdeaChatMessage[];
  userPrompt: string;
  results: PromptLabResultEntry[];
};

export type PromptLabArtifacts = {
  directory: string;
  reportPath: string;
  jsonPath: string;
};

export const scriptPromptVariants: PromptVariant[] = [
  {
    id: "baseline",
    label: "Current baseline",
    notes: "The system prompt currently used by the main script generator.",
    systemPrompt: defaultDraftSystemPrompt
  },
  {
    id: "audio-drama-polish",
    label: "Audio drama polish",
    notes: "Raises the prose quality while keeping the parser-friendly screenplay format.",
    systemPrompt:
      "Write premium audio-drama scripts for a multi-character ElevenLabs Eleven v3 workflow. Make the dialogue specific, emotionally playable, and natural instead of generic. Use parser-friendly screenplay text only: a Markdown title, bracketed audible stage directions, and UPPERCASE speaker labels followed by dialogue. Build tension through concrete sound cues, character choices, and clean story beats. Do not use code fences."
  },
  {
    id: "cinematic-grounded",
    label: "Cinematic grounded",
    notes: "Pushes cinematic detail without melodrama or vague atmosphere.",
    systemPrompt:
      "Write grounded cinematic audio scripts for a multi-character ElevenLabs Eleven v3 workflow. Favor vivid, specific language over hype, cliches, or broad exposition. Every line should either reveal character, move conflict, or create an audible moment. Use parser-friendly screenplay text only: a Markdown title, bracketed stage directions for concrete sounds, and UPPERCASE speaker labels followed by dialogue. Do not use code fences."
  },
  {
    id: "dialogue-first",
    label: "Dialogue first",
    notes: "Prioritizes speakable character voices and reduces narrator overuse.",
    systemPrompt:
      "Write dialogue-first scripts for a multi-character ElevenLabs Eleven v3 workflow. Give every speaker a distinct agenda, rhythm, and emotional temperature. Keep narration minimal unless it creates an important audio image. Use parser-friendly screenplay text only: a Markdown title, bracketed audible stage directions, and UPPERCASE speaker labels followed by dialogue. Do not use code fences."
  },
  {
    id: "prestige-podcast",
    label: "Prestige podcast",
    notes: "A polished narrative podcast tone with strong hooks and restrained style.",
    systemPrompt:
      "Write polished narrative podcast scripts for a multi-character ElevenLabs Eleven v3 workflow. Open with a strong audible hook, keep the language smart and direct, and make each beat feel intentional. Avoid cheesy phrasing, filler, and over-explaining. Use parser-friendly screenplay text only: a Markdown title, bracketed concrete sound directions, and UPPERCASE speaker labels followed by dialogue. Do not use code fences."
  },
  {
    id: "thriller-tension",
    label: "Thriller tension",
    notes: "Tests sharper pacing, pressure, and cleaner reversals.",
    systemPrompt:
      "Write tension-forward audio scripts for a multi-character ElevenLabs Eleven v3 workflow. Make scenes feel active: characters want something now, pressure rises, and each sound cue changes what the listener understands. Keep wording clean, adult, and specific. Use parser-friendly screenplay text only: a Markdown title, bracketed audible stage directions, and UPPERCASE speaker labels followed by dialogue. Do not use code fences."
  },
  {
    id: "character-premium",
    label: "Character premium",
    notes: "Optimizes for believable motives and less stock phrasing.",
    systemPrompt:
      "Write character-driven audio scripts for a multi-character ElevenLabs Eleven v3 workflow. Treat the premise as real to the characters. Give them grounded motives, subtext, and reactions that do not sound like placeholder dialogue. Use parser-friendly screenplay text only: a Markdown title, bracketed audible stage directions, and UPPERCASE speaker labels followed by dialogue. Do not use code fences."
  },
  {
    id: "sound-design-led",
    label: "Sound design led",
    notes: "Tests whether stronger sound direction improves ElevenLabs output.",
    systemPrompt:
      "Write sound-design-led audio scripts for a multi-character ElevenLabs Eleven v3 workflow. Let recognizable sounds reveal location, action, and emotional shifts, but keep sound cues concrete and playable. Dialogue should remain natural and story-focused. Use parser-friendly screenplay text only: a Markdown title, bracketed audible stage directions, and UPPERCASE speaker labels followed by dialogue. Do not use code fences."
  },
  {
    id: "lean-commercial",
    label: "Lean commercial",
    notes: "A cleaner, tighter style for scripts that should feel produced rather than overwritten.",
    systemPrompt:
      "Write clean, production-ready audio scripts for a multi-character ElevenLabs Eleven v3 workflow. Keep the prose tight, the beats clear, and the dialogue easy to perform. Avoid purple language, generic inspirational wording, and repeated emotional tags. Use parser-friendly screenplay text only: a Markdown title, bracketed audible stage directions, and UPPERCASE speaker labels followed by dialogue. Do not use code fences."
  },
  {
    id: "scene-craft",
    label: "Scene craft",
    notes: "Focuses on beginning, escalation, turn, and ending rather than decorative writing.",
    systemPrompt:
      "Write well-structured audio scenes for a multi-character ElevenLabs Eleven v3 workflow. Shape each script around a clear opening image, escalating conflict, a turn, and a final beat that lands. Make the wording vivid but not corny. Use parser-friendly screenplay text only: a Markdown title, bracketed audible stage directions, and UPPERCASE speaker labels followed by dialogue. Do not use code fences."
  }
];

export async function runPromptLab(options: PromptLabOptions, dependencies: PromptLabDependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const createdAt = now();
  const runId = formatRunId(createdAt);
  const preset = options.preset || "Cinematic";
  const duration = options.duration || "Medium";
  const variants = options.variants?.length ? options.variants : scriptPromptVariants;
  const userPrompt = buildDraftUserPrompt({
    idea: options.idea,
    conversation: options.conversation,
    preset,
    duration
  });

  if (!userPrompt) {
    throw new Error("Provide an idea or a conversation in the prompt lab input.");
  }

  const model = normalizeOpenAIModel(options.model);
  const createResponse = dependencies.createResponse || createOpenAIResponseForPromptLab;
  const results: PromptLabResultEntry[] = [];

  for (const variant of variants) {
    const started = performance.now();

    try {
      const output = options.mock
        ? createMockPromptLabOutput(variant, userPrompt)
        : await createResponse({
            variant,
            systemPrompt: variant.systemPrompt,
            userPrompt,
            model,
            preset,
            duration,
            timeoutMs: options.timeoutMs
          });

      results.push({
        variantId: variant.id,
        label: variant.label,
        notes: variant.notes,
        systemPrompt: variant.systemPrompt,
        output: output.trim(),
        error: null,
        elapsedMs: Math.round(performance.now() - started)
      });
    } catch (error) {
      results.push({
        variantId: variant.id,
        label: variant.label,
        notes: variant.notes,
        systemPrompt: variant.systemPrompt,
        output: "",
        error: error instanceof Error ? error.message : "Unknown prompt lab error.",
        elapsedMs: Math.round(performance.now() - started)
      });
    }
  }

  return {
    runId,
    createdAt: createdAt.toISOString(),
    model,
    preset,
    duration,
    idea: options.idea?.trim() || "",
    conversation: options.conversation || [],
    userPrompt,
    results
  };
}

export function formatPromptLabMarkdown(result: PromptLabResult) {
  const lines = [
    `# Script Prompt Lab Run ${result.runId}`,
    "",
    `Model: \`${result.model}\``,
    `Preset: \`${result.preset}\``,
    `Duration: \`${result.duration}\``,
    `Created: \`${result.createdAt}\``,
    "",
    "## Pick Notes",
    "",
    "- Best variant:",
    "- Why:",
    "- Main prompt changes to carry over:",
    "",
    "## Source Input",
    "",
    result.idea ? `Idea: ${result.idea}` : "Idea: n/a",
    "",
    "## Results Summary",
    "",
    "| # | Variant | Status | Time |",
    "|---:|---|---|---:|",
    ...result.results.map((entry, index) => {
      const status = entry.error ? `Error: ${entry.error.replace(/\|/g, "\\|")}` : "OK";
      return `| ${index + 1} | ${entry.label} (\`${entry.variantId}\`) | ${status} | ${entry.elapsedMs}ms |`;
    }),
    "",
    "## Outputs"
  ];

  result.results.forEach((entry, index) => {
    lines.push(
      "",
      `### ${index + 1}. ${entry.label}`,
      "",
      `Variant id: \`${entry.variantId}\``,
      "",
      entry.notes,
      "",
      "#### System prompt",
      "",
      fence("text", entry.systemPrompt),
      "",
      "#### Draft",
      "",
      entry.error ? `Error: ${entry.error}` : fence("markdown", entry.output)
    );
  });

  return `${lines.join("\n")}\n`;
}

export async function writePromptLabArtifacts(result: PromptLabResult, outputRoot = "prompt-lab-runs") {
  const directory = path.join(outputRoot, result.runId);
  await mkdir(directory, { recursive: true });

  const reportPath = path.join(directory, "report.md");
  const jsonPath = path.join(directory, "results.json");

  await Promise.all([
    writeFile(reportPath, formatPromptLabMarkdown(result), "utf8"),
    writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  ]);

  return { directory, reportPath, jsonPath };
}

async function createOpenAIResponseForPromptLab(request: PromptLabCreateResponseRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to .env.local or run with --mock.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 90_000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        input: [
          {
            role: "system",
            content: request.systemPrompt
          },
          {
            role: "user",
            content: request.userPrompt
          }
        ],
        store: false,
        truncation: "auto",
        metadata: {
          task: "prompt_lab",
          route: "script-prompt-lab",
          variant: request.variant.id,
          preset: request.preset,
          duration: request.duration
        },
        prompt_cache_key: `scriptcast-lab-${request.variant.id}`.slice(0, 64),
        reasoning: {
          effort: "low"
        },
        text: {
          verbosity: "medium"
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const message = data?.error?.message || `OpenAI prompt lab failed with ${response.status}`;
      throw new Error(`OpenAI prompt lab failed using ${request.model}: ${message}`);
    }

    return extractResponseText(await response.json());
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`OpenAI prompt lab timed out after ${request.timeoutMs ?? 90_000}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createMockPromptLabOutput(variant: PromptVariant, userPrompt: string) {
  const firstIdeaLine = userPrompt
    .split(/\r?\n/)
    .find((line) => line.startsWith("Additional idea notes:") || line.startsWith("User:"));

  return [
    `# Mock Draft - ${variant.label}`,
    "",
    `[prompt lab mock based on ${firstIdeaLine || "the supplied source"}]`,
    "",
    "NARRATOR: [quietly] This mock run proves the prompt lab pipeline is wired before spending API tokens.",
    "",
    "LEAD: [focused] Run it with the real API when the inputs are ready."
  ].join("\n");
}

function formatRunId(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function fence(language: string, value: string) {
  const ticks = value.match(/`{3,}/g);
  const fenceLength = ticks ? Math.max(...ticks.map((match) => match.length)) + 1 : 3;
  const marker = "`".repeat(fenceLength);
  return `${marker}${language}\n${value.trim()}\n${marker}`;
}

function printUsage() {
  console.log(`Usage:
  npm run prompt:lab -- --idea "A lighthouse keeper hears a rescue call from the future."
  npm run prompt:lab -- --case data/prompt-lab-case.json
  npm run prompt:lab -- --idea "..." --duration Short --preset Cinematic --limit 3 --mock

Options:
  --idea <text>       Story idea to test.
  --case <path>       JSON file with idea, conversation, preset, duration, model, or limit.
  --preset <name>     Natural, Anime/Dramatic, Podcast, Audiobook, Game Dialogue, Cinematic.
  --duration <name>   Short, Medium, or Long.
  --model <name>      Defaults to OPENAI_MODEL or ${DEFAULT_OPENAI_MODEL}.
  --limit <number>    Run only the first N variants.
  --out <path>        Output folder. Defaults to prompt-lab-runs.
  --mock              Write comparison artifacts without calling OpenAI.
`);
}

async function readCaseFile(casePath: string) {
  const raw = await readFile(casePath, "utf8");
  return JSON.parse(raw) as PromptLabOptions & { limit?: number; out?: string };
}

async function runCli(argv: string[]) {
  await loadEnvFiles(process.cwd());

  const cli = parseArgs(argv);
  if (cli.help) {
    printUsage();
    return 0;
  }

  const caseOptions = cli.casePath ? await readCaseFile(cli.casePath) : {};
  const limit = cli.limit || caseOptions.limit;
  const outputRoot = cli.out || caseOptions.out || "prompt-lab-runs";
  const variants = typeof limit === "number" ? scriptPromptVariants.slice(0, limit) : scriptPromptVariants;
  const options: PromptLabOptions = {
    ...caseOptions,
    idea: cli.idea ?? caseOptions.idea,
    preset: cli.preset ?? caseOptions.preset,
    duration: cli.duration ?? caseOptions.duration,
    model: cli.model ?? caseOptions.model,
    mock: cli.mock || caseOptions.mock,
    variants
  };

  if (!options.idea?.trim() && !options.conversation?.some((message) => message.role === "user" && message.content.trim())) {
    printUsage();
    throw new Error("Provide --idea or --case with a user conversation.");
  }

  const result = await runPromptLab(options);
  const artifacts = await writePromptLabArtifacts(result, outputRoot);

  console.log(`Prompt lab complete: ${artifacts.reportPath}`);
  console.log(`Raw JSON: ${artifacts.jsonPath}`);
  return 0;
}

function parseArgs(argv: string[]) {
  const parsed: {
    help?: boolean;
    idea?: string;
    casePath?: string;
    preset?: DraftDeliveryPreset;
    duration?: DraftScriptDuration;
    model?: string;
    limit?: number;
    out?: string;
    mock?: boolean;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      index += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--idea") {
      parsed.idea = next();
    } else if (arg === "--case") {
      parsed.casePath = next();
    } else if (arg === "--preset") {
      parsed.preset = next() as DraftDeliveryPreset;
    } else if (arg === "--duration") {
      parsed.duration = next() as DraftScriptDuration;
    } else if (arg === "--model") {
      parsed.model = next();
    } else if (arg === "--limit") {
      const value = Number.parseInt(next(), 10);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--limit must be a positive number.");
      }
      parsed.limit = value;
    } else if (arg === "--out") {
      parsed.out = next();
    } else if (arg === "--mock") {
      parsed.mock = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

async function loadEnvFiles(cwd: string) {
  for (const file of [".env.local", ".env"]) {
    const envPath = path.join(cwd, file);
    const raw = await readFile(envPath, "utf8").catch(() => "");

    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        return;
      }

      const [key, ...valueParts] = trimmed.split("=");
      if (process.env[key]) {
        return;
      }

      process.env[key] = valueParts.join("=").replace(/^['"]|['"]$/g, "");
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
