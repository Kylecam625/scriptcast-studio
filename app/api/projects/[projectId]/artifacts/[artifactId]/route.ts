import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertStorageId } from "@/lib/ids";
import { assertLocalFileAvailable, getProject, resolveProjectArtifactPath } from "@/lib/storage";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  try {
    const { artifactId, projectId } = await params;
    assertStorageId(projectId, "Project id");
    assertStorageId(artifactId, "Artifact id");
    const project = await getProject(projectId);
    const artifact = project.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
    }

    const filePath = resolveProjectArtifactPath(projectId, artifact);
    await assertLocalFileAvailable(filePath);
    const file = await readFile(filePath);
    const url = new URL(request.url);
    const headers = new Headers({
      "Content-Type": artifact.mimeType,
      "Cache-Control": "no-store"
    });

    if (url.searchParams.get("download") === "1") {
      headers.set("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    }

    return new NextResponse(file, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to download artifact.";
    return NextResponse.json(
      {
        error: message
      },
      { status: message.includes("invalid") ? 400 : 404 }
    );
  }
}
