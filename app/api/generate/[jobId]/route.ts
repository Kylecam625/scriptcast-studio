import { NextResponse } from "next/server";
import { assertStorageId } from "@/lib/ids";
import { getJob, getProject } from "@/lib/storage";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    assertStorageId(jobId, "Job id");
    const job = await getJob(jobId);
    const project = await getProject(job.projectId);
    return NextResponse.json({ job, project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation job not found.";
    return NextResponse.json(
      {
        error: message
      },
      { status: message.includes("invalid") ? 400 : 404 }
    );
  }
}
