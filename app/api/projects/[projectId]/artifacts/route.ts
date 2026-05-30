import { NextResponse } from "next/server";
import { assertStorageId } from "@/lib/ids";
import { getProject } from "@/lib/storage";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { projectId } = await params;
    assertStorageId(projectId, "Project id");
    const project = await getProject(projectId);
    return NextResponse.json({
      artifacts: project.artifacts.map((artifact) => ({
        id: artifact.id,
        label: artifact.label,
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        createdAt: artifact.createdAt,
        url: `/api/projects/${project.id}/artifacts/${artifact.id}`
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list artifacts.";
    return NextResponse.json(
      {
        error: message
      },
      { status: message.includes("invalid") ? 400 : 404 }
    );
  }
}
