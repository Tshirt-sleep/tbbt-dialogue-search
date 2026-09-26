import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedEpisodes, validateCatalog } from '../scripts/catalog-validation.js';

function fixture() {
  const episodes = Object.fromEntries(expectedEpisodes.map(episode => [episode, {
    title: episode,
    video: `https://example.com/${episode}.mp4`,
  }]));
  const lines = expectedEpisodes.map((episode, index) => ({
    id: `${episode}-0001`, episode, start: index, end: index + 1, zh: '演示', en: 'demo',
  }));
  return { lines, episodes };
}

test('正式目录要求四集、唯一稳定 ID 和对应的 HTTPS MP4', () => {
  const { lines, episodes } = fixture();
  assert.deepEqual(validateCatalog(lines, episodes), { episodeCount: 4, lineCount: 4 });
  lines[1].id = lines[0].id;
  assert.throws(() => validateCatalog(lines, episodes), /台词数据无效/);
  lines[1].id = 'S01E15-0001';
  episodes.S01E15.video = 'https://example.com/S01E16.mp4';
  assert.throws(() => validateCatalog(lines, episodes), /视频必须/);
});

test('正式目录拒绝演示台词', () => {
  const { lines, episodes } = fixture();
  lines[0].demo = true;
  assert.throws(() => validateCatalog(lines, episodes), /台词数据无效/);
});
