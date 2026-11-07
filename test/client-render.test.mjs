/** Render smoke test: the overlay component mounts without browser-only crashes. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const require = createRequire(import.meta.url);
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/** Minimal browser globals the initial render touches. */
function installDom() {
	const created = [];
	globalThis.window = {
		__ModuleLoader__: { load: () => undefined },
		innerWidth: 1280,
		innerHeight: 800
	};
	globalThis.document = {
		querySelector: () => null,
		createElement: () => {
			const tag = { dataset: {}, style: {}, textContent: '', appendChild: () => undefined };
			created.push(tag);
			return tag;
		},
		head: { appendChild: () => undefined }
	};
	globalThis.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
	globalThis.location = { href: 'http://localhost:53727/' };
	return created;
}

/** Evaluate the bundle, wire real React through the module table, return its exports. */
function loadBundle() {
	const created = installDom();
	const loads = [];
	window.__ModuleLoader__.load = (handoff) => loads.push(handoff);
	(0, eval)(code);
	const exports = loads[0].factory((specifier) => {
		if (specifier === 'react') return require('react');
		if (specifier === 'react/jsx-runtime') return require('react/jsx-runtime');
		throw new Error(`unexpected require ${specifier}`);
	});
	return { exports, created };
}

test('apply registers the overlay into shell.overlay and injects styles once', () => {
	const { exports, created } = loadBundle();
	let component;
	exports.apply({
		slots: {
			inject: (name, callback) => {
				assert.equal(name, 'shell.overlay');
				callback();
				return () => undefined;
			},
			register: (options, registered) => {
				assert.equal(options.name, 'shell.overlay');
				assert.equal(options.id, 'dsh-music-v2');
				assert.equal(typeof options.order, 'number');
				component = registered;
				return () => undefined;
			}
		}
	});
	assert.equal(typeof component, 'function');
	assert.equal(created.length, 1, 'one stylesheet tag');
	assert.ok(created[0].textContent.includes('.dm2-card'));
});

test('the real component renders with real React without throwing', () => {
	const { exports } = loadBundle();
	let component;
	exports.apply({
		slots: {
			inject: (_name, callback) => {
				callback();
				return () => undefined;
			},
			register: (_options, registered) => {
				component = registered;
				return () => undefined;
			}
		}
	});
	const html = renderToString(createElement(component));
	assert.ok(html.includes('dm2-card'), 'card markup rendered');
	assert.ok(html.includes('dm2-title'), 'title row rendered');
});
