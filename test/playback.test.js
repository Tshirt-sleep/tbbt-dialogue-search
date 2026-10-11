import test from 'node:test';
import assert from 'node:assert/strict';
import { playForSelection } from '../src/core.js';

const failure = name => Object.assign(new Error(name), { name });
class Media extends EventTarget {
  constructor(attempts, seeking = false) {
    super();
    this.attempts = attempts;
    this.seeking = seeking;
    this.paused = true;
    this.calls = 0;
  }
  play() { this.calls += 1; return this.attempts.shift()(); }
}

test('过期播放请求失败不污染新台词的状态', async () => {
  let reject;
  let current = true;
  const errors = [];
  const video = new Media([() => new Promise((_, fail) => { reject = fail; })]);
  const pending = playForSelection(video, () => current, error => errors.push(error));
  current = false;
  reject(failure('NotSupportedError'));
  await pending;
  assert.deepEqual(errors, []);
  assert.equal(video.calls, 1);
});

test('跳转中断播放后等待 seeked，仅重试当前请求一次', async () => {
  const errors = [];
  const video = new Media([() => Promise.reject(failure('AbortError')), () => Promise.resolve()], true);
  await playForSelection(video, () => true, error => errors.push(error));
  assert.equal(video.calls, 1);
  video.dispatchEvent(new Event('seeked'));
  video.dispatchEvent(new Event('seeked'));
  assert.equal(video.calls, 2);
  assert.deepEqual(errors, []);
});

test('等待跳转时再次选台词或主动暂停，不恢复旧播放', async () => {
  let current = true;
  const video = new Media([() => Promise.reject(failure('AbortError'))], true);
  await playForSelection(video, () => current, () => assert.fail('不应报错'));
  current = false;
  video.dispatchEvent(new Event('seeked'));
  assert.equal(video.calls, 1);
});

test('跳转已完成时重试，连续中断不无限重试或误报素材故障', async () => {
  const video = new Media([() => Promise.reject(failure('AbortError')), () => Promise.reject(failure('AbortError'))]);
  await playForSelection(video, () => true, () => assert.fail('中断不是素材故障'));
  await Promise.resolve();
  assert.equal(video.calls, 2);
});

test('真正的播放失败和自动播放限制仍传给界面', async () => {
  for (const name of ['NotAllowedError', 'NotSupportedError']) {
    const errors = [];
    const video = new Media([() => Promise.reject(failure(name))]);
    await playForSelection(video, () => true, error => errors.push(error.name));
    assert.deepEqual(errors, [name]);
  }
});
