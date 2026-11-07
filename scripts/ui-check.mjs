/**
 * Headless UI check: drives the real DSH web page through the Chrome DevTools
 * Protocol and verifies the music player actually mounts and reacts.
 *
 * Usage:
 *   node scripts/ui-check.mjs http://127.0.0.1:47999 [edgePath]
 *
 * It launches a throwaway headless Edge/Chrome profile, dismisses the welcome
 * modal, expands the player, imports a playlist through the host API, and
 * asserts the queue rendered. Screenshots land next to this script.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:47999';
const browser =
	process.argv[3] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9337;
const profile = path.join(process.cwd(), '.ui-check-profile');
const outDir = path.join(process.cwd(), 'screenshots');
/** Optional: a favlist URL/id/name to exercise the Bilibili tab (skip otherwise). */
const biliFolder = process.env.BILI_FOLDER ?? '';
mkdirSync(outDir, { recursive: true });

const child = spawn(
	browser,
	[
		'--headless',
		'--disable-gpu',
		'--no-first-run',
		'--disable-extensions',
		'--autoplay-policy=no-user-gesture-required',
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${profile}`,
		'--window-size=1280,900',
		url
	],
	{ stdio: 'ignore' }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools() {
	for (let i = 0; i < 60; i += 1) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
			const targets = await res.json();
			const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
			if (page !== undefined) return page.webSocketDebuggerUrl;
		} catch {
			/* devtools not up yet */
		}
		await sleep(500);
	}
	throw new Error('devtools endpoint never appeared');
}

const wsUrl = await waitForDevtools();
const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
	socket.onopen = resolve;
	socket.onerror = reject;
});

let nextId = 0;
const pending = new Map();
socket.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (message.id !== undefined && pending.has(message.id)) {
		const settle = pending.get(message.id);
		pending.delete(message.id);
		settle(message);
	}
};

function send(method, params = {}) {
	return new Promise((resolve, reject) => {
		const id = (nextId += 1);
		pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
		socket.send(JSON.stringify({ id, method, params }));
	});
}

async function evaluate(expression) {
	const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails !== undefined) throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
	return result.result?.value;
}

async function dismissModals() {
	for (let round = 0; round < 3; round += 1) {
		const target = await evaluate(`(() => {
			const labels = ['继续', '稍后配置'];
			const button = [...document.querySelectorAll('button')].find((el) => labels.includes(el.textContent?.trim() ?? ''));
			if (!button) return null;
			const rect = button.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		})()`);
		if (target === null) return;
		for (const type of ['mousePressed', 'mouseReleased']) {
			await send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left', clickCount: 1 });
		}
		await sleep(600);
	}
}

async function screenshot(name) {
	await dismissModals();
	const result = await send('Page.captureScreenshot', { format: 'png' });
	const file = path.join(outDir, name);
	writeFileSync(file, Buffer.from(result.data, 'base64'));
	return file;
}

const checks = [];
const check = (label, ok, detail = '') => {
	checks.push({ label, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`);
};

try {
	await send('Page.enable');
	await send('Runtime.enable');

	let mounted = false;
	for (let i = 0; i < 40; i += 1) {
		mounted = (await evaluate("Boolean(document.querySelector('.dm2-card'))")) === true;
		if (mounted) break;
		await sleep(500);
	}
	check('player mounts into shell.overlay', mounted);
	if (!mounted) {
		await screenshot('no-player.png');
		throw new Error('player never mounted');
	}

	// The welcome/onboarding modals can cover the overlay; dismiss them with
	// trusted clicks (JS .click() does not satisfy some modal handlers).
	await dismissModals();
	const modalGone = (await evaluate("document.body.innerText.includes('内测声明') || document.body.innerText.includes('添加一个 API Key')")) === false;
	check('welcome/onboarding modals dismissed', modalGone);

	// Expand the card (collapsed initially).
	await evaluate(`(() => {
		const button = [...document.querySelectorAll('.dm2-card button')].find((el) => el.title === '展开');
		button?.click();
		return Boolean(button);
	})()`);
	await sleep(800);

	const layout = await evaluate(`(() => {
		const card = document.querySelector('.dm2-card');
		const rect = card?.getBoundingClientRect();
		return rect ? { width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(window.innerWidth - rect.right), bottom: Math.round(window.innerHeight - rect.bottom), text: card.textContent.slice(0, 80) } : null;
	})()`);
	check('card is laid out in the floating layer', layout !== null && layout.width > 200, JSON.stringify(layout));

	// Import a small playlist through the host API; SSE must push it to the UI.
	const imported = await fetch(`${url}/dsh-music-v2/import`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: '13060319975', play: false })
	});
	const importedJson = await imported.json();
	check('host import succeeded', imported.ok, `${importedJson.playlist?.name} (${importedJson.playlist?.count})`);

	let rows = 0;
	for (let i = 0; i < 20; i += 1) {
		rows = await evaluate("document.querySelectorAll('.dm2-item').length");
		if (rows > 0) break;
		await sleep(300);
	}
	check('queue renders from SSE state', rows > 0, `${rows} rows`);

	const title = await evaluate("document.querySelector('.dm2-title')?.textContent ?? ''");
	check('track title is shown', typeof title === 'string' && title.length > 0 && title !== '未在播放', String(title));

	await screenshot('player.png');

	// Click play in the card (trusted click satisfies the autoplay policy) and
	// confirm both the host state and the browser's progress advanced.
	const playRect = await evaluate(`(() => {
		const button = document.querySelector('.dm2-play');
		if (!button) return null;
		const rect = button.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	})()`);
	if (playRect !== null) {
		for (const type of ['mousePressed', 'mouseReleased']) {
			await send('Input.dispatchMouseEvent', { type, x: playRect.x, y: playRect.y, button: 'left', clickCount: 1 });
		}
	}
	await sleep(2500);
	const state = await (await fetch(`${url}/dsh-music-v2/state`)).json();
	check('clicking play reaches the host state machine', state.playing === true, `playing=${state.playing} index=${state.index}`);

	const progress = await evaluate("document.querySelector('.dm2-time')?.textContent ?? '0:00'");
	check('browser audio actually advances', progress !== '0:00', `progress=${progress}`);

	// ── Bilibili tab: reuse the local login, load a favorites folder, play it ──
	if (biliFolder === '') {
		console.log('SKIP Bilibili checks: set BILI_FOLDER to a favlist URL/id/name');
	} else {
	await evaluate(`(() => {
		const tab = [...document.querySelectorAll('.dm2-card button')].find((el) => el.textContent?.trim() === 'B 站');
		tab?.click();
		return Boolean(tab);
	})()`);
	await sleep(2500);
	const biliStatusText = await evaluate("document.querySelector('.dm2-card')?.textContent ?? ''");
	check('Bilibili login is reused', biliStatusText.includes('B站：'), biliStatusText.slice(0, 40));

	// Fill the folder input the React way, then trigger the folder load.
	const filled = await evaluate(`(() => {
		const input = [...document.querySelectorAll('.dm2-input')].find((el) => el.placeholder?.includes('收藏夹'));
		if (!input) return false;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
		setter.call(input, ${JSON.stringify(biliFolder)});
		input.dispatchEvent(new Event('input', { bubbles: true }));
		return true;
	})()`);
	check('folder input accepts a URL', filled === true);
	await sleep(300);
	await evaluate(`(() => {
		const button = [...document.querySelectorAll('.dm2-card button')].find((el) => el.title === '载入收藏夹');
		button?.click();
		return Boolean(button);
	})()`);
	let biliRows = 0;
	for (let i = 0; i < 20; i += 1) {
		biliRows = await evaluate("document.querySelectorAll('.dm2-bili-row').length");
		if (biliRows > 0) break;
		await sleep(400);
	}
	check('favorite folder loaded in the UI', biliRows > 0, `${biliRows} rows`);

	await screenshot('bilibili-tab.png');

	await evaluate(`(() => {
		const button = [...document.querySelectorAll('.dm2-card button')].find((el) => el.title === '播放全部（替换队列）');
		button?.click();
		return Boolean(button);
	})()`);
	await sleep(3500);
	const biliState = await (await fetch(`${url}/dsh-music-v2/state`)).json();
	check(
		'Bilibili favorites become the queue',
		biliState.queue.length >= 1 && biliState.queue.every((item) => item.source === 'bilibili'),
		`${biliState.queue.length} tracks, playing=${biliState.playing}`
	);

	// JS .click() is not a trusted gesture, so autoplay may have been blocked:
	// give it a moment, then click the round play button with a trusted event.
	await sleep(2500);
	const paused = await evaluate("document.querySelector('.dm2-play')?.title ?? ''");
	if (paused === '播放') {
		const rect = await evaluate(`(() => {
			const button = document.querySelector('.dm2-play');
			if (!button) return null;
			const box = button.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		})()`);
		if (rect !== null) {
			for (const type of ['mousePressed', 'mouseReleased']) {
				await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
			}
		}
	}
	await sleep(5000);
	const biliDebug = await evaluate(`(() => ({
		error: document.querySelector('.dm2-error')?.textContent ?? '',
		streams: performance.getEntriesByType('resource')
			.filter((entry) => entry.name.includes('/stream'))
			.map((entry) => ({ query: entry.name.split('?')[1]?.slice(0, 60), status: entry.responseStatus, size: entry.transferSize, ms: Math.round(entry.duration) }))
			.slice(-3)
	}))()`);
	console.log('bili debug:', JSON.stringify(biliDebug));
	const biliProgress = await evaluate("document.querySelector('.dm2-time')?.textContent ?? '0:00'");
	check('Bilibili audio actually advances', biliProgress !== '0:00', `progress=${biliProgress}`);

	// Drag the progress bar (not just a click) and confirm it does not restart.
	const bar = await evaluate(`(() => {
		const el = document.querySelector('.dm2-progress');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: r.left, width: r.width, y: r.top + r.height / 2 };
	})()`);
	const dragTo = async (ratio) => {
		if (bar === null) return;
		const x = bar.left + bar.width * ratio;
		await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: bar.y, button: 'left', clickCount: 1 });
		await sleep(120);
		for (const step of [0.01, 0.02, 0.03]) {
			await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + bar.width * step, y: bar.y, button: 'left' });
			await sleep(80);
		}
		await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + bar.width * 0.03, y: bar.y, button: 'left', clickCount: 1 });
	};
	if (bar !== null) {
		await dragTo(0.5);
		await sleep(4000);
		const seekedText = await evaluate("document.querySelector('.dm2-time')?.textContent ?? '0:00'");
		const seekState = await (await fetch(`${url}/dsh-music-v2/state`)).json();
		const [mm, ss] = seekedText.split(':').map(Number);
		check(
			'dragging the progress bar seeks without restarting',
			Number.isFinite(mm) && Number.isFinite(ss) && mm * 60 + ss > 30 && seekState.positionMs > 30000,
			`ui=${seekedText} hostPositionMs=${seekState.positionMs}`
		);
		await screenshot('bilibili-seek.png');

		// Jump near 2:30 and let it play past 2:36 (the reported stall point).
		await dragTo(0.72);
		await sleep(12000);
		const lateText = await evaluate("document.querySelector('.dm2-time')?.textContent ?? '0:00'");
		const lateState = await (await fetch(`${url}/dsh-music-v2/state`)).json();
		const [lm, ls] = lateText.split(':').map(Number);
		check(
			'playback continues past 2:36 after seeking',
			Number.isFinite(lm) && Number.isFinite(ls) && lm * 60 + ls > 156 && lateState.positionMs > 156000,
			`ui=${lateText} hostPositionMs=${lateState.positionMs}`
		);
	}

	await screenshot('bilibili-playing.png');
	}
} finally {
	socket.close();
	child.kill();
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
