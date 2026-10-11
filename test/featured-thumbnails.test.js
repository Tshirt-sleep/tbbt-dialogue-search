import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const ids = ['S01E02-0050', 'S01E15-0050', 'S01E16-0058', 'S01E17-0034', 'S01E02-0023', 'S01E16-0042'];

test('首页精选缩略图是可读的静态 JPEG 文件', async () => {
  for (const id of ids) {
    const path = new URL(`../assets/featured/${id}.jpg`, import.meta.url);
    const [image, details] = await Promise.all([readFile(path), stat(path)]);
    assert.equal(image.readUInt16BE(0), 0xffd8, `${id} 应有 JPEG 文件头`);
    assert.ok(image.readUInt16BE(image.length - 2) === 0xffd9, `${id} 应有 JPEG 文件尾`);
    assert.ok(details.size > 5_000 && details.size < 200_000, `${id} 缩略图尺寸应适合网页加载`);
  }
});
