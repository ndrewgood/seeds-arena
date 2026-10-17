export interface Crumb {
	slug: string;
	title: string;
}

/**
 * Remembers which channel(s) you drilled in from for non-folder breadcrumbs.
 * Folder breadcrumbs use the folder hierarchy. Sidebar navigation starts a fresh trail.
 */
class Nav {
	trail = $state<Crumb[]>([]);

	push(crumb: Crumb) {
		this.trail = [...this.trail, crumb];
	}

	pop(): Crumb | undefined {
		const last = this.trail.at(-1);
		this.trail = this.trail.slice(0, -1);
		return last;
	}

	clear() {
		if (this.trail.length) this.trail = [];
	}
}

export const nav = new Nav();
