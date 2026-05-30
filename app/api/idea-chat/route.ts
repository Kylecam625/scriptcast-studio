import { NextResponse } from "next/server";
import { openAIMockMode } from "@/lib/env";
import { continueIdeaChat } from "@/lib/scriptWriter";
import { IdeaChatRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = IdeaChatRequestSchema.parse(await request.json());
    const reply = await continueIdeaChat(payload.messages, payload.preset);
    return NextResponse.json({
      reply,
      message: reply.content,
      question: reply.question,
      choices: reply.choices,
      mockMode: openAIMockMode()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to continue idea chat."
      },
      { status: 400 }
    );
  }
}
