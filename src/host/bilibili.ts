/**
 * Bilibili provider: shared login reuse, WBI-signed audio resolution and
 * favorite-folder reading.
 *
 * Only the audio track is ever requested; video tracks are ignored on purpose.
 */
import { createHash } from 'node:crypto';
import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Bilibili CDN hosts publish AAAA records; networks without IPv6 stall on them.
try {
	dns.setDefaultResultOrder('ipv4first');
} catch {
	/* older node */
}

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';
const API = 'https://api.bilibili.com';
const MIN_GAP_MS = 300;
const NAV_TTL = 5 * 60_000;
const WBI_TTL = 30 * 60_000;
const FOLDER_TTL = 2 * 60_000;
const RESOLVE_TTL = 90 * 60_000;

/** Audio quality preference: 30280 is the ~192k AAC track. */
const PREFERRED_AUDIO_ID = 30280;

export interface BiliCredentials {
	sessdata: string;
	biliJct: string;
	buvid3: string;
	dedeuserid: string;
	/** Where the cookie came from. */
	source: 'settings' | 'cli' | 'whale';
}

export interface BiliUser {
	name: string;
	mid: number | string;
}

export interface BiliFolder {
	id: number;
	title: string;
	owner: string;
	count: number;
}

export interface BiliFavorite {
	bvid: string;
	title: string;
	upper: string;
	cover: string;
	durationSec: number;
	favTime: number;
	attr: number;
}

export interface BiliPage {
	folder: BiliFolder;
	tracks: BiliFavorite[];
	hasMore: boolean;
}

export class BiliError extends Error {
	constructor(
		message: string,
		readonly code: number | string = 'bili-error',
		readonly status = 502
	) {
		super(message);
	}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── credentials ─────────────────────────────────────────────────────────────

/** Parse a cookie header, a `SESSDATA=…` pair, or a bare SESSDATA value. */
export function parseCookieString(raw: string): Partial<BiliCredentials> {
	const trimmed = raw.trim();
	// Bare value pasted from DevTools (SESSDATA is HttpOnly, so users copy the
	// value itself rather than a document.cookie string).
	if (trimmed !== '' && !trimmed.includes('=')) return { sessdata: trimmed };
	const result: Partial<BiliCredentials> = {};
	for (const part of trimmed.split(';')) {
		const index = part.indexOf('=');
		if (index <= 0) continue;
		const key = part.slice(0, index).trim();
		const value = part.slice(index + 1).trim();
		if (key === 'SESSDATA') result.sessdata = value;
		else if (key === 'bili_jct') result.biliJct = value;
		else if (key === 'buvid3') result.buvid3 = value;
		else if (key === 'DedeUserID') result.dedeuserid = value;
	}
	return result;
}

/** Validate a pasted cookie against the nav endpoint before storing it. */
export async function verifyCookie(raw: string): Promise<BiliUser> {
	const parsed = parseCookieString(raw);
	if (typeof parsed.sessdata !== 'string' || parsed.sessdata === '') {
		throw new BiliError('没有找到 SESSDATA，请粘贴 SESSDATA 的值或整段 Cookie', 'bad-cookie', 400);
	}
	const cred: BiliCredentials = {
		sessdata: parsed.sessdata,
		biliJct: parsed.biliJct ?? '',
		buvid3: parsed.buvid3 ?? '',
		dedeuserid: parsed.dedeuserid ?? '',
		source: 'settings'
	};
	let nav: NavPayload;
	try {
		nav = await apiGet<NavPayload>(`${API}/x/web-interface/nav`, cred);
	} catch (error) {
		throw error instanceof BiliError ? error : new BiliError('Cookie 校验请求失败', 'verify-failed', 502);
	}
	if (nav.code !== 0 || nav.data?.isLogin !== true) {
		throw new BiliError('Cookie 无效或已过期，请重新复制 SESSDATA', 'bad-cookie', 401);
	}
	return { name: nav.data.uname ?? '已登录', mid: nav.data.mid ?? parsed.dedeuserid ?? '' };
}

interface RawCredentialFile {
	sessdata?: unknown;
	bili_jct?: unknown;
	buvid3?: unknown;
	dedeuserid?: unknown;
	DedeUserID?: unknown;
}

async function readCredentialFile(file: string): Promise<Partial<BiliCredentials> | undefined> {
	try {
		const parsed = JSON.parse(await readFile(file, 'utf8')) as RawCredentialFile;
		const sessdata = typeof parsed.sessdata === 'string' ? parsed.sessdata : '';
		if (sessdata === '') return undefined;
		return {
			sessdata,
			biliJct: typeof parsed.bili_jct === 'string' ? parsed.bili_jct : '',
			buvid3: typeof parsed.buvid3 === 'string' ? parsed.buvid3 : '',
			dedeuserid: typeof parsed.dedeuserid === 'string' ? parsed.dedeuserid : typeof parsed.DedeUserID === 'string' ? parsed.DedeUserID : ''
		};
	} catch {
		return undefined;
	}
}

/**
 * Candidate credential stores, highest priority first. The plugin does not
 * write to any of them: it only borrows the account already logged in on this
 * machine (bili CLI is what bili-whale and the local upload scripts use).
 */
export async function loadCredentials(settingsCookie = ''): Promise<BiliCredentials[]> {
	const candidates: BiliCredentials[] = [];
	const fromSettings = parseCookieString(settingsCookie);
	if (typeof fromSettings.sessdata === 'string' && fromSettings.sessdata !== '') {
		candidates.push({
			sessdata: fromSettings.sessdata,
			biliJct: fromSettings.biliJct ?? '',
			buvid3: fromSettings.buvid3 ?? '',
			dedeuserid: fromSettings.dedeuserid ?? '',
			source: 'settings'
		});
	}
	const appData = process.env.APPDATA ?? '';
	if (appData !== '') {
		const cli = await readCredentialFile(path.join(appData, 'bili-cli', 'credential.json'));
		if (cli !== undefined) {
			candidates.push({ sessdata: cli.sessdata!, biliJct: cli.biliJct ?? '', buvid3: cli.buvid3 ?? '', dedeuserid: cli.dedeuserid ?? '', source: 'cli' });
		}
	}
	const whale = await readCredentialFile(path.join(homedir(), '.bili-ai', 'credentials.json'));
	if (whale !== undefined) {
		candidates.push({ sessdata: whale.sessdata!, biliJct: whale.biliJct ?? '', buvid3: whale.buvid3 ?? '', dedeuserid: whale.dedeuserid ?? '', source: 'whale' });
	}
	return candidates;
}

function cookieHeader(cred: BiliCredentials): string {
	return [
		`SESSDATA=${cred.sessdata}`,
		cred.biliJct !== '' ? `bili_jct=${cred.biliJct}` : '',
		cred.dedeuserid !== '' ? `DedeUserID=${cred.dedeuserid}` : '',
		cred.buvid3 !== '' ? `buvid3=${cred.buvid3}` : ''
	]
		.filter(Boolean)
		.join('; ');
}

// ── WBI signing ─────────────────────────────────────────────────────────────

const MIXIN_TAB = [
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
	41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
	20, 34, 44, 52
];

/** WBI signature for one query. `now` is injectable so tests stay deterministic. */
export function wbiSign(params: Record<string, string | number>, imgKey: string, subKey: string, now = Date.now()): string {
	const raw = imgKey + subKey;
	const mixin = MIXIN_TAB.map((index) => raw[index] ?? '')
		.join('')
		.slice(0, 32);
	const all: Record<string, string | number> = { ...params, wts: Math.floor(now / 1000) };
	const query = Object.keys(all)
		.sort()
		.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(all[key]).replace(/[!'()*]/g, ''))}`)
		.join('&');
	const wRid = createHash('md5').update(query + mixin).digest('hex');
	return `${query}&w_rid=${wRid}`;
}

const keyOf = (url: string): string => url.split('/').pop()?.split('.')[0] ?? '';

// ── HTTP plumbing ───────────────────────────────────────────────────────────

let lastCall = 0;
async function pace(): Promise<void> {
	const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now());
	if (wait > 0) await sleep(wait);
	lastCall = Date.now();
}

async function apiGet<T>(url: string, cred: BiliCredentials, timeoutMs = 12000): Promise<T> {
	await pace();
	let res: Response;
	try {
		res = await fetch(url, {
			headers: { 'user-agent': UA, referer: REFERER, origin: REFERER, cookie: cookieHeader(cred) },
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (error) {
		throw new BiliError(`B 站请求失败：${error instanceof Error ? error.message : String(error)}`, 'network', 504);
	}
	const text = await res.text();
	if (res.status === 412) throw new BiliError('B 站风控拦截（412），请稍后再试', 'risk', 429);
	if (!res.ok) throw new BiliError(`B 站返回 HTTP ${res.status}`, 'http', 502);
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new BiliError('B 站返回了非 JSON 响应（可能触发风控）', 'non-json', 502);
	}
}

function assertCode(payload: { code?: number; message?: string }, what: string): void {
	const code = payload.code ?? -1;
	if (code === 0) return;
	if (code === -101) throw new BiliError('B 站未登录或登录已失效', 'not-logged-in', 401);
	if (code === 87007 || code === 87008) throw new BiliError('该视频需要大会员/付费，无法播放', 'vip-required', 403);
	if (code === 62002) throw new BiliError('稿件不可见（可能已删除或仅粉丝可见）', 'unavailable', 404);
	if (code === -404) throw new BiliError('视频不存在或已删除', 'not-found', 404);
	throw new BiliError(`${what}失败：${payload.message ?? `code ${code}`}`, code, 502);
}

// ── session / nav ───────────────────────────────────────────────────────────

interface NavPayload {
	code: number;
	message?: string;
	data?: { isLogin?: boolean; uname?: string; mid?: number; wbi_img?: { img_url?: string; sub_url?: string } };
}

interface Session {
	cred: BiliCredentials;
	user: BiliUser;
	imgKey: string;
	subKey: string;
	at: number;
}

let sessionCache: Session | undefined;
let sessionCheckedAt = 0;

/** Resolve one working session from the credential stores (cached). */
export async function session(settingsCookie = '', force = false): Promise<Session> {
	if (!force && sessionCache !== undefined && Date.now() - sessionCache.at < NAV_TTL) return sessionCache;
	if (!force && Date.now() - sessionCheckedAt < NAV_TTL && sessionCache === undefined) {
		throw new BiliError('B 站未登录，请先在设置里粘贴 Cookie 或使用已登录的 bili CLI', 'not-logged-in', 401);
	}
	sessionCheckedAt = Date.now();
	const candidates = await loadCredentials(settingsCookie);
	if (candidates.length === 0) {
		sessionCache = undefined;
		throw new BiliError('没有找到可复用的 B 站登录态（bili CLI / bili-whale / 设置）', 'no-credentials', 401);
	}
	let lastError: BiliError | undefined;
	for (const cred of candidates) {
		try {
			const nav = await apiGet<NavPayload>(`${API}/x/web-interface/nav`, cred);
			if (nav.code !== 0 || nav.data?.isLogin !== true) continue;
			const imgUrl = nav.data.wbi_img?.img_url ?? '';
			const subUrl = nav.data.wbi_img?.sub_url ?? '';
			sessionCache = {
				cred,
				user: { name: nav.data.uname ?? '未知用户', mid: nav.data.mid ?? cred.dedeuserid },
				imgKey: keyOf(imgUrl),
				subKey: keyOf(subUrl),
				at: Date.now()
			};
			return sessionCache;
		} catch (error) {
			lastError = error as BiliError;
		}
	}
	sessionCache = undefined;
	throw lastError ?? new BiliError('B 站未登录或登录已失效', 'not-logged-in', 401);
}

export interface BiliStatus {
	loggedIn: boolean;
	user?: BiliUser;
	source?: BiliCredentials['source'];
}

export async function status(settingsCookie = ''): Promise<BiliStatus> {
	try {
		const current = await session(settingsCookie);
		return { loggedIn: true, user: current.user, source: current.cred.source };
	} catch (error) {
		if (error instanceof BiliError && error.code === 'not-logged-in') return { loggedIn: false };
		throw error;
	}
}

// ── favorites ───────────────────────────────────────────────────────────────

/** Extract a folder id from a raw id, a favlist URL or a b23.tv short link. */
export function parseFolderRef(raw: string): { fid?: string; mid?: string; short?: string } {
	const value = raw.trim();
	if (value === '') return {};
	if (/^\d+$/.test(value)) return { fid: value };
	const short = /^https?:\/\/b23\.tv\/([\w-]+)/i.exec(value);
	if (short !== null) return { short: value };
	const withMid = /space\.bilibili\.com\/(\d+)\/favlist[^#]*?[?&]fid=(\d+)/i.exec(value);
	if (withMid !== null) return { mid: withMid[1], fid: withMid[2] };
	const favlist = /[?&]fid=(\d+)/i.exec(value);
	if (favlist !== null) return { fid: favlist[1] };
	const mediaId = /[?&]media_id=(\d+)/i.exec(value);
	if (mediaId !== null) return { fid: mediaId[1] };
	return {};
}

/** Follow a b23.tv short link to the real favorites URL (no credentials needed). */
async function expandShortLink(url: string): Promise<string> {
	await pace();
	try {
		const res = await fetch(url, {
			headers: { 'user-agent': UA },
			redirect: 'follow',
			signal: AbortSignal.timeout(10000)
		});
		return res.url;
	} catch {
		return url;
	}
}

/** Match a folder by exact title first, then by a substring. */
export function matchFolderName(folders: BiliFolder[], raw: string): BiliFolder | undefined {
	const needle = raw.trim().toLowerCase();
	if (needle === '') return undefined;
	return (
		folders.find((folder) => folder.title.toLowerCase() === needle) ??
		folders.find((folder) => folder.title.toLowerCase().includes(needle))
	);
}

/**
 * Resolve a folder reference: numeric id, favlist URL, b23 short link, or a
 * folder NAME (e.g. "music"). Names match the signed-in user's own folders,
 * so a readable name can be configured instead of a URL.
 */
export async function resolveFolderRef(raw: string, settingsCookie = ''): Promise<{ fid: string; mid?: string }> {
	let parsed = parseFolderRef(raw);
	if (parsed.short !== undefined) {
		parsed = parseFolderRef(await expandShortLink(parsed.short));
	}
	if (parsed.fid === undefined) {
		const folders = await ownFolders(settingsCookie);
		const matched = matchFolderName(folders, raw);
		if (matched === undefined) {
			const names = folders.map((folder) => folder.title).join('、');
			throw new BiliError(
				names === '' ? '收藏夹链接、id 或名称无效' : `找不到收藏夹「${raw.trim()}」，可用：${names}`,
				'bad-folder',
				400
			);
		}
		return { fid: String(matched.id) };
	}
	return { fid: parsed.fid, ...(parsed.mid !== undefined ? { mid: parsed.mid } : {}) };
}

interface FolderInfoPayload {
	code: number;
	message?: string;
	data?: { id?: number; title?: string; media_count?: number; upper?: { name?: string; mid?: number } };
}

export async function folderInfo(fid: string, settingsCookie = ''): Promise<BiliFolder> {
	const current = await session(settingsCookie);
	const payload = await apiGet<FolderInfoPayload>(`${API}/x/v3/fav/folder/info?media_id=${encodeURIComponent(fid)}`, current.cred);
	assertCode(payload, '读取收藏夹');
	return {
		id: payload.data?.id ?? Number(fid),
		title: payload.data?.title ?? '未命名收藏夹',
		owner: payload.data?.upper?.name ?? '',
		count: payload.data?.media_count ?? 0
	};
}

interface FolderListPayload {
	code: number;
	message?: string;
	data?: { list?: Array<{ id?: number; title?: string; media_count?: number }> };
}

/** The signed-in user's own created folders. */
export async function ownFolders(settingsCookie = ''): Promise<BiliFolder[]> {
	const current = await session(settingsCookie);
	const payload = await apiGet<FolderListPayload>(
		`${API}/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(String(current.user.mid))}`,
		current.cred
	);
	assertCode(payload, '读取收藏夹列表');
	return (payload.data?.list ?? [])
		.filter((folder) => typeof folder.id === 'number')
		.map((folder) => ({
			id: folder.id as number,
			title: folder.title ?? '未命名收藏夹',
			owner: current.user.name,
			count: folder.media_count ?? 0
		}));
}

interface ResourcePayload {
	code: number;
	message?: string;
	data?: {
		info?: { id?: number; title?: string; media_count?: number; upper?: { name?: string } };
		medias?: Array<{
			bvid?: string;
			title?: string;
			cover?: string;
			duration?: number;
			attr?: number;
			fav_time?: number;
			upper?: { name?: string };
		}> | null;
		has_more?: boolean;
	};
}

const folderCache = new Map<string, { page: BiliPage; at: number }>();

export async function folderPage(fid: string, pn = 1, settingsCookie = ''): Promise<BiliPage> {
	const key = `${fid}:${pn}`;
	const hit = folderCache.get(key);
	if (hit !== undefined && Date.now() - hit.at < FOLDER_TTL) return hit.page;
	const current = await session(settingsCookie);
	const payload = await apiGet<ResourcePayload>(
		`${API}/x/v3/fav/resource/list?media_id=${encodeURIComponent(fid)}&pn=${pn}&ps=20&platform=web&order=mtime&type=0&tid=0`,
		current.cred
	);
	assertCode(payload, '读取收藏夹内容');
	const medias = payload.data?.medias ?? [];
	const tracks: BiliFavorite[] = medias
		.filter((item) => typeof item.bvid === 'string' && item.bvid !== '')
		.map((item) => ({
			bvid: item.bvid as string,
			title: item.title ?? '未知视频',
			upper: item.upper?.name ?? '',
			cover: item.cover ?? '',
			durationSec: typeof item.duration === 'number' ? item.duration : 0,
			favTime: typeof item.fav_time === 'number' ? item.fav_time : 0,
			attr: typeof item.attr === 'number' ? item.attr : 0
		}));
	const page: BiliPage = {
		folder: {
			id: Number(fid),
			title: payload.data?.info?.title ?? '收藏夹',
			owner: payload.data?.info?.upper?.name ?? '',
			count: payload.data?.info?.media_count ?? tracks.length
		},
		tracks,
		hasMore: payload.data?.has_more === true
	};
	folderCache.set(key, { page, at: Date.now() });
	return page;
}

// ── video → audio ───────────────────────────────────────────────────────────

interface ViewPayload {
	code: number;
	message?: string;
	data?: { bvid?: string; title?: string; duration?: number; cid?: number; owner?: { name?: string }; pic?: string; pages?: Array<{ cid?: number; page?: number; part?: string }> };
}

export interface BiliVideoInfo {
	bvid: string;
	title: string;
	uploader: string;
	cover: string;
	durationMs: number;
	cid: number;
	pages: number;
}

export async function videoInfo(bvid: string, settingsCookie = ''): Promise<BiliVideoInfo> {
	const current = await session(settingsCookie);
	const payload = await apiGet<ViewPayload>(`${API}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, current.cred);
	assertCode(payload, '读取视频信息');
	const cid = payload.data?.cid;
	if (typeof cid !== 'number') throw new BiliError('视频缺少 cid，无法解析音频', 'no-cid', 502);
	return {
		bvid: payload.data?.bvid ?? bvid,
		title: payload.data?.title ?? '未知视频',
		uploader: payload.data?.owner?.name ?? '',
		cover: payload.data?.pic ?? '',
		durationMs: (payload.data?.duration ?? 0) * 1000,
		cid,
		pages: payload.data?.pages?.length ?? 1
	};
}

interface PlayurlPayload {
	code: number;
	message?: string;
	data?: {
		dash?: {
			audio?: Array<{ id?: number; baseUrl?: string; base_url?: string; backupUrl?: string[]; backup_url?: string[]; bandwidth?: number; codecs?: string; mimeType?: string; mime_type?: string }>;
		};
	};
}

export interface ResolvedAudio {
	candidates: string[];
	quality: number;
	mimeType: string;
	expiresAt: number;
}

/** Choose the ~192k AAC track (30280), else the highest-bandwidth AAC track. */
export function pickAudioTrack(
	audio: NonNullable<NonNullable<PlayurlPayload['data']>['dash']>['audio']
): { url: string; backup: string[]; quality: number; mimeType: string } {
	if (!Array.isArray(audio) || audio.length === 0) throw new BiliError('该视频没有可用音轨', 'no-audio', 404);
	const usable = audio.filter((track) => typeof (track.baseUrl ?? track.base_url) === 'string');
	if (usable.length === 0) throw new BiliError('该视频没有可用音轨', 'no-audio', 404);
	const preferred = usable.find((track) => track.id === PREFERRED_AUDIO_ID);
	const chosen = preferred ?? [...usable].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]!;
	const url = (chosen.baseUrl ?? chosen.base_url) as string;
	return {
		url,
		backup: (chosen.backupUrl ?? chosen.backup_url ?? []).filter((item): item is string => typeof item === 'string'),
		quality: chosen.id ?? PREFERRED_AUDIO_ID,
		mimeType: chosen.mimeType ?? chosen.mime_type ?? 'audio/mp4'
	};
}

const resolveCache = new Map<string, { resolved: ResolvedAudio; at: number }>();
const inFlight = new Map<string, Promise<ResolvedAudio>>();

/** Last CDN host that actually served bytes; preferred on later resolutions. */
let preferredHost: string | undefined;

export function rememberWorkingUrl(url: string): void {
	try {
		preferredHost = new URL(url).host;
	} catch {
		/* ignore malformed url */
	}
}

function expiryOf(url: string): number {
	try {
		const value = Number(new URL(url).searchParams.get('expires') ?? new URL(url).searchParams.get('deadline'));
		return Number.isFinite(value) && value > 0 ? value * 1000 : Date.now() + RESOLVE_TTL;
	} catch {
		return Date.now() + RESOLVE_TTL;
	}
}

/** Resolve the playable audio candidates for one video (cached until URL expiry). */
export async function resolveAudio(bvid: string, cid: number, settingsCookie = ''): Promise<ResolvedAudio> {
	const key = `${bvid}:${cid}`;
	const hit = resolveCache.get(key);
	if (hit !== undefined && Date.now() - hit.at < RESOLVE_TTL && hit.resolved.expiresAt > Date.now() + 120_000) {
		return hit.resolved;
	}
	const running = inFlight.get(key);
	if (running !== undefined) return running;

	const task = (async () => {
		const current = await session(settingsCookie);
		const query = wbiSign({ bvid, cid, fnval: 16, fnver: 0, fourk: 1, platform: 'pc' }, current.imgKey, current.subKey);
		const payload = await apiGet<PlayurlPayload>(`${API}/x/player/wbi/playurl?${query}`, current.cred);
		assertCode(payload, '解析音频');
		const track = pickAudioTrack(payload.data?.dash?.audio);
		const expiresAt = Math.min(expiryOf(track.url), Date.now() + RESOLVE_TTL);
		const candidates = [track.url, ...track.backup];
		const hostOf = (candidate: string): string => {
			try {
				return new URL(candidate).host;
			} catch {
				return '';
			}
		};
		// Official upos mirrors are consistently fast; the primary PCDN node can
		// accept connections but trickle data, so prefer mirrors by default.
		candidates.sort((a, b) => {
			const rank = (candidate: string): number => {
				const host = hostOf(candidate);
				if (preferredHost !== undefined && host === preferredHost) return 0;
				if (/-mirror/.test(host) || host.startsWith('upos-')) return 1;
				return 2;
			};
			return rank(a) - rank(b);
		});
		const resolved: ResolvedAudio = {
			candidates,
			quality: track.quality,
			mimeType: track.mimeType,
			expiresAt
		};
		resolveCache.set(key, { resolved, at: Date.now() });
		return resolved;
	})().finally(() => inFlight.delete(key));

	inFlight.set(key, task);
	return task;
}

/** Drop all caches (logout, cookie change). */
export function resetBilibiliCache(): void {
	sessionCache = undefined;
	sessionCheckedAt = 0;
	folderCache.clear();
	resolveCache.clear();
	preferredHost = undefined;
}
