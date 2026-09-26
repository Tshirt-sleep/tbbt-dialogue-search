export function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
}

export function matchType(line, query) {
  const phrase = normalize(query).replace(/\s+/g, ' ');
  if (!phrase) return null;
  const fields = [line.zh, line.en, line.episode].map(value => normalize(value).replace(/\s+/g, ' '));
  if (fields.some(value => value.includes(phrase))) return 'phrase';
  const terms = phrase.split(' ');
  return terms.every(term => fields.some(value => value.includes(term))) ? 'keywords' : null;
}

export function searchLines(lines, query) {
  if (!normalize(query)) return lines;
  const phrases = [];
  const keywords = [];
  const seen = new Set();
  for (const line of lines) {
    if (seen.has(line.id)) continue;
    const type = matchType(line, query);
    if (!type) continue;
    seen.add(line.id);
    (type === 'phrase' ? phrases : keywords).push(line);
  }
  return [...phrases, ...keywords];
}

export function filterLines(lines, query, episode = 'all') {
  return searchLines(episode === 'all' ? lines : lines.filter(line => line.episode === episode), query);
}

export function visibleLines(matches, limit, selectedId = null) {
  const page = matches.slice(0, Math.max(0, limit));
  const selected = selectedId && matches.find(line => line.id === selectedId);
  return selected && !page.some(line => line.id === selectedId) ? [selected, ...page] : page;
}

export function clipRange(line, padding = 2) {
  return { start: Math.max(0, line.start - padding), end: line.end + padding };
}

export function activeLine(lines, time, episode) {
  return lines.find(line => line.episode === episode && time >= line.start && time <= line.end) ?? null;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
