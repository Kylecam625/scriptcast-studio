import { NextResponse } from "next/server";
import { openAIMockMode } from "@/lib/env";
import { enhanceTurnsWithDelivery } from "@/lib/parser";
import { EnhanceRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = EnhanceRequestSchema.parse(await request.json());
    const turns = await enhanceTurnsWithDelivery(payload.turns, payload.preset, payload.enabled);
    return NextResponse.json({
      turns,
      mockMode: openAIMockMode()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to enhance delivery."
      },
      { status: 400 }
    );
  }
}
