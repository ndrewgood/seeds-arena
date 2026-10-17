import { getChannel, getChannelContents } from './arena';
import type { Block, Channel, Connectable, SortKey } from './types';

const PAGE_SIZE = 50;
const MAX_AGE_MS = 5 * 60 * 1000;

export function keyOf(item: Connectable) {
	return `${item.type === 'Channel' ? 'c' : 'b'}${item.id}`;
}

/** A paged, incrementally-loaded view of one channel's contents. */
export class ChannelFeed {
	channel = $state.raw<Channel | null>(null);
	items = $state.raw<Connectable[]>([]);
	loading = $state(false);
	hasMore = $state(true);
	total = $state(0);
	error = $state<string | null>(null);
	/** Pages fetched so far; lets the infinite-scroll sentinel re-check even if a page added nothing new. */
	pages = $state(0);

	readonly createdAt = Date.now();
	started = false;
	private page = 0;
	/** Items removed locally since the last page load; later pages shift left by this many. */
	private removed = 0;
	private refreshing = false;

	constructor(
		public slug: string,
		readonly sort: SortKey
	) {}

	/** Kicks off the first load. Safe to call repeatedly. */
	start() {
		if (this.started) return;
		this.started = true;
		void this.loadChannel();
		void this.loadMore();
	}

	private async loadChannel() {
		try {
			this.channel = await getChannel(this.slug);
		} catch {
			// The contents request surfaces the useful error; the header just falls back.
		}
	}

	async loadMore() {
		if (this.loading || !this.hasMore) return;
		this.loading = true;
		this.error = null;
		try {
			// After local removals the first unseen item has slid back into the last page we loaded.
			const next = this.removed > 0 && this.page > 0 ? this.page : this.page + 1;
			const res = await getChannelContents(this.slug, { page: next, per: PAGE_SIZE, sort: this.sort });
			const known = new Set(this.items.map(keyOf));
			this.items = [...this.items, ...res.data.filter((i) => !known.has(keyOf(i)))];
			this.page = next;
			this.removed = 0;
			this.pages++;
			this.hasMore = res.meta.has_more_pages;
			this.total = res.meta.total_count;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to load channel.';
		} finally {
			this.loading = false;
		}
	}

	/** Pulls in newly-added items without disturbing what's already on screen. */
	async refresh() {
		if (!this.started || this.refreshing) return;
		this.refreshing = true;
		try {
			const res = await getChannelContents(this.slug, { page: 1, per: PAGE_SIZE, sort: this.sort });
			const known = new Set(this.items.map(keyOf));
			const fresh = res.data.filter((i) => !known.has(keyOf(i)));
			if (fresh.length) {
				if (this.sort !== 'created_at_asc') this.items = [...fresh, ...this.items];
				else if (!this.hasMore) this.items = [...this.items, ...fresh];
			}
			this.total = res.meta.total_count;
			void this.loadChannel();
		} catch {
			// A failed background refresh isn't worth surfacing.
		} finally {
			this.refreshing = false;
		}
	}

	/** Removes an item locally. Returns a function that puts it back, or null if it wasn't here. */
	remove(type: 'b' | 'c', id: number): (() => void) | null {
		const key = `${type}${id}`;
		const index = this.items.findIndex((i) => keyOf(i) === key);
		if (index < 0) return null;
		const item = this.items[index];
		this.items = this.items.filter((_, i) => i !== index);
		this.total = Math.max(0, this.total - 1);
		this.removed++;
		return () => {
			if (this.items.some((i) => keyOf(i) === key)) return;
			const at = Math.min(index, this.items.length);
			this.items = [...this.items.slice(0, at), item, ...this.items.slice(at)];
			this.total++;
			this.removed = Math.max(0, this.removed - 1);
		};
	}
}

const cache = new Map<string, ChannelFeed>();

/** Returns a cached feed (so revisiting a channel is instant), refreshing it after a few minutes. */
export function getFeed(slug: string, sort: SortKey): ChannelFeed {
	const key = `${slug}:${sort}`;
	const existing = cache.get(key);
	if (existing && Date.now() - existing.createdAt < MAX_AGE_MS) return existing;

	const feed = new ChannelFeed(slug, sort);
	cache.set(key, feed);
	return feed;
}

export function refreshFeed(slug: string, sort: SortKey): ChannelFeed {
	cache.delete(`${slug}:${sort}`);
	return getFeed(slug, sort);
}

/** Keeps open grids and cached channel tiles current after a folder rename, including changed slugs. */
export function updateChannelFeeds(changes: { before: Channel; after: Channel }[]) {
	const byId = new Map(changes.map(({ after }) => [after.id, after]));
	for (const [key, feed] of [...cache]) {
		const changed = changes.find(({ before }) => before.slug === feed.slug || before.id === feed.channel?.id);
		if (changed) {
			feed.slug = changed.after.slug;
			feed.channel = changed.after;
			cache.delete(key);
			cache.set(`${feed.slug}:${feed.sort}`, feed);
		}
		feed.items = feed.items.map((item) => {
			if (item.type !== 'Channel') return item;
			const updated = byId.get(item.id);
			return updated ? { ...updated, connection: item.connection } : item;
		});
	}
}

/** Updates block metadata everywhere while keeping each channel's connection context. */
export function updateBlockFeeds(block: Block) {
	for (const feed of cache.values()) {
		if (!feed.items.some((item) => item.type !== 'Channel' && item.id === block.id)) continue;
		feed.items = feed.items.map((item) =>
			item.type !== 'Channel' && item.id === block.id
				? { ...block, connection: item.connection }
				: item
		);
	}
}

/** Something was added to `slug`: update any feeds we've loaded, forget the rest. */
export function refreshChannelFeeds(slug: string) {
	for (const [key, feed] of cache) {
		if (feed.slug !== slug) continue;
		if (feed.started) void feed.refresh();
		else cache.delete(key);
	}
}

/** Updates channel metadata in headers and embedded tiles without touching same-id blocks. */
export function adjustChannelFeedCounts(id: number, kind: 'blocks' | 'channels', delta: number) {
	const adjust = (channel: Channel): Channel => ({
		...channel,
		counts: {
			...channel.counts,
			[kind]: Math.max(0, channel.counts[kind] + delta),
			contents: Math.max(0, channel.counts.contents + delta)
		}
	});
	for (const feed of cache.values()) {
		if (feed.channel?.id === id) feed.channel = adjust(feed.channel);
		feed.items = feed.items.map((item) =>
			item.type === 'Channel' && item.id === id ? adjust(item) : item
		);
	}
}

/** Evicts this channel's feeds and removes only its Channel tiles from other cached feeds. */
export function removeChannelFromFeeds(channel: Channel): number[] {
	const parents = new Set<number>();
	for (const [key, feed] of cache) {
		if (feed.slug === channel.slug || feed.channel?.id === channel.id) {
			cache.delete(key);
			feed.items = [];
			feed.channel = null;
			feed.total = 0;
			feed.hasMore = false;
			continue;
		}
		if (feed.remove('c', channel.id) && feed.channel) parents.add(feed.channel.id);
	}
	for (const id of parents) adjustChannelFeedCounts(id, 'channels', -1);
	return [...parents];
}

/** Removes a block from every loaded feed of `slug`. Call the result to undo if optimistic. */
export function removeBlockFromFeeds(slug: string, blockId: number): () => void {
	const undos: (() => void)[] = [];
	for (const feed of cache.values()) {
		if (feed.slug !== slug) continue;
		const undo = feed.remove('b', blockId);
		if (undo) undos.push(undo);
	}
	return () => undos.forEach((undo) => undo());
}
