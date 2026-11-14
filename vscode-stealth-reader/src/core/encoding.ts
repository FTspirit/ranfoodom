import * as iconv from 'iconv-lite';

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1258';

export interface DetectedEncoding {
  encoding: TextEncoding;
  /** Number of leading bytes (BOM) to skip when decoding. */
  bomLength: number;
}

function isValidUtf8(buf: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Detect the encoding of a text buffer: UTF-8 (±BOM), UTF-16 (BOM or NUL-heavy), else windows-1258. */
export function detectEncoding(buf: Uint8Array): DetectedEncoding {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: 'utf-8', bomLength: 3 };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: 'utf-16le', bomLength: 2 };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { encoding: 'utf-16be', bomLength: 2 };
  }
  // BOM-less UTF-16LE (checked before UTF-8: NUL bytes are valid UTF-8 but never occur in real text): Latin-heavy text has a NUL in most odd positions.
  const sample = Math.min(buf.length, 4096) & ~1;
  if (sample >= 4) {
    let nulOdd = 0;
    for (let i = 1; i < sample; i += 2) {
      if (buf[i] === 0) {
        nulOdd++;
      }
    }
    if (nulOdd / (sample / 2) > 0.3) {
      return { encoding: 'utf-16le', bomLength: 0 };
    }
  }
  if (isValidUtf8(buf)) {
    return { encoding: 'utf-8', bomLength: 0 };
  }
  return { encoding: 'windows-1258', bomLength: 0 };
}

export function decodeBuffer(buf: Uint8Array, encoding: TextEncoding, bomLength = 0): string {
  const body = bomLength ? buf.subarray(bomLength) : buf;
  if (encoding === 'utf-8') {
    return new TextDecoder('utf-8').decode(body);
  }
  const text = iconv.decode(Buffer.from(body.buffer, body.byteOffset, body.byteLength), encoding);
  // windows-1258 writes most tone marks as combining characters; compose for display/matching.
  return encoding === 'windows-1258' ? text.normalize('NFC') : text;
}

/** Detect and decode in one step. */
export function decodeAuto(buf: Uint8Array): { text: string; encoding: TextEncoding } {
  const d = detectEncoding(buf);
  return { text: decodeBuffer(buf, d.encoding, d.bomLength), encoding: d.encoding };
}
