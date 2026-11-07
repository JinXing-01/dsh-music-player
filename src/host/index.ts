/**
 * dsh-music-v2 — host half.
 *
 * Owns the authoritative player state, the NetEase provider chain, the audio
 * stream proxy, SSE state pushes, persistence, and the agent-facing `music`
 * tool.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { findTrack, createState, publicStateOf, reduce, type InternalState } from './reducer.js';
import { StateStore, loadPersisted } from './store.js';
import { installSettings, loadConfig, publicConfig, type MusicConfig } from './config.js';
import { parsePlaylistId, playlist as fetchPlaylist, resolveStream, search as searchNetease, type NeteaseOptions } from './netease.js';
import {
	BiliError,
	folderPage as biliFolderPage,
	folderInfo as biliFolderInfo,
	ownFolders as biliOwnFolders,
	rememberWorkingUrl,
	resetBilibiliCache,
	resolveAudio as biliResolveAudio,
	resolveFolderRef,
	session as biliSession,
	status as biliStatus,
	verifyCookie as biliVerifyCookie,
	videoInfo as biliVideoInfo,
	type BiliFavorite,
	type BiliFolder
} from './bilibili.js';
import { proxyAudio, proxyMedia, sendJson } from './stream.js';
import type { Command, CommandResult, PlayerState, SearchRow, Track } from '../shared/types.js';

export const name = 'dsh-music-v2';
export const inject = ['webServer', 'tools'];

// ── minimal structural types for the host services we consume ───────────────

interface WebRoute {
	kind: 'exact' | 'prefix';
	path: string;
	handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

interface HostContext {
	webServer: { register(route: WebRoute): () => void };
	tools: { register(definition: unknown): () => void };
	effect(callback: () => void | (() => void)): () => void;
	/** Cordis registry surface: run a child fiber once a service is available. */
	inject?(deps: string[], callback: (scoped: Record<string, unknown>) => void): unknown;
	logger?: { info(message: string): void; warn(message: string): void };
}

const log = (ctx: HostContext, level: 'info' | 'warn', message: string): void => {
	try {
		ctx.logger?.[level](message);
	} catch {
		/* logging must never break the plugin */
	}
	if (ctx.logger === undefined) console[level === 'warn' ? 'warn' : 'log'](`[dsh-music-v2] ${message}`);
};

// ── helpers ──────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = '';
		req.setEncoding('utf8');
		req.on('data', (chunk: string) => {
			data += chunk;
			if (data.length > limit) {
				reject(new Error('body too large'));
				req.destroy();
			}
		});
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

function jsonOk(res: ServerResponse, body: unknown): void {
	sendJson(res, 200, body);
}

/** Map provider rows to queue tracks. */
function toTrack(row: SearchRow): Track {
	return {
		id: `netease:${row.id}`,
		title: row.title,
		artist: row.artist,
		album: row.album,
		cover: row.cover,
		durationMs: row.durationMs,
		source: 'netease',
		sourceId: row.id
	};
}

function isTrack(value: unknown): value is Track {
	if (typeof value !== 'object' || value === null) return false;
	const track = value as Partial<Track>;
	if (typeof track.id !== 'string' || typeof track.title !== 'string') return false;
	if (track.source === 'direct') return typeof track.url === 'string' && /^(https?|blob):/.test(track.url);
	if (track.source === 'netease') return typeof track.sourceId === 'string' && /^\d+$/.test(track.sourceId);
	if (track.source === 'bilibili') return typeof track.bvid === 'string' && /^BV[0-9A-Za-z]+$/.test(track.bvid);
	return false;
}

/** Map one Bilibili favorite row to a queue track (audio-only playback). */
function biliTrack(row: BiliFavorite): Track {
	return {
		id: `bili:${row.bvid}`,
		title: row.title,
		artist: row.upper,
		cover: row.cover,
		durationMs: row.durationSec * 1000,
		source: 'bilibili',
		bvid: row.bvid
	};
}

/** Coerce an untrusted command payload into the typed union (or refuse it). */
function parseCommand(raw: unknown): Command | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const value = raw as Record<string, unknown>;
	const action = typeof value.action === 'string' ? value.action : '';
	switch (action) {
		case 'play':
			return typeof value.index === 'number' ? { action, index: value.index } : { action };
		case 'pause':
		case 'toggle':
		case 'next':
		case 'prev':
		case 'clear':
			return { action };
		case 'ended':
			return { action, ...(typeof value.trackId === 'string' ? { trackId: value.trackId } : {}) };
		case 'volume':
			return { action, volume: Number(value.volume) };
		case 'mode':
			return { action, mode: value.mode as 'list' | 'single' | 'shuffle' };
		case 'seek':
			return { action, positionMs: Number(value.positionMs) };
		case 'remove':
			return { action, index: Number(value.index) };
		case 'reorder':
			return { action, from: Number(value.from), to: Number(value.to) };
		case 'add':
			if (!isTrack(value.track)) return undefined;
			return { action, track: value.track, ...(value.next === true ? { next: true } : {}) };
		case 'replaceQueue': {
			if (!Array.isArray(value.tracks)) return undefined;
			const tracks = value.tracks.filter(isTrack);
			return { action, tracks, ...(value.play === true ? { play: true } : {}), ...(typeof value.startAt === 'number' ? { startAt: value.startAt } : {}) };
		}
		default:
			return undefined;
	}
}

// ── SSE hub ──────────────────────────────────────────────────────────────────

class StateHub {
	private readonly clients = new Set<ServerResponse>();
	private timer: NodeJS.Timeout | undefined;

	constructor() {
		this.timer = setInterval(() => this.ping(), 25_000);
		this.timer.unref?.();
	}

	attach(req: IncomingMessage, res: ServerResponse, initial: PlayerState): void {
		res.writeHead(200, {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-store, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		});
		res.write(`retry: 3000\nid: ${initial.rev}\nevent: state\ndata: ${JSON.stringify(initial)}\n\n`);
		this.clients.add(res);
		req.on('close', () => {
			this.clients.delete(res);
			res.end();
		});
	}

	broadcast(state: PlayerState): void {
		const payload = `id: ${state.rev}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`;
		for (const client of this.clients) {
			try {
				client.write(payload);
			} catch {
				this.clients.delete(client);
			}
		}
	}

	private ping(): void {
		for (const client of this.clients) {
			try {
				client.write(': ping\n\n');
			} catch {
				this.clients.delete(client);
			}
		}
	}

	dispose(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		for (const client of this.clients) {
			try {
				client.end();
			} catch {
				/* ignore */
			}
		}
		this.clients.clear();
	}
}

// ── plugin ───────────────────────────────────────────────────────────────────

export function apply(ctx: HostContext): void {
	let state: InternalState = createState();
	let config: MusicConfig = { neteaseCookie: '', defaultPlaylist: '', br: 320000, volume: 0.8, biliCookie: '', biliFolder: '' };
	const store = new StateStore();
	const hub = new StateHub();
	const bridge = installSettings(ctx, (next) => {
		config = next;
	}, (level, message) => log(ctx, level, message));
	let initialised = false;

	const options = (): NeteaseOptions => ({ cookie: config.neteaseCookie, br: config.br });

	const run = (command: Command): CommandResult => {
		const { state: next, result } = reduce(state, command);
		state = next;
		hub.broadcast(publicStateOf(state));
		store.schedule(state);
		return result;
	};

	/** Read every playable page of a Bilibili favorite folder into queue tracks. */
	const loadBiliFolder = async (ref: string): Promise<{ tracks: Track[]; folder: BiliFolder; fid: string }> => {
		if (ref.trim() === '') throw new BiliError('请提供收藏夹链接、id 或名称', 'bad-folder', 400);
		const resolved = await resolveFolderRef(ref, config.biliCookie);
		const tracks: Track[] = [];
		let folder: BiliFolder | undefined;
		for (let pn = 1; pn <= 10; pn += 1) {
			const page = await biliFolderPage(resolved.fid, pn, config.biliCookie);
			folder ??= page.folder;
			for (const row of page.tracks) {
				if (row.attr !== 0) continue;
				if (tracks.some((track) => track.bvid === row.bvid)) continue;
				tracks.push(biliTrack(row));
			}
			if (!page.hasMore) break;
		}
		return { tracks, folder: folder ?? { id: Number(resolved.fid), title: '收藏夹', owner: '', count: 0 }, fid: resolved.fid };
	};

	// Restore the last session and the configured default library.
	void (async () => {
		config = bridge.get() ?? (await loadConfig());
		const persisted = await loadPersisted();
		// Object URLs for local files die with the page that created them.
		const restoredQueue = (persisted?.queue ?? []).filter((track) => !(typeof track.url === 'string' && track.url.startsWith('blob:')));
		const base = createState();
		state = createState({
			...(persisted?.queue !== undefined ? { queue: restoredQueue } : {}),
			...(persisted?.index !== undefined ? { index: persisted.index } : {}),
			...(persisted?.mode !== undefined ? { mode: persisted.mode } : {}),
			...(persisted?.volume !== undefined ? { volume: persisted.volume } : {}),
			...(persisted?.positionMs !== undefined ? { positionMs: persisted.positionMs } : {}),
			volume: persisted?.volume ?? config.volume ?? base.volume,
			playing: false
		});
		if (state.queue.length === 0 && config.defaultPlaylist !== '') {
			const id = parsePlaylistId(config.defaultPlaylist);
			if (id !== undefined) {
				try {
					const loaded = await fetchPlaylist(id, options());
					state = createState({ ...state, queue: loaded.tracks.map(toTrack), index: 0, playing: false, volume: state.volume });
					log(ctx, 'info', `默认歌单「${loaded.name}」已加载（${loaded.tracks.length} 首）`);
				} catch (error) {
					log(ctx, 'warn', `默认歌单加载失败：${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
		initialised = true;
		hub.broadcast(publicStateOf(state));
		store.schedule(state);
	})();

	// ── routes ────────────────────────────────────────────────────────────
	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/state',
			handler: (_req, res) => jsonOk(res, { ...publicStateOf(state), initialised })
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/events',
			handler: (req, res) => hub.attach(req, res, publicStateOf(state))
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/command',
			handler: async (req, res) => {
				if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
				try {
					const body = await readBody(req);
					const command = parseCommand(JSON.parse(body || '{}'));
					if (command === undefined) return sendJson(res, 400, { error: 'bad-command' });
					jsonOk(res, run(command));
				} catch (error) {
					sendJson(res, 400, { error: 'bad-request', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/position',
			handler: async (req, res) => {
				if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
				try {
					const body = JSON.parse((await readBody(req)) || '{}') as { positionMs?: unknown; trackId?: unknown };
					if (typeof body.positionMs !== 'number' || !Number.isFinite(body.positionMs)) return sendJson(res, 400, { error: 'bad-position' });
					const current = state.queue[state.index];
					if (current !== undefined && body.trackId === current.id) {
						state = { ...state, positionMs: Math.max(0, body.positionMs), updatedAt: Date.now() };
						store.schedule(state);
					}
					sendJson(res, 204, {});
				} catch {
					sendJson(res, 400, { error: 'bad-request' });
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/search',
			handler: async (req, res) => {
				const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '';
				if (query.trim() === '') return jsonOk(res, { songs: [] });
				try {
					const songs = await searchNetease(query.trim(), 20, options());
					jsonOk(res, { songs });
				} catch (error) {
					sendJson(res, 502, { error: 'search-failed', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/import',
			handler: async (req, res) => {
				if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
				try {
					const body = JSON.parse((await readBody(req)) || '{}') as { id?: unknown; play?: unknown };
					const id = parsePlaylistId(String(body.id ?? ''));
					if (id === undefined) return sendJson(res, 400, { error: 'bad-playlist-id' });
					const loaded = await fetchPlaylist(id, options());
					if (loaded.tracks.length === 0) return sendJson(res, 404, { error: 'playlist-empty' });
					const result = run({ action: 'replaceQueue', tracks: loaded.tracks.map(toTrack), play: body.play === true });
					jsonOk(res, { ...result, playlist: { name: loaded.name, count: loaded.tracks.length } });
				} catch (error) {
					sendJson(res, 502, { error: 'import-failed', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/stream',
			handler: async (req, res) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				const source = url.searchParams.get('source') ?? '';
				if (source === 'bilibili') {
					const bvid = url.searchParams.get('bvid') ?? '';
					const cidParam = url.searchParams.get('cid') ?? '';
					if (!/^BV[0-9A-Za-z]+$/.test(bvid)) return sendJson(res, 400, { error: 'bad-bvid' });
					try {
						const cid = /^\d+$/.test(cidParam) ? Number(cidParam) : (await biliVideoInfo(bvid, config.biliCookie)).cid;
						const resolved = await biliResolveAudio(bvid, cid, config.biliCookie);
						res.setHeader('x-dsh-music-source', 'bilibili');
						res.setHeader('x-dsh-music-quality', String(resolved.quality));
						res.setHeader(
							'x-dsh-music-candidates',
							resolved.candidates
								.map((candidate) => {
									try {
										return new URL(candidate).host;
									} catch {
										return '?';
									}
								})
								.join(',')
						);
						let ok = await proxyMedia(resolved.candidates, req, res, {
							referer: 'https://www.bilibili.com/',
							allowMp4: true,
							onSuccess: rememberWorkingUrl,
							sendError: false
						});
						if (!ok && !res.headersSent) {
							// Expired CDN URL: drop the cache and resolve once more.
							resetBilibiliCache();
							const fresh = await biliResolveAudio(bvid, cid, config.biliCookie);
							ok = await proxyMedia(fresh.candidates, req, res, {
								referer: 'https://www.bilibili.com/',
								allowMp4: true,
								onSuccess: rememberWorkingUrl
							});
						}
						if (!ok && !res.headersSent) {
							sendJson(res, 502, { error: 'stream-unavailable', detail: 'B 站音频地址不可用' });
						}
					} catch (error) {
						const status = error instanceof BiliError ? error.status : 502;
						sendJson(res, status, {
							error: error instanceof BiliError ? String(error.code) : 'bili-resolve-failed',
							detail: error instanceof Error ? error.message : String(error)
						});
					}
					return;
				}
				const id = url.searchParams.get('id') ?? '';
				if (source !== 'netease' || !/^\d+$/.test(id)) return sendJson(res, 400, { error: 'bad-stream-request' });
				try {
					const resolved = await resolveStream(id, options());
					if (resolved === null) return sendJson(res, 404, { error: 'not-playable', id });
					if (resolved.trial) res.setHeader('x-dsh-music-trial', '1');
					await proxyAudio(resolved.url, req, res);
				} catch (error) {
					sendJson(res, 502, { error: 'resolve-failed', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	// ── Bilibili ──────────────────────────────────────────────────────────
	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/bili/status',
			handler: async (_req, res) => {
				try {
					const current = await biliStatus(config.biliCookie);
					jsonOk(res, { ...current, folder: config.biliFolder });
				} catch (error) {
					const status = error instanceof BiliError ? error.status : 502;
					sendJson(res, status, { error: 'bili-status-failed', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/bili/login/cookie',
			handler: async (req, res) => {
				if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
				try {
					const body = JSON.parse((await readBody(req)) || '{}') as { cookie?: unknown };
					const cookie = typeof body.cookie === 'string' ? body.cookie.trim() : '';
					if (cookie === '') return sendJson(res, 400, { error: 'missing-cookie', detail: '请粘贴 SESSDATA 或整段 Cookie' });
					const user = await biliVerifyCookie(cookie);
					await bridge.update({ biliCookie: cookie });
					config = bridge.get() ?? (await loadConfig());
					resetBilibiliCache();
					jsonOk(res, { ok: true, user });
				} catch (error) {
					const status = error instanceof BiliError ? error.status : 502;
					sendJson(res, status, {
						error: 'bili-login-failed',
						detail: error instanceof Error ? error.message : String(error)
					});
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/bili/folders',
			handler: async (_req, res) => {
				try {
					const folders = await biliOwnFolders(config.biliCookie);
					jsonOk(res, { folders });
				} catch (error) {
					const status = error instanceof BiliError ? error.status : 502;
					sendJson(res, status, { error: 'bili-folders-failed', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/bili/folder',
			handler: async (req, res) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				const ref = url.searchParams.get('ref') ?? config.biliFolder;
				const pn = Math.max(1, Number(url.searchParams.get('pn') ?? '1'));
				if (ref.trim() === '') return sendJson(res, 400, { error: 'missing-folder', detail: '请提供收藏夹链接、id 或名称' });
				try {
					const resolved = await resolveFolderRef(ref, config.biliCookie);
					const page = await biliFolderPage(resolved.fid, pn, config.biliCookie);
					jsonOk(res, {
						folder: page.folder,
						tracks: page.tracks.map(biliTrack),
						hasMore: page.hasMore,
						page: pn
					});
				} catch (error) {
					const status = error instanceof BiliError ? error.status : 502;
					sendJson(res, status, { error: 'bili-folder-failed', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/bili/import',
			handler: async (req, res) => {
				if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
				try {
					const body = JSON.parse((await readBody(req)) || '{}') as { ref?: unknown; play?: unknown };
					const ref = typeof body.ref === 'string' && body.ref.trim() !== '' ? body.ref : config.biliFolder;
					const loaded = await loadBiliFolder(ref);
					if (loaded.tracks.length === 0) return sendJson(res, 404, { error: 'folder-empty' });
					const result = run({ action: 'replaceQueue', tracks: loaded.tracks, play: body.play !== false });
					jsonOk(res, {
						...result,
						folder: { title: loaded.folder.title, count: loaded.tracks.length, id: loaded.fid }
					});
				} catch (error) {
					const status = error instanceof BiliError ? error.status : 502;
					sendJson(res, status, { error: 'bili-import-failed', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/bili/reset',
			handler: async (_req, res) => {
				resetBilibiliCache();
				jsonOk(res, { ok: true });
			}
		})
	);

	ctx.effect(() =>
		ctx.webServer.register({
			kind: 'exact',
			path: '/dsh-music-v2/config',
			handler: async (req, res) => {
				if (req.method === 'GET') return jsonOk(res, publicConfig(config));
				if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
				try {
					const patch = JSON.parse((await readBody(req)) || '{}') as Partial<MusicConfig>;
					await bridge.update(patch);
					config = bridge.get() ?? (await loadConfig());
					if (patch.biliCookie !== undefined) resetBilibiliCache();
					jsonOk(res, publicConfig(config));
				} catch (error) {
					sendJson(res, 400, { error: 'bad-config', detail: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	);

	// ── agent tool ────────────────────────────────────────────────────────
	ctx.tools.register({
		name: 'music',
		description:
			'控制 DSH 音乐播放器：播放/暂停/切歌/调音量/切换模式/查看队列/搜索网易云/导入歌单/添加直链/B 站收藏夹。用户说“放首歌、切歌、暂停、音量小一点、导入我的歌单、放我的 B 站收藏夹、来点随机”等时使用。',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				action: {
					type: 'string',
					enum: [
						'play',
						'pause',
						'next',
						'prev',
						'status',
						'volume',
						'mode',
						'search',
						'playlist',
						'add',
						'remove',
						'clear',
						'bili_status',
						'bili_folder'
					],
					description: '要执行的操作'
				},
				query: { type: 'string', description: 'play 的歌名/歌手，或 search 的关键词' },
				index: { type: 'number', description: 'play/remove 的队列索引（从 0 开始）' },
				volume: { type: 'number', description: '0-1 之间的音量' },
				mode: { type: 'string', enum: ['list', 'single', 'shuffle'], description: '播放模式' },
				id: { type: 'string', description: '网易云歌单 id 或分享链接' },
				ref: { type: 'string', description: 'B 站收藏夹链接或 id（bili_folder 用）' },
				url: { type: 'string', description: 'add 的音频直链' },
				title: { type: 'string', description: 'add 的标题' }
			},
			required: ['action']
		},
		output: {
			schema: { type: 'object', additionalProperties: true },
			render: (_args: unknown, value: unknown) => {
				const payload = value as { message?: string } | null;
				return [{ type: 'text', text: payload?.message ?? 'ok' }];
			}
		},
		async execute(args: Record<string, unknown>): Promise<unknown> {
			const action = typeof args.action === 'string' ? args.action : '';
			const status = (): string => {
				const current = state.queue[state.index];
				const lines = state.queue.map((track, index) => `${index === state.index ? (state.playing ? '▶' : '⏸') : ' '} [${index}] ${track.title} — ${track.artist}`);
				return [
					current === undefined ? '播放列表为空' : `正在${state.playing ? '播放' : '暂停'}「${current.title} — ${current.artist}」`,
					`模式 ${state.mode}｜音量 ${Math.round(state.volume * 100)}%｜共 ${state.queue.length} 首`,
					'',
					lines.join('\n')
				].join('\n');
			};

			switch (action) {
				case 'play': {
					const query = typeof args.query === 'string' ? args.query.trim() : '';
					if (query !== '') {
						const local = findTrack(state, query);
						if (local !== undefined) {
							const result = run({ action: 'play', index: state.queue.indexOf(local) });
							return { ok: true, message: result.message, state: publicStateOf(state) };
						}
						try {
							const songs = await searchNetease(query, 5, options());
							if (songs.length === 0) return { ok: false, message: `曲库和网易云都没有找到「${query}」` };
							const track = toTrack(songs[0]!);
							run({ action: 'add', track });
							const result = run({ action: 'play', index: state.queue.length - 1 });
							return { ok: true, message: `本地没有，已从网易云搜索并播放「${track.title} — ${track.artist}」`, state: publicStateOf(state) };
						} catch (error) {
							return { ok: false, message: `网易云搜索失败：${error instanceof Error ? error.message : String(error)}` };
						}
					}
					const result = run(typeof args.index === 'number' ? { action: 'play', index: args.index } : { action: 'play' });
					return { ok: result.ok, message: result.message, state: publicStateOf(state) };
				}
				case 'pause':
					return { ok: true, message: run({ action: 'pause' }).message };
				case 'next':
					return { ok: true, message: run({ action: 'next' }).message };
				case 'prev':
					return { ok: true, message: run({ action: 'prev' }).message };
				case 'status':
					return { ok: true, message: status(), state: publicStateOf(state) };
				case 'volume': {
					if (typeof args.volume !== 'number') return { ok: false, message: '请提供 0-1 的音量' };
					return { ok: true, message: run({ action: 'volume', volume: args.volume }).message };
				}
				case 'mode': {
					if (args.mode !== 'list' && args.mode !== 'single' && args.mode !== 'shuffle') return { ok: false, message: '模式必须是 list/single/shuffle' };
					return { ok: true, message: run({ action: 'mode', mode: args.mode }).message };
				}
				case 'search': {
					const query = typeof args.query === 'string' ? args.query.trim() : '';
					if (query === '') return { ok: false, message: '请提供搜索关键词 query' };
					try {
						const songs = await searchNetease(query, 10, options());
						if (songs.length === 0) return { ok: true, message: `网易云没有搜到「${query}」` };
						const lines = songs.map((song, i) => `${i + 1}. ${song.title} — ${song.artist}（${song.album}）`);
						return { ok: true, message: `网易云搜索结果：\n${lines.join('\n')}\n\n说“播放第 N 首”或直接给歌名。`, songs };
					} catch (error) {
						return { ok: false, message: `搜索失败：${error instanceof Error ? error.message : String(error)}` };
					}
				}
				case 'playlist': {
					const id = parsePlaylistId(String(args.id ?? ''));
					if (id === undefined) return { ok: false, message: '请提供网易云歌单 id 或分享链接' };
					try {
						const loaded = await fetchPlaylist(id, options());
						if (loaded.tracks.length === 0) return { ok: false, message: '歌单为空或不可访问' };
						const result = run({ action: 'replaceQueue', tracks: loaded.tracks.map(toTrack), play: true });
						return { ok: true, message: `已导入歌单「${loaded.name}」（${loaded.tracks.length} 首）并开始播放`, state: publicStateOf(state), result };
					} catch (error) {
						return { ok: false, message: `导入失败：${error instanceof Error ? error.message : String(error)}` };
					}
				}
				case 'add': {
					const url = typeof args.url === 'string' ? args.url.trim() : '';
					if (!/^https?:\/\/\S+$/.test(url)) return { ok: false, message: '请提供 http(s) 音频直链' };
					const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : url.split('/').pop() ?? url;
					const track: Track = { id: `direct:${Date.now().toString(36)}`, title, artist: '直链', source: 'direct', url };
					return { ok: true, message: run({ action: 'add', track }).message };
				}
				case 'remove':
					return { ok: true, message: run({ action: 'remove', index: Number(args.index) }).message };
				case 'clear':
					return { ok: true, message: run({ action: 'clear' }).message };
				case 'bili_status': {
					try {
						const current = await biliStatus(config.biliCookie);
						return {
							ok: true,
							message: current.loggedIn
								? `B 站已登录：${current.user?.name ?? '未知'}（来源 ${current.source ?? '?'}）`
								: 'B 站未登录：可粘贴 Cookie，或先在本机登录 bili CLI'
						};
					} catch (error) {
						return { ok: false, message: `B 站状态读取失败：${error instanceof Error ? error.message : String(error)}` };
					}
				}
				case 'bili_folder': {
					const ref = typeof args.ref === 'string' && args.ref.trim() !== '' ? args.ref : config.biliFolder;
					try {
						const loaded = await loadBiliFolder(ref);
						if (loaded.tracks.length === 0) return { ok: false, message: '收藏夹为空或全部失效' };
						run({ action: 'replaceQueue', tracks: loaded.tracks, play: true });
						return {
							ok: true,
							message: `已载入 B 站收藏夹「${loaded.folder.title}」（${loaded.tracks.length} 首），开始播放第一首`,
							state: publicStateOf(state)
						};
					} catch (error) {
						return { ok: false, message: `B 站收藏夹读取失败：${error instanceof Error ? error.message : String(error)}` };
					}
				}
				default:
					return { ok: false, message: `未知操作「${action}」` };
			}
		}
	});

	ctx.effect(() => () => {
		hub.dispose();
		void store.stop();
	});
}
