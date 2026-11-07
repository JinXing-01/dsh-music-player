/** Pure playback state machine. No I/O, no timers: easy to test and replay. */
import type { Command, CommandResult, Mode, PlayerState, Track } from '../shared/types.js';

/** Recently played track ids (shuffle "prev"), capped. */
const RECENT_LIMIT = 100;

export interface InternalState extends PlayerState {
	recent: string[];
}

export function createState(partial: Partial<PlayerState> = {}): InternalState {
	return {
		rev: 1,
		queue: [],
		index: 0,
		playing: false,
		volume: 0.8,
		mode: 'list',
		positionMs: 0,
		updatedAt: Date.now(),
		...partial,
		recent: []
	};
}

const clamp01 = (value: unknown): number => Math.min(1, Math.max(0, Number(value) || 0));

const clampIndex = (state: PlayerState): number => {
	const len = state.queue.length;
	if (len === 0) return 0;
	return Math.min(len - 1, Math.max(0, state.index));
};

function pushRecent(state: InternalState): void {
	const current = state.queue[state.index];
	if (current === undefined) return;
	state.recent = [...state.recent.filter((id) => id !== current.id), current.id].slice(-RECENT_LIMIT);
}

function nextIndex(state: InternalState, step: 1 | -1): number {
	const len = state.queue.length;
	if (len <= 1) return 0;
	if (state.mode !== 'shuffle') return (state.index + step + len) % len;
	if (step === -1) {
		for (let i = state.recent.length - 1; i >= 0; i -= 1) {
			const id = state.recent[i]!;
			if (id === state.queue[state.index]?.id) continue;
			const found = state.queue.findIndex((track) => track.id === id);
			if (found >= 0) return found;
		}
		return (state.index - 1 + len) % len;
	}
	let next = state.index;
	while (next === state.index) next = Math.floor(Math.random() * len);
	return next;
}

/** Advance to a queue position, resetting the reported position. */
function select(state: InternalState, index: number): void {
	const len = state.queue.length;
	if (len === 0) {
		state.index = 0;
		state.positionMs = 0;
		return;
	}
	if (index !== state.index) pushRecent(state);
	state.index = Math.min(len - 1, Math.max(0, index));
	state.positionMs = 0;
}

/**
 * Apply one command. Returns a new state object plus a human-readable result;
 * the input state is never mutated.
 */
export function reduce(input: InternalState, command: Command, now = Date.now()): { state: InternalState; result: CommandResult } {
	const state: InternalState = { ...input, queue: [...input.queue], recent: [...input.recent] };
	const reply = (ok: boolean, message: string, replay = false): { state: InternalState; result: CommandResult } => {
		state.rev = input.rev + 1;
		state.updatedAt = now;
		state.index = clampIndex(state);
		return { state, result: { ok, message, state: publicStateOf(state), ...(replay ? { replay: true } : {}) } };
	};

	switch (command.action) {
		case 'play': {
			if (typeof command.index === 'number' && Number.isInteger(command.index)) select(state, command.index);
			if (state.queue.length === 0) {
				state.playing = false;
				return reply(false, '播放列表为空');
			}
			state.playing = true;
			const current = state.queue[state.index]!;
			return reply(true, `正在播放「${current.title} — ${current.artist}」`);
		}
		case 'pause': {
			state.playing = false;
			return reply(true, '已暂停');
		}
		case 'toggle': {
			state.playing = !state.playing && state.queue.length > 0;
			return reply(true, state.playing ? '继续播放' : '已暂停');
		}
		case 'next': {
			if (state.queue.length === 0) return reply(false, '播放列表为空');
			select(state, nextIndex(state, 1));
			state.playing = true;
			const current = state.queue[state.index]!;
			return reply(true, `下一首「${current.title} — ${current.artist}」`);
		}
		case 'prev': {
			if (state.queue.length === 0) return reply(false, '播放列表为空');
			select(state, nextIndex(state, -1));
			state.playing = true;
			const current = state.queue[state.index]!;
			return reply(true, `上一首「${current.title} — ${current.artist}」`);
		}
		case 'ended': {
			const current = state.queue[state.index];
			// Late/duplicate ended events for another track are ignored: the
			// client may report an end that raced with a user skip.
			if (current !== undefined && typeof command.trackId === 'string' && command.trackId !== '' && command.trackId !== current.id) {
				return reply(true, '忽略过期的播放结束事件');
			}
			if (current === undefined) {
				state.playing = false;
				return reply(false, '播放列表为空');
			}
			if (state.mode === 'single') {
				state.positionMs = 0;
				state.playing = true;
				return reply(true, `单曲循环「${current.title}」`, true);
			}
			select(state, nextIndex(state, 1));
			state.playing = true;
			const next = state.queue[state.index]!;
			return reply(true, `播放结束，切到「${next.title} — ${next.artist}」`);
		}
		case 'volume': {
			state.volume = clamp01(command.volume);
			return reply(true, `音量 ${Math.round(state.volume * 100)}%`);
		}
		case 'mode': {
			if (!['list', 'single', 'shuffle'].includes(command.mode)) return reply(false, '未知播放模式');
			state.mode = command.mode as Mode;
			return reply(true, `播放模式：${state.mode}`);
		}
		case 'seek': {
			const position = Number(command.positionMs);
			state.positionMs = Number.isFinite(position) ? Math.max(0, position) : state.positionMs;
			return reply(true, 'ok');
		}
		case 'add': {
			const track = command.track;
			if (track === undefined || track.title === '') return reply(false, '缺少歌曲信息');
			const at = command.next === true && state.queue.length > 0 ? state.index + 1 : state.queue.length;
			state.queue.splice(at, 0, track);
			if (state.queue.length === 1) state.index = 0;
			return reply(true, `已加入「${track.title}」`);
		}
		case 'remove': {
			const index = Number(command.index);
			if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return reply(false, '索引无效');
			const [removed] = state.queue.splice(index, 1);
			if (state.index > index) state.index -= 1;
			else if (state.index === index) {
				state.positionMs = 0;
				state.index = Math.min(index, state.queue.length - 1);
			}
			if (state.queue.length === 0) state.playing = false;
			return reply(true, `已移除「${removed?.title ?? ''}」`);
		}
		case 'reorder': {
			const from = Number(command.from);
			const to = Number(command.to);
			if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= state.queue.length || to < 0 || to >= state.queue.length) {
				return reply(false, '索引无效');
			}
			const currentId = state.queue[state.index]?.id;
			const [moved] = state.queue.splice(from, 1);
			state.queue.splice(to, 0, moved!);
			const nextIndex = state.queue.findIndex((track) => track.id === currentId);
			if (nextIndex >= 0) state.index = nextIndex;
			return reply(true, '已调整队列顺序');
		}
		case 'clear': {
			state.queue = [];
			state.index = 0;
			state.positionMs = 0;
			state.playing = false;
			state.recent = [];
			return reply(true, '已清空播放列表');
		}
		case 'replaceQueue': {
			state.queue = [...command.tracks];
			state.index = Number.isInteger(command.startAt) ? Math.max(0, Math.min(state.queue.length - 1, command.startAt as number)) : 0;
			state.positionMs = 0;
			state.playing = command.play === true && state.queue.length > 0;
			state.recent = [];
			return reply(true, `队列已更新（${state.queue.length} 首）`);
		}
		default:
			return reply(false, `未知操作：${String((command as { action?: string }).action)}`);
	}
}

export function publicStateOf(state: PlayerState): PlayerState {
	return {
		rev: state.rev,
		queue: state.queue,
		index: state.index,
		playing: state.playing,
		volume: state.volume,
		mode: state.mode,
		positionMs: state.positionMs,
		updatedAt: state.updatedAt
	};
}

/** Find a track by title/artist substring (case-insensitive). */
export function findTrack(state: PlayerState, query: string): Track | undefined {
	const needle = query.trim().toLowerCase();
	if (needle === '') return undefined;
	return (
		state.queue.find((track) => track.title.toLowerCase().includes(needle)) ??
		state.queue.find((track) => track.artist.toLowerCase().includes(needle))
	);
}
