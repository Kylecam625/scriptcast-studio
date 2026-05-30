import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { scriptcastStorageDir } from "@/lib/env";
import { assertStorageId, createId, slugId } from "@/lib/ids";
import {
  GenerateJob,
  GenerateJobSchema,
  ParseResult,
  Project,
  ProjectArtifact,
  ProjectArtifactSchema,
  ProjectSchema,
  SourceMode
} from "@/lib/schemas";

const FILE_FLAG_TIMEOUT_MS = 2_000;

type CreateProjectOptions = {
  sourceMode?: SourceMode;
  sourceIdea?: string | null;
};

type ArtifactMeta = {
  id?: string;
  label: string;
  kind: ProjectArtifact["kind"];
  mimeType: string;
};

export type ProjectSummary = {
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

export function getStorageRoot() {
  return scriptcastStorageDir();
}

export function getProjectDirectory(projectId: string) {
  return path.join(getStorageRoot(), "projects", assertStorageId(projectId, "Project id"));
}

export async function createProject(
  rawText: string,
  parseResult: ParseResult,
  options: CreateProjectOptions = {}
): Promise<Project> {
  const now = new Date().toISOString();
  const sourceMode = options.sourceMode || "raw_script";
  const project: Project = {
    id: createId("project"),
    title: parseResult.title,
    sourceMode,
    sourceIdea: options.sourceIdea || null,
    rawText,
    parseResult,
    characters: parseResult.characters,
    turns: parseResult.turns,
    chunks: [],
    finalAudioPath: null,
    captions: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now
  };

  await saveProject(project);

  const artifacts: ProjectArtifact[] = [];
  if (sourceMode === "idea" && options.sourceIdea) {
    artifacts.push(
      await writeProjectArtifact(project.id, "source/idea.txt", options.sourceIdea, {
        id: "artifact-source-idea",
        label: "Original idea prompt",
        kind: "idea_prompt",
        mimeType: "text/plain; charset=utf-8"
      })
    );
  }

  artifacts.push(
    await writeProjectArtifact(
      project.id,
      sourceMode === "idea" ? "source/generated-script.txt" : "source/raw-script.txt",
      rawText,
      {
        id: "artifact-source-script",
        label: sourceMode === "idea" ? "Generated script" : "Raw script",
        kind: sourceMode === "idea" ? "generated_script" : "raw_script",
        mimeType: "text/plain; charset=utf-8"
      }
    )
  );
  artifacts.push(
    await writeProjectArtifact(project.id, "source/parse-result.json", JSON.stringify(parseResult, null, 2), {
      id: "artifact-parse-result",
      label: "Parse result JSON",
      kind: "parse_result",
      mimeType: "application/json; charset=utf-8"
    })
  );

  return saveProject({
    ...project,
    artifacts
  });
}

export async function getProject(projectId: string): Promise<Project> {
  assertStorageId(projectId, "Project id");
  const filePath = projectFilePath(projectId);
  const data = JSON.parse(await readLocalTextFile(filePath, "Project file"));
  return ProjectSchema.parse(data);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projectsDirectory = path.join(getStorageRoot(), "projects");
  const entries = await readdir(projectsDirectory, { withFileTypes: true }).catch((error) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          const project = await getProject(entry.name);
          return projectSummary(project);
        } catch {
          return null;
        }
      })
  );

  return summaries
    .filter((summary): summary is ProjectSummary => Boolean(summary))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveProject(project: Project): Promise<Project> {
  const nextProject = ProjectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString()
  });
  const dir = path.dirname(projectFilePath(project.id));
  await mkdir(dir, { recursive: true });
  await writeJsonAtomically(projectFilePath(project.id), nextProject);
  return nextProject;
}

export async function createJob(projectId: string): Promise<GenerateJob> {
  assertStorageId(projectId, "Project id");
  const now = new Date().toISOString();
  const job: GenerateJob = {
    id: createId("job"),
    projectId,
    status: "queued",
    progress: 0,
    message: "Generation queued.",
    chunks: [],
    finalAudioPath: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
  await saveJob(job);
  return job;
}

export async function getJob(jobId: string): Promise<GenerateJob> {
  assertStorageId(jobId, "Job id");
  const data = JSON.parse(await readLocalTextFile(jobFilePath(jobId), "Job file"));
  return GenerateJobSchema.parse(data);
}

export async function saveJob(job: GenerateJob): Promise<GenerateJob> {
  const nextJob = GenerateJobSchema.parse({
    ...job,
    updatedAt: new Date().toISOString()
  });
  await mkdir(path.dirname(jobFilePath(job.id)), { recursive: true });
  await writeJsonAtomically(jobFilePath(job.id), nextJob);
  return nextJob;
}

export async function writeProjectArtifact(
  projectId: string,
  relativePath: string,
  content: string | Buffer,
  meta: ArtifactMeta
): Promise<ProjectArtifact> {
  assertStorageId(projectId, "Project id");
  if (meta.id) {
    assertStorageId(meta.id, "Artifact id");
  }
  const filePath = resolveProjectFilePath(projectId, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return buildArtifact(projectId, filePath, meta);
}

export async function buildProjectArtifact(
  projectId: string,
  filePath: string,
  meta: ArtifactMeta
): Promise<ProjectArtifact> {
  assertStorageId(projectId, "Project id");
  if (meta.id) {
    assertStorageId(meta.id, "Artifact id");
  }
  const resolvedPath = path.resolve(filePath);
  const projectRoot = path.resolve(getProjectDirectory(projectId));
  if (resolvedPath !== projectRoot && !resolvedPath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("Artifact path must stay inside the project directory.");
  }
  return buildArtifact(projectId, resolvedPath, meta);
}

export function upsertArtifacts(
  existing: ProjectArtifact[],
  incoming: ProjectArtifact[]
): ProjectArtifact[] {
  const byId = new Map(existing.map((artifact) => [artifact.id, artifact]));
  for (const artifact of incoming) {
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function resolveProjectArtifactPath(projectId: string, artifact: ProjectArtifact) {
  assertStorageId(projectId, "Project id");
  assertStorageId(artifact.id, "Artifact id");
  const resolvedPath = path.resolve(artifact.path);
  const projectRoot = path.resolve(getProjectDirectory(projectId));
  if (resolvedPath !== projectRoot && !resolvedPath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("Artifact path is outside the project directory.");
  }
  return resolvedPath;
}

type LocalFileOptions = {
  platform?: NodeJS.Platform;
  readFlags?: (filePath: string) => Promise<string>;
};

export async function assertLocalFileAvailable(
  filePath: string,
  options: LocalFileOptions = {}
) {
  const platform = options.platform || process.platform;
  if (platform !== "darwin") {
    return;
  }

  const flags = await (options.readFlags || readMacFileFlags)(filePath);
  if (hasDatalessFlag(flags)) {
    throw new Error(
      `${path.basename(filePath)} is offline in cloud storage. Download it locally or move SCRIPTCAST_STORAGE_DIR outside iCloud/optimized storage.`
    );
  }
}

function projectFilePath(projectId: string) {
  return path.join(getProjectDirectory(projectId), "project.json");
}

function jobFilePath(jobId: string) {
  assertStorageId(jobId, "Job id");
  return path.join(getStorageRoot(), "jobs", `${jobId}.json`);
}

function resolveProjectFilePath(projectId: string, relativePath: string) {
  const projectRoot = path.resolve(getProjectDirectory(projectId));
  const resolvedPath = path.resolve(projectRoot, relativePath);
  if (resolvedPath !== projectRoot && !resolvedPath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("Project file path is outside the project directory.");
  }
  return resolvedPath;
}

async function buildArtifact(
  projectId: string,
  filePath: string,
  meta: ArtifactMeta
): Promise<ProjectArtifact> {
  const stats = await stat(filePath);
  const relativePath = path.relative(getProjectDirectory(projectId), filePath);
  return ProjectArtifactSchema.parse({
    id: meta.id || `artifact-${slugId(`${meta.kind}-${relativePath}`)}`,
    label: meta.label,
    kind: meta.kind,
    path: filePath,
    mimeType: meta.mimeType,
    sizeBytes: stats.size,
    createdAt: new Date().toISOString()
  });
}

async function readLocalTextFile(filePath: string, label: string) {
  await assertLocalFileAvailable(filePath).catch((error) => {
    throw new Error(`${label} is not locally available: ${error instanceof Error ? error.message : "unknown error"}`);
  });
  return readFile(filePath, "utf8");
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2));
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function hasDatalessFlag(flags: string) {
  return flags
    .split(/[,\s]+/)
    .map((flag) => flag.trim().toLowerCase())
    .includes("dataless");
}

function projectSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    sourceMode: project.sourceMode,
    characterCount: project.characters.length,
    turnCount: project.turns.length,
    chunkCount: project.chunks.length,
    hasFinalAudio: Boolean(project.finalAudioPath),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function readMacFileFlags(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("/usr/bin/stat", ["-f", "%Sf", filePath], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out while checking local file flags for ${path.basename(filePath)}.`));
    }, FILE_FLAG_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `stat exited with ${code}`));
    });
  });
}
