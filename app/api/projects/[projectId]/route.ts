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
    return NextResponse.json({
      project: await getProject(projectId)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load project.";
    return NextResponse.json(
      {
        error: message
      },
      { status: message.includes("invalid") ? 400 : 404 }
    );
  }
}
