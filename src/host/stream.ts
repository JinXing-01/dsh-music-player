/** Media stream proxy: Range passthrough, redirects, content-type validation, candidate fallback. */
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 3;
const CONNECT_TIMEOUT_MS = 8_000;

const AUDIO_TYPE = /^(audio\/|application\/octet-stream)/i;
const AUDIO_OR_MP4 = /^(audio\/|video\/mp4|application\/(octet-stream|mp4))/i;

export interface ProxyOptions {
	referer?: string;
	/** Accept `video/mp4` too (Bilibili serves audio-only DASH segments as video/mp4). */
	allowMp4?: boolean;
	/** Extra headers (e.g. a source cookie) forwarded upstream. */
	headers?: Record<string, string>;
	/** Called once a candidate produced a valid media response. */
	onSuccess?: (url: string) => void;
	/** When false, a total failure returns false without writing a 502 (caller retries). */
	sendError?: boolean;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
	try {
		res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
		res.end(JSON.stringify(body));
	} catch {
		/* response already gone */
	}
}

interface Upstream {
	res: IncomingMessage;
	abort: () => void;
}

function openStream(url: string, range: string | undefined, options: ProxyOptions, redirects = 0): Promise<Upstream> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = {
			'user-agent': UA,
			referer: options.referer ?? 'https://music.163.com/',
			...(options.headers ?? {})
		};
		if (range !== undefined && range !== '') headers.range = range;
		const mode = url.startsWith('https:') ? httpsRequest : httpRequest;
		const req = mode(url, { method: 'GET', headers }, (res) => {
			// Headers arrived: clear the connect budget. Do NOT re-arm an idle
			// timeout here: while the browser has enough buffered audio it stops
			// reading, the upstream socket goes idle, and an inactivity timeout
			// would truncate the stream mid-song.
			req.setTimeout(0);
			const status = res.statusCode ?? 0;
			const location = res.headers.location;
			if (status >= 300 && status < 400 && typeof location === 'string' && redirects < MAX_REDIRECTS) {
				res.resume();
				let next: string;
				try {
					next = new URL(location, url).href;
				} catch {
					reject(new Error('上游重定向地址无效'));
					return;
				}
				resolve(openStream(next, range, options, redirects + 1));
				return;
			}
			resolve({ res, abort: () => req.destroy(new Error('client aborted')) });
		});
		// Short budget for connect + response headers, so an unreachable CDN host
		// (Bilibili's PCDN nodes) falls through to the mirror quickly.
		req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(new Error('upstream connect timeout')));
		req.on('error', reject);
		req.end();
	});
}

/**
 * Proxy the first playable candidate URL into the browser response.
 * Candidates are tried in order (Bilibili's primary PCDN host is often
 * unreachable while its upos mirrors work). A bad status or non-media
 * content-type falls through to the next candidate instead of failing the
 * whole request.
 */
export async function proxyMedia(
	urls: string[],
	req: IncomingMessage,
	res: ServerResponse,
	options: ProxyOptions = {}
): Promise<boolean> {
	const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
	const allowed = options.allowMp4 === true ? AUDIO_OR_MP4 : AUDIO_TYPE;
	let lastFailure = '没有候选地址';

	for (const url of urls) {
		let upstream: Upstream;
		try {
			upstream = await openStream(url, range, options);
		} catch (error) {
			lastFailure = error instanceof Error ? error.message : String(error);
			continue;
		}
		const head = upstream.res;
		const status = head.statusCode ?? 0;
		const contentType = String(head.headers['content-type'] ?? '');
		if (status !== 200 && status !== 206) {
			head.resume();
			upstream.abort();
			lastFailure = `上游返回 ${status}`;
			continue;
		}
		if (!allowed.test(contentType)) {
			head.resume();
			upstream.abort();
			lastFailure = `上游返回的不是媒体（${contentType || '无 content-type'}）`;
			continue;
		}

		const headers: Record<string, string> = {
			'content-type': contentType,
			'accept-ranges': String(head.headers['accept-ranges'] ?? 'bytes'),
			'cache-control': 'no-store'
		};
		for (const name of ['content-length', 'content-range', 'etag', 'last-modified'] as const) {
			const value = head.headers[name];
			if (typeof value === 'string') headers[name] = value;
		}
		res.writeHead(status, headers);
		options.onSuccess?.(url);

		res.on('close', () => upstream.abort());
		head.on('error', () => upstream.abort());
		if (req.method === 'HEAD') {
			head.resume();
			res.end();
			return true;
		}
		head.pipe(res);
		return true;
	}

	if (options.sendError === false) return false;
	sendJson(res, 502, { error: 'stream-unavailable', detail: lastFailure });
	return false;
}

/** NetEase audio: single URL, audio types only. */
export async function proxyAudio(audioUrl: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
	await proxyMedia([audioUrl], req, res, { referer: 'https://music.163.com/' });
}
