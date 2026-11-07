/** The floating player surface, rendered inside the shell.overlay slot. */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { CommandResult, Mode, PlayerState, SearchRow, Track } from '../shared/types.js';
import { trackUrl } from '../shared/types.js';
import {
	biliFolder,
	biliFolders,
	biliImport,
	biliLoginCookie,
	biliStatus,
	importPlaylist,
	postCommand,
	postPosition,
	saveBiliFolder,
	searchSongs,
	subscribeState
} from './api.js';
import type { BiliFolderPayload, BiliStatusPayload } from './api.js';

const STORE_OPEN = 'dsh-music-v2:open';
const STORE_X = 'dsh-music-v2:x';
const STORE_Y = 'dsh-music-v2:y';
const STORE_BILI_REF = 'dsh-music-v2:bili-ref';

const SOURCE_LABEL: Record<string, string> = { netease: '网易云', bilibili: 'B站', direct: '直链' };

const MODE_LABEL: Record<Mode, string> = { list: '列表循环', single: '单曲循环', shuffle: '随机播放' };
const MODE_NEXT: Record<Mode, Mode> = { list: 'single', single: 'shuffle', shuffle: 'list' };

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
	const total = Math.floor(seconds);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function readPos(): { x: number; y: number } | null {
	try {
		const x = localStorage.getItem(STORE_X);
		const y = localStorage.getItem(STORE_Y);
		if (x === null || y === null) return null;
		const pos = { x: Number(x), y: Number(y) };
		return Number.isFinite(pos.x) && Number.isFinite(pos.y) ? pos : null;
	} catch {
		return null;
	}
}

function savePos(pos: { x: number; y: number }): void {
	try {
		localStorage.setItem(STORE_X, String(Math.round(pos.x)));
		localStorage.setItem(STORE_Y, String(Math.round(pos.y)));
	} catch {
		/* storage may be unavailable */
	}
}

function clampPos(pos: { x: number; y: number }, width: number, height: number): { x: number; y: number } {
	return {
		x: Math.max(8, Math.min(window.innerWidth - width - 8, pos.x)),
		y: Math.max(8, Math.min(window.innerHeight - height - 8, pos.y))
	};
}

interface QueueProps {
	queue: Track[];
	index: number;
	onPlay: (index: number) => void;
	onRemove: (index: number) => void;
	onPlayNext: (index: number) => void;
	onReorder: (from: number, to: number) => void;
}

const QueueList = memo(function QueueList({ queue, index, onPlay, onRemove, onPlayNext, onReorder }: QueueProps) {
	const [dragging, setDragging] = useState<number | null>(null);
	const [over, setOver] = useState<number | null>(null);
	if (queue.length === 0) return <div className="dm2-empty">播放列表为空，搜索或导入歌单吧</div>;
	const drop = (): void => {
		if (dragging !== null && over !== null && dragging !== over) onReorder(dragging, over);
		setDragging(null);
		setOver(null);
	};
	return (
		<>
			{queue.map((track, i) => (
				<div
					key={track.id}
					className={`dm2-item${i === index ? ' dm2-current' : ''}${dragging === i ? ' dm2-dragging' : ''}${over === i && dragging !== null ? ' dm2-drop' : ''}`}
					onClick={() => onPlay(i)}
					title={`${track.title} — ${track.artist}（拖动可排序）`}
					draggable
					onDragStart={(event) => {
						setDragging(i);
						event.dataTransfer.effectAllowed = 'move';
						event.dataTransfer.setData('text/plain', String(i));
					}}
					onDragOver={(event) => {
						event.preventDefault();
						event.dataTransfer.dropEffect = 'move';
						setOver(i);
					}}
					onDragLeave={() => setOver((current) => (current === i ? null : current))}
					onDrop={(event) => {
						event.preventDefault();
						drop();
					}}
					onDragEnd={() => {
						setDragging(null);
						setOver(null);
					}}
				>
					<span className="dm2-grip" title="拖动排序">⋮⋮</span>
					<span className="dm2-item-title">{i === index ? '▶ ' : ''}{track.title}</span>
					<span className="dm2-item-sub">{track.artist}</span>
					<button
						className="dm2-del"
						title="下一首播放"
						onClick={(event) => {
							event.stopPropagation();
							onPlayNext(i);
						}}
					>
						⏭
					</button>
					<button
						className="dm2-del"
						title="从队列移除"
						onClick={(event) => {
							event.stopPropagation();
							onRemove(i);
						}}
					>
						×
					</button>
				</div>
			))}
		</>
	);
});

export function MusicOverlay() {
	const [state, setState] = useState<PlayerState | null>(null);
	const [open, setOpen] = useState(() => localStorage.getItem(STORE_OPEN) === '1');
	const [pos, setPos] = useState<{ x: number; y: number } | null>(readPos);
	const [progress, setProgress] = useState(0);
	const [duration, setDuration] = useState(0);
	const [audioPaused, setAudioPaused] = useState(true);
	const [buffering, setBuffering] = useState(false);
	const [error, setError] = useState('');
	const [tab, setTab] = useState<'queue' | 'search' | 'bili'>('queue');
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SearchRow[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [fallback, setFallback] = useState(false);
	const [confirmClear, setConfirmClear] = useState(false);
	const [bili, setBili] = useState<BiliStatusPayload | null>(null);
	const [biliRef, setBiliRef] = useState(() => localStorage.getItem(STORE_BILI_REF) ?? '');
	const [biliData, setBiliData] = useState<BiliFolderPayload | null>(null);
	const [biliFolderList, setBiliFolderList] = useState<Array<{ id: number; title: string; count: number }>>([]);
	const [biliBusy, setBiliBusy] = useState(false);
	const [biliError, setBiliError] = useState('');
	const [cookieDraft, setCookieDraft] = useState('');
	const biliLoadedRef = useRef(false);

	const audioRef = useRef<HTMLAudioElement | null>(null);
	const loadedRef = useRef('');
	const cardRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
	const stateRef = useRef<PlayerState | null>(null);
	const errorSkipRef = useRef(0);
	const retryRef = useRef(0);
	const blobUrlRef = useRef<string | null>(null);
	const blobAbortRef = useRef<AbortController | null>(null);
	const lastUserRef = useRef(0);
	const volumeTimerRef = useRef<number | undefined>(undefined);
	const fileRef = useRef<HTMLInputElement | null>(null);

	stateRef.current = state;

	// ── state stream ──────────────────────────────────────────────────────
	useEffect(() => {
		let alive = true;
		const dispose = subscribeState(
			(next) => {
				if (!alive) return;
				setState((prev) => (prev !== null && next.rev < prev.rev ? prev : next));
			},
			(polling) => alive && setFallback(polling)
		);
		return () => {
			alive = false;
			dispose();
		};
	}, []);

	// ── audio engine ──────────────────────────────────────────────────────
	useEffect(() => {
		const audio = new Audio();
		audio.preload = 'metadata';
		audioRef.current = audio;
		const onTime = (): void => setProgress(audio.currentTime);
		const onMeta = (): void => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
		const onPlaying = (): void => {
			errorSkipRef.current = 0;
			retryRef.current = 0;
			setAudioPaused(false);
			setError('');
		};
		const onPlay = (): void => setAudioPaused(false);
		const onPause = (): void => setAudioPaused(true);
		const onEnded = (): void => {
			const current = stateRef.current;
			const track = current?.queue[current.index];
			if (track === undefined) return;
			postCommand({ action: 'ended', trackId: track.id })
				.then((result) => {
					setState(result.state);
					if (result.replay === true) {
						audio.currentTime = 0;
						void audio.play();
					}
				})
				.catch(() => setError('播放服务连接失败'));
		};
		const onError = (): void => {
			// Keep the element and its position: a transient stream error used to
			// reset the whole track (progress 0:00) and look like a restart.
			const current = stateRef.current;
			const track = current?.queue[current.index];
			const position = audio.currentTime;
			if (track !== undefined && retryRef.current < 2) {
				retryRef.current += 1;
				setError('播放中断，正在重试…');
				setProgress(position);
				const restore = (): void => {
					try {
						audio.currentTime = position;
					} catch {
						/* metadata not ready yet */
					}
					audio.removeEventListener('loadedmetadata', restore);
				};
				audio.addEventListener('loadedmetadata', restore);
				const base = trackUrl(track);
				audio.src = `${base}${base.includes('?') ? '&' : '?'}retry=${Date.now()}`;
				audio.load();
				void audio.play().catch(() => undefined);
				return;
			}
			setError('播放失败：音源不可达或版权受限，可点播放按钮重试');
		};
		audio.addEventListener('timeupdate', onTime);
		audio.addEventListener('loadedmetadata', onMeta);
		audio.addEventListener('playing', onPlaying);
		audio.addEventListener('play', onPlay);
		audio.addEventListener('pause', onPause);
		audio.addEventListener('ended', onEnded);
		audio.addEventListener('error', onError);
		return () => {
			audio.pause();
			audio.removeEventListener('timeupdate', onTime);
			audio.removeEventListener('loadedmetadata', onMeta);
			audio.removeEventListener('playing', onPlaying);
			audio.removeEventListener('play', onPlay);
			audio.removeEventListener('pause', onPause);
			audio.removeEventListener('ended', onEnded);
			audio.removeEventListener('error', onError);
			blobAbortRef.current?.abort();
			if (blobUrlRef.current !== null) URL.revokeObjectURL(blobUrlRef.current);
			audioRef.current = null;
		};
	}, []);

	// ── state → audio reconciliation ──────────────────────────────────────
	useEffect(() => {
		const audio = audioRef.current;
		if (audio === null) return;
		const track = state?.queue[state.index];
		if (state === null || track === undefined) {
			loadedRef.current = '';
			audio.pause();
			audio.removeAttribute('src');
			return;
		}
		audio.volume = state.volume;
		if (loadedRef.current !== track.id) {
			loadedRef.current = track.id;
			retryRef.current = 0;
			setProgress(state.positionMs / 1000);
			setDuration((track.durationMs ?? 0) / 1000);
			const resumeAt = state.positionMs / 1000;
			const start = (url: string): void => {
				audio.src = url;
				audio.load();
				const onLoaded = (): void => {
					try {
						if (resumeAt > 0.5) audio.currentTime = resumeAt;
					} catch {
						/* metadata not ready */
					}
					audio.removeEventListener('loadedmetadata', onLoaded);
				};
				audio.addEventListener('loadedmetadata', onLoaded);
				if (stateRef.current?.playing === true) {
					void audio.play().catch(() => undefined);
				}
			};

			// Bilibili tracks are small (a few MB): fetch the whole audio into a
			// Blob so seeking is local and playback cannot be truncated by a
			// dropped CDN connection halfway through a song.
			if (blobUrlRef.current !== null) {
				URL.revokeObjectURL(blobUrlRef.current);
				blobUrlRef.current = null;
			}
			blobAbortRef.current?.abort();
			blobAbortRef.current = null;
			const useBlob = track.source === 'bilibili' && (track.durationMs ?? 0) < 20 * 60_000;
			if (useBlob) {
				const controller = new AbortController();
				blobAbortRef.current = controller;
				setBuffering(true);
				const streamUrl = trackUrl(track);
				void fetch(streamUrl, { signal: controller.signal })
					.then((response) => {
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						return response.blob();
					})
					.then((blob) => {
						if (controller.signal.aborted) return;
						const objectUrl = URL.createObjectURL(blob);
						blobUrlRef.current = objectUrl;
						start(objectUrl);
					})
					.catch(() => {
						if (!controller.signal.aborted) start(streamUrl);
					})
					.finally(() => {
						if (!controller.signal.aborted) setBuffering(false);
					});
			} else {
				start(trackUrl(track));
			}
		} else if (state.playing && audio.paused) {
			audio.play().catch((reason: unknown) => {
				const name = reason instanceof DOMException ? reason.name : '';
				setError(name === 'NotAllowedError' ? '浏览器拦截了自动播放，点一下播放按钮' : '播放失败：音频源不可达');
			});
		} else if (!state.playing && !audio.paused) {
			audio.pause();
		}
	}, [state?.rev]);

	// ── progress reporting ────────────────────────────────────────────────
	useEffect(() => {
		const timer = window.setInterval(() => {
			const audio = audioRef.current;
			const current = stateRef.current;
			const track = current?.queue[current.index];
			if (audio === null || current === null || track === undefined || !current.playing) return;
			void postPosition(track.id, Math.round(audio.currentTime * 1000));
		}, 10_000);
		return () => window.clearInterval(timer);
	}, []);

	// ── MediaSession ──────────────────────────────────────────────────────
	useEffect(() => {
		if (!('mediaSession' in navigator)) return;
		const track = state?.queue[state.index];
		if (track === undefined) return;
		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: track.title,
				artist: track.artist,
				album: track.album ?? '',
				artwork: track.cover !== undefined && track.cover !== '' ? [{ src: track.cover }] : []
			});
			navigator.mediaSession.setActionHandler('play', () => void run({ action: 'play' }));
			navigator.mediaSession.setActionHandler('pause', () => void run({ action: 'pause' }));
			navigator.mediaSession.setActionHandler('nexttrack', () => void run({ action: 'next' }));
			navigator.mediaSession.setActionHandler('previoustrack', () => void run({ action: 'prev' }));
		} catch {
			/* older browsers */
		}
	}, [state?.queue[state.index]?.id]);

	const applyResult = useCallback((result: CommandResult) => {
		setState(result.state);
	}, []);

	const run = useCallback(
		async (command: Parameters<typeof postCommand>[0]): Promise<void> => {
			lastUserRef.current = Date.now();
			try {
				applyResult(await postCommand(command));
			} catch {
				setError('播放服务连接失败，稍后重试');
			}
		},
		[applyResult]
	);

	/**
	 * Ask the audio element to play inside the click handler, so the browser
	 * keeps the user gesture (a play() after an awaited POST can be blocked by
	 * the autoplay policy and look like "no playback at all").
	 */
	const playNow = useCallback((): void => {
		const audio = audioRef.current;
		if (audio === null) return;
		void audio
			.play()
			.then(() => setAudioPaused(false))
			.catch((reason: unknown) => {
				const name = reason instanceof DOMException ? reason.name : '';
				setError(name === 'NotAllowedError' ? '浏览器拦截了自动播放，点一下播放按钮' : '播放失败：音源不可达或格式不支持');
			});
	}, []);

	/** Toggle based on what the audio element is actually doing. */
	const togglePlay = useCallback((): void => {
		if (audioPaused) {
			playNow();
			void run({ action: 'play' });
		} else {
			void run({ action: 'pause' });
		}
	}, [audioPaused, playNow, run]);

	// ── drag ──────────────────────────────────────────────────────────────
	const onPointerDown = useCallback((event: ReactPointerEvent): void => {
		if (event.button !== 0) return;
		const rect = cardRef.current?.getBoundingClientRect();
		if (rect === undefined) return;
		dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: rect.left, baseY: rect.top, moved: false };
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}, []);

	const onPointerMove = useCallback((event: ReactPointerEvent): void => {
		const drag = dragRef.current;
		if (drag === null) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
		drag.moved = true;
		const rect = cardRef.current?.getBoundingClientRect();
		const next = clampPos({ x: drag.baseX + dx, y: drag.baseY + dy }, rect?.width ?? 320, rect?.height ?? 120);
		setPos(next);
	}, []);

	const onPointerUp = useCallback((): void => {
		const drag = dragRef.current;
		dragRef.current = null;
		if (drag?.moved === true) {
			setPos((current) => {
				if (current !== null) savePos(current);
				return current;
			});
		}
	}, []);

	const toggleOpen = useCallback((): void => {
		setOpen((prev) => {
			try {
				localStorage.setItem(STORE_OPEN, prev ? '0' : '1');
			} catch {
				/* ignore */
			}
			return !prev;
		});
	}, []);

	// ── seek / volume ─────────────────────────────────────────────────────
	const seekTo = useCallback((ratio: number): void => {
		const audio = audioRef.current;
		if (audio === null || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
		const time = Math.max(0, Math.min(audio.duration, ratio * audio.duration));
		audio.currentTime = time;
		setProgress(time);
		const track = stateRef.current?.queue[stateRef.current.index];
		if (track !== undefined) void postPosition(track.id, Math.round(time * 1000));
	}, []);

	const onVolume = useCallback(
		(value: number): void => {
			const audio = audioRef.current;
			if (audio !== null) audio.volume = value;
			setState((prev) => (prev === null ? prev : { ...prev, volume: value }));
			window.clearTimeout(volumeTimerRef.current);
			volumeTimerRef.current = window.setTimeout(() => void run({ action: 'volume', volume: value }), 180);
		},
		[run]
	);

	// ── library actions ───────────────────────────────────────────────────
	const doSearch = useCallback(async (): Promise<void> => {
		const value = query.trim();
		if (value === '') return;
		setBusy(true);
		setError('');
		try {
			setResults(await searchSongs(value));
		} catch (reason) {
			setResults([]);
			setError(`搜索失败：${reason instanceof Error ? reason.message : String(reason)}`);
		} finally {
			setBusy(false);
		}
	}, [query]);

	const addAndPlay = useCallback(
		async (row: SearchRow): Promise<void> => {
			const track: Track = {
				id: `netease:${row.id}`,
				title: row.title,
				artist: row.artist,
				album: row.album,
				cover: row.cover,
				durationMs: row.durationMs,
				source: 'netease',
				sourceId: row.id
			};
			try {
				const added = await postCommand({ action: 'add', track });
				applyResult(added);
				await run({ action: 'play', index: added.state.queue.findIndex((item) => item.id === track.id) });
			} catch {
				setError('加入播放列表失败');
			}
		},
		[applyResult, run]
	);

	const addLocalFiles = useCallback(
		async (files: FileList | null): Promise<void> => {
			if (files === null || files.length === 0) return;
			for (const file of Array.from(files)) {
				const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
				const track: Track = {
					id: `direct:${stamp}`,
					title: file.name.replace(/\.[a-z0-9]+$/i, ''),
					artist: '本地文件',
					source: 'direct',
					url: URL.createObjectURL(file)
				};
				try {
					applyResult(await postCommand({ action: 'add', track }));
				} catch {
					setError('添加本地文件失败');
					return;
				}
			}
			setTab('queue');
		},
		[applyResult]
	);

	const playNext = useCallback(
		(index: number): void => {
			const current = stateRef.current;
			if (current === null || index === current.index) return;
			// Indexes shift left when the moved track was above the current one.
			const afterRemovalCurrent = current.index - (index < current.index ? 1 : 0);
			const to = Math.min(current.queue.length - 1, afterRemovalCurrent + 1);
			if (to === index) return;
			void run({ action: 'reorder', from: index, to });
		},
		[run]
	);

	const doImport = useCallback(async (): Promise<void> => {
		const value = query.trim();
		if (value === '') return;
		setBusy(true);
		setError('');
		try {
			const result = await importPlaylist(value, true);
			applyResult(result);
			setQuery('');
			setResults(null);
			setTab('queue');
		} catch (reason) {
			setError(`导入失败：${reason instanceof Error ? reason.message : String(reason)}`);
		} finally {
			setBusy(false);
		}
	}, [query, applyResult]);

	// ── Bilibili favorites ────────────────────────────────────────────────
	/**
	 * Accept a URL, a numeric fid, or a folder NAME ("music"). Names are
	 * resolved client-side so the input stays readable; the resolved URL is what
	 * gets saved as the default.
	 */
	const resolveBiliRef = useCallback(async (raw: string): Promise<string> => {
		const value = raw.trim();
		if (value === '' || /^https?:\/\//i.test(value) || /^\d+$/.test(value)) return value;
		const folders = await biliFolders();
		const needle = value.toLowerCase();
		const hit =
			folders.find((folder) => folder.title.toLowerCase() === needle) ??
			folders.find((folder) => folder.title.toLowerCase().includes(needle));
		if (hit === undefined) {
			throw new Error(`找不到收藏夹「${value}」，可用：${folders.map((folder) => folder.title).join('、') || '（无）'}`);
		}
		return `https://space.bilibili.com/0/favlist?fid=${hit.id}`;
	}, []);

	const loadBili = useCallback(
		async (ref: string): Promise<void> => {
			setBiliBusy(true);
			setBiliError('');
			try {
				const target = await resolveBiliRef(ref);
				const data = await biliFolder(target, 1);
				setBiliData(data);
				if (ref.trim() !== '') {
					setBiliRef(ref);
					localStorage.setItem(STORE_BILI_REF, ref);
					// Save the resolved URL so a stale host can still load it next boot.
					void saveBiliFolder(target).catch(() => undefined);
				}
			} catch (reason) {
				setBiliData(null);
				setBiliError(reason instanceof Error ? reason.message : String(reason));
			} finally {
				setBiliBusy(false);
			}
		},
		[resolveBiliRef]
	);

	const refreshBili = useCallback(async (): Promise<void> => {
		setBiliBusy(true);
		setBiliError('');
		try {
			const current = await biliStatus();
			setBili(current);
			if (current.loggedIn) {
				const ref = biliRef.trim() !== '' ? biliRef : (current.folder ?? '');
				if (ref.trim() !== '') await loadBili(ref);
				else {
					try {
						setBiliFolderList(await biliFolders());
					} catch {
						/* folder list is optional */
					}
				}
			}
		} catch (reason) {
			setBili({ loggedIn: false });
			setBiliError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBiliBusy(false);
		}
	}, [biliRef, loadBili]);

	const saveCookie = useCallback(async (): Promise<void> => {
		const value = cookieDraft.trim();
		if (value === '') return;
		setBiliBusy(true);
		try {
			await biliLoginCookie(value);
			setCookieDraft('');
			await refreshBili();
		} catch (reason) {
			setBiliError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBiliBusy(false);
		}
	}, [cookieDraft, refreshBili]);

	const playBiliAll = useCallback(async (): Promise<void> => {
		const ref = biliRef.trim();
		if (ref === '') {
			setBiliError('先粘贴收藏夹链接或 id');
			return;
		}
		setBiliBusy(true);
		setBiliError('');
		try {
			applyResult(await biliImport(ref, true));
		} catch (reason) {
			setBiliError(`载入失败：${reason instanceof Error ? reason.message : String(reason)}`);
		} finally {
			setBiliBusy(false);
		}
	}, [biliRef, applyResult]);

	const playBiliTrack = useCallback(
		async (item: Track): Promise<void> => {
			const ref = biliRef.trim();
			if (ref === '') return;
			setBiliBusy(true);
			try {
				const imported = await biliImport(ref, false);
				applyResult(imported);
				const index = imported.state.queue.findIndex((entry) => entry.id === item.id);
				if (index >= 0) await run({ action: 'play', index });
			} catch (reason) {
				setBiliError(`播放失败：${reason instanceof Error ? reason.message : String(reason)}`);
			} finally {
				setBiliBusy(false);
			}
		},
		[biliRef, applyResult, run]
	);

	const addBiliTrack = useCallback(
		async (item: Track, next: boolean): Promise<void> => {
			try {
				applyResult(await postCommand({ action: 'add', track: item, ...(next ? { next: true } : {}) }));
			} catch (reason) {
				setBiliError(`加入队列失败：${reason instanceof Error ? reason.message : String(reason)}`);
			}
		},
		[applyResult]
	);

	useEffect(() => {
		if (tab !== 'bili' || biliLoadedRef.current) return;
		biliLoadedRef.current = true;
		void refreshBili();
	}, [tab, refreshBili]);

	const track = state?.queue[state.index] ?? null;
	const queue = state?.queue ?? [];
	const volume = state?.volume ?? 0.8;
	const ratio = duration > 0 ? Math.min(1, progress / duration) : 0;

	const cardStyle = useMemo<CSSProperties>(
		() => (pos !== null ? { left: pos.x, top: pos.y } : { right: 24, bottom: 92 }),
		[pos]
	);

	return (
		<div className="dm2-root" style={cardStyle}>
			<div className={`dm2-card${open ? '' : ' dm2-mini'}`} ref={cardRef} tabIndex={-1}>
				<div
					className="dm2-header"
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onDoubleClick={toggleOpen}
					title="拖动移动；双击展开/收起"
				>
					<div className="dm2-cover">
						{track?.cover !== undefined && track.cover !== '' ? <img src={track.cover} alt="" draggable={false} /> : '♪'}
					</div>
					<div className="dm2-meta">
						<div className="dm2-title">{track?.title ?? '未在播放'}</div>
						<div className="dm2-artist">
							{track
								? `${track.artist}${track.source !== undefined ? ` · ${SOURCE_LABEL[track.source] ?? track.source}` : ''}${buffering ? ' · 缓冲中…' : ''}`
								: '点开搜索一首歌'}
						</div>
					</div>
					<button
						className="dm2-icon"
						title={audioPaused ? '播放' : '暂停'}
						onClick={(event) => {
							event.stopPropagation();
							togglePlay();
						}}
						onPointerDown={(event) => event.stopPropagation()}
					>
						{state?.playing === true ? '❚❚' : '▶'}
					</button>
					<button
						className="dm2-icon"
						title={open ? '收起' : '展开'}
						onClick={(event) => {
							event.stopPropagation();
							toggleOpen();
						}}
						onPointerDown={(event) => event.stopPropagation()}
					>
						{open ? '▾' : '▴'}
					</button>
				</div>

				{open && (
					<div className="dm2-body">
						<div className="dm2-row" style={{ marginTop: 2 }}>
							<span className="dm2-time">{formatTime(progress)}</span>
							<div
								className="dm2-progress"
								title="点击或拖动调整进度"
								onPointerDown={(event) => {
									const rect = event.currentTarget.getBoundingClientRect();
									const seek = (clientX: number): void => seekTo(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
									seek(event.clientX);
									const move = (moveEvent: PointerEvent): void => seek(moveEvent.clientX);
									const up = (): void => {
										window.removeEventListener('pointermove', move);
										window.removeEventListener('pointerup', up);
									};
									window.addEventListener('pointermove', move);
									window.addEventListener('pointerup', up);
								}}
							>
								<div className="dm2-fill" style={{ width: `${ratio * 100}%` }} />
							</div>
							<span className="dm2-time">{formatTime(duration)}</span>
						</div>

						<div className="dm2-controls">
							<button className="dm2-icon" title="上一首" onClick={() => void run({ action: 'prev' })}>⏮</button>
							<button className="dm2-icon dm2-play" title={audioPaused ? '播放' : '暂停'} onClick={togglePlay}>
								{audioPaused ? '▶' : '❚❚'}
							</button>
							<button className="dm2-icon" title="下一首" onClick={() => void run({ action: 'next' })}>⏭</button>
							<button
								className="dm2-icon"
								title={`模式：${MODE_LABEL[state?.mode ?? 'list']}（点击切换）`}
								onClick={() => void run({ action: 'mode', mode: MODE_NEXT[state?.mode ?? 'list'] })}
							>
								{state?.mode === 'shuffle' ? '🔀' : state?.mode === 'single' ? '🔁¹' : '🔁'}
							</button>
						</div>

						<div className="dm2-row" style={{ marginTop: 8 }}>
							<span className="dm2-icon" style={{ cursor: 'default' }}>🔈</span>
							<input
								className="dm2-slider"
								type="range"
								min={0}
								max={1}
								step={0.02}
								value={volume}
								onChange={(event) => onVolume(Number(event.target.value))}
								title="音量"
							/>
							<span className="dm2-tag">{MODE_LABEL[state?.mode ?? 'list']}</span>
						</div>

						<div className="dm2-row" style={{ marginTop: 10, gap: 6 }}>
							<button
								className="dm2-icon"
								style={{ width: 'auto', padding: '0 8px', fontSize: 11 }}
								onClick={() => setTab('queue')}
							>
								队列 {queue.length}
							</button>
							<button
								className="dm2-icon"
								style={{ width: 'auto', padding: '0 8px', fontSize: 11 }}
								onClick={() => setTab('search')}
							>
								搜索 / 歌单
							</button>
							<button
								className="dm2-icon"
								style={{ width: 'auto', padding: '0 8px', fontSize: 11 }}
								onClick={() => setTab('bili')}
							>
								B 站
							</button>
							{fallback && <span className="dm2-tag" title="SSE 不可用，已降级轮询">轮询</span>}
						</div>

						{tab === 'queue' ? (
							<div>
								<div className="dm2-row dm2-queue-head">
									<span className="dm2-tag">共 {queue.length} 首</span>
									<button
										className="dm2-del"
										title="清空播放队列"
										onClick={() => {
											if (!confirmClear) {
												setConfirmClear(true);
												window.setTimeout(() => setConfirmClear(false), 3000);
												return;
											}
											setConfirmClear(false);
											void run({ action: 'clear' });
										}}
									>
										{confirmClear ? '确认清空？' : '清空'}
									</button>
								</div>
								<div className="dm2-list">
									<QueueList
										queue={queue}
										index={state?.index ?? 0}
										onPlay={(index) => void run({ action: 'play', index })}
										onRemove={(index) => void run({ action: 'remove', index })}
										onPlayNext={playNext}
										onReorder={(from, to) => void run({ action: 'reorder', from, to })}
									/>
								</div>
							</div>
						) : tab === 'search' ? (
							<div>
								<div className="dm2-search">
									<input
										className="dm2-input"
										placeholder="歌名/歌手，或歌单 id/链接"
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										onKeyDown={(event) => {
											if (event.key !== 'Enter') return;
											if (/^\d+$|music\.163\.com/.test(query.trim())) void doImport();
											else void doSearch();
										}}
									/>
									<button className="dm2-icon" title="搜索" disabled={busy} onClick={() => void doSearch()}>🔍</button>
									<button className="dm2-icon" title="导入歌单" disabled={busy} onClick={() => void doImport()}>＋</button>
									<button className="dm2-icon" title="播放本地文件" onClick={() => fileRef.current?.click()}>📁</button>
								</div>
								<input
									ref={fileRef}
									type="file"
									accept="audio/*"
									multiple
									style={{ display: 'none' }}
									onChange={(event) => {
										void addLocalFiles(event.target.files);
										event.target.value = '';
									}}
								/>
								<div className="dm2-list">
									{busy ? (
										<div className="dm2-empty">处理中…</div>
									) : results === null ? (
										<div className="dm2-empty">输入关键词搜索，或粘贴网易云歌单链接导入</div>
									) : results.length === 0 ? (
										<div className="dm2-empty">没有结果</div>
									) : (
										results.map((row) => (
											<div key={row.id} className="dm2-item" onClick={() => void addAndPlay(row)} title="加入并播放">
												<span className="dm2-item-title">{row.title}</span>
												<span className="dm2-item-sub">{row.artist}</span>
											</div>
										))
									)}
								</div>
							</div>
						) : (
							<div>
								<div className="dm2-row" style={{ marginTop: 8, gap: 6 }}>
									<span className="dm2-tag" title={bili?.source !== undefined ? `登录态来源：${bili.source}` : ''}>
										{bili?.loggedIn === true ? `B站：${bili.user?.name ?? '已登录'}` : 'B站未登录'}
									</span>
									<button className="dm2-del" title="刷新 B 站状态" onClick={() => void refreshBili()}>
										刷新
									</button>
									{biliBusy && <span className="dm2-tag">载入中…</span>}
								</div>

								{bili?.loggedIn !== true ? (
									<div>
										<div className="dm2-note">自动复用本机 bili CLI / bili-whale 的登录态；也可以直接粘贴 Cookie 登录。</div>
										<div className="dm2-search">
											<input
												className="dm2-input"
												placeholder="SESSDATA 的值或整段 Cookie"
												value={cookieDraft}
												onChange={(event) => setCookieDraft(event.target.value)}
												onKeyDown={(event) => {
													if (event.key === 'Enter') void saveCookie();
												}}
											/>
											<button className="dm2-icon" title="校验并保存 Cookie" onClick={() => void saveCookie()}>
												登录
											</button>
										</div>
										<div className="dm2-note">
											获取：浏览器登录 bilibili.com → F12 → Application → Cookies → https://www.bilibili.com → 复制 SESSDATA 的值（HttpOnly，document.cookie 取不到）。
										</div>
									</div>
								) : (
									<div>
										<div className="dm2-search">
											<input
												className="dm2-input"
												placeholder="收藏夹链接 / id / 名称（如 music）"
												value={biliRef}
												onChange={(event) => setBiliRef(event.target.value)}
												onKeyDown={(event) => {
													if (event.key === 'Enter') void loadBili(biliRef);
												}}
											/>
											<button className="dm2-icon" title="载入收藏夹" onClick={() => void loadBili(biliRef)}>
												↻
											</button>
											<button className="dm2-icon" title="播放全部（替换队列）" onClick={() => void playBiliAll()}>
												▶
											</button>
										</div>
										{biliData === null && biliFolderList.length > 0 && (
											<div className="dm2-bili-folders">
												{biliFolderList.map((folder) => (
													<button
														key={folder.id}
														className="dm2-tag dm2-bili-chip"
														title={`${folder.title}（${folder.count}）`}
														onClick={() => {
															const ref = `https://space.bilibili.com/${bili?.user?.mid ?? ''}/favlist?fid=${folder.id}`;
															setBiliRef(ref);
															void loadBili(ref);
														}}
													>
														{folder.title} {folder.count}
													</button>
												))}
											</div>
										)}
										{biliData !== null ? (
											<>
												<div className="dm2-row dm2-queue-head">
													<span className="dm2-tag">
														{biliData.folder.title} · {biliData.folder.count} 首
													</span>
												</div>
												<div className="dm2-list">
													{biliData.tracks.map((item) => (
														<div
															key={item.id}
															className="dm2-item dm2-bili-row"
															title="点击播放（替换队列）"
															onClick={() => void playBiliTrack(item)}
														>
															{typeof item.cover === 'string' && item.cover !== '' && (
																<img className="dm2-bili-cover" src={item.cover} alt="" loading="lazy" />
															)}
															<span className="dm2-item-title">{item.title}</span>
															<span className="dm2-item-sub">{item.artist}</span>
															<button
																className="dm2-del"
																title="加入队列"
																onClick={(event) => {
																	event.stopPropagation();
																	void addBiliTrack(item, false);
																}}
															>
																＋
															</button>
															<button
																className="dm2-del"
																title="下一首播放"
																onClick={(event) => {
																	event.stopPropagation();
																	void addBiliTrack(item, true);
																}}
															>
																⏭
															</button>
														</div>
													))}
												</div>
											</>
										) : (
											<div className="dm2-empty">{biliBusy ? '读取收藏夹…' : '粘贴收藏夹链接后点 ↻，或点上面的收藏夹'}</div>
										)}
									</div>
								)}

								{biliError !== '' && (
									<div className="dm2-error" onClick={() => setBiliError('')} title="点击关闭">
										{biliError}
									</div>
								)}
							</div>
						)}

						{error !== '' && (
							<div className="dm2-error" onClick={() => setError('')} title="点击关闭">
								{error}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
