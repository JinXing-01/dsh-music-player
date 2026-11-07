/** Shared data shapes for the host and browser halves. */
export const MODES = ['list', 'single', 'shuffle'];
export function trackUrl(track) {
    if (track.source === 'netease') {
        return `/dsh-music-v2/stream?source=netease&id=${encodeURIComponent(track.sourceId ?? '')}`;
    }
    if (track.source === 'bilibili') {
        const cid = track.cid !== undefined ? `&cid=${track.cid}` : '';
        return `/dsh-music-v2/stream?source=bilibili&bvid=${encodeURIComponent(track.bvid ?? '')}${cid}`;
    }
    return track.url ?? '';
}
