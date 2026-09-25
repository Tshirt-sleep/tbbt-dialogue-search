import { filterLines, visibleLines, clipRange, activeLine, formatTime } from './core.js';

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
let stopAt = null;
let pendingSeekTarget = null;
let selectionVersion = 0;
const PAGE_SIZE = 40;
const FEATURED_IDS = ['S01E02-0050', 'S01E15-0050', 'S01E16-0058', 'S01E17-0034'];
let visibleCount = PAGE_SIZE;

function closePlayer() {
  document.body.classList.remove('player-open');
  playerBackdrop.hidden = true;
  playerPanel.removeAttribute('role');
  playerPanel.removeAttribute('aria-modal');
  video.pause();
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

function appendHighlightedText(element, value, queryText) {
  const terms = queryText.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length || !value) { element.textContent = value || '—'; return; }
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
  subtitle.replaceChildren();
  if (!line) {
    const p = document.createElement('p');
    p.textContent = selected ? '片段缓冲中，或当前时间没有台词' : '字幕会随播放进度显示在这里';
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

function updateProgress() {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  episodeProgress.disabled = !duration;
  episodeProgress.max = String(duration || 100);
  episodeProgress.value = String(Math.min(video.currentTime || 0, duration || 100));
  progressTime.textContent = `${formatTime(video.currentTime || 0)} / ${duration ? formatTime(duration) : '--:--'}`;
}

function selectLine(line, updateUrl = true) {
  selected = line;
  const currentSelection = ++selectionVersion;
  stopAt = clipRange(line).end;
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
    if (video.getAttribute('src') !== source) {
      video.src = source;
      video.load();
    }
    placeholder.classList.add('hidden');
    const seek = () => {
      if (currentSelection !== selectionVersion) return;
      pendingSeekTarget = clipRange(line).start;
      video.currentTime = pendingSeekTarget;
      setSubtitle(activeLine(lines, video.currentTime, line.episode));
      video.play().catch(() => { status.textContent = '浏览器阻止了自动播放，请点击播放器的播放按钮。'; });
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
  render();
  openPlayer();
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
    const meta = document.createElement('span');
    meta.className = 'featured-meta';
    meta.textContent = `${episodes[line.episode]?.title || line.episode} · ${formatTime(line.start)}`;
    const zh = document.createElement('strong');
    zh.textContent = line.zh;
    const en = document.createElement('span');
    en.className = 'featured-en';
    en.textContent = line.en;
    card.append(meta, zh, en);
    card.addEventListener('click', () => selectLine(line));
    featuredList.append(card);
  }
}

function render() {
  document.body.classList.toggle('is-working', Boolean(query.value.trim()) || Boolean(selected));
  const matches = filterLines(lines, query.value, episodeFilter);
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
    const card = document.createElement('button');
    card.type = 'button';
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
      appendHighlightedText(p, value, query.value);
      card.append(p);
    }
    card.addEventListener('click', () => selectLine(line));
    results.append(card);
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
episodeFilterButton.addEventListener('click', () => {
  if (!episodeFilterPanel.hidden) { closeEpisodeFilter(); return; }
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
document.addEventListener('click', event => {
  if (!event.target.closest('.filter-control')) closeEpisodeFilter();
});
loadMore.addEventListener('click', () => { visibleCount += PAGE_SIZE; render(); });
closePlayerButton.addEventListener('click', closePlayer);
playerBackdrop.addEventListener('click', closePlayer);
document.addEventListener('keydown', event => {
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
  if (pendingSeekTarget === null || Math.abs(video.currentTime - pendingSeekTarget) > 0.15) stopAt = null;
  pendingSeekTarget = null;
  if (selected) setSubtitle(activeLine(lines, video.currentTime, selected.episode));
  updateProgress();
});
video.addEventListener('loadedmetadata', updateProgress);
video.addEventListener('playing', () => {
  if (status.textContent === '浏览器阻止了自动播放，请点击播放器的播放按钮。') status.textContent = '';
});
episodeProgress.addEventListener('input', () => {
  stopAt = null;
  pendingSeekTarget = null;
  video.currentTime = Number(episodeProgress.value);
  updateProgress();
});
video.addEventListener('timeupdate', () => {
  if (!selected) return;
  setSubtitle(activeLine(lines, video.currentTime, selected.episode));
  updateProgress();
  if (stopAt !== null && video.currentTime >= stopAt - 0.05) {
    const end = stopAt;
    stopAt = null;
    video.pause();
    video.currentTime = end;
  }
});
video.addEventListener('error', () => {
  if (selected) status.textContent = '视频缺失或浏览器无法播放。请检查 media/ 下的 MP4 文件。';
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
  renderFeatured();
  render();
  const id = new URL(location.href).searchParams.get('line');
  const linked = lines.find(line => line.id === id);
  if (linked) selectLine(linked, false);
  else if (id) status.textContent = '分享的台词 ID 不存在，可能已被移除。';
} catch (error) {
  results.textContent = '台词数据加载失败。请确认通过 npm start 启动，并检查数据文件。';
  status.textContent = error.message;
}
