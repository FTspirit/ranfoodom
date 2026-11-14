import * as assert from 'assert';
import { paginate } from '../../src/core/paginator';

describe('paginator', () => {
  it('wraps on word boundaries within width', () => {
    const lines = paginate('one two three four five six', 10);
    assert.deepStrictEqual(lines, ['one two', 'three four', 'five six']);
    assert.ok(lines.every((l) => l.length <= 10));
  });

  it('hard-splits words longer than the width', () => {
    assert.deepStrictEqual(paginate('abcdefghij kl', 4), ['abcd', 'efgh', 'ij', 'kl']);
  });

  it('collapses blank lines and trims edges', () => {
    assert.deepStrictEqual(paginate('\n\na\n\n\n\nb\n\n', 80), ['a', '', 'b']);
  });

  it('measures width in code points, keeping Vietnamese diacritics intact', () => {
    const lines = paginate('Nguyễn Văn Đạt đi tìm thanh kiếm', 15);
    assert.ok(lines.every((l) => Array.from(l).length <= 15));
    assert.strictEqual(lines.join(' '), 'Nguyễn Văn Đạt đi tìm thanh kiếm');
  });

  it('splits unspaced CJK text by width', () => {
    assert.deepStrictEqual(paginate('从前有座山山里有座庙', 4), ['从前有座', '山山里有', '座庙']);
  });

  it('handles CRLF and empty input', () => {
    assert.deepStrictEqual(paginate('a\r\nb'), ['a', 'b']);
    assert.deepStrictEqual(paginate(''), []);
    assert.deepStrictEqual(paginate('   \n  '), []);
  });
});
