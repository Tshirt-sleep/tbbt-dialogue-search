import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './catalog-validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.COS_CATALOG_BASE_URL || 'https://tbbt-demo-assets-1495950514.cos.ap-guangzhou.myqcloud.com/';
const baseUrl = new URL(base.endsWith('/') ? base : `${base}/`);
if (baseUrl.protocol !== 'https:') throw new Error('COS_CATALOG_BASE_URL 必须使用 HTTPS');

async function getJson(name) {
  if (process.env.LOCAL_CATALOG_DIR) {
    return JSON.parse(await fs.readFile(path.join(process.env.LOCAL_CATALOG_DIR, name), 'utf8'));
  }
  const response = await fetch(new URL(name, baseUrl), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${name} 读取失败：HTTP ${response.status}`);
  return response.json();
}
const [lines, episodes] = await Promise.all([getJson('dialogues.json'), getJson('episodes.json')]);
const report = validateCatalog(lines, episodes);
const staging = await fs.mkdtemp(path.join(root, '.cos-build-'));
try {
  for (const file of ['index.html', 'src/app.js', 'src/core.js', 'src/style.css']) {
    await fs.mkdir(path.dirname(path.join(staging, file)), { recursive: true });
    await fs.copyFile(path.join(root, file), path.join(staging, file));
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
