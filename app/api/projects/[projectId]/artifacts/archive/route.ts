import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertStorageId, slugId } from "@/lib/ids";
import { assertLocalFileAvailable, getProject, getProjectDirectory, resolveProjectArtifactPath } from "@/lib/storage";
import { createZipArchive } from "@/lib/zip";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { projectId } = await params;
    assertStorageId(projectId, "Project id");
    const project = await getProject(projectId);
    const projectDirectory = getProjectDirectory(projectId);
    const entries = await Promise.all(
      project.artifacts.map(async (artifact) => {
        const filePath = resolveProjectArtifactPath(projectId, artifact);
        await assertLocalFileAvailable(filePath);
        return {
          name: path.relative(projectDirectory, filePath),
          data: await readFile(filePath)
        };
      })
    );

    const archive = createZipArchive(entries);
    const filename = `${slugId(project.title || project.id)}-scriptcast-artifacts.zip`;
    return new NextResponse(archive, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to download project archive.";
    return NextResponse.json(
      {
        error: message
      },
      { status: message.includes("invalid") ? 400 : 404 }
    );
  }
}
