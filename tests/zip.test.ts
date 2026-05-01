import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import {
  readZipCentralDirectory,
  readZipEntry,
  type ZipEntry,
} from "../scripts/zip.js";

// CRC-32 (IEEE 802.3) — pure-JS, only used by the test ZIP builder.
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface BuildEntry {
  name: string;
  data: Buffer;
  store?: boolean; // if true, no compression
}

/**
 * Build a small ZIP archive in memory. Mixed stored + deflate entries so
 * both code paths in readZipEntry are exercised.
 */
function buildZip(entries: BuildEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const compressed = e.store ? e.data : zlib.deflateRawSync(e.data);
    const method = e.store ? 0 : 8;
    const crc = crc32(e.data);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0, 12); // mod date
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(e.data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra len
    localChunks.push(lfh, nameBuf, compressed);

    const cfh = Buffer.alloc(46);
    cfh.writeUInt32LE(0x02014b50, 0);
    cfh.writeUInt16LE(20, 4); // version made by
    cfh.writeUInt16LE(20, 6); // version needed
    cfh.writeUInt16LE(0, 8); // flags
    cfh.writeUInt16LE(method, 10);
    cfh.writeUInt16LE(0, 12); // mod time
    cfh.writeUInt16LE(0, 14); // mod date
    cfh.writeUInt32LE(crc, 16);
    cfh.writeUInt32LE(compressed.length, 20);
    cfh.writeUInt32LE(e.data.length, 24);
    cfh.writeUInt16LE(nameBuf.length, 28);
    cfh.writeUInt16LE(0, 30); // extra len
    cfh.writeUInt16LE(0, 32); // comment len
    cfh.writeUInt16LE(0, 34); // disk number
    cfh.writeUInt16LE(0, 36); // internal attrs
    cfh.writeUInt32LE(0, 38); // external attrs
    cfh.writeUInt32LE(offset, 42);
    cdChunks.push(cfh, nameBuf);

    offset += lfh.length + nameBuf.length + compressed.length;
  }

  const localBuf = Buffer.concat(localChunks);
  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with cd
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20); // comment len
  return Buffer.concat([localBuf, cdBuf, eocd]);
}

test("readZipCentralDirectory: lists every entry name and method", () => {
  const zip = buildZip([
    { name: "a.txt", data: Buffer.from("hello") },
    { name: "dir/b.bin", data: Buffer.from([1, 2, 3, 4, 5]), store: true },
  ]);
  const entries = readZipCentralDirectory(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.name, "a.txt");
  assert.equal(entries[0]!.compressionMethod, 8);
  assert.equal(entries[1]!.name, "dir/b.bin");
  assert.equal(entries[1]!.compressionMethod, 0);
});

test("readZipEntry: round-trips both deflate and stored entries", () => {
  const payload = Buffer.from(
    "ModForge ZIP round-trip test " + "x".repeat(500),
  );
  const stored = Buffer.from([10, 20, 30, 40]);
  const zip = buildZip([
    { name: "compressed.txt", data: payload },
    { name: "raw.bin", data: stored, store: true },
  ]);
  const entries = readZipCentralDirectory(zip);
  const compressedEntry = entries.find((e) => e.name === "compressed.txt")!;
  const storedEntry = entries.find((e) => e.name === "raw.bin")!;
  assert.deepEqual(readZipEntry(zip, compressedEntry), payload);
  assert.deepEqual(readZipEntry(zip, storedEntry), stored);
});

test("readZipEntry: throws on unsupported compression method", () => {
  const zip = buildZip([{ name: "x", data: Buffer.from("y") }]);
  const entries = readZipCentralDirectory(zip);
  const fake: ZipEntry = { ...entries[0]!, compressionMethod: 99 };
  assert.throws(() => readZipEntry(zip, fake), /unsupported compression/);
});

test("readZipCentralDirectory: throws on a buffer with no EOCD", () => {
  assert.throws(
    () => readZipCentralDirectory(Buffer.from("not a zip file")),
    /end-of-central-directory/,
  );
});
