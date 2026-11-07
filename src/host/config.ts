/** Plugin configuration: DSH settings namespace first, an editable JSON document as fallback. */
import z from '@deepseek-ai/schemastery';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface MusicConfig {
	/** NetEase logged-in cookie (MUSIC_U=…); empty means anonymous. */
	neteaseCookie: string;
	/** Playlist id/link loaded as the initial queue when the queue is empty. */
	defaultPlaylist: string;
	/** Requested bitrate: 128000 / 192000 / 320000 / 999000. */
	br: number;
	/** Initial volume for a fresh install. */
	volume: number;
	/** Optional Bilibili cookie override (SESSDATA=…); empty means reuse bili CLI / bili-whale. */
	biliCookie: string;
	/** Last opened Bilibili favorite folder (URL or fid). */
	biliFolder: string;
}

const DSH_HOME = process.env.DSH_HOME ?? path.join(homedir(), '.dsh');
const DIR = path.join(DSH_HOME, 'storages', 'dsh-music-v2');
const FILE = path.join(DIR, 'config.json');

export const SETTINGS_NS = 'dsh-music';

/** Composition-layer defaults: environment variables still seed a fresh profile. */
export const DEFAULT_CONFIG: MusicConfig = {
	neteaseCookie: process.env.DSH_MUSIC_COOKIE ?? '',
	defaultPlaylist: process.env.DSH_MUSIC_PLAYLIST ?? '',
	br: 320000,
	volume: 0.8,
	biliCookie: process.env.DSH_BILI_COOKIE ?? '',
	biliFolder: process.env.DSH_BILI_FOLDER ?? ''
};

/** Declared settings surface (rendered by the DSH settings UI, secret-redacted). */
export const settingsSchema = z.object({
	neteaseCookie: z
		.string()
		.role('secret')
		.description('网易云登录 Cookie（含 MUSIC_U=）；配置后有权益的 VIP 曲可播放全曲')
		.default(''),
	defaultPlaylist: z.string().description('默认歌单 id 或分享链接（队列为空时自动加载）').default(''),
	br: z.number().description('请求码率：128000 / 192000 / 320000 / 999000').default(320000),
	volume: z.number().description('初始音量 0-1').default(0.8),
	biliCookie: z
		.string()
		.role('secret')
		.description('B 站 Cookie（SESSDATA=…）；留空则自动复用 bili CLI / bili-whale 的登录态')
		.default(''),
	biliFolder: z.string().description('B 站收藏夹链接或 id（B 站 tab 默认打开）').default('')
});

export function toConfig(value: {
	neteaseCookie?: unknown;
	defaultPlaylist?: unknown;
	br?: unknown;
	volume?: unknown;
	biliCookie?: unknown;
	biliFolder?: unknown;
}): MusicConfig {
	return {
		neteaseCookie: typeof value.neteaseCookie === 'string' ? value.neteaseCookie : '',
		defaultPlaylist: typeof value.defaultPlaylist === 'string' ? value.defaultPlaylist : '',
		br: typeof value.br === 'number' && value.br > 0 ? value.br : 320000,
		volume: typeof value.volume === 'number' ? Math.min(1, Math.max(0, value.volume)) : 0.8,
		biliCookie: typeof value.biliCookie === 'string' ? value.biliCookie : '',
		biliFolder: typeof value.biliFolder === 'string' ? value.biliFolder : ''
	};
}

export async function loadConfig(): Promise<MusicConfig> {
	try {
		const raw = await readFile(FILE, 'utf8');
		const parsed = JSON.parse(raw) as Partial<MusicConfig>;
		return toConfig(parsed);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

/** Persist a patch of whitelisted fields; returns the merged config. */
export async function saveConfig(patch: Partial<MusicConfig>): Promise<MusicConfig> {
	const current = await loadConfig();
	const next: MusicConfig = {
		neteaseCookie: typeof patch.neteaseCookie === 'string' ? patch.neteaseCookie : current.neteaseCookie,
		defaultPlaylist: typeof patch.defaultPlaylist === 'string' ? patch.defaultPlaylist : current.defaultPlaylist,
		br: typeof patch.br === 'number' && patch.br > 0 ? patch.br : current.br,
		volume: typeof patch.volume === 'number' ? patch.volume : current.volume,
		biliCookie: typeof patch.biliCookie === 'string' ? patch.biliCookie : current.biliCookie,
		biliFolder: typeof patch.biliFolder === 'string' ? patch.biliFolder : current.biliFolder
	};
	await mkdir(DIR, { recursive: true });
	await writeFile(FILE, JSON.stringify(next, null, '\t'), 'utf8');
	return next;
}

/** Config without secrets, for the browser. */
export function publicConfig(
	config: MusicConfig
): Omit<MusicConfig, 'neteaseCookie' | 'biliCookie'> & { hasCookie: boolean; hasBiliCookie: boolean } {
	return {
		defaultPlaylist: config.defaultPlaylist,
		br: config.br,
		volume: config.volume,
		biliFolder: config.biliFolder,
		hasCookie: config.neteaseCookie !== '',
		hasBiliCookie: config.biliCookie !== ''
	};
}

interface SettingsScopeLike {
	get(): unknown;
	watch(callback: (next: unknown, prev: unknown) => void): () => void;
	update(patch: object): Promise<void>;
}

export interface ConfigBridge {
	/** Resolved settings value, or undefined when the settings service is absent. */
	get(): MusicConfig | undefined;
	/** Persist through settings when available, else the config file. */
	update(patch: Partial<MusicConfig>): Promise<void>;
}

interface InjectContext {
	inject?(deps: string[], callback: (scoped: Record<string, unknown>) => void): unknown;
}

/**
 * Register the `dsh-music` settings namespace. When the settings service is not
 * composed (headless profiles), the plugin silently keeps using config.json.
 */
export function installSettings(
	ctx: InjectContext,
	onChange: (config: MusicConfig) => void,
	log: (level: 'info' | 'warn', message: string) => void
): ConfigBridge {
	let scope: SettingsScopeLike | undefined;

	if (typeof ctx.inject === 'function') {
		try {
			ctx.inject(['settings'], (scoped) => {
				try {
					const settings = scoped.settings as { register(ns: string, schema: unknown, options: object): SettingsScopeLike };
					scope = settings.register(SETTINGS_NS, settingsSchema, { base: DEFAULT_CONFIG, applies: 'live' });
					onChange(toConfig(scope.get() as Record<string, unknown>));
					const dispose = scope.watch((next) => onChange(toConfig(next as Record<string, unknown>)));
					const effect = scoped.effect as ((callback: () => () => void) => unknown) | undefined;
					effect?.(() => () => dispose());
					log('info', `设置命名空间 "${SETTINGS_NS}" 已注册`);
				} catch (error) {
					log('warn', `设置命名空间注册失败，回退到 config.json：${error instanceof Error ? error.message : String(error)}`);
				}
			});
		} catch (error) {
			log('warn', `settings 服务不可用，回退到 config.json：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return {
		get: () => (scope === undefined ? undefined : toConfig(scope.get() as Record<string, unknown>)),
		update: async (patch) => {
			if (scope !== undefined) {
				const payload: Record<string, unknown> = {};
				for (const key of ['neteaseCookie', 'defaultPlaylist', 'br', 'volume', 'biliCookie', 'biliFolder'] as const) {
					if (patch[key] !== undefined) payload[key] = patch[key];
				}
				await scope.update(payload);
				return;
			}
			await saveConfig(patch);
		}
	};
}
