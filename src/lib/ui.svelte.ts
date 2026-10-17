const KEY = 'seeds.ui';

/** Sidebar chrome that should survive reloads: which sections/folders are open. */
class Ui {
	// The Channels section starts collapsed.
	#channelsOpen = $state(false);
	#expanded = $state.raw<Set<number>>(new Set());

	/** The "set up Seeds" dialog (offered after signing in on an account with no Inbox). */
	initPrompt = $state(false);
	initializing = $state(false);
	/** A rename spans multiple Are.na writes; prevent overlapping folder moves/renames. */
	folderRenaming = $state(false);

	constructor() {
		if (typeof localStorage === 'undefined') return;
		try {
			const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (typeof saved.channelsOpen === 'boolean') this.#channelsOpen = saved.channelsOpen;
			if (Array.isArray(saved.expanded)) {
				this.#expanded = new Set(saved.expanded.filter((n: unknown) => typeof n === 'number'));
			}
		} catch {
			// ignore corrupt state
		}
	}

	get channelsOpen() {
		return this.#channelsOpen;
	}

	openChannels() {
		if (this.#channelsOpen) return;
		this.#channelsOpen = true;
		this.save();
	}

	toggleChannels() {
		this.#channelsOpen = !this.#channelsOpen;
		this.save();
	}

	isExpanded(id: number) {
		return this.#expanded.has(id);
	}

	toggle(id: number) {
		const next = new Set(this.#expanded);
		if (!next.delete(id)) next.add(id);
		this.#expanded = next;
		this.save();
	}

	expand(ids: number[]) {
		if (ids.every((id) => this.#expanded.has(id))) return;
		this.#expanded = new Set([...this.#expanded, ...ids]);
		this.save();
	}

	private save() {
		localStorage.setItem(
			KEY,
			JSON.stringify({ channelsOpen: this.#channelsOpen, expanded: [...this.#expanded] })
		);
	}
}

export const ui = new Ui();
