import type { TextEncoding } from './encoding';

/** Subset of vscode.Memento used here (keeps core testable without vscode). */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface BookMeta {
  id: string;
  title: string;
  path: string;
  size: number;
  encoding: TextEncoding;
}

export interface Progress {
  bookId: string;
  chapterIndex: number;
  lineIndex: number;
}

const BOOKS_KEY = 'stealthReader.books';
const PROGRESS_KEY = 'stealthReader.progress';
const CURRENT_KEY = 'stealthReader.currentBook';

export class BookStore {
  constructor(private readonly state: KeyValueStore) {}

  list(): BookMeta[] {
    return this.state.get<BookMeta[]>(BOOKS_KEY) ?? [];
  }

  get(id: string): BookMeta | undefined {
    return this.list().find((b) => b.id === id);
  }

  /** Adds a book; a book with the same path is replaced and keeps its id. */
  async add(meta: Omit<BookMeta, 'id'>): Promise<BookMeta> {
    const books = this.list();
    const existing = books.find((b) => b.path === meta.path);
    const book: BookMeta = { ...meta, id: existing?.id ?? newId() };
    await this.state.update(BOOKS_KEY, [...books.filter((b) => b.id !== book.id), book]);
    return book;
  }

  async remove(id: string): Promise<void> {
    await this.state.update(BOOKS_KEY, this.list().filter((b) => b.id !== id));
    if (this.currentId() === id) {
      await this.state.update(CURRENT_KEY, undefined);
    }
  }

  currentId(): string | undefined {
    return this.state.get<string>(CURRENT_KEY);
  }

  setCurrent(id: string | undefined): PromiseLike<void> {
    return this.state.update(CURRENT_KEY, id);
  }
}

export class ProgressStore {
  constructor(private readonly state: KeyValueStore) {}

  private all(): Record<string, Progress> {
    return this.state.get<Record<string, Progress>>(PROGRESS_KEY) ?? {};
  }

  get(bookId: string): Progress {
    return this.all()[bookId] ?? { bookId, chapterIndex: 0, lineIndex: 0 };
  }

  async set(p: Progress): Promise<void> {
    await this.state.update(PROGRESS_KEY, { ...this.all(), [p.bookId]: p });
  }

  async clear(bookId: string): Promise<void> {
    const { [bookId]: _removed, ...rest } = this.all();
    void _removed;
    await this.state.update(PROGRESS_KEY, rest);
  }
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
