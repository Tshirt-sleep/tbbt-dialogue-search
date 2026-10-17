import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, withMediaBase } from './catalog-validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.COS_CATALOG_BASE_URL || 'https://tbbt-demo-assets-1495950514.cos.ap-guangzhou.myqcloud.com/';
const baseUrl = new URL(base.endsWith('/') ? base : `${base}/`);
if (baseUrl.protocol !== 'https:') throw new Error('COS_CATALOG_BASE_URL 必须使用 HTTPS');

async function getJson(name) {
  if (process.env.LOCAL_CATALOG_DIR) {
    return JSON.parse(await fs.readFile(path.join(process.env.LOCAL_CATALOG_DIR, name), 'utf8'));
  }
  // Netlify builds can use the repository's ignored local catalog files when
  // they are present in the build checkout (for example, via a deploy bundle).
  const localCatalogPath = path.join(root, 'data', name);
  try {
    return JSON.parse(await fs.readFile(localCatalogPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(new URL(name, baseUrl), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${name} 读取失败：HTTP ${response.status}`);
  return response.json();
}
const [lines, sourceEpisodes] = await Promise.all([getJson('dialogues.json'), getJson('episodes.json')]);
const mediaBase = process.env.R2_MEDIA_BASE_URL || 'https://pub-a0c4843b29534b999f578e9b898b6127.r2.dev/media/';
const episodes = withMediaBase(sourceEpisodes, mediaBase);
const report = validateCatalog(lines, episodes);
const featuredIds = ['S01E02-0050', 'S01E15-0050', 'S01E16-0058', 'S01E17-0034', 'S01E02-0023', 'S01E16-0042'];
for (const id of featuredIds) {
  if (!lines.some(line => line.id === id && line.zh && line.en)) {
    throw new Error(`正式目录缺少双语精选台词：${id}`);
  }
  try { await fs.access(path.join(root, 'assets', 'featured', `${id}.jpg`)); }
  catch { throw new Error(`缺少由视频素材生成的精选缩略图：${id}.jpg；运行 python scripts/generate-featured-thumbnails.py`); }
}
if (!process.env.LOCAL_CATALOG_DIR) {
  await Promise.all(Object.entries(episodes).map(async ([episode, details]) => {
    try {
      const response = await fetch(details.video, {
        headers: { Range: 'bytes=0-1' },
        signal: AbortSignal.timeout(15000),
      });
      const contentType = response.headers.get('content-type') || '';
      const contentRange = response.headers.get('content-range') || '';
      const disposition = response.headers.get('content-disposition') || '';
      console.log(`${episode} 视频探测：HTTP ${response.status}，类型 ${contentType || '未提供'}，范围 ${contentRange || response.headers.get('accept-ranges') || '未提供'}，下载方式 ${disposition || '未提供'}`);
      await response.body?.cancel();
      if (response.status !== 206 || !/^video\/mp4(?:;|$)/i.test(contentType) || !/^bytes 0-1\//i.test(contentRange) || /attachment/i.test(disposition)) {
        throw new Error(`${episode} R2 视频不可用于网页播放：需要 HTTP 206、video/mp4、有效字节范围且不能强制下载`);
      }
    } catch (error) {
      throw new Error(`${episode} 视频探测失败：${error.message}`);
    }
  }));
}
const staging = await fs.mkdtemp(path.join(root, '.cos-build-'));
try {
  for (const file of ['index.html', 'src/app.js', 'src/core.js', 'src/style.css']) {
    await fs.mkdir(path.dirname(path.join(staging, file)), { recursive: true });
    await fs.copyFile(path.join(root, file), path.join(staging, file));
  }
  await fs.mkdir(path.join(staging, 'assets', 'featured'), { recursive: true });
  for (const id of featuredIds) {
    await fs.copyFile(path.join(root, 'assets', 'featured', `${id}.jpg`), path.join(staging, 'assets', 'featured', `${id}.jpg`));
  }
  await fs.mkdir(path.join(staging, 'data'));
  await fs.writeFile(path.join(staging, 'data/dialogues.json'), JSON.stringify(lines) + '\n');
  await fs.writeFile(path.join(staging, 'data/episodes.json'), JSON.stringify(episodes) + '\n');
  const output = path.join(root, 'dist');
  await fs.rm(output, { recursive: true, force: true });
  await fs.rename(staging, output);
  console.log(`正式候选构建完成：${report.episodeCount} 集、${report.lineCount} 条台词。`);
} catch (error) {
  await fs.rm(staging, { recursive: true, force: true });
  throw error;
}
