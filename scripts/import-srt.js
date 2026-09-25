import { readFile, writeFile, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseSrt(text, language = 'any') {
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const rows = block.split('\n');
    const timingIndex = rows.findIndex(row => /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(row));
    if (timingIndex < 0) continue;
    const match = rows[timingIndex].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) continue;
    const seconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    const start = seconds(...match.slice(1, 5));
    const end = seconds(...match.slice(5, 9));
    const contentRows = rows.slice(timingIndex + 1).map(row => row.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').trim());
    const chosenRows = language === 'zh' ? contentRows.filter(row => /[\u3400-\u9fff]/.test(row)) : contentRows;
    const text = chosenRows.join(' ').replace(/\s+/g, ' ').trim();
    if (end > start && text) cues.push({ sourceIndex: Number(rows[0]) || cues.length + 1, start, end, text });
  }
  return cues;
}

export function pairCues(zh, en, episode) {
  return zh.map(cue => {
    const match = en.map(other => ({ other, overlap: Math.max(0, Math.min(cue.end, other.end) - Math.max(cue.start, other.start)) }))
      .sort((a, b) => b.overlap - a.overlap)[0];
    return { id: `${episode}-${String(cue.sourceIndex).padStart(4, '0')}`, episode, start: cue.start, end: cue.end, zh: cue.text, en: match?.overlap > 0 ? match.other.text : '' };
  });
}

export function mergeEpisodeLines(existing, incoming, episode) {
  const ids = new Set();
  for (const line of incoming) {
    if (line.episode !== episode || ids.has(line.id)) throw new Error(`集数 ${episode} 的台词 ID 重复或不匹配: ${line.id}`);
    ids.add(line.id);
  }
  return [...existing.filter(line => line.episode !== episode), ...incoming]
    .sort((a, b) => a.episode.localeCompare(b.episode) || a.start - b.start || a.id.localeCompare(b.id));
}

export function discoverSrtPairs(names) {
  const groups = new Map();
  for (const name of names) {
    if (!/\.srt$/i.test(name)) continue;
    const episode = name.match(/S\d{2}E\d{2}/i)?.[0].toUpperCase();
    if (!episode) continue;
    const group = groups.get(episode) || { episode, zh: [], en: [] };
    group[/-EN\.srt$/i.test(name) ? 'en' : 'zh'].push(name);
    groups.set(episode, group);
  }
  return [...groups.values()].sort((a, b) => a.episode.localeCompare(b.episode));
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, file);
}

async function importOne(zhPath, enPath, episode, existing) {
  const [zhBytes, enBytes] = await Promise.all([readFile(zhPath), readFile(enPath)]);
  if (zhBytes.includes(0) || enBytes.includes(0)) throw new Error(`${episode}: 字幕包含空字节，可能未下载完成或文件已损坏`);
  const zh = parseSrt(new TextDecoder('utf-8', { fatal: true }).decode(zhBytes), 'zh');
  const en = parseSrt(new TextDecoder('utf-8', { fatal: true }).decode(enBytes), 'en');
  if (!zh.length || !en.length) throw new Error(`${episode}: 未解析到有效字幕；请确认文件为 UTF-8 SRT`);
  const data = pairCues(zh, en, episode);
  return { lines: mergeEpisodeLines(existing, data, episode), zhCount: zh.length, enCount: en.length, count: data.length, unmatched: data.filter(line => !line.en).map(line => line.id) };
}

async function main(args) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataPath = path.join(root, 'data', 'dialogues.json');
  const episodesPath = path.join(root, 'data', 'episodes.json');
  const existing = await readJson(dataPath, []);
  const episodes = await readJson(episodesPath, {});
  let jobs;
  if (args.length === 0) {
    const need = path.resolve(root, '..', 'need');
    const groups = discoverSrtPairs(await readdir(need));
    if (!groups.length) throw new Error(`未在 ${need} 找到带 S01E02 等集数编号的 SRT`);
    for (const group of groups) {
      if (group.zh.length !== 1 || group.en.length !== 1) throw new Error(`${group.episode}: 需要恰好一份中文和一份 -EN.srt 英文字幕；目前中文 ${group.zh.length} 份、英文 ${group.en.length} 份`);
    }
    jobs = groups.map(group => ({ episode: group.episode, zh: path.join(need, group.zh[0]), en: path.join(need, group.en[0]) }));
  } else if (args.length === 3 && /^S\d{2}E\d{2}$/i.test(args[2])) {
    jobs = [{ zh: args[0], en: args[1], episode: args[2].toUpperCase() }];
  } else {
    throw new Error('用法: npm run import（自动扫描 ../need）或 node scripts/import-srt.js 中文.srt English.srt S01E17');
  }
  let lines = existing;
  const reports = [];
  for (const job of jobs) {
    const result = await importOne(job.zh, job.en, job.episode, lines);
    lines = result.lines;
    const season = Number(job.episode.slice(1, 3));
    const episodeNumber = Number(job.episode.slice(4, 6));
    const mediaFile = path.join(root, 'media', `${job.episode}.mp4`);
    const mediaPresent = await stat(mediaFile).then(info => info.isFile()).catch(() => false);
    episodes[job.episode] = {
      title: episodes[job.episode]?.title || `第 ${season} 季 · 第 ${episodeNumber} 集`,
      video: episodes[job.episode]?.video || `/media/${job.episode}.mp4`
    };
    reports.push({ episode: job.episode, ...result, lines: undefined, mediaPresent });
  }
  await atomicJson(dataPath, lines);
  await atomicJson(episodesPath, episodes);
  for (const report of reports) {
    console.log(`${report.episode}: 中文 ${report.zhCount} 条，英文 ${report.enCount} 条，导入 ${report.count} 条；视频 ${report.mediaPresent ? '已就绪' : '缺少 media/' + report.episode + '.mp4'}`);
    if (report.unmatched.length) console.log(`  未匹配英文: ${report.unmatched.join(', ')}`);
  }
  console.log(`共 ${lines.length} 条台词，${Object.keys(episodes).length} 集。请抽查新集字幕配对。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
