import { NextResponse } from "next/server";
import { openAIMockMode } from "@/lib/env";
import { parseRawScript } from "@/lib/parser";
import { createProject } from "@/lib/storage";
import { ParseRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = ParseRequestSchema.parse(await request.json());
    const parseResult = await parseRawScript(payload.rawText);
    const project = await createProject(payload.rawText, parseResult, {
      sourceMode: payload.sourceMode,
      sourceIdea: payload.sourceIdea || null
    });

    return NextResponse.json({
      project,
      parseResult,
      mockMode: openAIMockMode()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to parse script."
      },
      { status: 400 }
    );
  }
}
