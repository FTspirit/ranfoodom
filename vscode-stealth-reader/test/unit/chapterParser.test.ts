import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseChapters } from '../../src/core/chapterParser';

const fx = (n: string) => fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures', n), 'utf8');
const titles = (t: string, o = {}) => parseChapters(t, o).map((c) => c.title);

describe('chapterParser', () => {
  it('matches "Chương 12"', () => assert.deepStrictEqual(titles('Chương 12\nx'), ['Chương 12']));
  it('matches "Chương 12: Tên"', () => assert.deepStrictEqual(titles('Chương 12: Tên\nx'), ['Chương 12: Tên']));
  it('matches "CHƯƠNG XII"', () => assert.deepStrictEqual(titles('CHƯƠNG XII\nx'), ['CHƯƠNG XII']));
  it('matches "Chapter 12"', () => assert.deepStrictEqual(titles('Chapter 12\nx'), ['Chapter 12']));
  it('matches "第12章"', () => assert.deepStrictEqual(titles('第12章 开始\nx'), ['第12章 开始']));
  it('matches 第二十章', () => assert.deepStrictEqual(titles('第二十章\nx'), ['第二十章']));
  it('does not match prose mentioning a chapter', () => {
    const long = 'Chương 1 ' + 'a'.repeat(200);
    assert.strictEqual(parseChapters(`${long}\nbody`).every((c) => c.title.startsWith('Part')), true);
  });

  it('splits the vietnamese fixture with a preface and contiguous ranges', () => {
    const text = fx('vi-utf8.txt');
    const ch = parseChapters(text);
    assert.deepStrictEqual(ch.map((c) => c.title), ['Preface', 'Chương 1: Khởi đầu', 'Chương 2', 'CHƯƠNG XII']);
    assert.strictEqual(ch[0].start, 0);
    for (let i = 1; i < ch.length; i++) assert.strictEqual(ch[i].start, ch[i - 1].end);
    assert.strictEqual(ch[ch.length - 1].end, text.length);
  });

  it('handles CRLF line endings', () => {
    assert.deepStrictEqual(titles('Chapter 1\r\nA\r\nChapter 2\r\nB\r\n'), ['Chapter 1', 'Chapter 2']);
  });

  it('falls back to fixed-size chunks without headings', () => {
    const text = fx('no-headings.txt');
    const ch = parseChapters(text, { chunkSize: 1000 });
    assert.ok(ch.length > 5);
    assert.ok(ch.every((c) => c.title.startsWith('Part ')));
    assert.ok(ch.every((c) => c.end - c.start <= 1000));
    assert.strictEqual(ch[0].start, 0);
    assert.strictEqual(ch[ch.length - 1].end, text.length);
  });

  it('honours custom patterns and ignores invalid ones', () => {
    assert.deepStrictEqual(titles('# One\nx\n# Two\ny', { patterns: ['(', '^#\\s.*$'] }), ['# One', '# Two']);
  });

  it('returns [] for empty or blank text', () => {
    assert.deepStrictEqual(parseChapters(''), []);
    assert.deepStrictEqual(parseChapters('  \n\n '), []);
    assert.deepStrictEqual(parseChapters(fx('empty.txt')), []);
  });

  it('parses a 20 MB book quickly', () => {
    const body = 'Nội dung dòng thường của chương truyện, đủ dài để chiếm dung lượng.\n';
    const parts: string[] = [];
    let size = 0;
    for (let i = 1; size < 20 * 1024 * 1024; i++) {
      const chunk = `Chương ${i}: Tiêu đề\n` + body.repeat(500);
      parts.push(chunk);
      size += chunk.length;
    }
    const text = parts.join('');
    const t0 = Date.now();
    const ch = parseChapters(text);
    assert.strictEqual(ch.length, parts.length);
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0}ms`);
  });
});
