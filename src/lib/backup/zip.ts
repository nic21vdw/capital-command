import { open } from "node:fs/promises";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Buffer; modified?: Date };

export type ZipFileEntry = {
  name: string;
  size: number;
  compressedSize: number;
  crc32: number;
  modified: Date;
};

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_NAMES = 0x0800;
const STORED = 0;
const DEFLATED = 8;
const MAX_ENTRIES = 0xffff;
const MAX_OFFSET = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function fromDosDateTime(time: number, date: number): Date {
  return new Date(
    ((date >> 9) & 0x7f) + 1980,
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2
  );
}

type CentralRecord = {
  name: Buffer;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
};

function localHeader(record: CentralRecord): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_NAMES, 6);
  header.writeUInt16LE(record.method, 8);
  header.writeUInt16LE(record.time, 10);
  header.writeUInt16LE(record.date, 12);
  header.writeUInt32LE(record.crc, 14);
  header.writeUInt32LE(record.compressedSize, 18);
  header.writeUInt32LE(record.size, 22);
  header.writeUInt16LE(record.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, record.name]);
}

function centralHeader(record: CentralRecord): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_HEADER, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_NAMES, 8);
  header.writeUInt16LE(record.method, 10);
  header.writeUInt16LE(record.time, 12);
  header.writeUInt16LE(record.date, 14);
  header.writeUInt32LE(record.crc, 16);
  header.writeUInt32LE(record.compressedSize, 20);
  header.writeUInt32LE(record.size, 24);
  header.writeUInt16LE(record.name.length, 28);
  header.writeUInt32LE(record.offset, 42);
  return Buffer.concat([header, record.name]);
}

export async function writeZip(
  target: string,
  entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>
): Promise<{ bytes: number; entries: number }> {
  const file = await open(target, "w");
  const records: CentralRecord[] = [];
  let offset = 0;

  const write = async (buffer: Buffer) => {
    let written = 0;
    while (written < buffer.length) {
      const { bytesWritten } = await file.write(buffer, written, buffer.length - written);
      written += bytesWritten;
    }
    offset += buffer.length;
  };

  try {
    for await (const entry of entries) {
      if (records.length >= MAX_ENTRIES) throw new Error("Too many files for one zip archive.");
      if (offset > MAX_OFFSET || entry.data.length > MAX_OFFSET) throw new Error("The archive is too large for the zip format used here.");
      const deflated = deflateRawSync(entry.data);
      const stored = deflated.length >= entry.data.length;
      const payload = stored ? entry.data : deflated;
      const stamp = dosDateTime(entry.modified ?? new Date());
      const record: CentralRecord = {
        name: Buffer.from(entry.name, "utf8"),
        method: stored ? STORED : DEFLATED,
        time: stamp.time,
        date: stamp.date,
        crc: crc32(entry.data),
        compressedSize: payload.length,
        size: entry.data.length,
        offset
      };
      await write(localHeader(record));
      await write(payload);
      records.push(record);
    }

    const directoryStart = offset;
    for (const record of records) await write(centralHeader(record));
    const directorySize = offset - directoryStart;

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(records.length, 8);
    end.writeUInt16LE(records.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(directoryStart, 16);
    await write(end);
    await file.sync();
  } finally {
    await file.close();
  }

  return { bytes: offset, entries: records.length };
}

export type ZipArchive = {
  entries: ZipFileEntry[];
  read(name: string): Buffer;
};

export function openZip(archive: Buffer): ZipArchive {
  const searchFrom = Math.max(0, archive.length - 22 - 0xffff);
  let end = -1;
  for (let position = archive.length - 22; position >= searchFrom; position -= 1) {
    if (archive.readUInt32LE(position) === END_OF_CENTRAL_DIRECTORY) {
      end = position;
      break;
    }
  }
  if (end < 0) throw new Error("This is not a zip archive (no central directory found).");

  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const found = new Map<string, { entry: ZipFileEntry; method: number; offset: number }>();
  const entries: ZipFileEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== CENTRAL_HEADER) {
      throw new Error("This zip archive is damaged (bad central directory).");
    }
    const method = archive.readUInt16LE(cursor + 10);
    const entry: ZipFileEntry = {
      name: "",
      crc32: archive.readUInt32LE(cursor + 16),
      compressedSize: archive.readUInt32LE(cursor + 20),
      size: archive.readUInt32LE(cursor + 24),
      modified: fromDosDateTime(archive.readUInt16LE(cursor + 12), archive.readUInt16LE(cursor + 14))
    };
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const offset = archive.readUInt32LE(cursor + 42);
    entry.name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    found.set(entry.name, { entry, method, offset });
    entries.push(entry);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return {
    entries,
    read(name) {
      const record = found.get(name);
      if (!record) throw new Error(`${name} is not in this archive.`);
      const { entry, method, offset } = record;
      if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== LOCAL_HEADER) {
        throw new Error(`${name} is damaged inside the archive (bad header).`);
      }
      const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
      const payload = archive.subarray(start, start + entry.compressedSize);
      let data: Buffer;
      if (method === STORED) data = Buffer.from(payload);
      else if (method === DEFLATED) {
        try {
          data = inflateRawSync(payload);
        } catch {
          throw new Error(`${name} is corrupt inside the archive (could not decompress).`);
        }
      } else throw new Error(`${name} uses an unsupported compression method (${method}).`);
      if (data.length !== entry.size || crc32(data) !== entry.crc32) {
        throw new Error(`${name} failed its checksum - the archive is corrupt.`);
      }
      return data;
    }
  };
}
