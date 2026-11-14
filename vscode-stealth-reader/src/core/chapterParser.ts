export interface Chapter {
  title: string;
  /** Start offset (inclusive) into the book text, UTF-16 code units. */
  start: number;
  /** End offset (exclusive). */
  end: number;
}

export const DEFAULT_CHAPTER_PATTERNS: string[] = [
  '^\\s*(?:chương|chuong|chapter)\\s+(?:\\d+|[IVXLCDM]+)\\b.*$',
  '^\\s*第\\s*[0-9０-９〇零一二三四五六七八九十百千万两]+\\s*章.*$',
];

export const DEFAULT_CHUNK_SIZE = 3000;
const MAX_HEADING_LENGTH = 120;

export interface ParseOptions {
  patterns?: string[];
  chunkSize?: number;
}

function compilePatterns(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p, 'imu'));
    } catch {
      // ignore invalid user regex
    }
  }
  return out;
}

/** Split text into fixed-size chunks, preferring to break at a newline. */
function chunkFallback(text: string, chunkSize: number): Chapter[] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chapters: Chapter[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + size, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > pos + size / 2) {
        end = nl + 1;
      }
    }
    if (text.slice(pos, end).trim()) {
      chapters.push({ title: `Part ${chapters.length + 1}`, start: pos, end });
    }
    pos = end;
  }
  return chapters;
}

/** Pure chapter splitter. Returns [] for empty/blank text. */
export function parseChapters(text: string, options: ParseOptions = {}): Chapter[] {
  if (!text.trim()) {
    return [];
  }
  const regexes = compilePatterns(options.patterns ?? DEFAULT_CHAPTER_PATTERNS);
  const headings: { title: string; start: number }[] = [];

  let pos = 0;
  while (pos < text.length) {
    let eol = text.indexOf('\n', pos);
    if (eol === -1) {
      eol = text.length;
    }
    const line = text.slice(pos, eol).replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed && trimmed.length <= MAX_HEADING_LENGTH && regexes.some((r) => r.test(trimmed))) {
      headings.push({ title: trimmed, start: pos });
    }
    pos = eol + 1;
  }

  if (headings.length === 0) {
    return chunkFallback(text, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  }

  const chapters: Chapter[] = [];
  if (text.slice(0, headings[0].start).trim()) {
    chapters.push({ title: 'Preface', start: 0, end: headings[0].start });
  }
  headings.forEach((h, i) => {
    chapters.push({ title: h.title, start: h.start, end: i + 1 < headings.length ? headings[i + 1].start : text.length });
  });
  return chapters;
}
