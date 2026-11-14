# Stealth Reader (VS Code extension) — Stage 1

Read a local `.txt` novel inside VS Code. Stage 1 delivers the foundation: book import, encoding detection, chapter parsing, pagination and progress persistence, exposed through an internal `ReaderService`. The disguise UI comes in Stage 2. Client-only: no network, no telemetry.

## Build & run

```bash
cd vscode-stealth-reader
npm install
npm run build      # type-check + bundle to dist/extension.js
npm run lint
npm test           # unit tests (mocha, no VS Code needed)
npm run test:vscode  # integration tests in a VS Code instance (needs a display / xvfb)
```

Press **F5** (Run Extension) in this folder to open the Extension Development Host, then use the Command Palette:

- `Stealth Reader: Import Book (.txt)` — stores path + metadata (id, title, size, encoding) in `globalState`; the file is not copied.
- `Stealth Reader: Select Book` / `Remove Book` / `Go to Chapter`.

## Settings (`stealthReader.*`)

| Setting | Default | Meaning |
| --- | --- | --- |
| `chapterPatterns` | Vietnamese/English/Chinese headings | Regexes (flags `imu`) matching a whole heading line |
| `chunkSize` | 3000 | Chunk size when no headings are found |
| `lineWidth` | 80 | Max display line width |
| `pageSize` | 10 | Lines per `getPage()` page |

## Internals

- `src/core/encoding.ts` — UTF-8 (±BOM) → UTF-16 → windows-1258 fallback via `iconv-lite`.
- `src/core/chapterParser.ts`, `src/core/paginator.ts` — pure modules.
- `src/core/bookLoader.ts` — decode + chapter index, cached per book in `globalStorageUri/index`.
- `src/core/readerService.ts` — `currentLine() / next() / prev() / nextChapter() / prevChapter() / getPage(n) / onDidChange`. `activate()` returns it as the extension API.
- Progress `{bookId, chapterIndex, lineIndex}` is saved to `globalState` on every move and restored on startup.

Regenerate fixtures with `npm run fixtures`.
