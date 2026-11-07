/**
 * Development harness: mounts the host half on a bare http server so routes can
 * be exercised without a full DSH web profile.
 *
 *   node scripts/dev-host.mjs [port] [--settings]
 *
 * `--settings` installs a minimal in-memory stand-in for the DSH settings
 * service, so the `dsh-music` namespace registration path can be exercised.
 */
import http from 'node:http';
import { apply } from '../lib/host/index.js';

const args = process.argv.slice(2);
const portArg = args.find((value) => /^\d+$/.test(value));
const withSettings = args.includes('--settings');

const routes = new Map();
const tools = [];
const scopes = new Map();

const fakeSettings = {
	register(ns, schema, options = {}) {
		let value = schema({ ...(options.base ?? {}) });
		const watchers = new Set();
		const scope = {
			get: () => value,
			watch(callback) {
				watchers.add(callback);
				return () => watchers.delete(callback);
			},
			async update(patch) {
				const next = schema({ ...value, ...patch });
				const prev = value;
				value = next;
				for (const callback of watchers) callback(next, prev);
			},
			async replace(section) {
				value = schema(section);
			}
		};
		scopes.set(ns, scope);
		return scope;
	},
	get: (ns) => scopes.get(ns)?.get()
};

const ctx = {
	webServer: {
		register(route) {
			routes.set(route.path, route);
			return () => routes.delete(route.path);
		}
	},
	tools: {
		register(definition) {
			tools.push(definition);
			return () => undefined;
		}
	},
	effect(callback) {
		const dispose = callback();
		return () => (typeof dispose === 'function' ? dispose() : undefined);
	},
	logger: {
		info: (message) => console.log(`[host] ${message}`),
		warn: (message) => console.warn(`[host] ${message}`)
	}
};

if (withSettings) {
	ctx.inject = (deps, callback) => {
		if (deps.includes('settings')) callback({ ...ctx, settings: fakeSettings });
		else callback(ctx);
	};
}

apply(ctx);

const server = http.createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://localhost');
	const route = routes.get(url.pathname);
	if (route === undefined) {
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('not found');
		return;
	}
	Promise.resolve(route.handler(req, res)).catch((error) => {
		console.error(error);
		if (!res.headersSent) res.writeHead(500);
		res.end();
	});
});

const port = Number(portArg ?? 47831);
server.listen(port, '127.0.0.1', () => {
	console.log(`dev host listening on http://127.0.0.1:${port} (settings=${withSettings})`);
	console.log(`routes: ${[...routes.keys()].join(', ')}`);
	console.log(`tool: ${tools.map((tool) => tool.name).join(', ')}`);
});
