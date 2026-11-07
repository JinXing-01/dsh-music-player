const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE_COOKIE = 'os=pc; appver=8.9.70';
class NeteaseError extends Error {
    status;
    constructor(message, status = 502) {
        super(message);
        this.status = status;
    }
}
function headers(options) {
    return {
        'user-agent': UA,
        referer: 'https://music.163.com/',
        cookie: options.cookie !== undefined && options.cookie !== '' ? options.cookie : BASE_COOKIE
    };
}
async function getJson(url, options, timeoutMs = 12000) {
    let res;
    try {
        res = await fetch(url, { headers: headers(options), signal: AbortSignal.timeout(timeoutMs) });
    }
    catch (error) {
        throw new NeteaseError(`网易云请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok)
        throw new NeteaseError(`网易云返回 ${res.status}`);
    try {
        return await res.json();
    }
    catch {
        throw new NeteaseError('网易云返回了非 JSON 响应');
    }
}
const cover = (url) => {
    if (typeof url !== 'string' || url === '')
        return '';
    return `${url}?param=200y200`;
};
const artistNames = (value) => {
    if (!Array.isArray(value))
        return '未知歌手';
    const names = value
        .map((artist) => artist.name)
        .filter((name) => typeof name === 'string' && name !== '');
    return names.length > 0 ? names.join(' / ') : '未知歌手';
};
const searchCache = new Map();
const playlistCache = new Map();
const resolveCache = new Map();
const SEARCH_TTL = 60_000;
const PLAYLIST_TTL = 300_000;
const RESOLVE_TTL = 480_000;
function cached(map, key, ttl) {
    const hit = map.get(key);
    if (hit === undefined)
        return undefined;
    if (Date.now() - hit.at > ttl) {
        map.delete(key);
        return undefined;
    }
    return hit.value;
}
/** Search songs by title/artist keyword. */
export async function search(query, limit, options) {
    const key = `search:${limit}:${query}`;
    const hit = cached(searchCache, key, SEARCH_TTL);
    if (hit !== undefined)
        return hit;
    const encoded = encodeURIComponent(query);
    const urls = [
        `https://music.163.com/api/search/get/web?s=${encoded}&type=1&limit=${limit}&offset=0`,
        `https://music.163.com/api/search/get?s=${encoded}&type=1&limit=${limit}&offset=0`
    ];
    let lastError;
    for (const url of urls) {
        try {
            const data = (await getJson(url, options));
            const songs = data.result?.songs;
            if (!Array.isArray(songs))
                continue;
            const rows = songs
                .filter((song) => typeof song === 'object' && song !== null && typeof song.id === 'number')
                .map((song) => ({
                id: String(song.id),
                title: String(song.name ?? '未知歌曲'),
                artist: artistNames(song.artists ?? song.ar),
                album: String(song.album?.name ?? song.al?.name ?? ''),
                cover: cover(song.album?.picUrl ?? song.al?.picUrl),
                durationMs: typeof song.duration === 'number' ? song.duration : typeof song.dt === 'number' ? song.dt : 0
            }));
            searchCache.set(key, { value: rows, at: Date.now() });
            return rows;
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError ?? new NeteaseError('网易云搜索失败');
}
/** Load a playlist by id (accepts plain ids; links are parsed by the caller). */
export async function playlist(id, options) {
    const key = `playlist:${id}`;
    const hit = cached(playlistCache, key, PLAYLIST_TTL);
    if (hit !== undefined)
        return hit;
    const data = (await getJson(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=1000`, options));
    const tracks = data.playlist?.tracks;
    if (!Array.isArray(tracks))
        throw new NeteaseError('歌单不存在或无权访问');
    const rows = tracks
        .filter((song) => typeof song === 'object' && song !== null && typeof song.id === 'number')
        .map((song) => ({
        id: String(song.id),
        title: String(song.name ?? '未知歌曲'),
        artist: artistNames(song.ar ?? song.artists),
        album: String(song.al?.name ?? song.album?.name ?? ''),
        cover: cover(song.al?.picUrl ?? song.album?.picUrl),
        durationMs: typeof song.dt === 'number' ? song.dt : typeof song.duration === 'number' ? song.duration : 0
    }));
    const result = { name: String(data.playlist?.name ?? '未命名歌单'), tracks: rows };
    playlistCache.set(key, { value: result, at: Date.now() });
    return result;
}
/**
 * Resolve a playable CDN URL through the official player-url endpoint.
 * Anonymous requests still return full 320 kbps URLs for free tracks; VIP
 * tracks come back with an empty url unless the cookie owns them.
 */
export async function resolveStream(id, options) {
    const br = options.br ?? 320000;
    const key = `resolve:${id}:${br}`;
    const hit = cached(resolveCache, key, RESOLVE_TTL);
    if (hit !== undefined)
        return hit;
    const data = (await getJson(`https://music.163.com/api/song/enhance/player/url?ids=[${encodeURIComponent(id)}]&br=${br}`, options));
    const row = Array.isArray(data.data) ? data.data[0] : undefined;
    const url = typeof row?.url === 'string' ? row.url : '';
    if (url === '' || !/^https?:\/\//.test(url)) {
        resolveCache.set(key, { value: null, at: Date.now() });
        return null;
    }
    const bitrate = typeof row?.br === 'number' ? row.br : br;
    const durationMs = typeof row?.size === 'number' && bitrate > 0 ? Math.round((row.size * 8 * 1000) / bitrate) : 0;
    const format = typeof row?.type === 'string' && row.type !== '' ? row.type : 'mp3';
    const freeTrial = row?.freeTrialInfo !== undefined && row?.freeTrialInfo !== null;
    const trial = freeTrial || durationMs < 45_000;
    const resolved = { url, format, bitrate, durationMs, trial, expiresAt: Date.now() + RESOLVE_TTL };
    resolveCache.set(key, { value: resolved, at: Date.now() });
    return resolved;
}
/** Extract a playlist id from a raw id or a share link. */
export function parsePlaylistId(raw) {
    const value = raw.trim();
    if (/^\d+$/.test(value))
        return value;
    const match = /music\.163\.com\/(?:playlist|#\/playlist)[^0-9]*(\d+)/.exec(value);
    return match?.[1];
}
