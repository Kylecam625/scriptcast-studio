import { NextResponse } from "next/server";
import { listProjects } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      projects: await listProjects()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to list projects."
      },
      { status: 500 }
    );
  }
}
