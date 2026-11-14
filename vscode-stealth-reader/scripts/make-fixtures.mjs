// Regenerates small fixtures (run: npm run fixtures). Needs `npm install` first.
import fs from 'fs';
import iconv from 'iconv-lite';

const dir = new URL('../test/fixtures/', import.meta.url);
const vi = [
  'Lời mở đầu',
  'Đây là phần giới thiệu của cuốn tiểu thuyết thử nghiệm.',
  '',
  'Chương 1: Khởi đầu',
  'Ngày xửa ngày xưa, ở một vương quốc xa xôi, có một chàng trai nghèo tên là Nguyễn Văn Đạt.',
  '',
  '',
  'Chương 2',
  'Chàng lên đường tìm kiếm thanh kiếm huyền thoại ở phương Bắc.',
  '',
  'CHƯƠNG XII',
  'Cuộc chiến cuối cùng đã đến, mọi thứ đều thay đổi.',
  '',
].join('\n');
fs.writeFileSync(new URL('vi-utf8.txt', dir), vi);
fs.writeFileSync(new URL('vi-utf8-bom.txt', dir), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(vi)]));
fs.writeFileSync(new URL('vi-cp1258.txt', dir), encodeCp1258(vi, iconv));
fs.writeFileSync(new URL('vi-utf16le.txt', dir), iconv.encode(vi, 'utf-16le', { addBOM: true }));
fs.writeFileSync(new URL('en-chapters.txt', dir), 'Chapter 1\nHello world.\n\nChapter 2: Next\nMore text here.\n');
fs.writeFileSync(new URL('zh-chapters.txt', dir), '第1章 开始\n从前有座山。\n\n第二十章 结束\n故事完。\n');
fs.writeFileSync(
  new URL('no-headings.txt', dir),
  Array.from({ length: 200 }, (_, i) => `Dòng số ${i + 1} của một văn bản không có tiêu đề chương nào cả.`).join('\n'),
);
fs.writeFileSync(new URL('empty.txt', dir), '');

function cp1258Prep(t) {
  // cp1258 stores â/ă/ê/ô/ơ/ư/đ precomposed but tone marks as separate combining chars.
  return t.normalize('NFD').replace(/(.)([\u0300-\u036f]+)/gsu, (_, b, marks) => {
    const mods = marks.replace(/[^\u0302\u0306\u031b]/g, '');
    return (b + mods).normalize('NFC') + marks.replace(/[\u0302\u0306\u031b]/g, '');
  });
}
export function encodeCp1258(text, ic) {
  return ic.encode(cp1258Prep(text), 'windows-1258');
}
