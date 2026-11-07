/** Smoke test: the client bundle registers the right module and exports a slot plugin. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

test('client bundle registers itself with __ModuleLoader__', () => {
	const loads = [];
	globalThis.window = { __ModuleLoader__: { load: (handoff) => loads.push(handoff) } };
	// eslint-disable-next-line no-eval
	(0, eval)(code);
	assert.equal(loads.length, 1);
	assert.equal(loads[0].id, 'dsh-music-v2');
	assert.equal(typeof loads[0].factory, 'function');
});

test('factory exports apply/inject/name and requires react', () => {
	const loads = [];
	globalThis.window = { __ModuleLoader__: { load: (handoff) => loads.push(handoff) } };
	(0, eval)(code);
	const required = [];
	const reactStub = {
		memo: (component) => component,
		useCallback: (callback) => callback,
		useEffect: () => undefined,
		useMemo: (factory) => factory(),
		useRef: () => ({ current: null }),
		useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
		createElement: () => null
	};
	const exports = loads[0].factory((specifier) => {
		required.push(specifier);
		if (specifier === 'react') return reactStub;
		if (specifier === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' };
		throw new Error(`unexpected require: ${specifier}`);
	});
	assert.equal(typeof exports.apply, 'function');
	assert.deepEqual(exports.inject, ['slots']);
	assert.equal(exports.name, 'dsh-music-v2');
	assert.ok(required.includes('react'));
});
