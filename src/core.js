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

export function filterLines(lines, query, episode = 'all', speaker = 'all') {
  const filtered = lines.filter(line => (episode === 'all' || line.episode === episode) &&
    (speaker === 'all' || (speaker === '__unlabeled__' ? !String(line.speaker || '').trim() : line.speaker === speaker)));
  return searchLines(filtered, query);
}

export function contextLines(lines, lineId, radius = 2) {
  const line = lines.find(item => item.id === lineId);
  if (!line) return [];
  const episodeLines = lines.filter(item => item.episode === line.episode)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const index = episodeLines.findIndex(item => item.id === lineId);
  return episodeLines.slice(Math.max(0, index - radius), index + radius + 1);
}

export function visibleLines(matches, limit, selectedId = null) {
  const page = matches.slice(0, Math.max(0, limit));
  const selected = selectedId && matches.find(line => line.id === selectedId);
  return selected && !page.some(line => line.id === selectedId) ? [selected, ...page] : page;
}

export function clipRange(line, padding = 2) {
  return { start: Math.max(0, line.start - padding), end: line.end + padding };
}

export async function playForSelection(video, isCurrent, onError) {
  try {
    await video.play();
  } catch (error) {
    if (!isCurrent()) return;
    if (error.name !== 'AbortError') { onError(error); return; }
    const retry = () => {
      if (!isCurrent() || !video.paused) return;
      video.play().catch(retryError => {
        if (isCurrent() && retryError.name !== 'AbortError') onError(retryError);
      });
    };
    if (video.seeking) video.addEventListener('seeked', retry, { once: true });
    else retry();
  }
}

export function activeLine(lines, time, episode) {
  return lines.find(line => line.episode === episode && time >= line.start && time <= line.end) ?? null;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
