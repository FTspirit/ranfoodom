import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReaderService } from '../../src/core/readerService';
import { BookStore, KeyValueStore, Progress, ProgressStore } from '../../src/core/stores';
import { loadBook } from '../../src/core/bookLoader';
import { parseChapters } from '../../src/core/chapterParser';

class MemState implements KeyValueStore {
  constructor(public data: Record<string, unknown> = {}) {}
  get<T>(k: string): T | undefined { return this.data[k] as T | undefined; }
  async update(k: string, v: unknown) { if (v === undefined) delete this.data[k]; else this.data[k] = JSON.parse(JSON.stringify(v)); }
}

const text = 'Chapter 1\nalpha\nbeta\n\nChapter 2\ngamma\n\nChapter 3\ndelta\n';
const meta = { id: 'b1', title: 't', path: '/x', size: 1, encoding: 'utf-8' as const };
const book = () => ({ meta, text, chapters: parseChapters(text) });

describe('ReaderService', () => {
  it('navigates lines and rolls over chapters', () => {
    const r = new ReaderService();
    r.open(book());
    assert.strictEqual(r.currentLine(), 'Chapter 1');
    r.next(); assert.strictEqual(r.currentLine(), 'alpha');
    r.next(); r.next(); // beta -> Chapter 2
    assert.strictEqual(r.currentLine(), 'Chapter 2');
    assert.strictEqual(r.position.chapterIndex, 1);
    r.prev(); assert.strictEqual(r.position.chapterIndex, 0);
    assert.strictEqual(r.currentLine(), 'beta');
  });

  it('stops at both ends of the book', () => {
    const r = new ReaderService();
    r.open(book());
    assert.strictEqual(r.prev(), false);
    r.nextChapter(); r.nextChapter();
    while (r.next()) { /* run to end */ }
    assert.strictEqual(r.currentLine(), 'delta');
    assert.strictEqual(r.nextChapter(), false);
  });

  it('chapter navigation and getPage', () => {
    const r = new ReaderService();
    r.updateSettings({ pageSize: 2 });
    r.open(book());
    assert.deepStrictEqual(r.getPage(0), ['Chapter 1', 'alpha']);
    assert.deepStrictEqual(r.getPage(1), ['beta']);
    assert.deepStrictEqual(r.getPage(5), []);
    assert.strictEqual(r.nextChapter(), true);
    assert.strictEqual(r.currentLine(), 'Chapter 2');
    assert.strictEqual(r.prevChapter(), true);
    assert.strictEqual(r.prevChapter(), false);
  });

  it('fires onDidChange and saves progress', async () => {
    const saved: Progress[] = [];
    const r = new ReaderService((p) => { saved.push(p); });
    const events: number[] = [];
    r.onDidChange((e) => events.push(e.lineIndex));
    r.open(book());
    r.next();
    assert.deepStrictEqual(events, [0, 1]);
    assert.deepStrictEqual(saved, [{ bookId: 'b1', chapterIndex: 0, lineIndex: 1 }]);
  });

  it('is safe with nothing open or an empty book', () => {
    const r = new ReaderService();
    assert.strictEqual(r.currentLine(), '');
    assert.strictEqual(r.next(), false);
    r.open({ meta, text: '', chapters: [] });
    assert.strictEqual(r.currentLine(), '');
    assert.strictEqual(r.next(), false);
  });
});

describe('progress persistence', () => {
  it('restores position from a fresh ReaderService on the same state (simulated reload)', async () => {
    const state = new MemState();
    const progress = new ProgressStore(state);
    const r1 = new ReaderService((p) => progress.set(p));
    r1.open(book(), progress.get('b1'));
    r1.nextChapter(); r1.next();
    await Promise.resolve();

    const reloaded = new MemState(JSON.parse(JSON.stringify(state.data)));
    const r2 = new ReaderService();
    r2.open(book(), new ProgressStore(reloaded).get('b1'));
    assert.deepStrictEqual(r2.position, { chapterIndex: 1, lineIndex: 1 });
    assert.strictEqual(r2.currentLine(), 'gamma');
  });

  it('clamps out-of-range saved progress', () => {
    const r = new ReaderService();
    r.open(book(), { bookId: 'b1', chapterIndex: 99, lineIndex: 99 });
    assert.deepStrictEqual(r.position, { chapterIndex: 2, lineIndex: 1 });
  });
});

describe('BookStore', () => {
  it('adds, dedupes by path, removes', async () => {
    const s = new BookStore(new MemState());
    const a = await s.add({ title: 'a', path: '/a', size: 1, encoding: 'utf-8' });
    const a2 = await s.add({ title: 'a', path: '/a', size: 2, encoding: 'utf-8' });
    assert.strictEqual(a.id, a2.id);
    assert.strictEqual(s.list().length, 1);
    await s.setCurrent(a.id);
    await s.remove(a.id);
    assert.strictEqual(s.list().length, 0);
    assert.strictEqual(s.currentId(), undefined);
  });
});

describe('loadBook', () => {
  it('decodes windows-1258 and caches the chapter index', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-'));
    const file = path.resolve(__dirname, '../../../test/fixtures/vi-cp1258.txt');
    const m = { ...meta, path: file, encoding: 'windows-1258' as const };
    const a = await loadBook(m, {}, dir);
    assert.ok(a.text.includes('Nguyễn Văn Đạt'));
    assert.strictEqual(a.chapters.length, 4);
    assert.ok(fs.existsSync(path.join(dir, 'b1.json')));
    const b = await loadBook(m, {}, dir);
    assert.deepStrictEqual(b.chapters, a.chapters);
    // changed options invalidate the cache
    const c = await loadBook(m, { patterns: ['^Chương 2$'] }, dir);
    assert.strictEqual(c.chapters.length, 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
