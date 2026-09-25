import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const files = new Map([
  ['index.html', 'index.html'],
  ['src/app.js', 'src/app.js'],
  ['src/core.js', 'src/core.js'],
  ['src/style.css', 'src/style.css'],
  ['data/dialogues.example.json', 'data/dialogues.json'],
  ['data/episodes.example.json', 'data/episodes.json'],
]);

// Copy only the explicit demo allowlist. Never traverse the project tree.
const staging = await fs.mkdtemp(path.join(root, '.demo-build-'));
try {
  for (const [source, target] of files) {
    const sourcePath = path.join(root, source);
    const stat = await fs.lstat(sourcePath);
    if (!stat.isFile()) throw new Error(`演示构建源文件不是普通文件：${source}`);
    const targetPath = path.join(staging, target);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  const lines = JSON.parse(await fs.readFile(path.join(staging, 'data/dialogues.json'), 'utf8'));
  const episodes = JSON.parse(await fs.readFile(path.join(staging, 'data/episodes.json'), 'utf8'));
  if (!Array.isArray(lines) || !lines.every(line => line.demo === true && episodes[line.episode] && !episodes[line.episode].video)) {
    throw new Error('演示数据检查失败：只允许无视频的原创演示台词');
  }

  await fs.rm(output, { recursive: true, force: true });
  await fs.rename(staging, output);
  console.log(`演示站构建完成：${output}`);
} catch (error) {
  await fs.rm(staging, { recursive: true, force: true });
  throw error;
}
