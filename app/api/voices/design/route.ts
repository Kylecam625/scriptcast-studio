import { NextResponse } from "next/server";
import { CharacterSchema } from "@/lib/schemas";
import { designVoiceForCharacter } from "@/lib/voices";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const character = CharacterSchema.parse(await request.json());
    return NextResponse.json(designVoiceForCharacter(character));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to design voice prompt."
      },
      { status: 400 }
    );
  }
}
