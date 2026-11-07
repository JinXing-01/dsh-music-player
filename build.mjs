/**
 * Build script for dsh-music-v2.
 *
 * - host half: plain ESM emitted by tsc (imports of node builtins and the DSH
 *   services stay as specifiers, resolved by the profile).
 * - client half: esbuild bundles src/client into one CJS file, wrapped in the
 *   browser module-registration handoff:
 *     window.__ModuleLoader__.load({ id, factory: (require) => … })
 *   react / react-dom / react/jsx-runtime are external (the shell provides them).
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

// 1) host
await rm(path.join(root, 'lib', 'host'), { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.host.json'], {
	stdio: 'inherit',
	cwd: root
});

// 2) client
const result = await build({
	entryPoints: [path.join(root, 'src', 'client', 'index.tsx')],
	bundle: true,
	write: false,
	format: 'cjs',
	platform: 'browser',
	target: ['chrome110', 'safari16'],
	jsx: 'automatic',
	external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
	define: { 'process.env.NODE_ENV': '"production"' },
	logLevel: 'warning'
});
const body = result.outputFiles[0].text;
const wrapped =
	'window.__ModuleLoader__.load({\n' +
	`\tid: ${JSON.stringify(pkg.name)},\n` +
	'\tfactory: (require) => {\n' +
	'\t\tvar module = { exports: {} };\n' +
	'\t\tvar exports = module.exports;\n' +
	body +
	'\n\t\treturn module.exports;\n' +
	'\t}\n' +
	'});\n';

await mkdir(path.join(root, 'lib'), { recursive: true });
await writeFile(path.join(root, 'lib', 'client.js'), wrapped);
console.log(`built lib/client.js (${(wrapped.length / 1024).toFixed(1)} kB) and lib/host/*.js`);
