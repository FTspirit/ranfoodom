export const DEFAULT_LINE_WIDTH = 80;

/**
 * Turn text into display lines no wider than `width` characters.
 * Wraps on whitespace, hard-splits words longer than `width`, and collapses
 * runs of blank lines into one (leading/trailing blanks are dropped).
 */
export function paginate(text: string, width = DEFAULT_LINE_WIDTH): string[] {
  const w = Math.max(1, Math.floor(width));
  const out: string[] = [];

  const pushBlank = () => {
    if (out.length > 0 && out[out.length - 1] !== '') {
      out.push('');
    }
  };

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) {
      pushBlank();
      continue;
    }
    let current = '';
    let currentLen = 0;
    for (const word of line.split(/\s+/)) {
      let chars = Array.from(word);
      // hard-split over-long words
      while (chars.length > w) {
        if (currentLen > 0) {
          out.push(current);
          current = '';
          currentLen = 0;
        }
        out.push(chars.slice(0, w).join(''));
        chars = chars.slice(w);
      }
      if (chars.length === 0) {
        continue;
      }
      const piece = chars.join('');
      if (currentLen === 0) {
        current = piece;
        currentLen = chars.length;
      } else if (currentLen + 1 + chars.length <= w) {
        current += ' ' + piece;
        currentLen += 1 + chars.length;
      } else {
        out.push(current);
        current = piece;
        currentLen = chars.length;
      }
    }
    if (currentLen > 0) {
      out.push(current);
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  return out;
}
