/**
 * Minimal ZIP reader: parses the central directory and inflates entries.
 *
 * Scope: just enough to read uncompressed and deflate-compressed entries
 * from a Minecraft client jar. No ZIP64, no encryption, no spanning.
 */
import zlib from "node:zlib";

const SIG_LFH = 0x04034b50;
const SIG_CFH = 0x02014b50;
const SIG_EOCD = 0x06054b50;

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEOCD(buf: Buffer): number {
  const maxBack = Math.min(buf.length, 22 + 0xffff);
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      const commentLen = buf.readUInt16LE(i + 20);
      if (i + 22 + commentLen === buf.length) return i;
    }
  }
  throw new Error("ZIP: end-of-central-directory record not found");
}

export function readZipCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocd = findEOCD(buf);
  const cdEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(p) !== SIG_CFH) {
      throw new Error(`ZIP: bad central directory header at offset ${p}`);
    }
    const compressionMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localHeaderOffset;
  if (buf.readUInt32LE(p) !== SIG_LFH) {
    throw new Error(`ZIP: bad local file header for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(compressed);
  }
  throw new Error(
    `ZIP: unsupported compression method ${entry.compressionMethod} for ${entry.name}`,
  );
}
