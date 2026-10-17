import { getChannel, getUserChannels } from './arena';
import { buildFolders, isFolder, isInbox } from './seeds';
import type { Channel } from './types';

/**
 * Every channel the signed-in user owns. Seeds finds its Inbox and folders by title, so
 * (unlike a plain channel list) this has to load all pages, 100 per request, up front.
 */
class ChannelList {
	items = $state.raw<Channel[]>([]);
	loading = $state(false);
	/** True once every page has been fetched, so "no Inbox" really means no Inbox. */
	loaded = $state(false);
	error = $state<string | null>(null);

	inbox = $derived(this.items.find((c) => isInbox(c)) ?? null);
	folders = $derived(buildFolders(this.items));
	/** Everything that isn't the Inbox or a Seeds folder. */
	others = $derived(this.items.filter((c) => !isInbox(c) && !isFolder(c)));

	private page = 0;
	private userSlug: string | null = null;
	private generation = 0;

	reset(userSlug: string) {
		this.generation++;
		this.userSlug = userSlug;
		this.page = 0;
		this.items = [];
		this.loaded = false;
		this.error = null;
		this.loading = false;
	}

	/** Re-fetches everything (used to recover after a partially-failed rename). */
	reload() {
		if (!this.userSlug) return;
		this.reset(this.userSlug);
		void this.loadAll();
	}

	async loadAll() {
		const slug = this.userSlug;
		if (!slug || this.loading || this.loaded) return;

		const generation = this.generation;
		this.loading = true;
		this.error = null;
		try {
			for (;;) {
				const next = this.page + 1;
				const res = await getUserChannels(slug, next);
				// Ignore the response if the user changed (or we were reset) while waiting.
				if (generation !== this.generation) return;

				// Pages are ordered by updated_at, so they can shift while we load: de-dupe by id.
				const byId = new Map(this.items.map((c) => [c.id, c]));
				for (const c of res.data) {
									if (c.type === 'Channel' && c.state !== 'deleted') byId.set(c.id, c);
								}
				this.items = [...byId.values()];

				this.page = next;
				if (!res.meta.has_more_pages) {
					this.loaded = true;
					return;
				}
			}
		} catch (e) {
			if (generation === this.generation) {
				this.error = e instanceof Error ? e.message : 'Failed to load channels.';
			}
		} finally {
			if (generation === this.generation) this.loading = false;
		}
	}

	add(channel: Channel) {
		this.items = [channel, ...this.items.filter((c) => c.id !== channel.id)];
	}

	remove(id: number) {
		this.items = this.items.filter((c) => c.id !== id);
	}

	update(id: number, fn: (channel: Channel) => Channel) {
		this.items = this.items.map((c) => (c.id === id ? fn(c) : c));
	}

	/** Keeps sidebar badges honest after blocks are added/moved, without refetching. */
	adjustCount(id: number | null | undefined, delta: number) {
		if (id == null) return;
		this.update(id, (c) => ({
			...c,
			counts: {
				...c.counts,
				blocks: Math.max(0, c.counts.blocks + delta),
				contents: Math.max(0, c.counts.contents + delta)
			}
		}));
	}

	/** Removing an embedded channel changes channel/contents counts, never block counts. */
	adjustChannelCount(id: number, delta: number) {
		this.update(id, (c) => ({
			...c,
			counts: {
				...c.counts,
				channels: Math.max(0, c.counts.channels + delta),
				contents: Math.max(0, c.counts.contents + delta)
			}
		}));
	}

	/** Applies new titles (id -> title) in one pass, e.g. when a folder subtree is nested. */
	retitle(titles: Map<number, string>) {
		this.items = this.items.map((c) => {
			const title = titles.get(c.id);
			return title === undefined ? c : { ...c, title };
		});
	}

	/** Adopts fresh counts from a channel we just fetched. */
	syncCounts(fresh: Channel) {
		const current = this.items.find((c) => c.id === fresh.id);
		if (!current) return;
		const a = current.counts;
		const b = fresh.counts;
		if (a.blocks === b.blocks && a.contents === b.contents && a.channels === b.channels) return;
		this.update(fresh.id, (c) => ({ ...c, counts: b }));
	}

	/** Re-reads one channel's counts (e.g. the Inbox after something else added to it). */
	async refreshCounts(id: number) {
		try {
			this.syncCounts(await getChannel(id));
		} catch {
			// stale badge is fine
		}
	}

	bySlug(slug: string) {
		return this.items.find((c) => c.slug === slug) ?? null;
	}
}

export const channels = new ChannelList();
