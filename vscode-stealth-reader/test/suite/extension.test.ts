import * as assert from 'assert';
import * as vscode from 'vscode';
import type { StealthReaderApi } from '../../src/extension';

describe('Stealth Reader extension', () => {
  let api: StealthReaderApi;

  before(async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'stealth-reader');
    assert.ok(ext, 'extension not found');
    api = (await ext.activate()) ?? ext.exports;
  });

  it('registers all commands', async () => {
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['importBook', 'selectBook', 'removeBook', 'gotoChapter']) {
      assert.ok(cmds.includes(`stealthReader.${c}`), c);
    }
  });

  it('exposes a ReaderService', () => {
    assert.strictEqual(typeof api.reader.currentLine, 'function');
    assert.strictEqual(api.reader.currentLine(), '');
  });
});
