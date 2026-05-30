"use client";

import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  FileText,
  Info,
  ListChecks,
  Loader2,
  Moon,
  MessageCircle,
  Mic2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Wand2,
  Waves
} from "lucide-react";
import clsx from "clsx";
import {
  apiStatusReducer,
  initialApiStatus,
  type ApiStatusState,
  type ApiTask
} from "@/lib/apiStatus";
import { chunkTurnsForDialogue } from "@/lib/chunker";
import { prepareTurnsForDelivery } from "@/lib/generationFlow";
import { MAX_SCRIPT_CHARACTERS, MAX_SCRIPT_FILE_BYTES, formatCharacterLimit } from "@/lib/limits";
import { sampleScript } from "@/lib/sampleScript";
import {
  bestVoiceForCharacter,
  findProjectBlockingIssues,
  maxReachableStep,
  rankVoicesForCharacter,
  requiredCharacterIdsForGeneration
} from "@/lib/workflow";
import type {
  Character,
  CaptionCue,
  Chunk,
  DeliveryPreset,
  GenerateJob,
  IdeaChatChoice,
  IdeaChatMessage,
  IdeaChatReply,
  ParseResult,
  Project,
  ProjectArtifact,
  ScriptDuration,
  SourceMode,
  Turn,
  VoiceOption
} from "@/lib/schemas";

const steps = ["Upload", "Review Parse", "Cast Voices", "Generate", "Export"] as const;
const deliveryPresets: DeliveryPreset[] = [
  "Natural",
  "Anime/Dramatic",
  "Podcast",
  "Audiobook",
  "Game Dialogue",
  "Cinematic"
];
const scriptDurations: Array<{ value: ScriptDuration; label: string; detail: string }> = [
  { value: "Short", label: "Short", detail: "1-2 min" },
  { value: "Medium", label: "Medium", detail: "3-5 min" },
  { value: "Long", label: "Long", detail: "6-9 min" }
];

type BusyState = "idle" | "chat" | "draft" | "parse" | "voices" | "enhance" | "generate" | "regenerate";
type IdeaChatItem = IdeaChatMessage & { id: string; question?: string; choices?: IdeaChatChoice[] };
type ThemeMode = "light" | "dark";
type ProjectSummary = {
  id: string;
  title: string;
  sourceMode: SourceMode;
  characterCount: number;
  turnCount: number;
  chunkCount: number;
  hasFinalAudio: boolean;
  createdAt: string;
  updatedAt: string;
};

const savedSessionKey = "scriptcast-studio-session-v1";

type SavedSession = {
  rawText: string;
  inputMode: SourceMode;
  project: Project | null;
  parseResult: ParseResult | null;
  characters: Character[];
  turns: Turn[];
  deliveryPreset: DeliveryPreset;
  scriptDuration: ScriptDuration;
  deliveryEnabled: boolean;
  audioVersion: number;
};

export function ScriptCastStudio() {
  const [activeStep, setActiveStep] = useState(0);
  const [inputMode, setInputMode] = useState<SourceMode>("raw_script");
  const [rawText, setRawText] = useState("");
  const [ideaMessages, setIdeaMessages] = useState<IdeaChatItem[]>([]);
  const [ideaInput, setIdeaInput] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [voiceList, setVoiceList] = useState<VoiceOption[]>([]);
  const [deliveryPreset, setDeliveryPreset] = useState<DeliveryPreset>("Natural");
  const [scriptDuration, setScriptDuration] = useState<ScriptDuration>("Medium");
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [job, setJob] = useState<GenerateJob | null>(null);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioVersion, setAudioVersion] = useState(0);
  const [captionTime, setCaptionTime] = useState(0);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [infoOpen, setInfoOpen] = useState(false);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([]);
  const [apiStatus, dispatchApiStatus] = useReducer(apiStatusReducer, initialApiStatus);
  const [statusNow, setStatusNow] = useState(() => Date.now());
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const turnRefs = useRef<Record<string, HTMLElement | null>>({});
  const storageWarningShownRef = useRef(false);

  const rawCharacterCount = rawText.length;
  const chunks = job?.chunks || project?.chunks || [];
  const finalAudioUrl = project ? `/api/export/${project.id}?v=${audioVersion}` : "";
  const completedChunks = chunks.filter((chunk) => chunk.status === "complete").length;
  const requiredCharacterIds = useMemo(() => requiredCharacterIdsForGeneration(turns), [turns]);
  const requiredCharacters = useMemo(
    () => characters.filter((character) => requiredCharacterIds.has(character.id)),
    [characters, requiredCharacterIds]
  );
  const selectedRequiredVoiceCount = requiredCharacters.filter((character) => character.selectedVoiceId).length;
  const requiredVoiceCount = requiredCharacterIds.size;
  const hasRequiredVoices = selectedRequiredVoiceCount >= requiredVoiceCount;
  const hasIdeaChat = ideaMessages.some((message) => message.role === "user" && message.content.trim().length >= 5);
  const canContinueFromUpload = rawText.trim().length > 0 && busy !== "parse" && busy !== "draft" && busy !== "chat";
  const canGenerateDraft = hasIdeaChat && busy !== "draft" && busy !== "chat";
  const ideaTranscript = useMemo(() => ideaMessagesToTranscript(ideaMessages), [ideaMessages]);
  const captions = project?.captions || [];
  const activeCaptions = captions.filter((caption) => captionTime >= caption.start && captionTime <= caption.end);
  const captionTrack = project?.artifacts.find((artifact) => artifact.kind === "captions_vtt") || null;
  const currentApiActivityId = apiStatus.current?.id;
  const currentApiActivityState = apiStatus.current?.state;
  const workflowProject = project ? { ...project, characters, turns } : null;
  const reachableStep = maxReachableStep(workflowProject);
  const blockingIssues = workflowProject ? findProjectBlockingIssues(workflowProject) : [];
  const generationCharCount = turns.reduce((total, turn) => total + turn.ttsText.length, 0);
  const estimatedChunks = useMemo(() => previewChunks(turns), [turns]);
  const reviewTurnCount = turns.filter((turn) => turn.needsReview).length;
  const finalAudioArtifact = project?.artifacts.find((artifact) => artifact.kind === "final_audio") || null;
  const finalAudioExtension = finalAudioArtifact?.mimeType === "audio/wav" || project?.finalAudioPath?.endsWith(".wav")
    ? "WAV"
    : "MP3";
  const estimatedAudioLength = estimateAudioLength(generationCharCount);

  const stats = useMemo(
    () => [
      { label: "Characters", value: characters.length || "-" },
      { label: "Lines", value: turns.length || "-" },
      { label: "Voices", value: requiredVoiceCount ? `${selectedRequiredVoiceCount}/${requiredVoiceCount}` : "-" },
      { label: "Chunks", value: chunks.length || "-" }
    ],
    [characters.length, chunks.length, requiredVoiceCount, selectedRequiredVoiceCount, turns.length]
  );

  useEffect(() => {
    if (currentApiActivityState !== "pending") {
      return;
    }

    const interval = window.setInterval(() => setStatusNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [currentApiActivityId, currentApiActivityState]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("scriptcast-theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    setTheme(savedTheme === "dark" || (!savedTheme && prefersDark) ? "dark" : "light");
    setHasSavedSession(Boolean(window.localStorage.getItem(savedSessionKey)));
    void loadRecentProjects();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("scriptcast-theme", theme);
    } catch {
      // Theme persistence is best-effort.
    }
  }, [theme]);

  useEffect(() => {
    const session: SavedSession = {
      rawText,
      inputMode,
      project,
      parseResult,
      characters,
      turns,
      deliveryPreset,
      scriptDuration,
      deliveryEnabled,
      audioVersion
    };

    if (!rawText.trim() && !project && ideaMessages.length === 0) {
      return;
    }

    try {
      window.localStorage.setItem(savedSessionKey, JSON.stringify(session));
      setHasSavedSession(true);
    } catch {
      if (!storageWarningShownRef.current) {
        storageWarningShownRef.current = true;
        setError("Autosave is unavailable because browser storage is full. The project files are still saved locally.");
      }
    }
  }, [
    audioVersion,
    characters,
    deliveryEnabled,
    deliveryPreset,
    ideaMessages.length,
    inputMode,
    parseResult,
    project,
    rawText,
    scriptDuration,
    turns
  ]);

  useEffect(() => {
    if (activeStep !== 2) {
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
      setPreviewingVoiceId(null);
    }
  }, [activeStep]);

  useEffect(() => {
    if (activeStep > reachableStep) {
      setActiveStep(reachableStep);
    }
  }, [activeStep, reachableStep]);

  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
    };
  }, []);

  async function runApiTask<T>(
    task: ApiTask,
    request: () => Promise<T>,
    successDetail?: (result: T) => string
  ) {
    dispatchApiStatus({ type: "start", task, now: Date.now() });

    try {
      const result = await request();
      dispatchApiStatus({
        type: "succeed",
        detail: successDetail?.(result),
        now: Date.now()
      });
      return result;
    } catch (err) {
      dispatchApiStatus({
        type: "fail",
        error: readError(err),
        now: Date.now()
      });
      throw err;
    }
  }

  async function parseScript() {
    if (!rawText.trim()) {
      setError("Paste or upload script text first.");
      return;
    }
    if (rawText.length > MAX_SCRIPT_CHARACTERS) {
      setError(`Script text must be ${formatCharacterLimit()} characters or fewer.`);
      return;
    }

    setBusy("parse");
    setError(null);
    try {
      const data = await runApiTask(
        "parse",
        () =>
          postJson<{ project: Project; parseResult: ParseResult }>("/api/parse", {
            rawText,
            sourceMode: inputMode,
            sourceIdea: inputMode === "idea" ? ideaTranscript : null
          }),
        (result) =>
          `Found ${result.parseResult.characters.length} characters and ${result.parseResult.turns.length} lines.`
      );
      setProject(data.project);
      setParseResult(data.parseResult);
      setCharacters(data.parseResult.characters);
      setTurns(data.parseResult.turns);
      setJob(null);
      setVoiceList([]);
      setActiveStep(1);
      void loadRecentProjects();
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("idle");
    }
  }

  async function generateScriptDraft() {
    if (!hasIdeaChat) {
      setError("Chat with the AI about your idea before generating the story.");
      return;
    }

    setBusy("draft");
    setError(null);
    try {
      const data = await runApiTask(
        "draft",
        () =>
          postJson<{ script: string }>("/api/script", {
            idea: ideaTranscript,
            conversation: ideaMessages.map(({ role, content }) => ({ role, content })),
            preset: deliveryPreset,
            duration: scriptDuration
          }),
        (result) => `Drafted ${result.script.length.toLocaleString()} characters.`
      );
      setRawText(data.script);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("idle");
    }
  }

  async function sendIdeaMessage() {
    await sendIdeaContent(ideaInput.trim());
  }

  async function sendIdeaChoice(choice: IdeaChatChoice) {
    await sendIdeaContent(`${choice.label}: ${choice.description}`);
  }

  async function sendIdeaContent(content: string) {
    if (!content) {
      return;
    }

    const nextMessages: IdeaChatItem[] = [
      ...ideaMessages,
      {
        id: createClientId("idea-user"),
        role: "user",
        content
      }
    ];

    setIdeaMessages(nextMessages);
    setIdeaInput("");
    setRawText("");
    setBusy("chat");
    setError(null);

    try {
      const data = await runApiTask(
        "chat",
        () =>
          postJson<{
            reply?: IdeaChatReply;
            message?: string;
            question?: string;
            choices?: IdeaChatChoice[];
          }>("/api/idea-chat", {
            messages: nextMessages.map(({ role, content }) => ({ role, content })),
            preset: deliveryPreset
          }),
        () => "Idea reply received."
      );
      const reply = normalizeIdeaReply(data);
      setIdeaMessages([
        ...nextMessages,
        {
          id: createClientId("idea-ai"),
          role: "assistant",
          content: reply.content,
          question: reply.question,
          choices: reply.choices
        }
      ]);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("idle");
    }
  }

  async function loadVoiceList() {
    setBusy("voices");
    setError(null);
    try {
      const data = await runApiTask(
        "voices",
        () => fetchJson<{ voices: VoiceOption[] }>("/api/voices/search"),
        (result) => `Loaded ${result.voices.length} ElevenLabs voices.`
      );
      setVoiceList(data.voices);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("idle");
    }
  }

  async function moveToCastVoices() {
    setActiveStep(2);
    if (voiceList.length === 0) {
      await loadVoiceList();
    }
  }

  async function generateAudio(options: { regenerateChunkId?: string; regenerateTurnId?: string } = {}) {
    if (!project) {
      setError("Parse a script before generating audio.");
      return;
    }

    setBusy(options.regenerateChunkId || options.regenerateTurnId ? "regenerate" : "generate");
    setError(null);

    try {
      const issues = findProjectBlockingIssues({ characters, turns });
      if (issues.length) {
        setError(`Fix these before generating: ${issues.slice(0, 4).join(" ")}`);
        return;
      }

      let nextTurns = prepareTurnsForDelivery(turns, deliveryEnabled);
      if (deliveryEnabled) {
        setBusy("enhance");
        const enhanced = await runApiTask(
          "enhance",
          () =>
            postJson<{ turns: Turn[] }>("/api/enhance", {
              turns,
              preset: deliveryPreset,
              enabled: deliveryEnabled
            }),
          (result) => `Tagged ${result.turns.length} lines for ${deliveryPreset} delivery.`
        );
        nextTurns = enhanced.turns;
      }
      setTurns(nextTurns);

      setBusy(options.regenerateChunkId || options.regenerateTurnId ? "regenerate" : "generate");
      const apiTask = options.regenerateChunkId || options.regenerateTurnId ? "regenerate" : "generate";
      const data = await runApiTask(
        apiTask,
        async () => {
          const started = await postJson<{ job: GenerateJob; project: Project }>("/api/generate", {
            projectId: project.id,
            characters,
            turns: nextTurns,
            preset: deliveryPreset,
            ...options
          });
          setJob(started.job);
          setProject(started.project);
          return pollGenerationJob(started.job.id, started);
        },
        (result) => result.job.message || `Generated ${result.job.chunks.length} chunks.`
      );
      setJob(data.job);
      setProject(data.project);
      setCharacters(data.project.characters);
      setTurns(data.project.turns);
      setAudioVersion((version) => version + 1);
      setCaptionTime(0);
      setActiveStep(4);
      void loadRecentProjects();
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("idle");
    }
  }

  async function pollGenerationJob(
    jobId: string,
    initial: { job: GenerateJob; project: Project }
  ): Promise<{ job: GenerateJob; project: Project }> {
    let current = initial;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (current.job.status === "complete") {
        return current;
      }
      if (current.job.status === "error") {
        throw new Error(current.job.error || current.job.message || "Generation failed.");
      }

      await delay(1500);
      current = await fetchJson<{ job: GenerateJob; project: Project }>(`/api/generate/${jobId}`);
      setJob(current.job);
      setProject(current.project);
    }

    throw new Error("Generation is still running. Check the job status and try again.");
  }

  function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > MAX_SCRIPT_FILE_BYTES) {
      setError(`File is too large. Upload ${formatBytes(MAX_SCRIPT_FILE_BYTES)} or less.`);
      event.currentTarget.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const nextText = String(reader.result || "");
      if (nextText.length > MAX_SCRIPT_CHARACTERS) {
        setError(`Script text must be ${formatCharacterLimit()} characters or fewer.`);
        event.target.value = "";
        return;
      }
      setInputMode("raw_script");
      setRawText(nextText);
      setError(null);
    };
    reader.onerror = () => {
      setError("Unable to read that file. Try a plain text or Markdown file.");
    };
    reader.readAsText(file);
  }

  function restoreSavedSession() {
    const rawSession = window.localStorage.getItem(savedSessionKey);
    if (!rawSession) {
      setHasSavedSession(false);
      return;
    }

    try {
      const session = JSON.parse(rawSession) as SavedSession;
      const restoredProject = session.project
        ? {
            ...session.project,
            characters: session.characters || session.project.characters,
            turns: session.turns || session.project.turns
          }
        : null;
      setRawText(session.rawText || "");
      setInputMode(session.inputMode || "raw_script");
      setProject(restoredProject);
      setParseResult(session.parseResult || null);
      setCharacters(session.characters || []);
      setTurns(session.turns || []);
      setDeliveryPreset(session.deliveryPreset || "Natural");
      setScriptDuration(session.scriptDuration || "Medium");
      setDeliveryEnabled(session.deliveryEnabled ?? true);
      setAudioVersion(session.audioVersion || 0);
      setJob(null);
      setActiveStep(maxReachableStep(restoredProject));
      setError(null);
    } catch {
      window.localStorage.removeItem(savedSessionKey);
      setHasSavedSession(false);
      setError("Saved session could not be restored.");
    }
  }

  function clearSavedSession() {
    window.localStorage.removeItem(savedSessionKey);
    setHasSavedSession(false);
  }

  async function loadRecentProjects() {
    try {
      const data = await fetchJson<{ projects: ProjectSummary[] }>("/api/projects");
      setRecentProjects(data.projects.slice(0, 5));
    } catch {
      setRecentProjects([]);
    }
  }

  async function loadProject(projectId: string) {
    setBusy("parse");
    setError(null);
    try {
      const data = await fetchJson<{ project: Project }>(`/api/projects/${projectId}`);
      setProject(data.project);
      setParseResult(data.project.parseResult);
      setCharacters(data.project.characters);
      setTurns(data.project.turns);
      setRawText(data.project.rawText);
      setInputMode(data.project.sourceMode);
      setJob(null);
      setAudioVersion((version) => version + 1);
      setActiveStep(maxReachableStep(data.project));
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("idle");
    }
  }

  function renameCharacter(characterId: string, name: string) {
    setCharacters((current) =>
      current.map((character) =>
        character.id === characterId
          ? {
              ...character,
              name,
              aliases: Array.from(new Set([name.toUpperCase(), ...character.aliases]))
            }
          : character
      )
    );
  }

  function mergeCharacter(fromId: string, toId: string) {
    if (!fromId || !toId || fromId === toId) {
      return;
    }
    setTurns((current) =>
      current.map((turn) => (turn.speakerId === fromId ? { ...turn, speakerId: toId } : turn))
    );
    setCharacters((current) => current.filter((character) => character.id !== fromId));
  }

  function updateTurn(turnId: string, patch: Partial<Turn>) {
    setTurns((current) =>
      current.map((turn) => (turn.id === turnId ? { ...turn, ...patch } : turn))
    );
  }

  function updateTurnType(turnId: string, type: Turn["type"]) {
    updateTurn(turnId, {
      type,
      speakerId: type === "stage_direction" ? null : turns.find((turn) => turn.id === turnId)?.speakerId || null
    });
  }

  function jumpToFirstReview() {
    const firstReview = turns.find((turn) => turn.needsReview);
    if (!firstReview) {
      return;
    }
    turnRefs.current[firstReview.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function deleteTurn(turnId: string) {
    setTurns((current) =>
      renumberTurns(current.filter((turn) => turn.id !== turnId))
    );
  }

  function duplicateTurn(turnId: string) {
    setTurns((current) => {
      const index = current.findIndex((turn) => turn.id === turnId);
      if (index < 0) {
        return current;
      }

      const original = current[index];
      const copy: Turn = {
        ...original,
        id: createClientId("turn"),
        order: original.order + 1,
        needsReview: true
      };
      return renumberTurns([...current.slice(0, index + 1), copy, ...current.slice(index + 1)]);
    });
  }

  function selectVoice(characterId: string, voiceId: string) {
    const voice = voiceList.find((candidate) => candidate.voiceId === voiceId);
    setCharacters((current) =>
      current.map((character) =>
        character.id === characterId
          ? {
              ...character,
              selectedVoiceId: voice?.voiceId || null,
              selectedVoiceName: voice?.name || null
            }
          : character
      )
    );
  }

  function selectedVoiceForCharacter(character: Character) {
    return voiceList.find((candidate) => candidate.voiceId === character.selectedVoiceId) || null;
  }

  function rankedVoicesFor(character: Character) {
    const ranked = rankVoicesForCharacter(character, voiceList);
    if (!voiceQuery.trim()) {
      return ranked;
    }

    const query = voiceQuery.trim().toLowerCase();
    return ranked.filter((voice) =>
      [voice.name, voice.description || "", voice.category || "", ...Object.values(voice.labels || {})]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }

  function assignBestVoice(characterId: string) {
    const character = characters.find((candidate) => candidate.id === characterId);
    if (!character) {
      return;
    }
    const voice = bestVoiceForCharacter(character, voiceList);
    if (voice) {
      selectVoice(characterId, voice.voiceId);
    }
  }

  function assignBestVoices() {
    setCharacters((current) =>
      current.map((character) => {
        const voice = bestVoiceForCharacter(character, voiceList);
        return voice
          ? {
              ...character,
              selectedVoiceId: voice.voiceId,
              selectedVoiceName: voice.name
            }
          : character;
      })
    );
  }

  async function toggleVoicePreview(voice: VoiceOption | null) {
    setPreviewError(null);

    if (!voice?.previewUrl) {
      setPreviewError("This voice does not include a preview URL from ElevenLabs.");
      return;
    }

    if (previewingVoiceId === voice.voiceId) {
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
      setPreviewingVoiceId(null);
      return;
    }

    previewAudioRef.current?.pause();
    const audio = new Audio(voice.previewUrl);
    previewAudioRef.current = audio;
    setPreviewingVoiceId(voice.voiceId);

    audio.onended = () => {
      if (previewAudioRef.current === audio) {
        previewAudioRef.current = null;
        setPreviewingVoiceId(null);
      }
    };
    audio.onerror = () => {
      if (previewAudioRef.current === audio) {
        previewAudioRef.current = null;
        setPreviewingVoiceId(null);
        setPreviewError("Unable to play this ElevenLabs voice preview.");
      }
    };

    try {
      await audio.play();
    } catch {
      if (previewAudioRef.current === audio) {
        previewAudioRef.current = null;
        setPreviewingVoiceId(null);
      }
      setPreviewError("Unable to play this ElevenLabs voice preview.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Waves size={20} strokeWidth={2.4} />
          </span>
          <span>ScriptCast Studio</span>
        </div>
        <div className="topbar-actions">
          <button
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            type="button"
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <button
            aria-expanded={infoOpen}
            aria-label="Product info"
            className="info-button"
            onClick={() => setInfoOpen((open) => !open)}
            type="button"
          >
            <Info size={17} />
            <span className="info-label">Info</span>
          </button>
        </div>
      </header>

      <section className="workspace" aria-label="ScriptCast Studio workflow">
        {infoOpen ? <InfoPanel onClose={() => setInfoOpen(false)} /> : null}
        <Stepper
          activeStep={activeStep}
          busyStep={apiStatus.current?.state === "pending" ? taskStepIndex(apiStatus.current.task) : null}
          onStepClick={setActiveStep}
          maxStep={reachableStep}
        />

        <div className="status-row" aria-label="Project summary">
          {stats.map((item) => (
            <div className="stat" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <ApiStatusPanel now={statusNow} status={apiStatus} />

        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}

        {activeStep === 0 ? (
          <section className="primary-panel input-panel">
            <div className="panel-heading">
              <div>
                <h1>{inputMode === "idea" ? "Start from an idea" : "Add your script"}</h1>
              </div>
            </div>

            {hasSavedSession ? (
              <div className="resume-strip">
                <span>Saved project state is available on this device.</span>
                <div>
                  <button className="ghost-button compact-button" onClick={restoreSavedSession} type="button">
                    Resume
                  </button>
                  <button className="ghost-button compact-button" onClick={clearSavedSession} type="button">
                    Clear saved resume data
                  </button>
                </div>
              </div>
            ) : null}

            {recentProjects.length ? (
              <div className="recent-projects-strip" aria-label="Recent projects">
                <div>
                  <Clock size={16} />
                  <span>Recent projects</span>
                </div>
                <div className="recent-project-list">
                  {recentProjects.map((recentProject) => (
                    <button
                      className="ghost-button compact-button"
                      disabled={busy !== "idle"}
                      key={recentProject.id}
                      onClick={() => loadProject(recentProject.id)}
                      type="button"
                    >
                      {recentProject.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="input-switch" role="tablist" aria-label="Input type">
              <button
                aria-selected={inputMode === "raw_script"}
                className={clsx("switch-button", inputMode === "raw_script" && "active")}
                onClick={() => setInputMode("raw_script")}
                role="tab"
                type="button"
              >
                <Upload size={16} />
                Upload raw script
              </button>
              <button
                aria-selected={inputMode === "idea"}
                className={clsx("switch-button", inputMode === "idea" && "active")}
                onClick={() => setInputMode("idea")}
                role="tab"
                type="button"
              >
                <Sparkles size={16} />
                Start from idea
              </button>
            </div>

            {inputMode === "raw_script" ? (
              <>
            <div className="mode-actions">
              <button className="tab-button active" type="button">
                <FileText size={17} />
                Paste Text
              </button>
              <label className="tab-button file-button">
                <Upload size={17} />
                Upload File
                <input accept=".txt,.md,text/plain,text/markdown" hidden onChange={handleFileUpload} type="file" />
              </label>
              <button className="ghost-button sample-button" type="button" onClick={() => setRawText(sampleScript)}>
                <Sparkles size={16} />
                Try sample script
              </button>
            </div>

            <textarea
              className="script-input"
              maxLength={MAX_SCRIPT_CHARACTERS}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="Paste your script or raw text here..."
              value={rawText}
            />
              </>
            ) : (
              <div className="idea-flow">
                <div className="idea-chat-panel" aria-label="Idea chat">
                  <div className="idea-message assistant">
                    <div className="idea-message-icon">
                      <MessageCircle size={16} />
                    </div>
                    <div>
                      <span>AI</span>
                      <p>Tell me the premise, characters, tone, or a scene you want. I will help shape it before you generate the story.</p>
                    </div>
                  </div>
                  {ideaMessages.map((message) => (
                    <div className={clsx("idea-message", message.role)} key={message.id}>
                      <div className="idea-message-icon">
                        {message.role === "assistant" ? <MessageCircle size={16} /> : <Sparkles size={16} />}
                      </div>
                      <div>
                        <span>{message.role === "assistant" ? "AI" : "You"}</span>
                        <p>{message.content}</p>
                        {message.role === "assistant" && message.question ? (
                          <strong className="idea-question">{message.question}</strong>
                        ) : null}
                        {message.role === "assistant" && message.choices?.length ? (
                          <div className="idea-choice-list" aria-label={message.question || "Suggested replies"}>
                            {message.choices.map((choice) => (
                              <button
                                className="idea-choice-button"
                                disabled={busy !== "idle"}
                                key={choice.id}
                                onClick={() => sendIdeaChoice(choice)}
                                type="button"
                              >
                                <span>{choice.label}</span>
                                <small>{choice.description}</small>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {busy === "chat" ? (
                    <div className="idea-message assistant typing" aria-label="AI is typing">
                      <div className="idea-message-icon">
                        <MessageCircle size={16} />
                      </div>
                      <div>
                        <span>AI</span>
                        <p className="typing-dots">
                          <i />
                          <i />
                          <i />
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="idea-compose">
                  <textarea
                    className="idea-compose-input"
                    maxLength={2000}
                    onChange={(event) => setIdeaInput(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        void sendIdeaMessage();
                      }
                    }}
                    placeholder="Message the AI about the story..."
                    value={ideaInput}
                  />
                  <button
                    className="ghost-button send-button"
                    disabled={!ideaInput.trim() || busy === "chat" || busy === "draft"}
                    onClick={sendIdeaMessage}
                    type="button"
                  >
                    {busy === "chat" ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                    Send
                  </button>
                </div>
                <div className="duration-control">
                  <span>Target audio length</span>
                  <div className="duration-options" role="radiogroup" aria-label="Target audio length">
                    {scriptDurations.map((option) => (
                      <button
                        aria-checked={scriptDuration === option.value}
                        className={clsx("duration-button", scriptDuration === option.value && "selected")}
                        key={option.value}
                        onClick={() => setScriptDuration(option.value)}
                        role="radio"
                        type="button"
                      >
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="draft-actions">
                  <button
                    className="ghost-button"
                    disabled={!canGenerateDraft}
                    onClick={generateScriptDraft}
                    type="button"
                  >
                    {busy === "draft" ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />}
                    Generate story
                  </button>
                  <span className="counter">
                    {ideaMessages.length
                      ? `${ideaMessages.length} chat messages`
                      : "Chat first, then generate the story"}
                  </span>
                </div>
                <div className="generated-editor">
                  <div className="review-head">
                    <h2>Generated script</h2>
                    <span className="counter">
                      {rawCharacterCount.toLocaleString()} / {formatCharacterLimit()} characters
                    </span>
                  </div>
                  <textarea
                    className="script-input generated-script-input"
                    maxLength={MAX_SCRIPT_CHARACTERS}
                    onChange={(event) => setRawText(event.target.value)}
                    placeholder="Your generated script will appear here..."
                    value={rawText}
                  />
                  {busy === "draft" && !rawText.trim() ? (
                    <div className="script-skeleton" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            <div className="panel-footer">
              <span className="counter">
                {inputMode === "idea"
                  ? rawText.trim()
                    ? "Generated script ready for review"
                    : "Generate a story before continuing"
                  : `${rawCharacterCount.toLocaleString()} / ${formatCharacterLimit()} characters`}
              </span>
              <button
                className="primary-button"
                disabled={!canContinueFromUpload}
                onClick={parseScript}
                type="button"
              >
                {busy === "parse" ? <Loader2 className="spin" size={17} /> : null}
                Continue
                <ArrowRight size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {activeStep === 1 && parseResult ? (
          <section className="primary-panel review-panel">
            <PanelTitle
              title="Review parse"
              action={
                <div className="panel-action-group">
                  {reviewTurnCount ? (
                    <button className="ghost-button" onClick={jumpToFirstReview} type="button">
                      <ListChecks size={16} />
                      Review flagged lines
                    </button>
                  ) : null}
                  <button className="primary-button" onClick={moveToCastVoices} type="button">
                    Continue
                    <ArrowRight size={17} />
                  </button>
                </div>
              }
            />
            <div className="split-grid">
              <div className="review-column">
                <h2>Raw text</h2>
                <pre className="raw-preview">{rawText}</pre>
              </div>
              <div className="review-column">
                <div className="review-head">
                  <h2>Parsed turns</h2>
                  <span className="confidence">{Math.round(parseResult.confidence * 100)}% confidence</span>
                </div>
                <div className="turn-list">
                  {turns.map((turn) => (
                    <article
                      className={clsx("turn-row", turn.needsReview && "needs-review")}
                      key={turn.id}
                      ref={(node) => {
                        turnRefs.current[turn.id] = node;
                      }}
                    >
                      <div className="turn-meta">
                        <span>{turn.order}</span>
                        <select
                          aria-label={`Type for line ${turn.order}`}
                          onChange={(event) => updateTurnType(turn.id, event.target.value as Turn["type"])}
                          value={turn.type}
                        >
                          <option value="dialogue">Dialogue</option>
                          <option value="narration">Narration</option>
                          <option value="stage_direction">Stage direction</option>
                        </select>
                        <select
                          aria-label={`Speaker for line ${turn.order}`}
                          disabled={turn.type === "stage_direction"}
                          onChange={(event) => updateTurn(turn.id, { speakerId: event.target.value || null })}
                          value={turn.speakerId || ""}
                        >
                          <option value="">No speaker</option>
                          {characters.map((character) => (
                            <option key={character.id} value={character.id}>
                              {character.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        aria-label={`Text for line ${turn.order}`}
                        onChange={(event) =>
                          updateTurn(turn.id, {
                            originalText: event.target.value,
                            ttsText: event.target.value
                          })
                        }
                        value={turn.originalText}
                      />
                      <div className="turn-actions">
                        <button className="icon-text-button" onClick={() => duplicateTurn(turn.id)} type="button">
                          <Copy size={14} />
                          Duplicate
                        </button>
                        <button
                          className="icon-text-button danger-text"
                          disabled={turns.length <= 1}
                          onClick={() => deleteTurn(turn.id)}
                          type="button"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <details className="advanced-box">
              <summary>
                Character cleanup
                <ChevronDown size={16} />
              </summary>
              <div className="character-edit-grid">
                {characters.map((character) => (
                  <div className="character-edit" key={character.id}>
                    <input
                      aria-label={`Rename ${character.name}`}
                      onChange={(event) => renameCharacter(character.id, event.target.value)}
                      value={character.name}
                    />
                    <select
                      aria-label={`Merge ${character.name}`}
                      onChange={(event) => mergeCharacter(character.id, event.target.value)}
                      value=""
                    >
                      <option value="">Merge into...</option>
                      {characters
                        .filter((candidate) => candidate.id !== character.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            </details>

            {parseResult.warnings.length ? (
              <div className="warning-list">
                {parseResult.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {activeStep === 2 ? (
          <section className="primary-panel">
            <PanelTitle
              title="Cast voices"
              action={
                <button
                  className="primary-button"
                  disabled={!hasRequiredVoices}
                  onClick={() => setActiveStep(3)}
                  type="button"
                >
                  Continue
                  <ArrowRight size={17} />
                </button>
              }
            />
            <div className="voice-toolbar">
              <button className="ghost-button" disabled={busy === "voices"} onClick={() => loadVoiceList()} type="button">
                {busy === "voices" ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />}
                Load ElevenLabs voices
              </button>
              <button
                className="ghost-button"
                disabled={voiceList.length === 0 || busy === "voices"}
                onClick={assignBestVoices}
                type="button"
              >
                <Sparkles size={16} />
                Suggest best matches
              </button>
              <label className="voice-search">
                <Search size={15} />
                <input
                  onChange={(event) => setVoiceQuery(event.target.value)}
                  placeholder="Search real voices..."
                  value={voiceQuery}
                />
              </label>
              <span>
                {selectedRequiredVoiceCount} of {requiredVoiceCount} required voices selected
              </span>
            </div>
	            {previewError ? (
	              <div className="voice-preview-error" role="alert">
	                {previewError}
	              </div>
	            ) : null}
	            <div className={clsx("voice-grid", busy === "voices" && voiceList.length === 0 && "loading")}>
              {busy === "voices" && voiceList.length === 0 ? (
                characters.map((character) => (
                  <article className="voice-card voice-card-skeleton" key={character.id} aria-hidden="true">
                    <div className="voice-card-head">
                      <div className="avatar shimmer" />
                      <div className="skeleton-stack">
                        <span />
                        <span />
                      </div>
                    </div>
                    <div className="prompt-box skeleton-block">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="selected-voice-detail muted skeleton-line" />
                  </article>
                ))
	              ) : (
                characters.map((character) => {
                  const selectedVoice = selectedVoiceForCharacter(character);
                  const isRequiredVoice = requiredCharacterIds.has(character.id);
                  const rankedVoices = rankedVoicesFor(character);
                  const voiceOptions =
                    selectedVoice && !rankedVoices.some((voice) => voice.voiceId === selectedVoice.voiceId)
                      ? [selectedVoice, ...rankedVoices]
                      : rankedVoices;
                  const topMatches = rankedVoices.slice(0, 3);
                  const isPreviewing = previewingVoiceId === selectedVoice?.voiceId;
                  return (
                <article className="voice-card" key={character.id}>
                  <div className="voice-card-head">
                    <div className="avatar">
                      <Mic2 size={18} />
                    </div>
                    <div>
                      <h2>{character.name}</h2>
                      <p>
                        {character.inferredTraits.join(" • ")}
                        {!isRequiredVoice ? " • Not used in generated lines" : ""}
                      </p>
                    </div>
                  </div>

                  <div className="prompt-box">
                    <span>Voice prompt</span>
                    <p>{character.voiceDesignPrompt}</p>
                  </div>

                  <div className="voice-select-wrap">
                    <label htmlFor={`voice-${character.id}`}>ElevenLabs voice</label>
                    <select
                      disabled={busy === "voices" || voiceList.length === 0}
                      id={`voice-${character.id}`}
                      onChange={(event) => selectVoice(character.id, event.target.value)}
                      value={character.selectedVoiceId || ""}
                    >
                      <option value="">Select a voice...</option>
                      {voiceOptions.map((voice) => (
                        <option key={voice.voiceId} value={voice.voiceId}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                    {topMatches.length ? (
                      <div className="voice-match-list" aria-label={`Suggested voices for ${character.name}`}>
                        {topMatches.map((voice) => (
                          <button
                            className={clsx(
                              "voice-match-button",
                              voice.voiceId === character.selectedVoiceId && "selected"
                            )}
                            key={voice.voiceId}
                            onClick={() => selectVoice(character.id, voice.voiceId)}
                            type="button"
                          >
                            <span>{voice.name}</span>
                            <small>{voice.description || voice.category || "ElevenLabs voice"}</small>
                          </button>
                        ))}
                        <button
                          className="icon-text-button"
                          disabled={!voiceList.length}
                          onClick={() => assignBestVoice(character.id)}
                          type="button"
                        >
                          <Sparkles size={14} />
                          Assign top match
                        </button>
                      </div>
                    ) : null}
	                    {character.selectedVoiceName ? (
	                      <>
	                        <div className="selected-voice-detail">
	                          <Check size={15} />
	                          <span>{character.selectedVoiceName}</span>
	                        </div>
	                        <button
	                          className="ghost-button voice-preview-button"
	                          disabled={!selectedVoice?.previewUrl}
	                          onClick={() => toggleVoicePreview(selectedVoice)}
	                          type="button"
	                        >
	                          {isPreviewing ? <Pause size={15} /> : <Play size={15} />}
	                          {selectedVoice?.previewUrl
	                            ? isPreviewing
	                              ? "Stop preview"
	                              : "Preview voice"
	                            : "No preview available"}
	                        </button>
	                      </>
	                    ) : (
	                      <div className="selected-voice-detail muted">
	                        <Play size={15} />
                        <span>Choose one voice from your ElevenLabs list.</span>
                      </div>
	                    )}
	                  </div>
	                </article>
	                  );
	                })
	              )}
            </div>
          </section>
        ) : null}

        {activeStep === 3 ? (
          <section className="primary-panel generate-panel">
            <PanelTitle
              title="Generate audio"
              action={
                <button
                  className="primary-button"
                  disabled={
                    busy === "generate" ||
                    busy === "enhance" ||
                    !hasRequiredVoices ||
                    blockingIssues.length > 0
                  }
                  onClick={() => generateAudio()}
                  type="button"
                >
                  {busy === "generate" || busy === "enhance" ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
                  Generate
                </button>
              }
            />

            <div className="preset-grid" role="radiogroup" aria-label="Delivery presets">
              {deliveryPresets.map((preset) => (
                <button
                  aria-checked={deliveryPreset === preset}
                  className={clsx("preset-button", deliveryPreset === preset && "selected")}
                  key={preset}
                  onClick={() => setDeliveryPreset(preset)}
                  role="radio"
                  type="button"
                >
                  {preset}
                </button>
              ))}
            </div>

            <label className="toggle-row">
              <input
                checked={deliveryEnabled}
                onChange={(event) => setDeliveryEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>Add ElevenLabs v3 tags and sound effects</span>
            </label>

            {blockingIssues.length ? (
              <div className="validation-list" role="alert">
                <strong>Fix before generation</strong>
                {blockingIssues.slice(0, 6).map((issue) => (
                  <span key={issue}>{issue}</span>
                ))}
              </div>
            ) : null}

            <div className="generation-summary">
              <div>
                <span>Estimated chunks</span>
                <strong>{chunks.length || estimatedChunks.length || "Ready after generate"}</strong>
              </div>
              <div>
                <span>Script characters</span>
                <strong>{generationCharCount.toLocaleString()}</strong>
              </div>
              <div>
                <span>Estimated length</span>
                <strong>{estimatedAudioLength}</strong>
              </div>
              <div>
                <span>Progress</span>
                <strong>
                  {job?.progress
                    ? `${job.progress}%`
                    : busy === "generate" || busy === "enhance" || busy === "regenerate"
                      ? "Working"
                      : "0%"}
                </strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{apiStatus.current?.state === "pending" ? apiStatus.current.detail : job?.message || "Waiting"}</strong>
              </div>
            </div>

            <div className="chunk-list">
              {(chunks.length ? chunks : estimatedChunks).map((chunk) => (
                <div
                  className={clsx(
                    "chunk-row",
                    (busy === "generate" || busy === "enhance" || busy === "regenerate") && "is-busy"
                  )}
                  key={chunk.id}
                >
                  <span>Chunk {chunk.order}</span>
                  <strong>{chunk.charCount} chars</strong>
                  <em>{chunk.uniqueVoiceIds.length} voices</em>
                  <small>{chunk.status}</small>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {activeStep === 4 ? (
          <section className="primary-panel export-panel">
            <PanelTitle
              title="Export"
              action={
                <button className="ghost-button" onClick={() => setActiveStep(3)} type="button">
                  <ArrowLeft size={16} />
                  Back
                </button>
              }
            />

            <div className="export-card">
              <div className="export-icon">
                <Waves size={28} />
              </div>
              <div>
                <h2>{project?.title || "Final audio"}</h2>
                <p>{completedChunks || chunks.length} chunks merged into one final audio file.</p>
              </div>
            </div>

            {project?.finalAudioPath ? (
              <>
                <audio
                  className="audio-player"
                  controls
                  onLoadedMetadata={() => setCaptionTime(0)}
                  onSeeked={(event) => setCaptionTime(event.currentTarget.currentTime)}
                  onTimeUpdate={(event) => setCaptionTime(event.currentTarget.currentTime)}
                  src={finalAudioUrl}
                >
                  {captionTrack ? (
                    <track
                      default
                      kind="captions"
                      label="English"
                      src={`/api/projects/${project.id}/artifacts/${captionTrack.id}`}
                      srcLang="en"
                    />
                  ) : null}
                </audio>
                {captions.length ? (
                  <CaptionPanel activeCaptions={activeCaptions} captions={captions} />
                ) : null}
                <div className="export-actions">
                  <a className="primary-button" href={`${finalAudioUrl}&download=1`}>
                    <Download size={17} />
                    Download {finalAudioExtension}
                  </a>
                  <button
                    className="ghost-button"
                    disabled={busy === "regenerate"}
                    onClick={() => generateAudio()}
                    type="button"
                  >
                    <RefreshCw size={16} />
                    Regenerate all
                  </button>
                </div>
              </>
            ) : (
              <button className="primary-button" onClick={() => setActiveStep(3)} type="button">
                Generate audio
                <ArrowRight size={17} />
              </button>
            )}

            {project?.artifacts.length ? <ArtifactPanel artifacts={project.artifacts} projectId={project.id} /> : null}

            <div className="regenerate-grid">
              {chunks.map((chunk) => (
                <button
                  className="regenerate-card"
                  disabled={busy === "regenerate"}
                  key={chunk.id}
                  onClick={() => generateAudio({ regenerateChunkId: chunk.id })}
                  type="button"
                >
                  <RefreshCw size={16} />
                  <span>Regenerate chunk {chunk.order}</span>
                </button>
              ))}
              {turns.map((turn) => (
                <button
                  className="regenerate-card"
                  disabled={busy === "regenerate"}
                  key={turn.id}
                  onClick={() => generateAudio({ regenerateTurnId: turn.id })}
                  type="button"
                >
                  <RefreshCw size={16} />
                  <span>Regenerate line {turn.order}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <footer>Open Source Project • Powered by OpenAI &amp; ElevenLabs</footer>
    </main>
  );
}

function Stepper({
  activeStep,
  busyStep,
  maxStep,
  onStepClick
}: {
  activeStep: number;
  busyStep?: number | null;
  maxStep: number;
  onStepClick: (step: number) => void;
}) {
  const progress = ((Math.min(activeStep, steps.length - 1) + 1) / steps.length) * 100;

  return (
    <div className="workflow-progress">
      <div className="mobile-step-summary" aria-live="polite">
        <span>
          Step {activeStep + 1} of {steps.length}
        </span>
        <strong>{steps[activeStep]}</strong>
        <div className="mobile-progress-bar" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>
      <nav className="stepper" aria-label="Workflow steps">
        <div className="stepper-track">
          {steps.map((step, index) => {
            const available = index <= maxStep;
            return (
              <button
                className={clsx(
                  "step",
                  activeStep === index && "active",
                  index < activeStep && "complete",
                  busyStep === index && "busy"
                )}
                disabled={!available}
                key={step}
                onClick={() => onStepClick(index)}
                type="button"
              >
                <span>{index + 1}</span>
                <strong className="desktop-step-label">{step}</strong>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function PanelTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="panel-heading">
      <div>
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  );
}

function InfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="info-panel" aria-label="Product info">
      <div>
        <span>Production workflow</span>
        <strong>OpenAI parsing, ElevenLabs voices, local exports</strong>
        <p>
          Add or generate a script, review detected speakers, select real ElevenLabs voice IDs, then
          generate audio and download the final file.
        </p>
      </div>
      <button className="icon-text-button" onClick={onClose} type="button">
        Close
      </button>
    </aside>
  );
}

function ApiStatusPanel({ now, status }: { now: number; status: ApiStatusState }) {
  const activity = status.current || status.recent[0];
  const elapsedMs = activity
    ? activity.state === "pending"
      ? now - activity.startedAt
      : activity.elapsedMs
    : 0;

  return (
    <div
      className={clsx("api-status-panel", activity?.state || "idle")}
      aria-label="API status"
      aria-live="polite"
    >
      <div className="api-status-icon" aria-hidden="true">
        {activity?.state === "pending" ? (
          <Loader2 className="spin" size={17} />
        ) : activity?.state === "success" ? (
          <Check size={17} />
        ) : (
          <Info size={17} />
        )}
      </div>
      <div className="api-status-copy">
        <span>API status</span>
        <strong>{activity?.label || "Ready"}</strong>
        <p>{activity?.detail || "Waiting for the next request."}</p>
      </div>
      <div className="api-status-meta">
        <span>{activity ? formatElapsed(elapsedMs) : "Idle"}</span>
        {activity?.state === "pending" ? (
          <span className="api-status-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CaptionPanel({
  activeCaptions,
  captions
}: {
  activeCaptions: CaptionCue[];
  captions: CaptionCue[];
}) {
  const primaryActiveCaption = activeCaptions[activeCaptions.length - 1] || null;
  const activeCaptionIds = new Set(activeCaptions.map((caption) => caption.id));
  const activeIndex = primaryActiveCaption
    ? captions.findIndex((caption) => caption.id === primaryActiveCaption.id)
    : -1;
  const visibleCaptions =
    activeIndex >= 0
      ? captions.slice(Math.max(0, activeIndex - 1), activeIndex + 3)
      : captions.slice(0, 4);

  return (
    <div className="caption-panel" aria-live="polite">
      <div
        className={clsx("live-caption", !activeCaptions.length && "empty")}
        style={primaryActiveCaption ? { borderColor: primaryActiveCaption.color } : undefined}
      >
        {activeCaptions.length ? (
          <div className="live-caption-stack">
            {activeCaptions.map((caption) => (
              <div className="live-caption-line" key={caption.id}>
                <span style={{ color: caption.color }}>{caption.speakerName}</span>
                <p>{caption.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <>
            <span>Captions</span>
            <p>Press play to follow the script.</p>
          </>
        )}
      </div>
      <div className="caption-list">
        {visibleCaptions.map((caption) => (
          <div
            className={clsx("caption-row", activeCaptionIds.has(caption.id) && "active")}
            key={caption.id}
            style={{ borderLeftColor: caption.color }}
          >
            <span>{caption.speakerName}</span>
            <p>{caption.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtifactPanel({
  artifacts,
  projectId
}: {
  artifacts: ProjectArtifact[];
  projectId: string;
}) {
  return (
    <div className="artifact-panel">
      <div className="artifact-head">
        <h2>Saved generated files</h2>
        <div>
          <span>{artifacts.length} files</span>
          <a className="ghost-button compact-button" href={`/api/projects/${projectId}/artifacts/archive`}>
            <Archive size={15} />
            Download all
          </a>
        </div>
      </div>
      <div className="artifact-grid">
        {artifacts.map((artifact) => (
          <a
            className="artifact-link"
            href={`/api/projects/${projectId}/artifacts/${artifact.id}?download=1`}
            key={artifact.id}
          >
            <FileText size={16} />
            <span>
              <strong>{artifact.label}</strong>
              <small>
                {kindLabel(artifact.kind)} • {formatBytes(artifact.sizeBytes)}
              </small>
            </span>
            <Download size={15} />
          </a>
        ))}
      </div>
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed with ${response.status}`);
  }
  return response.json();
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed with ${response.status}`);
  }

  return response.json();
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeIdeaReply(data: {
  reply?: IdeaChatReply;
  message?: string;
  question?: string;
  choices?: IdeaChatChoice[];
}): IdeaChatReply {
  if (data.reply) {
    return data.reply;
  }

  return {
    content: data.message || "I can help shape that into an audio-first scene.",
    question: data.question || "Which direction should we explore next?",
    choices: data.choices?.length
      ? data.choices
      : [
          {
            id: "character",
            label: "Character",
            description: "Define who drives the scene and what they want."
          },
          {
            id: "conflict",
            label: "Conflict",
            description: "Choose the pressure or obstacle that forces a decision."
          },
          {
            id: "sound",
            label: "Sound",
            description: "Pick the audio motif that makes the scene vivid."
          }
        ]
  };
}

function taskStepIndex(task: ApiTask) {
  const stepByTask: Record<ApiTask, number> = {
    chat: 0,
    draft: 0,
    parse: 0,
    voices: 2,
    enhance: 3,
    generate: 3,
    regenerate: 4,
    export: 4
  };
  return stepByTask[task];
}

function formatElapsed(ms: number) {
  if (ms < 1000) {
    return "<1s";
  }

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function previewChunks(turns: Turn[]): Chunk[] {
  return chunkTurnsForDialogue(turns, {
    maxChars: 1800,
    maxUniqueVoices: 10
  });
}

function renumberTurns(turns: Turn[]) {
  return turns.map((turn, index) => ({
    ...turn,
    order: index + 1
  }));
}

function kindLabel(kind: ProjectArtifact["kind"]) {
  return kind
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function estimateAudioLength(characters: number) {
  if (characters <= 0) {
    return "-";
  }

  const estimatedSeconds = Math.max(10, Math.round(characters / 14));
  const minutes = Math.floor(estimatedSeconds / 60);
  const seconds = estimatedSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function ideaMessagesToTranscript(messages: IdeaChatItem[]) {
  return messages
    .map((message) => `${message.role === "assistant" ? "AI" : "User"}: ${message.content.trim()}`)
    .filter(Boolean)
    .join("\n\n");
}

function createClientId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
