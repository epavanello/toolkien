import type { Attachment } from 'svelte/attachments';

/**
 * Viewport and tab visibility for brand motion (`{@attach view.attach}` on the animated root).
 * `visible`: on screen and the tab is shown, so looping animations can pause otherwise (CSS
 * `animation-play-state`). `seen`: entered the viewport once, to start one-shot animations.
 * `mounted`: hydrated, so a one-shot animation can hide its first frame without a flash in SSR.
 */
export class InView {
	visible = $state(false);
	seen = $state(false);
	mounted = $state(false);

	readonly #threshold: number;

	/** `threshold`: share of the element that must be on screen to count as seen */
	constructor(threshold = 0.2) {
		this.#threshold = threshold;
	}

	attach: Attachment<Element> = (node) => {
		this.mounted = true;
		let intersecting = false;
		const update = () => {
			this.visible = intersecting && document.visibilityState === 'visible';
			if (this.visible) this.seen = true;
		};
		const observer = new IntersectionObserver(
			([entry]) => {
				intersecting = entry.isIntersecting;
				update();
			},
			{ threshold: this.#threshold }
		);
		observer.observe(node);
		document.addEventListener('visibilitychange', update);
		return () => {
			observer.disconnect();
			document.removeEventListener('visibilitychange', update);
		};
	};
}
