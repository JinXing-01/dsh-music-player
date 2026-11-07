/** Package contract: what the DSH loader and the web boot graph rely on. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('host entry and client bundle exist', () => {
	assert.equal(pkg.type, 'module');
	assert.equal(pkg.main, 'lib/host/index.js');
	assert.ok(existsSync(new URL(pkg.main, root)), 'host entry must be built');
	assert.ok(existsSync(new URL(pkg.exports['./client'], root)), 'client bundle must be built');
});

test('dsh manifests are declared', () => {
	assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
	assert.ok(existsSync(new URL(pkg.dsh.bundle.patch, root)));
	assert.equal(pkg.dsh.client.platform, 'web');
	assert.ok(Array.isArray(pkg.dsh.client.inject));
	assert.ok(pkg.files.includes('lib'));
});

test('host module exports a cordis plugin', async () => {
	const host = await import(new URL('lib/host/index.js', root).href);
	assert.equal(typeof host.apply, 'function');
	assert.deepEqual(host.inject, ['webServer', 'tools']);
	assert.equal(host.name, 'dsh-music-v2');
});
