type ZipEntry = {
  name: string;
  data: Buffer;
};

type CentralDirectoryEntry = {
  crc32: number;
  compressedSize: number;
  localHeaderOffset: number;
  name: Buffer;
  uncompressedSize: number;
};

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

export function createZipArchive(entries: ZipEntry[]) {
  const chunks: Buffer[] = [];
  const centralEntries: CentralDirectoryEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(sanitizeZipPath(entry.name), "utf8");
    const data = entry.data;
    const crc32 = crc32Buffer(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(data.byteLength, 18);
    localHeader.writeUInt32LE(data.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, name, data);
    centralEntries.push({
      crc32,
      compressedSize: data.byteLength,
      localHeaderOffset: offset,
      name,
      uncompressedSize: data.byteLength
    });
    offset += localHeader.byteLength + name.byteLength + data.byteLength;
  }

  const centralDirectoryOffset = offset;
  for (const entry of centralEntries) {
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(entry.crc32, 16);
    centralHeader.writeUInt32LE(entry.compressedSize, 20);
    centralHeader.writeUInt32LE(entry.uncompressedSize, 24);
    centralHeader.writeUInt16LE(entry.name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(entry.localHeaderOffset, 42);
    chunks.push(centralHeader, entry.name);
    offset += centralHeader.byteLength + entry.name.byteLength;
  }

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(centralEntries.length, 8);
  endOfCentralDirectory.writeUInt16LE(centralEntries.length, 10);
  endOfCentralDirectory.writeUInt32LE(offset - centralDirectoryOffset, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);
  chunks.push(endOfCentralDirectory);

  return Buffer.concat(chunks);
}

function sanitizeZipPath(value: string) {
  const cleaned = value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");

  return cleaned || "artifact";
}

function crc32Buffer(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
