import { describe, expect, it } from "vitest";
import { createZipArchive } from "@/lib/zip";

describe("createZipArchive", () => {
  it("creates a standards-compatible archive with central directory entries", () => {
    const archive = createZipArchive([
      {
        name: "readme.txt",
        data: Buffer.from("hello")
      },
      {
        name: "../unsafe.txt",
        data: Buffer.from("safe")
      }
    ]);

    const text = archive.toString("latin1");
    expect(text).toContain("PK\u0003\u0004");
    expect(text).toContain("PK\u0001\u0002");
    expect(text).toContain("readme.txt");
    expect(text).toContain("unsafe.txt");
    expect(text).not.toContain("../unsafe.txt");
  });
});
