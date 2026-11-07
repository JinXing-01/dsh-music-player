/** Reducer unit tests: run `npm test` after `npm run build` (tests import lib/). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createState, reduce } from '../lib/host/reducer.js';

const track = (id, title = id) => ({ id, title, artist: 'artist', source: 'direct', url: `https://example.com/${id}.mp3` });

const queueOf = (ids) => createState({ queue: ids.map((id) => track(id, id)), index: 0 });

test('single repeat asks the client to replay the same track', () => {
	const state = { ...queueOf(['a']), mode: 'single', playing: true };
	const { result } = reduce(state, { action: 'ended', trackId: 'a' });
	assert.equal(result.replay, true);
	assert.equal(result.state.index, 0);
	assert.equal(result.state.playing, true);
});

test('list mode advances and wraps', () => {
	const base = { ...queueOf(['a', 'b']), playing: true };
	const first = reduce(base, { action: 'ended', trackId: 'a' });
	assert.equal(first.result.state.index, 1);
	const second = reduce(first.state, { action: 'ended', trackId: 'b' });
	assert.equal(second.result.state.index, 0);
});

test('a stale ended event never skips the current track', () => {
	const base = { ...queueOf(['a', 'b']), index: 1, playing: true };
	const { result } = reduce(base, { action: 'ended', trackId: 'a' });
	assert.equal(result.state.index, 1);
});

test('next in shuffle never repeats the current index', () => {
	const state = { ...queueOf(['a', 'b', 'c']), mode: 'shuffle' };
	for (let i = 0; i < 20; i += 1) {
		const { state: next } = reduce(state, { action: 'next' });
		assert.notEqual(next.index, state.index);
	}
});

test('removing the current track keeps the queue playable', () => {
	const state = { ...queueOf(['a', 'b', 'c']), index: 1, playing: true };
	const { state: next } = reduce(state, { action: 'remove', index: 1 });
	assert.deepEqual(next.queue.map((item) => item.id), ['a', 'c']);
	assert.equal(next.index, 1);
	assert.equal(next.playing, true);
});

test('reorder keeps the current track selected', () => {
	const state = { ...queueOf(['a', 'b', 'c']), index: 2 };
	const { state: next } = reduce(state, { action: 'reorder', from: 2, to: 0 });
	assert.deepEqual(next.queue.map((item) => item.id), ['c', 'a', 'b']);
	assert.equal(next.index, 0);
});

test('volume is clamped to 0..1', () => {
	const state = queueOf([]);
	assert.equal(reduce(state, { action: 'volume', volume: 3 }).state.volume, 1);
	assert.equal(reduce(state, { action: 'volume', volume: -1 }).state.volume, 0);
});

test('replaceQueue resets position and starts when asked', () => {
	const state = queueOf(['a']);
	const { state: next } = reduce(state, { action: 'replaceQueue', tracks: [track('x'), track('y')], play: true });
	assert.equal(next.queue.length, 2);
	assert.equal(next.index, 0);
	assert.equal(next.positionMs, 0);
	assert.equal(next.playing, true);
});
