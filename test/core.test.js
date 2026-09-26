import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLines, matchType, filterLines, visibleLines, clipRange, activeLine } from '../src/core.js';
import { parseSrt, pairCues, mergeEpisodeLines, discoverSrtPairs } from '../scripts/import-srt.js';

const lines = [{ id: 'S01E17-0001', episode: 'S01E17', start: 4, end: 7, zh: '时间到了', en: "It's time" }];
test('中英文检索与片段时间', () => {
  assert.equal(searchLines(lines, '时间').length, 1);
  assert.equal(searchLines(lines, 'TIME').length, 1);
  assert.equal(searchLines(lines, '不存在').length, 0);
  assert.deepEqual(clipRange(lines[0]), { start: 2, end: 9 });
  assert.equal(activeLine(lines, 5, 'S01E17')?.id, lines[0].id);
});
test('短语优先，词序颠倒和词间插词归入关键词匹配', () => {
  const catalogue = [
    { id: 'reverse', episode: 'S01E02', zh: '', en: 'bang big theory' },
    { id: 'gap', episode: 'S01E02', zh: '', en: 'big strange bang theory' },
    { id: 'phrase', episode: 'S01E02', zh: '', en: 'the BIG BANG theory' }
  ];
  assert.deepEqual(searchLines(catalogue, 'big bang').map(line => line.id), ['phrase', 'reverse', 'gap']);
  assert.equal(matchType(catalogue[0], 'big bang'), 'keywords');
  assert.equal(matchType(catalogue[1], 'big bang'), 'keywords');
  assert.equal(matchType(catalogue[2], 'BiG BaNg'), 'phrase');
  assert.equal(matchType(catalogue[0], 'bang big'), 'phrase');
});
test('短语结果不重复，集数筛选保留排序，单词和中文可搜索', () => {
  const catalogue = [
    { id: 'a', episode: 'S01E02', zh: '大爆炸理论', en: 'big bang theory' },
    { id: 'b', episode: 'S01E15', zh: '中文台词', en: 'big surprising bang' },
    { id: 'c', episode: 'S01E15', zh: '中文短语', en: 'BIG BANG' }
  ];
  assert.deepEqual(searchLines(catalogue, 'big bang').map(line => line.id), ['a', 'c', 'b']);
  assert.equal(new Set(searchLines(catalogue, 'big bang').map(line => line.id)).size, 3);
  assert.deepEqual(filterLines(catalogue, 'big bang', 'S01E15').map(line => line.id), ['c', 'b']);
  assert.deepEqual(filterLines(catalogue, 'big bang', 'S01E02').map(line => line.id), ['a']);
  assert.deepEqual(searchLines(catalogue, '中文').map(line => line.id), ['b', 'c']);
  assert.deepEqual(searchLines(catalogue, 'theory').map(line => line.id), ['a']);
});
test('解析 SRT 并按重叠时间配对', () => {
  const zh = parseSrt('1\n00:00:04,000 --> 00:00:07,000\n时间到了。\n');
  const en = parseSrt('1\n00:00:04,200 --> 00:00:07,100\nIt is time.\n');
  assert.deepEqual(pairCues(zh, en, 'S01E17'), [{ id: 'S01E17-0001', episode: 'S01E17', start: 4, end: 7, zh: '时间到了。', en: 'It is time.' }]);
});
test('自动识别集数，重复导入只替换目标集', () => {
  const groups = discoverSrtPairs(['SHDBZ S01E03.srt', 'SHDBZ S01E02-EN.srt', 'SHDBZ S01E03-EN.srt', 'SHDBZ S01E02.srt', 'SHDBZ S01E03.mkv']);
  assert.deepEqual(groups.map(group => group.episode), ['S01E02', 'S01E03']);
  const existing = [
    { id: 'S01E02-0001', episode: 'S01E02', start: 2, zh: '旧台词' },
    { id: 'S01E03-0001', episode: 'S01E03', start: 5, zh: '保留台词' }
  ];
  const updated = mergeEpisodeLines(existing, [{ id: 'S01E02-0001', episode: 'S01E02', start: 3, zh: '新台词' }], 'S01E02');
  assert.equal(updated.length, 2);
  assert.equal(updated[0].zh, '新台词');
  assert.equal(updated[1].zh, '保留台词');
  assert.throws(() => mergeEpisodeLines([], [{ id: 'duplicate', episode: 'S01E02' }, { id: 'duplicate', episode: 'S01E02' }], 'S01E02'), /重复/);
});
test('双语中文字幕只提取中文行', () => {
  const cues = parseSrt('1\n00:00:02,700 --> 00:00:05,140\n{\\fs16}给 泰国炒面\nHere we go.\n', 'zh');
  assert.equal(cues[0].text, '给 泰国炒面');
});
test('集数筛选、分页与靠后分享台词可见', () => {
  const catalogue = Array.from({ length: 95 }, (_, index) => ({ id: `S01E02-${index}`, episode: 'S01E02', zh: `台词 ${index}`, en: `line ${index}` }));
  catalogue.push({ id: 'S01E15-1', episode: 'S01E15', zh: '另一集', en: 'another episode' });
  assert.equal(filterLines(catalogue, '', 'S01E02').length, 95);
  assert.equal(filterLines(catalogue, 'another', 'S01E15').length, 1);
  assert.equal(filterLines(catalogue, 'another', 'S01E02').length, 0);
  assert.equal(visibleLines(catalogue, 40).length, 40);
  assert.equal(visibleLines(catalogue, 80).length, 80);
  const linked = visibleLines(catalogue, 40, 'S01E02-90');
  assert.equal(linked[0].id, 'S01E02-90');
  assert.equal(new Set(linked.map(line => line.id)).size, linked.length);
  assert.equal(visibleLines(catalogue, 95, 'S01E02-90').length, 95);
});
