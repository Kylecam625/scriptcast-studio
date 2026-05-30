import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertStorageId } from "@/lib/ids";
import { assertLocalFileAvailable, getProject } from "@/lib/storage";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  try {
    const { projectId } = await params;
    assertStorageId(projectId, "Project id");
    const project = await getProject(projectId);
    if (!project.finalAudioPath) {
      return NextResponse.json({ error: "Final audio is not ready." }, { status: 404 });
    }

    await assertLocalFileAvailable(project.finalAudioPath);
    const audioStats = await stat(project.finalAudioPath);
    const audioSize = audioStats.size;
    const isWav = path.extname(project.finalAudioPath).toLowerCase() === ".wav";
    const url = new URL(request.url);
    const headers = new Headers({
      "Content-Type": isWav ? "audio/wav" : "audio/mpeg",
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes"
    });

    if (url.searchParams.get("download") === "1") {
      const extension = isWav ? "wav" : "mp3";
      headers.set(
        "Content-Disposition",
        `attachment; filename="${project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-scriptcast.${extension}"`
      );
    }

    const range = request.headers.get("range");
    if (range) {
      const parsedRange = parseByteRange(range, audioSize);
      if (!parsedRange) {
        headers.set("Content-Range", `bytes */${audioSize}`);
        return new NextResponse(null, { status: 416, headers });
      }

      const { start, end } = parsedRange;
      headers.set("Content-Range", `bytes ${start}-${end}/${audioSize}`);
      headers.set("Content-Length", String(end - start + 1));
      return new NextResponse(fileStream(project.finalAudioPath, { start, end }), { status: 206, headers });
    }

    headers.set("Content-Length", String(audioSize));
    return new NextResponse(fileStream(project.finalAudioPath), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to export audio.";
    return NextResponse.json(
      {
        error: message
      },
      { status: message.includes("invalid") ? 400 : 404 }
    );
  }
}

function fileStream(filePath: string, options?: { start: number; end: number }) {
  return Readable.toWeb(createReadStream(filePath, options)) as ReadableStream;
}

function parseByteRange(range: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || size <= 0) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return null;
  }

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}
