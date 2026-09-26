import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedEpisodes, validateCatalog } from './catalog-validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.COS_MEDIA_BASE_URL;
if (!base) throw new Error('请设置 COS_MEDIA_BASE_URL 为 COS 存放 MP4 的 HTTPS 目录 URL');
const baseUrl = new URL(base.endsWith('/') ? base : `${base}/`);
if (baseUrl.protocol !== 'https:') throw new Error('COS_MEDIA_BASE_URL 必须使用 HTTPS');

const lines = JSON.parse(await fs.readFile(path.join(root, 'data/dialogues.json'), 'utf8'));
const episodes = JSON.parse(await fs.readFile(path.join(root, 'data/episodes.json'), 'utf8'));
for (const episode of expectedEpisodes) {
  const media = path.join(root, 'media', `${episode}.mp4`);
  if (!(await fs.stat(media).catch(() => null))?.isFile()) throw new Error(`缺少本地视频：${media}`);
  if (!episodes[episode]) throw new Error(`缺少集数：${episode}`);
  episodes[episode].video = new URL(`${episode}.mp4`, baseUrl).href;
}
const report = validateCatalog(lines, episodes);
const output = path.join(root, 'publish-candidate');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'dialogues.json'), JSON.stringify(lines) + '\n');
await fs.writeFile(path.join(output, 'episodes.json'), JSON.stringify(episodes, null, 2) + '\n');
console.log(`已在 ${output} 准备 ${report.episodeCount} 集、${report.lineCount} 条台词；未上传任何文件。`);
