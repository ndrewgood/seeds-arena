import { SvelteMap } from 'svelte/reactivity';
import { getChannelContents } from './arena';
import { imageFor } from './media';
import type { Channel } from './types';

const MAX_THUMBS = 4;
const CONCURRENCY = 2;

type PreviewJob = { channel: Channel; members: Channel[]; key: string };

/** Lazily fetch folder thumbnails, preferring direct blocks before searching descendants. */
export class Previews {
	private cache = new SvelteMap<number, { key: string; urls: string[] }>();
	private requested = new Map<number, PreviewJob>();

	private queue: PreviewJob[] = [];
	private active = 0;

	get(channelId: number): string[] | undefined {
		return this.cache.get(channelId)?.urls;
	}

	request(channel: Channel, members: Channel[] = [channel]) {
		const key = JSON.stringify(members.map((member) =>
			[member.id, member.slug, member.title, member.counts.blocks, member.updated_at]));
		if (this.cache.get(channel.id)?.key === key || this.requested.get(channel.id)?.key === key) return;
		const job = { channel, members, key };
		this.requested.set(channel.id, job);
		if (members.every((member) => member.counts.blocks === 0)) {
			this.cache.set(channel.id, { key, urls: [] });
			return;
		}
		this.queue.push(job);
		this.pump();
	}

	invalidate(channelId: number) {
		// A changed child also changes every parent preview that searched its subtree.
		for (const [id, job] of this.requested) {
			if (job.members.some((member) => member.id === channelId)) {
				this.requested.delete(id);
				this.cache.delete(id);
			}
		}
		this.cache.delete(channelId);
	}

	private pump() {
		while (this.active < CONCURRENCY && this.queue.length) {
			const job = this.queue.shift()!;
			if (this.requested.get(job.channel.id) !== job) continue;
			this.active++;
			void this.fetch(job).finally(() => {
				this.active--;
				this.pump();
			});
		}
	}

	private async fetch(job: PreviewJob) {
		const urls = new Set<string>();
		for (const member of job.members) {
			if (urls.size === MAX_THUMBS || this.requested.get(job.channel.id) !== job) break;
			if (member.counts.blocks === 0) continue;
			try {
				let page = 1;
				for (;;) {
					const res = await getChannelContents(member.slug, { page, per: 8, sort: 'position_desc' });
					for (const item of res.data) {
						const image = item.type === 'Channel' ? null : imageFor(item);
						if (image?.square?.src) urls.add(image.square.src);
						if (urls.size === MAX_THUMBS) break;
					}
					if (urls.size === MAX_THUMBS || !res.meta.has_more_pages ||
						this.requested.get(job.channel.id) !== job) break;
					page++;
				}
			} catch {
				// An unavailable folder should not hide previews from the remaining descendants.
			}
		}
		if (this.requested.get(job.channel.id) === job) {
			this.cache.set(job.channel.id, { key: job.key, urls: [...urls] });
		}
	}
}

export const previews = new Previews();
