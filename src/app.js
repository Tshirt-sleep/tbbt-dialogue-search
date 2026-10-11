import { filterLines, matchType, visibleLines, clipRange, activeLine, formatTime, playForSelection, contextLines } from './core.js';

const $ = selector => document.querySelector(selector);
const form = $('#search-form');
const query = $('#query');
const results = $('#results');
const featuredList = $('#featured-list');
const episodeFilterButton = $('#episode-filter-button');
const episodeFilterPanel = $('#episode-filter-panel');
const episodeFilterOptions = $('#episode-filter-options');
const episodeFilterValue = $('#episode-filter-value');
let episodeFilter = 'all';
const speakerFilterButton = $('#speaker-filter-button');
const speakerFilterPanel = $('#speaker-filter-panel');
const speakerFilterOptions = $('#speaker-filter-options');
const speakerFilterValue = $('#speaker-filter-value');
const speakerFilterNote = $('#speaker-filter-note');
let speakerFilter = 'all';
const loadMore = $('#load-more');
const video = $('#video');
const episodeProgress = $('#episode-progress');
const progressTime = $('#progress-time');
const placeholder = $('#video-placeholder');
const status = $('#media-status');
const subtitle = $('#subtitle');
const share = $('#share');
const playerPanel = $('#player-panel');
const playerBackdrop = $('#player-backdrop');
const closePlayerButton = $('#close-player');
const previousLineButton = $('#previous-line');
const nextLineButton = $('#next-line');
const mobileLayout = window.matchMedia('(max-width: 800px)');
let lines = [];
let episodes = {};
let selected = null;
let selectedFromFeatured = false;
let stopAt = null;
let pendingSeekTarget = null;
let selectionVersion = 0;
let subtitleId = undefined;
let clipReady = false;
let pauseVersion = 0;
const PAGE_SIZE = 40;
const FEATURED_IDS = ['S01E02-0050', 'S01E15-0050', 'S01E16-0058', 'S01E17-0034', 'S01E02-0023', 'S01E16-0042'];
let visibleCount = PAGE_SIZE;

function closePlayer() {
  const returningToFeatured = selectedFromFeatured;
  selectionVersion += 1;
  stopAt = null;
  clipReady = false;
  pendingSeekTarget = null;
  document.body.classList.remove('player-open');
  playerBackdrop.hidden = true;
  playerPanel.removeAttribute('role');
  playerPanel.removeAttribute('aria-modal');
  video.pause();
  if (returningToFeatured) {
    selected = null;
    selectedFromFeatured = false;
    share.disabled = true;
    status.textContent = '';
    $('#episode').textContent = '尚未选择台词';
    $('#time').textContent = '--:--';
    setSubtitle(null);
    updateNavigation();
    const url = new URL(location.href);
    url.searchParams.delete('line');
    history.replaceState(null, '', url);
    document.body.classList.remove('featured-playing', 'is-working');
    render();
  }
  results.querySelector('.card.active')?.focus({ preventScroll: true });
}

function openPlayer() {
  if (!mobileLayout.matches) return;
  document.body.classList.add('player-open');
  playerBackdrop.hidden = false;
  playerPanel.setAttribute('role', 'dialog');
  playerPanel.setAttribute('aria-modal', 'true');
  playerPanel.scrollTop = 0;
  closePlayerButton.focus({ preventScroll: true });
}

function appendHighlightedText(element, value, queryText, type) {
  const terms = type === 'phrase'
    ? [queryText.trim().split(/\s+/).join('\\s+')]
    : queryText.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length || !value) { element.textContent = value || '—'; return; }
  const escaped = terms.map(term => type === 'phrase'
    ? term.split('\\s+').map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'giu');
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    element.append(document.createTextNode(value.slice(cursor, match.index)));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    element.append(mark);
    cursor = match.index + match[0].length;
  }
  element.append(document.createTextNode(value.slice(cursor)));
}

function updateNavigation() {
  const episodeLines = lines.filter(line => line.episode === selected?.episode);
  const index = episodeLines.findIndex(line => line.id === selected?.id);
  previousLineButton.disabled = index <= 0;
  nextLineButton.disabled = index < 0 || index >= episodeLines.length - 1;
}

function setSubtitle(line) {
  const nextId = line?.id ?? null;
  if (subtitleId === nextId) return;
  subtitleId = nextId;
  subtitle.replaceChildren();
  if (!line) {
    const p = document.createElement('p');
    p.textContent = selected ? '当前时间没有字幕' : '字幕会随播放进度显示在这里';
    subtitle.append(p);
    return;
  }
  for (const [className, content] of [['zh', line.zh], ['en', line.en]]) {
    const p = document.createElement('p');
    p.className = className;
    p.textContent = content || '—';
    subtitle.append(p);
  }
}

function updateSelectedCard(nextId) {
  for (const card of results.querySelectorAll('.card.active')) {
    card.classList.remove('active');
    card.removeAttribute('aria-current');
    card.querySelector('.current-badge')?.remove();
  }
  const card = [...results.querySelectorAll('.card')].find(item => item.dataset.lineId === nextId);
  if (!card) return false;
  card.classList.add('active');
  card.setAttribute('aria-current', 'true');
  const badge = document.createElement('span');
  badge.className = 'current-badge';
  badge.textContent = '当前播放';
  card.querySelector('.card-location').append(badge);
  return true;
}

function updateProgress() {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  episodeProgress.disabled = !duration;
  episodeProgress.max = String(duration || 100);
  episodeProgress.value = String(Math.min(video.currentTime || 0, duration || 100));
  progressTime.textContent = `${formatTime(video.currentTime || 0)} / ${duration ? formatTime(duration) : '--:--'}`;
}

function selectLine(line, updateUrl = true, selectionSource = 'results') {
  selected = line;
  selectedFromFeatured = selectionSource === 'featured';
  const currentSelection = ++selectionVersion;
  const range = clipRange(line);
  stopAt = range.end;
  clipReady = false;
  pendingSeekTarget = null;
  const episode = episodes[line.episode];
  $('#episode').textContent = episode?.title || line.episode;
  $('#time').textContent = formatTime(line.start);
  share.disabled = false;
  status.textContent = '';
  const source = episode?.video;
  if (!source) {
    video.removeAttribute('src');
    video.load();
    updateProgress();
    placeholder.classList.remove('hidden');
    status.textContent = '该集尚未配置视频。可以搜索和分享台词，但无法播放。';
  } else {
    if (video.getAttribute('src') !== source || video.error) {
      video.src = source;
      video.load();
    }
    placeholder.classList.add('hidden');
    status.textContent = '正在定位并缓冲视频…';
    const seek = () => {
      if (currentSelection !== selectionVersion) return;
      pendingSeekTarget = range.start;
      video.currentTime = pendingSeekTarget;
      clipReady = !video.seeking;
      setSubtitle(activeLine(lines, video.currentTime, line.episode));
      const requestedPauseVersion = pauseVersion;
      playForSelection(video,
        () => currentSelection === selectionVersion && requestedPauseVersion === pauseVersion,
        error => showPlayError(error, currentSelection));
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
  }
  setSubtitle(line);
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('line', line.id);
    history.replaceState(null, '', url);
  }
  updateNavigation();
  document.body.classList.toggle('featured-playing', selectedFromFeatured);
  document.body.classList.toggle('is-working', !selectedFromFeatured);
  if (!updateSelectedCard(line.id)) render();
  if (selectedFromFeatured) {
    requestAnimationFrame(() => playerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } else openPlayer();
}

function showPlayError(error, version) {
  if (version !== selectionVersion || error.name === 'AbortError') return;
  status.textContent = error.name === 'NotAllowedError'
    ? '浏览器阻止了自动播放，请点击播放器的播放按钮。'
    : `视频播放失败（${error.name}）。请检查视频地址、权限和编码。`;
}

function renderFeatured() {
  featuredList.replaceChildren();
  const picks = FEATURED_IDS.map(id => lines.find(line => line.id === id && !line.demo && line.zh && line.en)).filter(Boolean);
  if (!picks.length) {
    const empty = document.createElement('p');
    empty.className = 'featured-empty';
    empty.textContent = '暂无真实素材精选片段。导入剧集字幕后，这里会展示可播放的台词。';
    featuredList.append(empty);
    return;
  }
  for (const line of picks) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'featured-card';
    card.setAttribute('aria-label', `播放 ${episodes[line.episode]?.title || line.episode} ${formatTime(line.start)}：${line.zh} ${line.en}`);
    const media = document.createElement('span');
    media.className = 'featured-media';
    const imageUrl = `/assets/featured/${encodeURIComponent(line.id)}.jpg`;
    const thumbnail = document.createElement('img');
    thumbnail.className = 'featured-thumbnail';
    thumbnail.src = imageUrl;
    thumbnail.alt = `${episodes[line.episode]?.title || line.episode} ${formatTime(line.start)} 的视频画面`;
    thumbnail.loading = 'lazy';
    thumbnail.addEventListener('error', () => {
      const missing = document.createElement('span');
      missing.className = 'featured-thumbnail-missing';
      missing.textContent = '尚未生成此台词的真实视频缩略图';
      thumbnail.replaceWith(missing);
    }, { once: true });
    const playIcon = document.createElement('span');
    playIcon.className = 'featured-play-icon';
    playIcon.setAttribute('aria-hidden', 'true');
    playIcon.textContent = '▶';
    media.append(thumbnail, playIcon);
    const copy = document.createElement('span');
    copy.className = 'featured-copy';
    const meta = document.createElement('span');
    meta.className = 'featured-meta';
    const episodeLabel = document.createElement('span');
    episodeLabel.textContent = episodes[line.episode]?.title || line.episode;
    const timeLabel = document.createElement('span');
    timeLabel.textContent = formatTime(line.start);
    meta.append(episodeLabel, timeLabel);
    const zh = document.createElement('strong');
    zh.textContent = line.zh;
    const en = document.createElement('span');
    en.className = 'featured-en';
    en.textContent = line.en;
    copy.append(meta, zh, en);
    card.append(media, copy);
    card.addEventListener('click', () => selectLine(line, true, 'featured'));
    featuredList.append(card);
  }
}

function render() {
  if (query.value.trim()) selectedFromFeatured = false;
  document.body.classList.toggle('featured-playing', selectedFromFeatured && Boolean(selected));
  document.body.classList.toggle('is-working', Boolean(query.value.trim()) || (Boolean(selected) && !selectedFromFeatured));
  const matches = filterLines(lines, query.value, episodeFilter, speakerFilter);
  const visible = visibleLines(matches, visibleCount, selected?.id);
  $('#count').textContent = `显示 ${visible.length} / ${matches.length} 条`;
  loadMore.hidden = matches.length <= visibleCount;
  loadMore.textContent = `再显示 ${Math.min(PAGE_SIZE, Math.max(0, matches.length - visibleCount))} 条`;
  results.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = lines.length ? '没有找到匹配台词。试试更短的中英文关键词。' : '尚无可用台词。请先导入字幕数据。';
    results.append(empty);
    return;
  }
  for (const line of visible) {
    const type = matchType(line, query.value);
    const card = document.createElement('button');
    card.type = 'button';
    card.dataset.lineId = line.id;
    card.className = `card${selected?.id === line.id ? ' active' : ''}`;
    if (selected?.id === line.id) card.setAttribute('aria-current', 'true');
    const top = document.createElement('div');
    top.className = 'card-top';
    const ep = document.createElement('span');
    ep.textContent = episodes[line.episode]?.title || line.episode;
    const time = document.createElement('span');
    time.textContent = formatTime(line.start);
    const left = document.createElement('span');
    left.className = 'card-location';
    left.append(ep);
    if (line.speaker) {
      const speaker = document.createElement('span');
      speaker.className = 'speaker-badge';
      speaker.textContent = line.speaker;
      left.append(speaker);
    }
    if (type) {
      const badge = document.createElement('span');
      badge.className = `match-badge ${type}`;
      badge.textContent = type === 'phrase' ? '短语匹配' : '关键词匹配';
      left.append(badge);
    }
    if (selected?.id === line.id) {
      const badge = document.createElement('span');
      badge.className = 'current-badge';
      badge.textContent = '当前播放';
      left.append(badge);
    }
    top.append(left, time);
    card.append(top);
    for (const [className, value] of [['zh', line.zh], ['en', line.en]]) {
      const p = document.createElement('p');
      p.className = className;
      appendHighlightedText(p, value, query.value, type);
      card.append(p);
    }
    card.addEventListener('click', () => selectLine(line));
    const context = document.createElement('details');
    context.className = 'context';
    const summary = document.createElement('summary');
    summary.textContent = '查看前后文';
    const contextList = document.createElement('ol');
    contextList.className = 'context-list';
    for (const contextLine of contextLines(lines, line.id)) {
      const row = document.createElement('li');
      row.className = contextLine.id === line.id ? 'context-current' : '';
      const meta = document.createElement('span');
      meta.className = 'context-meta';
      meta.textContent = `${formatTime(contextLine.start)}${contextLine.speaker ? ` · ${contextLine.speaker}` : ''}`;
      const zh = document.createElement('span');
      zh.className = 'context-zh';
      zh.textContent = contextLine.zh || '—';
      const en = document.createElement('span');
      en.className = 'context-en';
      en.textContent = contextLine.en || '—';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'context-play';
      play.textContent = '播放此句';
      play.setAttribute('aria-label', `播放 ${formatTime(contextLine.start)} 的台词`);
      play.addEventListener('click', () => selectLine(contextLine));
      row.append(meta, zh, en, play);
      contextList.append(row);
    }
    context.append(summary, contextList);
    const item = document.createElement('div');
    item.className = 'result-item';
    item.append(card, context);
    results.append(item);
  }
}

function resetResults() { visibleCount = PAGE_SIZE; render(); }
form.addEventListener('submit', event => { event.preventDefault(); resetResults(); });
query.addEventListener('input', resetResults);
function closeEpisodeFilter(returnFocus = false) {
  episodeFilterPanel.hidden = true;
  episodeFilterButton.setAttribute('aria-expanded', 'false');
  if (returnFocus) episodeFilterButton.focus();
}
function closeSpeakerFilter(returnFocus = false) {
  speakerFilterPanel.hidden = true;
  speakerFilterButton.setAttribute('aria-expanded', 'false');
  if (returnFocus) speakerFilterButton.focus();
}
episodeFilterButton.addEventListener('click', () => {
  if (!episodeFilterPanel.hidden) { closeEpisodeFilter(); return; }
  closeSpeakerFilter();
  episodeFilterPanel.hidden = false;
  episodeFilterButton.setAttribute('aria-expanded', 'true');
  episodeFilterOptions.querySelector('input:checked')?.focus();
});
episodeFilterOptions.addEventListener('change', event => {
  if (event.target.name !== 'episode-filter' || event.target.value === episodeFilter) return;
  episodeFilter = event.target.value;
  episodeFilterValue.textContent = event.target.closest('label').textContent;
  closeEpisodeFilter(true);
  resetResults();
});
speakerFilterButton.addEventListener('click', () => {
  if (speakerFilterPanel.hidden) {
    closeEpisodeFilter();
    speakerFilterPanel.hidden = false;
    speakerFilterButton.setAttribute('aria-expanded', 'true');
    speakerFilterOptions.querySelector('input:checked')?.focus();
  } else closeSpeakerFilter();
});
speakerFilterOptions.addEventListener('change', event => {
  if (event.target.name !== 'speaker-filter' || event.target.value === speakerFilter) return;
  speakerFilter = event.target.value;
  speakerFilterValue.textContent = event.target.closest('label').querySelector('span').textContent;
  closeSpeakerFilter(true);
  resetResults();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.filter-control')) { closeEpisodeFilter(); closeSpeakerFilter(); }
});
loadMore.addEventListener('click', () => { visibleCount += PAGE_SIZE; render(); });
closePlayerButton.addEventListener('click', closePlayer);
playerBackdrop.addEventListener('click', closePlayer);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !speakerFilterPanel.hidden) { closeSpeakerFilter(true); return; }
  if (event.key === 'Escape' && !episodeFilterPanel.hidden) { closeEpisodeFilter(true); return; }
  if (event.key === 'Escape' && document.body.classList.contains('player-open')) closePlayer();
});
mobileLayout.addEventListener('change', event => {
  if (!event.matches) {
    document.body.classList.remove('player-open');
    playerBackdrop.hidden = true;
    playerPanel.removeAttribute('role');
    playerPanel.removeAttribute('aria-modal');
  }
});
for (const [button, offset] of [[previousLineButton, -1], [nextLineButton, 1]]) {
  button.addEventListener('click', () => {
    if (!selected) return;
    const episodeLines = lines.filter(line => line.episode === selected.episode);
    const index = episodeLines.findIndex(line => line.id === selected.id);
    const next = episodeLines[index + offset];
    if (next) selectLine(next);
  });
}
video.addEventListener('seeking', () => {
  clipReady = false;
  if (pendingSeekTarget === null || Math.abs(video.currentTime - pendingSeekTarget) > 0.15) {
    stopAt = null;
    pendingSeekTarget = null;
  }
  if (selected) setSubtitle(activeLine(lines, video.currentTime, selected.episode));
  updateProgress();
});
video.addEventListener('seeked', () => {
  clipReady = pendingSeekTarget !== null && Math.abs(video.currentTime - pendingSeekTarget) <= 0.15;
  pendingSeekTarget = null;
});
video.addEventListener('pause', () => { pauseVersion += 1; });
video.addEventListener('loadedmetadata', updateProgress);
video.addEventListener('playing', () => {
  status.textContent = '';
});
video.addEventListener('waiting', () => {
  if (selected && !video.paused && !video.error) status.textContent = '正在缓冲视频，请稍候…';
});
episodeProgress.addEventListener('input', () => {
  stopAt = null;
  clipReady = false;
  pendingSeekTarget = null;
  video.currentTime = Number(episodeProgress.value);
  updateProgress();
});
video.addEventListener('timeupdate', () => {
  if (!selected) return;
  setSubtitle(activeLine(lines, video.currentTime, selected.episode));
  updateProgress();
  if (clipReady && stopAt !== null && video.currentTime >= stopAt - 0.05) {
    const end = stopAt;
    stopAt = null;
    clipReady = false;
    video.pause();
    video.currentTime = end;
  }
});
video.addEventListener('error', () => {
  if (!selected || !video.error || video.error.code === 1) return;
  const reason = {
    2: '网络读取失败',
    3: '视频解码失败',
    4: '视频来源或格式不受支持',
  }[video.error?.code] || '未知错误';
  status.textContent = `视频无法播放：${reason}。请检查视频地址、访问权限和 MP4 编码；也可重新点击台词重试。`;
});
share.addEventListener('click', async () => {
  if (!selected) return;
  const url = new URL(location.href);
  url.searchParams.set('line', selected.id);
  try {
    await navigator.clipboard.writeText(url.href);
    share.textContent = '链接已复制 ✓';
  } catch {
    window.prompt('复制片段链接', url.href);
  }
  setTimeout(() => { share.textContent = '复制片段链接 ↗'; }, 2500);
});

try {
  const [lineResponse, episodeResponse] = await Promise.all([fetch('/data/dialogues.json'), fetch('/data/episodes.json')]);
  if (!lineResponse.ok || !episodeResponse.ok) throw new Error('数据文件读取失败');
  lines = await lineResponse.json();
  episodes = await episodeResponse.json();
  const availableEpisodes = [...new Set(lines.map(line => line.episode))].sort();
  $('#catalog-note').textContent = lines.length && lines.every(line => line.demo)
    ? '当前显示原创演示数据；请导入你有权使用的字幕和视频。'
    : `当前收录 ${availableEpisodes.length} 集、${lines.length} 条台词，支持中英文搜索。`;
  for (const episode of availableEpisodes) {
    const label = document.createElement('label');
    label.className = 'filter-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'episode-filter';
    input.value = episode;
    const name = document.createElement('span');
    name.textContent = episodes[episode]?.title || episode;
    label.append(input, name);
    episodeFilterOptions.append(label);
  }
  const speakers = [...new Set(lines.map(line => String(line.speaker || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (speakers.length) {
    speakerFilterOptions.replaceChildren();
    const hasUnlabeled = lines.some(line => !String(line.speaker || '').trim());
    const speakerOptions = [['all', '全部角色'], ...speakers.map(name => [name, name])];
    if (hasUnlabeled) speakerOptions.push(['__unlabeled__', '未标注角色']);
    for (const [value, labelText] of speakerOptions) {
      const label = document.createElement('label');
      label.className = 'filter-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'speaker-filter';
      input.value = value;
      input.checked = value === 'all';
      const text = document.createElement('span');
      text.textContent = labelText;
      label.append(input, text);
      speakerFilterOptions.append(label);
    }
    speakerFilterButton.disabled = false;
    speakerFilterValue.textContent = '全部角色';
    speakerFilterNote.hidden = true;
  }
  renderFeatured();
  render();
  const id = new URL(location.href).searchParams.get('line');
  const linked = lines.find(line => line.id === id);
  if (linked) selectLine(linked, false);
  else if (id) status.textContent = '分享的台词 ID 不存在，可能已被移除。';
} catch (error) {
  results.textContent = '台词数据加载失败。请检查 /data 下的 JSON 文件。';
  status.textContent = error.message;
}
