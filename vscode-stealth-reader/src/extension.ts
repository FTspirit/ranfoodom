import * as vscode from 'vscode';
import * as path from 'path';
import { BookStore, BookMeta, ProgressStore } from './core/stores';
import { loadBook, readBookFile, deleteIndexCache } from './core/bookLoader';
import { ReaderService } from './core/readerService';
import { DEFAULT_CHAPTER_PATTERNS, DEFAULT_CHUNK_SIZE } from './core/chapterParser';
import { DEFAULT_LINE_WIDTH } from './core/paginator';

/** Public API returned from activate(); Stage 2 UI (and tests) use it. */
export interface StealthReaderApi {
  reader: ReaderService;
  books: BookStore;
  openBook(id: string): Promise<boolean>;
}

function cfg() {
  const c = vscode.workspace.getConfiguration('stealthReader');
  return {
    patterns: c.get<string[]>('chapterPatterns', DEFAULT_CHAPTER_PATTERNS),
    chunkSize: c.get<number>('chunkSize', DEFAULT_CHUNK_SIZE),
    lineWidth: c.get<number>('lineWidth', DEFAULT_LINE_WIDTH),
    pageSize: c.get<number>('pageSize', 10),
  };
}

export function activate(context: vscode.ExtensionContext): StealthReaderApi {
  const books = new BookStore(context.globalState);
  const progress = new ProgressStore(context.globalState);
  const cacheDir = path.join(context.globalStorageUri.fsPath, 'index');
  const reader = new ReaderService((p) => progress.set(p));
  let openSeq = 0;

  const applySettings = () => {
    const { lineWidth, pageSize } = cfg();
    reader.updateSettings({ lineWidth, pageSize });
  };
  applySettings();

  const openBook = async (id: string): Promise<boolean> => {
    const meta = books.get(id);
    if (!meta) {
      return false;
    }
    const seq = ++openSeq;
    try {
      const loaded = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Loading ${meta.title}` },
        () => loadBook(meta, cfg(), cacheDir),
      );
      if (seq !== openSeq) {
        return false; // a newer open superseded this one
      }
      applySettings();
      reader.open(loaded, progress.get(id));
      await books.setCurrent(id);
      return true;
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not open "${meta.title}": ${(err as Error).message}`);
      return false;
    }
  };

  const pickBook = async (placeHolder: string): Promise<BookMeta | undefined> => {
    const list = books.list();
    if (list.length === 0) {
      void vscode.window.showInformationMessage('No books imported yet. Run "Stealth Reader: Import Book (.txt)".');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      list.map((b) => ({ label: b.title, description: `${(b.size / 1024 / 1024).toFixed(1)} MB · ${b.encoding}`, book: b })),
      { placeHolder },
    );
    return picked?.book;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('stealthReader.importBook', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Text files': ['txt'] },
        openLabel: 'Import',
      });
      if (!uris || uris.length === 0) {
        return;
      }
      const file = uris[0].fsPath;
      try {
        const { encoding, size } = await readBookFile(file);
        const book = await books.add({ title: path.basename(file), path: file, size, encoding });
        await openBook(book.id);
        void vscode.window.showInformationMessage(`Imported "${book.title}" (${encoding}).`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Import failed: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('stealthReader.selectBook', async () => {
      const book = await pickBook('Select a book');
      if (book) {
        await openBook(book.id);
      }
    }),

    vscode.commands.registerCommand('stealthReader.removeBook', async () => {
      const book = await pickBook('Remove which book?');
      if (!book) {
        return;
      }
      if (reader.bookId === book.id) {
        reader.close();
      }
      await books.remove(book.id);
      await progress.clear(book.id);
      await deleteIndexCache(cacheDir, book.id);
    }),

    vscode.commands.registerCommand('stealthReader.gotoChapter', async () => {
      if (!reader.bookId) {
        void vscode.window.showInformationMessage('Open a book first ("Stealth Reader: Select Book").');
        return;
      }
      const items = reader.chapters.map((c, i) => ({ label: c.title, index: i }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Go to chapter', matchOnDescription: true });
      if (picked) {
        reader.gotoChapter(picked.index);
      }
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('stealthReader.lineWidth') || e.affectsConfiguration('stealthReader.pageSize')) {
        applySettings();
      }
    }),
  );

  // Restore last book (and its saved position) after a restart.
  const last = books.currentId();
  if (last) {
    void openBook(last);
  }

  return { reader, books, openBook };
}

export function deactivate(): void {
  // nothing to clean up: state is persisted on every position change
}
