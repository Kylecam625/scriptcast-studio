import { NextResponse } from "next/server";
import { elevenLabsMockMode } from "@/lib/env";
import { searchVoices } from "@/lib/voices";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("query") || "";
    const voices = await searchVoices(query);

    return NextResponse.json({
      voices,
      mockMode: elevenLabsMockMode()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to search voices."
      },
      { status: 400 }
    );
  }
}
