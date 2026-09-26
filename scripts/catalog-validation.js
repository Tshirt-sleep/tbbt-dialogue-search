const expectedEpisodes = ['S01E02', 'S01E15', 'S01E16', 'S01E17'];

export function validateCatalog(lines, episodes) {
  if (!Array.isArray(lines) || !lines.length || !episodes || typeof episodes !== 'object' || Array.isArray(episodes)) {
    throw new Error('台词或集数 JSON 格式无效');
  }
  const ids = new Set();
  for (const line of lines) {
    if (typeof line.id !== 'string' || ids.has(line.id) || !expectedEpisodes.includes(line.episode) ||
        !Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < 0 || line.end <= line.start ||
        typeof line.zh !== 'string' || typeof line.en !== 'string' || line.demo) {
      throw new Error(`台词数据无效：${line.id || '无 ID'}`);
    }
    ids.add(line.id);
  }
  const actual = Object.keys(episodes).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedEpisodes)) throw new Error('集数目录不符合预期的四集');
  for (const episode of expectedEpisodes) {
    if (!lines.some(line => line.episode === episode) || typeof episodes[episode].title !== 'string' ||
        typeof episodes[episode].video !== 'string') throw new Error(`${episode}: 缺少台词、标题或视频地址`);
    const url = new URL(episodes[episode].video);
    if (url.protocol !== 'https:' || !url.pathname.endsWith(`/${episode}.mp4`)) {
      throw new Error(`${episode}: 视频必须使用对应集数的 HTTPS MP4 URL`);
    }
  }
  return { episodeCount: expectedEpisodes.length, lineCount: lines.length };
}

export { expectedEpisodes };
