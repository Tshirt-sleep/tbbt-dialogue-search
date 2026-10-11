import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function applySpeakerTags(lines, tags) {
  if (!Array.isArray(lines) || !tags || typeof tags !== 'object' || Array.isArray(tags)) {
    throw new Error('需要台词数组和 {"稳定台词ID":"角色名"} 标注对象');
  }
  const byId = new Map(lines.map(line => [line.id, line]));
  for (const [id, value] of Object.entries(tags)) {
    if (!byId.has(id)) throw new Error(`标注中存在未知台词 ID：${id}`);
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${id} 的角色名必须是非空文本`);
  }
  return lines.map(line => Object.hasOwn(tags, line.id)
    ? { ...line, speaker: tags[line.id].trim() }
    : line);
}

async function main(args) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (args.length < 1 || args.length > 3) {
    throw new Error('用法: node scripts/apply-speakers.js speaker-tags.json [dialogues.json] [publish-candidate/dialogues.json]');
  }
  const tagsPath = path.resolve(args[0]);
  const inputPath = path.resolve(args[1] || path.join(root, 'data', 'dialogues.json'));
  const outputPath = path.resolve(args[2] || path.join(root, 'publish-candidate', 'dialogues.json'));
  const [lines, tags] = await Promise.all([
    readFile(inputPath, 'utf8').then(JSON.parse),
    readFile(tagsPath, 'utf8').then(JSON.parse),
  ]);
  const tagged = applySpeakerTags(lines, tags);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(tagged, null, 2) + '\n', 'utf8');
  await rename(temporary, outputPath);
  console.log(`写入 ${Object.keys(tags).length} 条角色标注：${outputPath}`);
  console.log('原始台词文件未修改；请先抽查生成结果，再按流程更新 COS。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
