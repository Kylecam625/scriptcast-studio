import { NextResponse } from "next/server";
import { after } from "next/server";
import { startProjectAudioGeneration } from "@/lib/generator";
import { getProject } from "@/lib/storage";
import { GenerateRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = GenerateRequestSchema.parse(await request.json());
    const job = await startProjectAudioGeneration(payload, (task) => after(task));
    const project = await getProject(payload.projectId);
    if (job.status === "error") {
      return NextResponse.json({ job, project, error: job.error || job.message }, { status: 500 });
    }
    return NextResponse.json({ job, project }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to generate audio."
      },
      { status: 400 }
    );
  }
}
