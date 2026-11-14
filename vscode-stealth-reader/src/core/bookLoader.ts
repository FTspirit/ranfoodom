import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { decodeBuffer, detectEncoding } from './encoding';
import { Chapter, parseChapters, ParseOptions, DEFAULT_CHAPTER_PATTERNS, DEFAULT_CHUNK_SIZE } from './chapterParser';
import type { BookMeta } from './stores';

export interface LoadedBook {
  meta: BookMeta;
  text: string;
  chapters: Chapter[];
}

export async function readBookFile(filePath: string): Promise<{ text: string; encoding: BookMeta['encoding']; size: number }> {
  const buf = await fs.promises.readFile(filePath);
  const d = detectEncoding(buf);
  return { text: decodeBuffer(buf, d.encoding, d.bomLength), encoding: d.encoding, size: buf.length };
}

/**
 * Loads a book and its chapter index. The index (offsets only) is cached as JSON
 * in `cacheDir`, keyed by file size/mtime + parse options, so re-opening a large
 * book skips the heading scan.
 */
export async function loadBook(meta: BookMeta, options: ParseOptions, cacheDir?: string): Promise<LoadedBook> {
  const stat = await fs.promises.stat(meta.path);
  const buf = await fs.promises.readFile(meta.path);
  const d = detectEncoding(buf);
  const text = decodeBuffer(buf, d.encoding, d.bomLength);

  const fingerprint = createHash('sha1')
    .update(JSON.stringify([stat.size, stat.mtimeMs, options.patterns ?? DEFAULT_CHAPTER_PATTERNS, options.chunkSize ?? DEFAULT_CHUNK_SIZE]))
    .digest('hex');
  const cacheFile = cacheDir ? path.join(cacheDir, `${meta.id}.json`) : undefined;

  if (cacheFile) {
    try {
      const cached = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8')) as { fingerprint: string; chapters: Chapter[] };
      if (cached.fingerprint === fingerprint) {
        return { meta, text, chapters: cached.chapters };
      }
    } catch {
      // no/invalid cache: rebuild
    }
  }

  const chapters = parseChapters(text, options);
  if (cacheFile) {
    try {
      await fs.promises.mkdir(cacheDir!, { recursive: true });
      await fs.promises.writeFile(cacheFile, JSON.stringify({ fingerprint, chapters }));
    } catch {
      // cache is best-effort
    }
  }
  return { meta, text, chapters };
}

export async function deleteIndexCache(cacheDir: string, bookId: string): Promise<void> {
  await fs.promises.rm(path.join(cacheDir, `${bookId}.json`), { force: true });
}
