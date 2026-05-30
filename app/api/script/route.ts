import { NextResponse } from "next/server";
import { openAIMockMode } from "@/lib/env";
import { draftScriptFromIdea } from "@/lib/scriptWriter";
import { DraftScriptRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = DraftScriptRequestSchema.parse(await request.json());
    const script = await draftScriptFromIdea({
      idea: payload.idea,
      conversation: payload.conversation,
      preset: payload.preset,
      duration: payload.duration
    });
    return NextResponse.json({
      script,
      mockMode: openAIMockMode()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to generate script."
      },
      { status: 400 }
    );
  }
}
