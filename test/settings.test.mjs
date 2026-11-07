/** Settings namespace schema: defaults, secret handling, and coercion. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG, settingsSchema, toConfig } from '../lib/host/config.js';

test('settings schema fills defaults', () => {
	const value = settingsSchema({});
	assert.equal(value.br, 320000);
	assert.equal(value.volume, 0.8);
	assert.equal(value.neteaseCookie, '');
	assert.equal(value.defaultPlaylist, '');
});

test('settings schema carries secret metadata for the cookie', () => {
	const json = settingsSchema.toJSON();
	const text = JSON.stringify(json);
	assert.ok(text.includes('secret'), 'cookie field must be marked role=secret');
	assert.ok(text.includes('neteaseCookie'));
});

test('settings schema validates and coerces a section', () => {
	const value = settingsSchema({ volume: 0.3, neteaseCookie: 'MUSIC_U=x', br: 192000 });
	assert.equal(value.volume, 0.3);
	assert.equal(toConfig(value).neteaseCookie, 'MUSIC_U=x');
	assert.equal(toConfig(value).br, 192000);
});

test('invalid sections are rejected', () => {
	assert.throws(() => settingsSchema({ volume: 'loud' }));
	assert.throws(() => settingsSchema({ br: 'high' }));
});

test('composition defaults stay usable as the settings base layer', () => {
	const value = settingsSchema({ ...DEFAULT_CONFIG });
	assert.equal(typeof value.br, 'number');
	assert.ok(value.volume >= 0 && value.volume <= 1);
});
