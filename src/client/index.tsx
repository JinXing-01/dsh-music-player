/** dsh-music-v2 — browser half: registers the floating player into the shell overlay. */
import { MusicOverlay } from './app.js';
import { CSS } from './styles.js';

interface ClientContext {
	slots: {
		/** Wait until a slot name is declared, then run the registration callback. */
		inject(name: string, callback: () => void | (() => void)): () => void;
		register(options: Record<string, unknown>, component: unknown): () => void;
	};
}

export const name = 'dsh-music-v2';
export const inject = ['slots'];

const STYLE_ID = 'dsh-music-v2/styles';

/** Inject the stylesheet once per page (idempotent across HMR reloads). */
function ensureStyles(): void {
	if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return;
	const tag = document.createElement('style');
	tag.dataset.plugin = 'dsh-music-v2';
	tag.dataset.pluginCss = STYLE_ID;
	tag.textContent = CSS;
	document.head.appendChild(tag);
}

export function apply(ctx: ClientContext): void {
	ensureStyles();
	ctx.slots.inject('shell.overlay', () =>
		ctx.slots.register(
			{
				name: 'shell.overlay',
				id: 'dsh-music-v2',
				order: 40
			},
			MusicOverlay
		)
	);
}
