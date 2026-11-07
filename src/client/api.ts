/** Browser-side REST/SSE client for the host half. */
import type { Command, CommandResult, PlayerState, SearchRow, Track } from '../shared/types.js';

const BASE = '/dsh-music-v2';

export interface StatePayload extends PlayerState {
	initialised?: boolean;
}

async function json<T>(response: Response): Promise<T> {
	const body = (await response.json().catch(() => ({}))) as T & { error?: string; detail?: string };
	if (!response.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${response.status}`);
	return body;
}

export async function fetchState(): Promise<StatePayload> {
	return json<StatePayload>(await fetch(`${BASE}/state`, { cache: 'no-store' }));
}

export async function postCommand(command: Command): Promise<CommandResult> {
	return json<CommandResult>(
		await fetch(`${BASE}/command`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(command)
		})
	);
}

export async function searchSongs(query: string): Promise<SearchRow[]> {
	const payload = await json<{ songs: SearchRow[] }>(
		await fetch(`${BASE}/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
	);
	return payload.songs;
}

export async function importPlaylist(id: string, play: boolean): Promise<CommandResult & { playlist?: { name: string; count: number } }> {
	return json<CommandResult & { playlist?: { name: string; count: number } }>(
		await fetch(`${BASE}/import`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, play })
		})
	);
}

// ── Bilibili ────────────────────────────────────────────────────────────────

export interface BiliStatusPayload {
	loggedIn: boolean;
	user?: { name: string; mid: number | string };
	source?: string;
	folder?: string;
}

export interface BiliFolderPayload {
	folder: { id: number; title: string; owner: string; count: number };
	tracks: Track[];
	hasMore: boolean;
}

export async function biliStatus(): Promise<BiliStatusPayload> {
	return json<BiliStatusPayload>(await fetch(`${BASE}/bili/status`, { cache: 'no-store' }));
}

export async function biliFolders(): Promise<Array<{ id: number; title: string; count: number }>> {
	const payload = await json<{ folders: Array<{ id: number; title: string; count: number }> }>(
		await fetch(`${BASE}/bili/folders`, { cache: 'no-store' })
	);
	return payload.folders;
}

export async function biliFolder(ref: string, pn = 1): Promise<BiliFolderPayload> {
	const query = new URLSearchParams({ ...(ref.trim() !== '' ? { ref } : {}), pn: String(pn) });
	return json<BiliFolderPayload>(await fetch(`${BASE}/bili/folder?${query.toString()}`, { cache: 'no-store' }));
}

export async function biliImport(ref: string, play = true): Promise<CommandResult & { folder?: { title: string; count: number; id: string } }> {
	return json<CommandResult & { folder?: { title: string; count: number; id: string } }>(
		await fetch(`${BASE}/bili/import`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ref, play })
		})
	);
}

/** Validate and store a pasted Bilibili cookie; throws with the server message. */
export async function biliLoginCookie(cookie: string): Promise<{ user: { name: string; mid: number | string } }> {
	const response = await fetch(`${BASE}/bili/login/cookie`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ cookie })
	});
	const payload = (await response.json().catch(() => ({}))) as { user?: { name: string; mid: number | string }; detail?: string; error?: string };
	if (!response.ok || payload.user === undefined) throw new Error(payload.detail ?? payload.error ?? `登录失败（HTTP ${response.status}）`);
	return { user: payload.user };
}

/** Persist the favorite folder (URL, id or name) as the default for next time. */
export async function saveBiliFolder(ref: string): Promise<void> {
	await fetch(`${BASE}/config`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ biliFolder: ref })
	});
}

export async function postPosition(trackId: string, positionMs: number): Promise<void> {
	try {
		await fetch(`${BASE}/position`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ trackId, positionMs }),
			keepalive: true
		});
	} catch {
		/* progress reporting is best-effort */
	}
}

/**
 * Subscribe to host state pushes. Falls back to polling when EventSource is
 * unavailable or the connection keeps failing.
 * @returns disposer.
 */
export function subscribeState(onState: (state: StatePayload) => void, onFallback: (polling: boolean) => void): () => void {
	let closed = false;
	let source: EventSource | undefined;
	let timer: number | undefined;
	let failures = 0;

	const poll = (): void => {
		if (closed) return;
		fetchState()
			.then((state) => onState(state))
			.catch(() => {
				/* host restarting */
			});
	};

	const startPolling = (): void => {
		if (timer !== undefined) return;
		onFallback(true);
		poll();
		timer = window.setInterval(poll, 5000);
	};

	const stopPolling = (): void => {
		if (timer === undefined) return;
		window.clearInterval(timer);
		timer = undefined;
		onFallback(false);
	};

	const connect = (): void => {
		if (closed) return;
		try {
			source = new EventSource(`${BASE}/events`);
		} catch {
			startPolling();
			return;
		}
		source.addEventListener('state', (event) => {
			if (closed) return;
			try {
				onState(JSON.parse((event as MessageEvent<string>).data) as StatePayload);
				failures = 0;
				stopPolling();
			} catch {
				/* ignore malformed frame */
			}
		});
		source.addEventListener('error', () => {
			source?.close();
			source = undefined;
			failures += 1;
			if (failures >= 2) startPolling();
			if (closed) return;
			// EventSource retries on its own; only reconnect manually after a close.
			window.setTimeout(() => {
				if (closed || source !== undefined) return;
				connect();
			}, 3000);
		});
	};

	connect();
	// SSE only pushes future changes: take one snapshot up front.
	poll();
	return () => {
		closed = true;
		stopPolling();
		source?.close();
	};
}
