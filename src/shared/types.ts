/** Shared data shapes for the host and browser halves. */

export type Mode = 'list' | 'single' | 'shuffle';
export type TrackSource = 'netease' | 'direct' | 'bilibili';

export interface Track {
	/** Stable id: `netease:<songId>` or `direct:<hash>`. */
	id: string;
	title: string;
	artist: string;
	album?: string;
	cover?: string;
	durationMs?: number;
	source: TrackSource;
	/** NetEase song id, for `source === 'netease'`. */
	sourceId?: string;
	/** Direct audio URL, for `source === 'direct'`. */
	url?: string;
	/** Bilibili video id, for `source === 'bilibili'`. */
	bvid?: string;
	/** Bilibili page cid; resolved lazily when absent. */
	cid?: number;
}

export interface PlayerState {
	/** Monotonic revision; every mutation increments it. */
	rev: number;
	queue: Track[];
	index: number;
	playing: boolean;
	volume: number;
	mode: Mode;
	/** Last reported playback position of queue[index], in ms. */
	positionMs: number;
	updatedAt: number;
}

export interface CommandResult {
	ok: boolean;
	message: string;
	/** Set when the client must restart the current track (single-track repeat). */
	replay?: boolean;
	state: PlayerState;
}

export interface SearchRow {
	id: string;
	title: string;
	artist: string;
	album: string;
	cover: string;
	durationMs: number;
}

export interface PlaylistRow {
	name: string;
	tracks: SearchRow[];
}

export type Command =
	| { action: 'play'; index?: number }
	| { action: 'pause' }
	| { action: 'toggle' }
	| { action: 'next' }
	| { action: 'prev' }
	| { action: 'ended'; trackId?: string }
	| { action: 'volume'; volume: number }
	| { action: 'mode'; mode: Mode }
	| { action: 'seek'; positionMs: number }
	| { action: 'add'; track: Track; next?: boolean }
	| { action: 'remove'; index: number }
	| { action: 'reorder'; from: number; to: number }
	| { action: 'clear' }
	| { action: 'replaceQueue'; tracks: Track[]; play?: boolean; startAt?: number };

export const MODES: Mode[] = ['list', 'single', 'shuffle'];

export function trackUrl(track: Track): string {
	if (track.source === 'netease') {
		return `/dsh-music-v2/stream?source=netease&id=${encodeURIComponent(track.sourceId ?? '')}`;
	}
	if (track.source === 'bilibili') {
		const cid = track.cid !== undefined ? `&cid=${track.cid}` : '';
		return `/dsh-music-v2/stream?source=bilibili&bvid=${encodeURIComponent(track.bvid ?? '')}${cid}`;
	}
	return track.url ?? '';
}
