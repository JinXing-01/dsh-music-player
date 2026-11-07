/** Playback state persistence: one JSON document, atomic writes, debounced. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
const DSH_HOME = process.env.DSH_HOME ?? path.join(homedir(), '.dsh');
const DIR = path.join(DSH_HOME, 'storages', 'dsh-music-v2');
const FILE = path.join(DIR, 'state.json');
export async function loadPersisted() {
    try {
        const raw = await readFile(FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export class StateStore {
    timer;
    pending;
    /** Queue a save; writes at most once per `delayMs` with the latest snapshot. */
    schedule(state, delayMs = 800) {
        this.pending = {
            queue: state.queue,
            index: state.index,
            mode: state.mode,
            volume: state.volume,
            positionMs: state.positionMs,
            updatedAt: state.updatedAt
        };
        if (this.timer !== undefined)
            return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
        }, delayMs);
        this.timer.unref?.();
    }
    async flush() {
        const snapshot = this.pending;
        this.pending = undefined;
        if (snapshot === undefined)
            return;
        try {
            await mkdir(DIR, { recursive: true });
            const tmp = `${FILE}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify(snapshot), 'utf8');
            await rename(tmp, FILE);
        }
        catch {
            /* persistence is best-effort: never break playback for it */
        }
    }
    async stop() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        await this.flush();
    }
}
