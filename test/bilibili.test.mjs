/** Bilibili provider: URL parsing, WBI signing and audio-track selection. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchFolderName, parseFolderRef, pickAudioTrack, wbiSign } from '../lib/host/bilibili.js';

test('matchFolderName resolves a readable folder name', () => {
	const folders = [
		{ id: 1, title: '默认收藏夹', owner: 'me', count: 5 },
		{ id: 2, title: 'music', owner: 'me', count: 12 },
		{ id: 3, title: 'Music 现场', owner: 'me', count: 3 }
	];
	assert.equal(matchFolderName(folders, 'music')?.id, 2, 'exact match wins');
	assert.equal(matchFolderName(folders, 'MUSIC')?.id, 2, 'case-insensitive');
	assert.equal(matchFolderName(folders, '现场')?.id, 3, 'substring match');
	assert.equal(matchFolderName(folders, 'nope'), undefined);
	assert.equal(matchFolderName(folders, '   '), undefined);
});

test('parseFolderRef accepts ids, favlist URLs, media_id and b23 short links', () => {
	assert.deepEqual(parseFolderRef('123456789'), { fid: '123456789' });
	assert.deepEqual(parseFolderRef('https://space.bilibili.com/987654321/favlist?fid=123456789&ftype=create'), {
		mid: '987654321',
		fid: '123456789'
	});
	assert.deepEqual(parseFolderRef('https://api.bilibili.com/x/v3/fav/resource/list?media_id=42'), { fid: '42' });
	assert.equal(parseFolderRef('https://b23.tv/abc123').short, 'https://b23.tv/abc123');
	assert.deepEqual(parseFolderRef('not a folder'), {});
});

test('wbiSign matches the fixed vector (params sorted, w_rid hex)', () => {
	const signed = wbiSign(
		{ bvid: 'BV1xx411c7mD', cid: 12345, fnval: 16, fnver: 0, fourk: 1, platform: 'pc' },
		'0123456789abcdef0123456789abcdef',
		'fedcba9876543210fedcba9876543210',
		1700000000000
	);
	assert.equal(
		signed,
		'bvid=BV1xx411c7mD&cid=12345&fnval=16&fnver=0&fourk=1&platform=pc&wts=1700000000&w_rid=61f8a898ad9e82d47be6613f1fb0ac9f'
	);
});

test('pickAudioTrack prefers the 192k track (30280)', () => {
	const audio = [
		{ id: 30216, baseUrl: 'https://cdn/low.m4s', bandwidth: 65000, mimeType: 'audio/mp4' },
		{ id: 30280, baseUrl: 'https://cdn/192.m4s', backupUrl: ['https://mirror/192.m4s'], bandwidth: 120000, mimeType: 'audio/mp4' },
		{ id: 30232, baseUrl: 'https://cdn/mid.m4s', bandwidth: 66000, mimeType: 'audio/mp4' }
	];
	const picked = pickAudioTrack(audio);
	assert.equal(picked.quality, 30280);
	assert.equal(picked.url, 'https://cdn/192.m4s');
	assert.deepEqual(picked.backup, ['https://mirror/192.m4s']);
});

test('pickAudioTrack falls back to the highest bandwidth AAC track', () => {
	const audio = [
		{ id: 30216, baseUrl: 'https://cdn/low.m4s', bandwidth: 65000 },
		{ id: 30232, baseUrl: 'https://cdn/mid.m4s', bandwidth: 90000 }
	];
	assert.equal(pickAudioTrack(audio).quality, 30232);
});

test('pickAudioTrack rejects a video with no audio track', () => {
	assert.throws(() => pickAudioTrack([]), /没有可用音轨/);
	assert.throws(() => pickAudioTrack(undefined), /没有可用音轨/);
});
