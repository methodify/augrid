/**
 * Minimal ZIP writer — the container format for .xlsx. Zero dependencies
 * (house rule): CRC-32 by table, local + central directory records written
 * by hand. Entries are DEFLATE-compressed via the platform's
 * CompressionStream when available (Chrome/Edge/Safari 16.4+/Firefox 113+/
 * Node 18+) and stored uncompressed otherwise — both are valid ZIP, so an
 * export always works; compression only decides the file size.
 */

export interface ZipEntry {
  /** Path inside the archive, '/'-separated (e.g. 'xl/worksheets/sheet1.xml'). */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Raw DEFLATE via CompressionStream; null when the platform lacks it.
 * Writes to the stream directly rather than via Blob/Response — some
 * environments (jsdom) ship CompressionStream but not Blob.stream().
 */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (typeof CS !== 'function') return null;
  try {
    const cs = new CS('deflate-raw');
    const writer = cs.writable.getWriter();
    // Cast: a Uint8Array may be SharedArrayBuffer-backed in the type system,
    // which BufferSource excludes; the runtime accepts either.
    void writer.write(data as unknown as BufferSource).then(() => writer.close());
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value as Uint8Array;
      chunks.push(chunk);
      total += chunk.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  } catch {
    return null; // 'deflate-raw' unsupported on this engine
  }
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  /** Little-endian scalars — every numeric ZIP field is LE. */
  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]),
    );
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Build a ZIP archive. `compress: false` forces stored entries (used by tests
 * so the output is byte-inspectable without a decompressor).
 */
export async function createZip(entries: ZipEntry[], compress = true): Promise<Uint8Array> {
  const out = new ByteWriter();
  const central: { name: Uint8Array; crc: number; csize: number; usize: number; offset: number; method: number }[] = [];

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const crc = crc32(entry.data);
    let payload = entry.data;
    let method = 0;
    if (compress && entry.data.length > 0) {
      const deflated = await deflateRaw(entry.data);
      // Only take the compressed form if it actually helped.
      if (deflated && deflated.length < entry.data.length) {
        payload = deflated;
        method = 8;
      }
    }
    const offset = out.length;
    central.push({
      name: nameBytes,
      crc,
      csize: payload.length,
      usize: entry.data.length,
      offset,
      method,
    });

    out.u32(0x04034b50); // local file header signature
    out.u16(20); // version needed
    out.u16(0x0800); // flags: UTF-8 names
    out.u16(method);
    out.u16(0); // mod time — fixed, so exports are byte-reproducible
    out.u16(0x0021); // mod date = 1980-01-01
    out.u32(crc);
    out.u32(payload.length);
    out.u32(entry.data.length);
    out.u16(nameBytes.length);
    out.u16(0); // extra field length
    out.push(nameBytes);
    out.push(payload);
  }

  const cdStart = out.length;
  for (const e of central) {
    out.u32(0x02014b50); // central directory header signature
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0x0800);
    out.u16(e.method);
    out.u16(0);
    out.u16(0x0021);
    out.u32(e.crc);
    out.u32(e.csize);
    out.u32(e.usize);
    out.u16(e.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number start
    out.u16(0); // internal attrs
    out.u32(0); // external attrs
    out.u32(e.offset);
    out.push(e.name);
  }
  const cdSize = out.length - cdStart;

  out.u32(0x06054b50); // end of central directory
  out.u16(0); // this disk
  out.u16(0); // cd start disk
  out.u16(central.length);
  out.u16(central.length);
  out.u32(cdSize);
  out.u32(cdStart);
  out.u16(0); // comment length

  return out.concat();
}
