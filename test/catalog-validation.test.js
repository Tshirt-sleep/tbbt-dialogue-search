import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedEpisodes, validateCatalog, withMediaBase } from '../scripts/catalog-validation.js';

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

test('R2 视频地址替换不修改源集数数据，并拒绝非公开 HTTPS 地址', () => {
  const { episodes } = fixture();
  const rewritten = withMediaBase(episodes, 'https://media.example/media');
  assert.equal(rewritten.S01E02.video, 'https://media.example/media/S01E02.mp4');
  assert.equal(episodes.S01E02.video, 'https://example.com/S01E02.mp4');
  assert.throws(() => withMediaBase(episodes, 'http://media.example/media/'), /公开 HTTPS/);
  assert.throws(() => withMediaBase(episodes, 'https://media.example/media/?token=secret'), /公开 HTTPS/);
});
