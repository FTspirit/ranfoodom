import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { decodeAuto, detectEncoding } from '../../src/core/encoding';

const fxBuf = (n: string) => fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures', n));
const expected = fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/vi-utf8.txt'), 'utf8');

describe('encoding', () => {
  it('detects UTF-8 without BOM', () => {
    const r = decodeAuto(fxBuf('vi-utf8.txt'));
    assert.strictEqual(r.encoding, 'utf-8');
    assert.strictEqual(r.text, expected);
  });

  it('detects UTF-8 with BOM and strips it', () => {
    const r = decodeAuto(fxBuf('vi-utf8-bom.txt'));
    assert.strictEqual(r.encoding, 'utf-8');
    assert.strictEqual(r.text, expected);
  });

  it('falls back to windows-1258 with correct diacritics', () => {
    const r = decodeAuto(fxBuf('vi-cp1258.txt'));
    assert.strictEqual(r.encoding, 'windows-1258');
    assert.ok(r.text.includes('Chương 1: Khởi đầu'));
    assert.ok(r.text.includes('Nguyễn Văn Đạt'));
  });

  it('detects UTF-16LE with BOM', () => {
    const r = decodeAuto(fxBuf('vi-utf16le.txt'));
    assert.strictEqual(r.encoding, 'utf-16le');
    assert.strictEqual(r.text, expected);
  });

  it('detects BOM-less UTF-16LE', () => {
    const buf = Buffer.from('Hello there, plain ascii text in utf16', 'utf16le');
    assert.strictEqual(detectEncoding(buf).encoding, 'utf-16le');
  });

  it('treats empty input as UTF-8', () => {
    assert.deepStrictEqual(decodeAuto(Buffer.alloc(0)), { text: '', encoding: 'utf-8' });
  });

  it('decodes a ~10 MB Vietnamese file in both UTF-8 and windows-1258', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const iconv = require('iconv-lite');
    // cp1258 keeps â/ă/ê/ô/ơ/ư precomposed but stores tone marks as combining characters.
    const encodeCp1258 = (t: string, ic: typeof import('iconv-lite')) =>
      ic.encode(t.normalize('NFD').replace(/(.)([\u0300-\u036f]+)/gsu, (_, b, marks) => {
        const mods = marks.replace(/[^\u0302\u0306\u031b]/g, '');
        return (b + mods).normalize('NFC') + marks.replace(/[\u0302\u0306\u031b]/g, '');
      }), 'windows-1258');
    const line = 'Chương trình đọc truyện ở Việt Nam hôm nay thật tuyệt vời, Đạt nói.\n';
    const text = line.repeat(Math.ceil((10 * 1024 * 1024) / Buffer.byteLength(line)));
    const u8 = decodeAuto(Buffer.from(text));
    assert.strictEqual(u8.encoding, 'utf-8');
    assert.strictEqual(u8.text, text);
    const w = decodeAuto(encodeCp1258(text, iconv));
    assert.strictEqual(w.encoding, 'windows-1258');
    assert.strictEqual(w.text, text);
  });
});
