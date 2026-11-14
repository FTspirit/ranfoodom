import { Emitter, Event } from './emitter';
import { Chapter } from './chapterParser';
import { paginate, DEFAULT_LINE_WIDTH } from './paginator';
import type { LoadedBook } from './bookLoader';
import type { Progress } from './stores';

export interface ReaderChange {
  bookId: string | undefined;
  chapterIndex: number;
  lineIndex: number;
}

export interface ReaderSettings {
  lineWidth: number;
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 10;

/**
 * Stage 1 reading API (consumed by the Stage 2 disguise UI).
 * Keeps the current book/chapter in memory, paginates one chapter at a time,
 * and reports position changes through `onDidChange`.
 */
export class ReaderService {
  private book: LoadedBook | undefined;
  private lines: string[] = [];
  private chapterIndex = 0;
  private lineIndex = 0;
  private settings: ReaderSettings = { lineWidth: DEFAULT_LINE_WIDTH, pageSize: DEFAULT_PAGE_SIZE };
  private readonly emitter = new Emitter<ReaderChange>();

  readonly onDidChange: Event<ReaderChange> = this.emitter.event;

  constructor(private readonly saveProgress: (p: Progress) => PromiseLike<void> | void = () => undefined) {}

  get bookId(): string | undefined {
    return this.book?.meta.id;
  }
  get chapters(): readonly Chapter[] {
    return this.book?.chapters ?? [];
  }
  get position(): { chapterIndex: number; lineIndex: number } {
    return { chapterIndex: this.chapterIndex, lineIndex: this.lineIndex };
  }

  open(book: LoadedBook, progress?: Progress): void {
    this.book = book;
    const last = Math.max(0, book.chapters.length - 1);
    this.chapterIndex = clamp(progress?.chapterIndex ?? 0, 0, last);
    this.repaginate();
    this.lineIndex = clamp(progress?.lineIndex ?? 0, 0, Math.max(0, this.lines.length - 1));
    this.changed(false);
  }

  close(): void {
    this.book = undefined;
    this.lines = [];
    this.chapterIndex = 0;
    this.lineIndex = 0;
    this.changed(false);
  }

  updateSettings(s: Partial<ReaderSettings>): void {
    const widthChanged = s.lineWidth !== undefined && s.lineWidth !== this.settings.lineWidth;
    this.settings = { ...this.settings, ...s };
    if (widthChanged && this.book) {
      // keep roughly the same place in the chapter
      const ratio = this.lines.length ? this.lineIndex / this.lines.length : 0;
      this.repaginate();
      this.lineIndex = clamp(Math.floor(ratio * this.lines.length), 0, Math.max(0, this.lines.length - 1));
      this.changed();
    }
  }

  /** Current line, or '' when nothing is open. */
  currentLine(): string {
    return this.lines[this.lineIndex] ?? '';
  }

  /** Advance one line; rolls over into the next chapter. Returns false at end of book. */
  next(): boolean {
    if (!this.book) {
      return false;
    }
    if (this.lineIndex + 1 < this.lines.length) {
      this.lineIndex++;
    } else if (this.chapterIndex + 1 < this.book.chapters.length) {
      this.chapterIndex++;
      this.repaginate();
      this.lineIndex = 0;
    } else {
      return false;
    }
    this.changed();
    return true;
  }

  /** Go back one line; rolls into the last line of the previous chapter. Returns false at start of book. */
  prev(): boolean {
    if (!this.book) {
      return false;
    }
    if (this.lineIndex > 0) {
      this.lineIndex--;
    } else if (this.chapterIndex > 0) {
      this.chapterIndex--;
      this.repaginate();
      this.lineIndex = Math.max(0, this.lines.length - 1);
    } else {
      return false;
    }
    this.changed();
    return true;
  }

  nextChapter(): boolean {
    return this.gotoChapter(this.chapterIndex + 1);
  }

  prevChapter(): boolean {
    return this.gotoChapter(this.chapterIndex - 1);
  }

  gotoChapter(index: number): boolean {
    if (!this.book || index < 0 || index >= this.book.chapters.length || index === this.chapterIndex) {
      return false;
    }
    this.chapterIndex = index;
    this.repaginate();
    this.lineIndex = 0;
    this.changed();
    return true;
  }

  /** Lines of page `n` (0-based, `pageSize` lines each) in the current chapter. */
  getPage(n: number): string[] {
    const size = Math.max(1, this.settings.pageSize);
    if (n < 0) {
      return [];
    }
    return this.lines.slice(n * size, (n + 1) * size);
  }

  private repaginate(): void {
    const ch = this.book?.chapters[this.chapterIndex];
    this.lines = ch && this.book ? paginate(this.book.text.slice(ch.start, ch.end), this.settings.lineWidth) : [];
  }

  private changed(save = true): void {
    const change: ReaderChange = { bookId: this.bookId, chapterIndex: this.chapterIndex, lineIndex: this.lineIndex };
    if (save && this.book) {
      void this.saveProgress({ bookId: this.book.meta.id, chapterIndex: this.chapterIndex, lineIndex: this.lineIndex });
    }
    this.emitter.fire(change);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
